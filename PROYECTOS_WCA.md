# Proyecto WCA — Hommies

Documento de contexto y estado del proyecto. Pensado para pegar en una conversación nueva con Claude si esta se pierde.

**Última actualización**: junio 2026.

---

## Contexto del usuario

- **GitHub**: `amorasan`
- **Familia "Hommies"**, todos cuberos, con sus WCA IDs:
  - Álex Mora Prieto — `2025MORA11`
  - Marcos Mora Prieto — `2025PRIE04`
  - (y más de una docena de amigos añadidos a la lista en la app web)
- **Carpeta local del proyecto en PC**: `D:\claude\wca-spain-tracker` (Windows)

---

## Herramientas construidas (3 en total)

### 1. Bot de Telegram de competiciones WCA España — TERMINADO

Notifica nuevas competiciones, cambios y fechas de inscripción.

- **Arquitectura**:
  - **GitHub Actions cron cada hora** ejecuta `fetcher.py`, consulta API WCA (`https://www.worldcubeassociation.org/api/v0/competitions?country_iso2=ES`), detecta cambios y manda notificaciones a Telegram.
  - **Cloudflare Workers** sirve el bot interactivo (`worker/bot.js`) vía webhook.
  - **Repo GitHub** hace de "base de datos": `data/competitions.json` + `data/subscribers.json`.
  - Cero coste, GitHub Actions ilimitado en repos públicos.

- **Comandos del bot**:
  - `/start` (suscripción), `/stop` (baja)
  - `/proximas`
  - `/horario <id>` (acepta texto libre y desambigua)
  - `/inscripcion <id>` (cuándo abre/cierra)
  - `/buscar <texto>`, `/help`
  - Tappables: `/horario_<id>` e `/inscripcion_<id>`

- **Notificaciones**: 🆕 nueva, 🔔 cambios, 🚫 cancelada, ⚠️ error.
- **Otros**: aviso diario a las 12:00 (cron `0 11 * * *`), auto-purga suscriptores que bloquean bot (HTTP 403).
- **Configuración Cloudflare Workers**:
  - Secretos: `TELEGRAM_TOKEN`, `GITHUB_TOKEN`, `GITHUB_REPO=amorasan/wca-spain-tracker`
  - URL: `https://wca-spain-bot.amorasan.workers.dev`
  - Setup: `wrangler secret put NOMBRE` (interactivo, NO se pega valor en línea)

### 2. Lanzador Chrome multi-perfil — TERMINADO

Script PowerShell que abre 4 ventanas Chrome simultáneamente, una con cada perfil (Alex, Marcos, Ele, Andy), todas apuntando a la URL de inscripción de una competición, colocadas en cuadrícula 2×2. Sirve para coordinar inscripciones familiares a competiciones populares.

- Archivos: `lanzar.bat` (wrapper) + `lanzar.ps1` (script principal).
- Perfiles Chrome:
  - Alex: `Profile 11`
  - Marcos: `Profile 9`
  - Ele: `Profile 18`
  - Andy: `Default`
- Usa Win32 API `EnumWindows` (clase `Chrome_WidgetWin_1`) para colocar ventanas.
- Estrategia: lanzar todas, esperar 8s, buscar por clase, mover con MoveWindow API.
- **Limitación honesta**: NO auto-rellena formulario, NO hace Submit. La versión ética requeriría OAuth WCA (descartado).

### 3. Tiempos WCA — Hommies (app HTML web pública) — TERMINADO PERO ACTIVO

App single-file HTML con CSS + JS inline. Actualmente desplegada como web pública en:
```
https://amorasan.github.io/TiempoWCA/
```

- **Repo**: `TiempoWCA` en GitHub (público). El archivo es `index.html`.
- **Cómo actualizar**: editas `index.html` en GitHub directamente, commit, y en 1-2 minutos GitHub Pages se actualiza. Los usuarios necesitan Ctrl+Shift+R para ver cambios (caché).

Ver secciones siguientes para detalles funcionales.

---

## Detalles funcionales de la app HTML

### Pestaña Histórico

- Tabla (escritorio) / tarjetas apiladas (móvil, media query `max-width: 768px`).
- Cada fila = un competidor con sus PBs single y average por evento.
- **Medallas** oro/plata/bronce sobre los mejores tiempos de la familia por evento/tipo.
- Colores CSS:
  - `--gold: #ffd43b`
  - `--silver: #74c0fc` (azul cielo — el gris original no se veía bien sobre fondo oscuro)
  - `--bronze: #d4a373`
- Botón **🔄 Actualizar** manual. Sin polling automático.
- Los PBs se leen de: `https://www.worldcubeassociation.org/api/v0/persons/{wcaId}` con `cache: "no-store"` + `?_=timestamp` para evitar caché.

### Pestaña Live — 4 sub-secciones

