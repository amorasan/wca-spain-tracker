/**
 * Bot interactivo + suscripciones para WCA España.
 * Lee competitions.json y subscribers.json desde GitHub raw.
 * Escribe subscribers.json vía la API de GitHub.
 */

const TELEGRAM_API = (token, method) =>
  `https://api.telegram.org/bot${token}/${method}`;

const GH_API = "https://api.github.com";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("WCA Spain bot is alive", { status: 200 });
    }

    const update = await request.json();
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return new Response("ok");

    try {
      const reply = await handleCommand(msg, env);
      if (reply) await sendMessage(env.TELEGRAM_TOKEN, msg.chat.id, reply);
    } catch (e) {
      console.error("handler error:", e);
      await sendMessage(env.TELEGRAM_TOKEN, msg.chat.id,
        `⚠️ Error interno: <code>${escapeHtml(String(e.message || e))}</code>`);
    }
    return new Response("ok");
  },
};

// --------------------------- Commands ---------------------------

async function handleCommand(msg, env) {
  const text = msg.text.trim();
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmdLower = cmdRaw.toLowerCase().split("@")[0];
  const arg = rest.join(" ");

  // Tappable commands with id appended after underscore
  if (cmdLower.startsWith("/horario_")) {
    return cmdHorario(cmdRaw.split("@")[0].slice("/horario_".length), env);
  }
  if (cmdLower.startsWith("/inscripcion_")) {
    return cmdInscripcion(cmdRaw.split("@")[0].slice("/inscripcion_".length), env);
  }

  switch (cmdLower) {
    case "/start":
      return cmdStart(msg, env);
    case "/stop":
      return cmdStop(msg, env);
    case "/help":
      return helpText();
    case "/proximas":
      return cmdProximas(env);
    case "/horario":
      return arg ? cmdHorario(arg, env)
                 : "Uso: <code>/horario &lt;competition_id&gt;</code>";
    case "/inscripcion":
      return arg ? cmdInscripcion(arg, env)
                 : "Uso: <code>/inscripcion &lt;competition_id&gt;</code>";
    case "/buscar":
      return arg ? cmdBuscar(arg, env)
                 : "Uso: <code>/buscar &lt;texto&gt;</code>";
    default:
      return null;
  }
}

function helpText() {
  return [
    "<b>Bot WCA España</b>",
    "",
    "/start — suscribirte a las novedades",
    "/stop — darte de baja",
    "/proximas — próximas 10 competiciones",
    "/horario &lt;id&gt; — horario completo",
    "/inscripcion &lt;id&gt; — cuándo abre/cierra la inscripción",
    "/buscar &lt;texto&gt; — busca por nombre o ciudad",
  ].join("\n");
}

async function cmdStart(msg, env) {
  const id = String(msg.chat.id);
  const subs = await loadSubscribers(env);
  if (subs.subscribers.includes(id)) {
    return "Ya estás suscrito ✅\nUsa /help para ver los comandos.";
  }
  subs.subscribers.push(id);
  await saveSubscribers(env, subs);
  return [
    "✅ <b>Suscrito</b>",
    "",
    "Te avisaré cuando aparezca una competición nueva en España o cambie el horario de una existente.",
    "",
    "Usa /help para ver los comandos.",
  ].join("\n");
}

async function cmdStop(msg, env) {
  const id = String(msg.chat.id);
  const subs = await loadSubscribers(env);
  const before = subs.subscribers.length;
  subs.subscribers = subs.subscribers.filter(x => x !== id);
  if (subs.subscribers.length === before) {
    return "No estabas suscrito.";
  }
  await saveSubscribers(env, subs);
  return "👋 Te he dado de baja. Vuelve cuando quieras con /start.";
}

async function cmdProximas(env) {
  const state = await loadCompetitions(env);
  const list = Object.values(state)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 10);
  if (!list.length) return "No tengo competiciones registradas todavía.";
  return [
    "<b>Próximas competiciones en España</b>",
    "",
    ...list.map(c =>
      `• <b>${escapeHtml(c.name)}</b>\n` +
      `  📍 ${escapeHtml(c.city)}  📅 ${c.start_date}\n` +
      `  /horario_${c.id}  /inscripcion_${c.id}`
    ),
  ].join("\n\n");
}

async function cmdHorario(id, env) {
  const state = await loadCompetitions(env);
  const c = findComp(state, id);
  if (!c) return `No encuentro <code>${escapeHtml(id)}</code>. Prueba /proximas.`;
  const lines = (c.schedule || [])
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start))
    .map(a => `  • ${fmtMadrid(a.start)} — ${escapeHtml(a.name)}`);
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

async function cmdInscripcion(id, env) {
  const state = await loadCompetitions(env);
  const c = findComp(state, id);
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

async function cmdBuscar(query, env) {
  const state = await loadCompetitions(env);
  const q = query.toLowerCase();
  const hits = Object.values(state).filter(c =>
    c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q)
  );
  if (!hits.length) return `Sin resultados para <i>${escapeHtml(query)}</i>.`;
  return hits.slice(0, 15).map(c =>
    `• <b>${escapeHtml(c.name)}</b> — ${escapeHtml(c.city)} (${c.start_date})\n` +
    `  /horario_${c.id}  /inscripcion_${c.id}`
  ).join("\n\n");
}

// --------------------------- Storage ---------------------------

async function loadCompetitions(env) {
  const r = await fetch(env.STATE_URL, { cf: { cacheTtl: 60 } });
  if (!r.ok) throw new Error(`No pude leer competitions.json (${r.status})`);
  const data = await r.json();
  return data.competitions || {};
}

async function loadSubscribers(env) {
  // Use the contents API so we get the SHA we need to write back later
  const url = `${GH_API}/repos/${env.GITHUB_REPO}/contents/data/subscribers.json`;
  const r = await fetch(url, { headers: ghHeaders(env) });
  if (!r.ok) throw new Error(`No pude leer subscribers.json (${r.status})`);
  const meta = await r.json();
  const content = atob(meta.content.replace(/\n/g, ""));
  const json = JSON.parse(content);
  return { ...json, _sha: meta.sha };
}

async function saveSubscribers(env, subs) {
  const url = `${GH_API}/repos/${env.GITHUB_REPO}/contents/data/subscribers.json`;
  const body = {
    message: "chore: update subscribers [skip ci]",
    content: btoa(JSON.stringify({ subscribers: subs.subscribers }, null, 2) + "\n"),
    sha: subs._sha,
  };
  const r = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`No pude escribir subscribers.json (${r.status}): ${txt}`);
  }
}

function ghHeaders(env) {
  return {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "wca-spain-bot",
  };
}

// --------------------------- Helpers ---------------------------

function findComp(state, id) {
  return state[id] ||
         Object.values(state).find(x => x.id.toLowerCase() === id.toLowerCase());
}

function fmtMadrid(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

async function sendMessage(token, chatId, text) {
  await fetch(TELEGRAM_API(token, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[ch]));
}
