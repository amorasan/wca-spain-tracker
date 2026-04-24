/**
 * Bot interactivo para consultar competiciones WCA en España.
 * Despliega esto en Cloudflare Workers (gratis, serverless).
 *
 * Variables de entorno (configurar en el dashboard de Workers):
 *   TELEGRAM_TOKEN   Token del bot
 *   ALLOWED_CHAT_ID  Tu chat id (para que solo tú puedas usarlo)
 *   STATE_URL        URL raw del JSON, p. ej.
 *                    https://raw.githubusercontent.com/<user>/<repo>/main/data/competitions.json
 *
 * Comandos:
 *   /proximas              Lista las próximas 10 competiciones
 *   /horario <comp_id>     Horario completo de una competición
 *   /buscar <texto>        Busca por nombre o ciudad
 *   /help                  Ayuda
 */

const TELEGRAM_API = (token, method) =>
  `https://api.telegram.org/bot${token}/${method}`;

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("WCA Spain bot is alive", { status: 200 });
    }

    const update = await request.json();
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return new Response("ok");

    // Authorization: only the configured chat can use the bot
    if (String(msg.chat.id) !== String(env.ALLOWED_CHAT_ID)) {
      return new Response("ok");
    }

    const reply = await handleCommand(msg.text.trim(), env);
    if (reply) {
      await sendMessage(env.TELEGRAM_TOKEN, msg.chat.id, reply);
    }
    return new Response("ok");
  },
};

async function handleCommand(text, env) {
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmdLower = cmdRaw.toLowerCase().split("@")[0];
  const arg = rest.join(" ");

  // /horario_<id> — preserve original case for the id
  if (cmdLower.startsWith("/horario_")) {
    const id = cmdRaw.split("@")[0].slice("/horario_".length);
    return cmdHorario(id, env);
  }

  if (cmdLower.startsWith("/inscripcion_")) {
    const id = cmdRaw.split("@")[0].slice("/inscripcion_".length);
    return cmdInscripcion(id, env);
  }
  
  const cmd = cmdLower;

  switch (cmd) {
    case "/start":
    case "/help":
      return helpText();
    case "/proximas":
      return cmdProximas(env);
    case "/horario":
      return arg ? cmdHorario(arg, env) : "Uso: <code>/horario &lt;competition_id&gt;</code>";
    case "/inscripcion":
      return arg ? cmdInscripcion(arg, env) : "Uso: <code>/inscripcion &lt;competition_id&gt;</code>";
    case "/buscar":
      return arg ? cmdBuscar(arg, env) : "Uso: <code>/buscar &lt;texto&gt;</code>";
    default:
      return null;
  }
}

function helpText() {
  return [
    "<b>Bot WCA España</b>",
    "",
    "/proximas — próximas 10 competiciones",
    "/horario &lt;id&gt; — horario completo de una competición",
    "/buscar &lt;texto&gt; — busca por nombre o ciudad",
    "/inscripcion &lt;id&gt; — cuándo abre y cierra la inscripción",
    "",
    "El <code>id</code> es el identificador WCA, p. ej. <code>MadridOpen2026</code>.",
  ].join("\n");
}

async function loadState(env) {
  const r = await fetch(env.STATE_URL, { cf: { cacheTtl: 60 } });
  if (!r.ok) throw new Error(`No pude leer el estado (${r.status})`);
  const data = await r.json();
  return data.competitions || {};
}

async function cmdProximas(env) {
  const state = await loadState(env);
  const list = Object.values(state).sort((a, b) =>
    a.start_date.localeCompare(b.start_date)
  ).slice(0, 10);

  if (!list.length) return "No tengo competiciones registradas todavía.";

  return [
    "<b>Próximas competiciones en España</b>",
    "",
    ...list.map(c =>
      `• <b>${escapeHtml(c.name)}</b>\n` +
      `  📍 ${escapeHtml(c.city)}  📅 ${c.start_date}\n` +
      `  /horario_${c.id}`
    ),
  ].join("\n\n");
}

async function cmdHorario(id, env) {
  const state = await loadState(env);
  const c = state[id];
  if (!c) return `No encuentro <code>${escapeHtml(id)}</code>. Prueba /proximas.`;

  const lines = (c.schedule || [])
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start))
    .map(a => `  • ${a.start.slice(0, 16).replace("T", " ")} — ${escapeHtml(a.name)}`);

  return [
    `<b>${escapeHtml(c.name)}</b>`,
    `📍 ${escapeHtml(c.city)}`,
    `📅 ${c.start_date} → ${c.end_date}`,
    `🧩 ${c.events.join(", ") || "—"}`,
    "",
    "<b>Horario:</b>",
    lines.length ? lines.join("\n") : "<i>Aún no publicado.</i>",
    "",
    `🔗 https://www.worldcubeassociation.org/competitions/${c.id}`,
  ].join("\n");
}

async function cmdBuscar(query, env) {
  const state = await loadState(env);
  const q = query.toLowerCase();
  const hits = Object.values(state).filter(c =>
    c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q)
  );
  if (!hits.length) return `Sin resultados para <i>${escapeHtml(query)}</i>.`;
  return hits.slice(0, 15).map(c =>
    `• <b>${escapeHtml(c.name)}</b> — ${escapeHtml(c.city)} (${c.start_date})\n  /horario_${c.id}`
  ).join("\n\n");
}

async function sendMessage(token, chatId, text) {
  await fetch(TELEGRAM_API(token, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

function fmtMadrid(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

async function cmdInscripcion(id, env) {
  const state = await loadState(env);
  const c = state[id] ||
            Object.values(state).find(x => x.id.toLowerCase() === id.toLowerCase());
  if (!c) return `No encuentro <code>${escapeHtml(id)}</code>. Prueba /proximas.`;

  return [
    `<b>${escapeHtml(c.name)}</b>`,
    `📍 ${escapeHtml(c.city)}`,
    "",
    `📝 <b>Inscripción</b>`,
    `Abre:   ${fmtMadrid(c.registration_open)}`,
    `Cierra: ${fmtMadrid(c.registration_close)}`,
    `Plazas: ${c.competitor_limit || "sin límite"}`,
    "",
    `🔗 https://www.worldcubeassociation.org/competitions/${c.id}/register`,
  ].join("\n");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[ch]));
}