**Modal de búsqueda de competiciones activas**:
- Query GraphQL a `https://live.worldcubeassociation.org/api`:
  ```
  competitions(from: <ayer>, limit: 200)
  ```
- Sección "En curso" (verde) y "Próximas" (azul, siguientes 14 días).
- Tag naranja "ZONA HORARIA" para las que caen en el margen horario.
- Filtro por nombre / wcaId.
- Botón "Recargar lista".

**Sub-sección 1: Tiempos en vivo**
- Una tarjeta por evento/ronda donde compite algún Hommie.
- Filas: `nombre | rank (#) | 5 solves | avg`.
- **Cabecera de tarjeta**: nombre del evento + **flechita ↗** que abre la ronda en WCA Live antiguo.
- **Rank en verde** si el competidor pasa a la siguiente ronda (según `advancementCondition`).
- Rondas ordenadas **en orden inverso** (`cards.reverse()`), las más recientes arriba.
- Sin polling automático desde la última versión — solo se refresca con el botón **"Actualizar ahora"** (grande, en fila propia, azul).
- FMC: single como entero (movimientos), average dividido por 100 (`4700` → `47.00`).

**Sub-sección 2: Records detectados**
- 🥇 PB single, 🌸 PB media.
- **Aviso "mejor de la familia" DESACTIVADO** (usuario lo pidió: solo PBs personales).
- Los PBs del mismo tipo/persona/evento **se reemplazan**, no se acumulan. Si Marcos hace 3 PBs medias seguidos, solo queda el último visible.
- Botón "Borrar" para vaciar el panel.

**Sub-sección 3: Asignaciones de competidores**
- Datos de WCIF público: `https://www.worldcubeassociation.org/api/v0/competitions/{compId}/wcif/public`.
- Una tarjeta por Hommie inscrito con su agenda de tareas del día:
  - 🎲 verde: compite
  - 👀 naranja: juzga
  - 🔀 azul: mezcla (scrambler)
  - 🏃 rosa: corre (runner)
  - 📋 morado: entrada de datos
  - 🛠️ gris: staff otro
- La tarea que ocurre AHORA se resalta con borde azul y etiqueta "AHORA".
- Las ya pasadas se atenúan (opacity 0.5).
- **Sin polling automático**. Botón 🔄 manual en el header del panel.
- **Detección de cambios**: si al refrescar detecta que la asignación de alguien cambió, aparece un badge ⚠️ Cambios pulsante en su tarjeta. Pulsar el badge lo limpia.

**Sub-sección 4: Horario de la competición**
- Reutiliza el mismo WCIF (una descarga).
- Pestañas por día (hora Madrid).
- Cada bloque muestra hora, nombre de la actividad, y chips con los Hommies involucrados.
- Resaltados:
  - **Borde verde**: bloque con algún Hommie.
  - **Fondo azul + borde azul**: bloque ocurriendo AHORA.
  - **Atenuado**: bloque ya pasado.

### Estructura técnica clave

- **Meta viewport imprescindible**: `<meta name="viewport" content="width=device-width, initial-scale=1">`. Sin esto el móvil renderiza a 981px y no aplica el media query.
- **Zona horaria**: todo se convierte a `Europe/Madrid` con `timeMadridShort()`, `dateMadridShort()`.
- **Códigos de evento WCA**: 333, 222, 444, 555, 666, 777, 333bf, 333fm, 333oh, clock, minx, pyram, skewb, sq1, 444bf, 555bf, 333mbf.
- **Tiempos especiales**: centisegundos, `-1` = DNF, `-2` = DNS. Formato FMC especial (single entero, average /100). MBLD tiene su propio formato encoded.

### Lista de competidores (COMPETIDORES)

Actualmente **20+ personas** en la lista. Núcleo familiar Álex y Marcos; el resto son amigos/rivales habituales. Se añaden editando el array `COMPETIDORES` en el JS.

---

## Estado del despliegue

- **Repo GitHub**: `github.com/amorasan/TiempoWCA` (público).
- **URL pública**: `https://amorasan.github.io/TiempoWCA/`
- **Método de update**: editar `index.html` directamente en GitHub, commit → deploy automático en 1-2 minutos.

---

## PENDIENTE / PROBLEMA ABIERTO — Nueva URL de WCA Live

**Contexto**: la WCA está migrando de dos sitios distintos:

- **Sitio viejo** (donde tira nuestra app):
  ```
  https://live.worldcubeassociation.org/
  ```
  API GraphQL pública, documentada, funciona bien.

- **Sitio nuevo** (donde algunas competiciones publican los tiempos ahora):
  ```
  https://www.worldcubeassociation.org/competitions/{compId}/live
  https://www.worldcubeassociation.org/competitions/{compId}/live/rounds/{eventId}-r{roundNum}
  ```
  Ejemplos vividos:
  - `ValdepenasOpen2026` → SOLO en la nueva. La vieja da error "Oh dear!"
  - `ParlaOpen2026` → SOLO en la nueva.

