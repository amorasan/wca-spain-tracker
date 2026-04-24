# WCA Spain Tracker

Vigila las competiciones de la **World Cube Association** en España y avisa por
Telegram en cuanto aparece una nueva o cambia el horario de una existente.
Además permite consultar los horarios desde el móvil con un bot.

Sin servidores que mantener: el cron vive en GitHub Actions (gratis) y el bot
en Cloudflare Workers (gratis también, 100 000 peticiones al día).

```
┌──────────────┐     cron 6h      ┌──────────────┐  push   ┌──────────┐
│  WCA  API    │ ───────────────▶ │ GitHub Action│ ──────▶ │ Telegram │
└──────────────┘                  │   fetcher.py │         └──────────┘
                                  └──────┬───────┘                ▲
                                         │ commit                 │
                                         ▼                        │
                                ┌─────────────────┐               │
                                │ data/comps.json │ ◀──── lee ────┤
                                └─────────────────┘               │
                                                                  │
                              ┌───────────────────────┐  webhook  │
                              │ Cloudflare Worker bot │ ◀─────────┘
                              └───────────────────────┘
```

---

## 1. Crear el bot de Telegram

1. Abre Telegram, busca **@BotFather**, manda `/newbot`, sigue las instrucciones
   y guarda el **token** que te da (algo como `1234:AAA...`).
2. Habla con tu propio bot enviándole cualquier mensaje (si no, no podrá
   escribirte después).
3. Busca **@userinfobot**, mándale `/start` y guarda tu **chat id** (un número).

## 2. Subir el repo a GitHub

```bash
git init
git add .
git commit -m "init"
gh repo create wca-spain-tracker --private --source=. --push
```

(O créalo a mano en github.com y haz `git push`.)

## 3. Configurar los secretos del repo

En GitHub → Settings → Secrets and variables → Actions → **New repository secret**:

| Nombre              | Valor                          |
|---------------------|--------------------------------|
| `TELEGRAM_TOKEN`    | El token de BotFather          |
| `TELEGRAM_CHAT_ID`  | Tu chat id                     |

## 4. Lanzar el primer sync manualmente

En la pestaña **Actions** del repo → workflow *Sync WCA Spain* → **Run workflow**
y marca *force_digest = true* para recibir el resumen completo de inmediato.

A partir de ahí se ejecutará solo cada 6 horas. Los cambios en
`data/competitions.json` los commiteará el propio bot del Action.

> **Notificaciones que recibirás**
> - 🆕 cada vez que aparece una competición nueva en España
> - 🔔 cuando cambia algo (fecha, horario, registro, eventos…) — con la lista
>   exacta de campos modificados
> - 📋 cada lunes, resumen de las próximas 15 competiciones
> - ⚠️ si el sync falla por cualquier motivo

---

## 5. (Opcional) Bot interactivo en Cloudflare Workers

Si solo quieres notificaciones, puedes ignorar esta sección. Si quieres poder
preguntarle al bot cosas como `/proximas` o `/horario MadridOpen2026` desde el
móvil, sigue:

### 5.1. Instalar wrangler y hacer login

```bash
npm install -g wrangler
wrangler login
```

### 5.2. Editar `worker/wrangler.toml`

Cambia `STATE_URL` por la URL raw de tu `data/competitions.json`:

```toml
STATE_URL = "https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main/data/competitions.json"
```

> El repo puede ser **privado** si lo prefieres, pero entonces tendrás que
> servir el JSON desde otro sitio (GitHub Pages o un endpoint con token). Lo
> más cómodo es repo público, ya que los datos son públicos de todos modos.

### 5.3. Desplegar

```bash
cd worker
wrangler deploy
wrangler secret put TELEGRAM_TOKEN     # pega el token
wrangler secret put ALLOWED_CHAT_ID    # pega tu chat id
```

Wrangler te imprimirá la URL del worker, algo como
`https://wca-spain-bot.tu-usuario.workers.dev`.

### 5.4. Apuntar Telegram al webhook

Una sola vez, desde el navegador o curl:

```
https://api.telegram.org/bot<TELEGRAM_TOKEN>/setWebhook?url=https://wca-spain-bot.tu-usuario.workers.dev
```

Deberías ver `{"ok":true,"result":true,"description":"Webhook was set"}`.

### 5.5. Probar

Desde el móvil, en el chat con tu bot:

- `/proximas` → lista de las 10 próximas competiciones, cada una con un enlace
  tappable `/horario_xxx`
- `/horario MadridOpen2026` → horario completo
- `/buscar madrid` → busca por nombre o ciudad
- `/help` → ayuda

---

## Estructura del proyecto

```
wca-spain-tracker/
├── fetcher.py              # script principal que se ejecuta en el Action
├── requirements.txt
├── data/
│   └── competitions.json   # estado, lo actualiza el Action automáticamente
├── .github/workflows/
│   └── sync.yml            # cron + commit del estado
├── worker/
│   ├── bot.js              # bot interactivo (Cloudflare Workers)
│   └── wrangler.toml
└── README.md
```

## Personalizaciones rápidas

- **Frecuencia del cron**: edita la línea `cron:` en `.github/workflows/sync.yml`.
  Cada hora: `"0 * * * *"`. Cada día a las 9:00 UTC: `"0 9 * * *"`.
- **Día del resumen semanal**: cambia `is_digest_day()` en `fetcher.py`
  (`weekday()` devuelve 0=lunes … 6=domingo).
- **Filtrar por evento favorito**: dentro del bucle de `main()`, salta las
  competiciones cuyo `view["events"]` no contenga, por ejemplo, `"333"` o `"444"`.
- **Otro país**: cambia `country_iso2` en `fetch_competitions()`.

## Troubleshooting

- **No me llegan mensajes**: comprueba que has escrito al bot al menos una vez,
  y que el `TELEGRAM_CHAT_ID` es tu chat personal (no el del bot).
- **El Action falla con `403` al hacer push**: Settings → Actions → General →
  Workflow permissions → marca **Read and write permissions**.
- **El bot no responde**: revisa el webhook con
  `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`. Si `last_error_message`
  tiene algo, el Worker está fallando — mira los logs con `wrangler tail`.
- **El estado no se actualiza entre runs**: confirma que el repo tiene
  permisos de escritura y que el commit del workflow se está haciendo (mira
  el log del paso *Commit state if changed*).

## Coste

Cero euros. GitHub Actions: 2 000 minutos/mes gratis en repos privados, ilimitado
en públicos. Cloudflare Workers: 100 000 peticiones/día gratis. Este proyecto
consume aproximadamente 30 segundos por run × 4 runs/día = 60 minutos/mes.