### Estado del análisis (parcial)

- La web nueva está en **Next.js con React Server Components**.
- Peticiones típicas: `live?_rsc=...`, `333-r3?_rsc=...`, etc. Formato RSC binario/texto propio de Next.js.
- **No hay API JSON pública identificada** para esta parte del sitio.
- Pendiente: hacer inspección Network profunda en PC desde una URL con datos (ej. una ronda activa). Objetivos:
  - Ver si hay peticiones **fuera del patrón `?_rsc=`** (podría haber endpoints `/api/...` JSON limpios).
  - Si no, ver el cuerpo de una respuesta `?_rsc=` de una ronda concreta para valorar si es parseable.

### Opciones si se avanza (aún no decidido)

- **Opción A** (aceptar limitación, statu quo): la app sigue funcionando para las competiciones que estén en el sitio viejo. Para las nuevas, abrir la URL directamente. Recomendada a corto plazo.
- **Opción B** (parsear RSC): montar una **tercera pestaña "Live nuevo"** que consulte la URL nueva y extraiga datos parseando la respuesta RSC. Frágil (formato interno de Next.js, puede cambiar sin aviso). Requiere confirmar que los datos son extraíbles.
- **Opción C** (esperar): la WCA probablemente publicará API oficial para lo nuevo en algún momento. Esperar unos meses.

**Decisión actual del usuario**: DEJAR ASÍ DE MOMENTO. Volver a esta cuestión más adelante.

---

## OTRAS PENDIENTES MENORES

- **Actualización automática de los PBs históricos**: normalmente la WCA tarda entre 3 y 10 días en publicar oficialmente los resultados de una competición pasada. Si el usuario ve tiempos actuales en la pestaña Live pero no en Histórico, es normal, hay que esperar (o refrescar manualmente con el botón "Actualizar").

- **Cache-busting**: ya implementado en `fetchPerson` con `cache: "no-store"` + timestamp. No debería haber problemas de caché con la API de PBs.

---

## Historial de lecciones aprendidas

- WCA API necesita User-Agent identificable.
- Fetcher tiene reintentos urllib3 (`total=3, connect=3, read=3, backoff_factor=2`) para timeouts.
- `Profile Default` en wrangler = error, se llama solo `Default`.
- En Windows cmd, `#` no es comentario; conflictos git frecuentes por commits del bot entre medias.
- WCA Live API GraphQL:
  - Solo existen queries: `activeScoretakingTokens`, `competition`, `competitions`, `currentUser`, `importableCompetitions`, `officialWorldRecords`, `person`, `recentRecords`, `round`, `users`.
  - `CompetitionBrief` (de `importableCompetitions`) tiene solo: endDate, name, shortName, startDate, wcaId. Sin `id` interno → no usable para consulta directa.
  - `importableCompetitions` requiere usuario logueado, no es útil sin cuenta.
  - `competitions` acepta args: `filter (String)`, `from (Date)`, `limit (Int)`. Con `from: <ayer>` se obtienen las activas hoy.
  - **Límite de complejidad de 5000**: la query "completa" (todos los eventos, todas las rondas, todos los resultados) revienta el límite en competiciones grandes. Dividimos: 1 query ligera de estructura + N queries en paralelo de resultados por ronda.
- Field `countryIso2` NO existe en Competition WCA Live. Descartado.
- Meta viewport es imprescindible en HTML para móvil.
- `str_replace` en Claude a veces borra la línea de apertura de función `async function XXX() {`, hay que estar atento y re-verificar tras cada edit.
- El polling automático (`setInterval`) en móvil es problemático cuando la pantalla se bloquea. Mejor botón manual grande.
- competitiongroups.com (herramienta externa) NO tiene API propia útil — usa el WCIF público de la WCA por debajo. Por eso las asignaciones las leemos directamente del WCIF de la API REST.

---

## Sobre lo que Claude NO puede hacer en conversaciones nuevas

- Claude NO tiene navegación web ni acceso a internet en el chat conversacional. No puede abrir URLs para verificar cosas.
- Para investigar cambios de la WCA, el usuario tiene que hacer la inspección Network (F12) desde su PC y pasar capturas o pegar respuestas.
- Claude puede ejecutar código en un sandbox Linux sin internet, editar archivos, buscar en conversaciones pasadas.

---

## Cómo retomar esta conversación

Si esta conversación se pierde, en una nueva:

1. Pegar este documento.
2. Adjuntar el `index.html` actual descargado de GitHub.
3. Explicar qué se quiere hacer.

Claude debería tener contexto suficiente para continuar sin re-explicar todo.
