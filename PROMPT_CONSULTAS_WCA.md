# Prompt de arranque — Consultas de datos WCA

Voy a hacer una serie de desarrollos para consultar información pública de la World Cube Association (WCA): datos de **competiciones**, **competidores**, **inscritos** y **tiempos**. No necesito contexto de proyectos previos, solo cómo funcionan las fuentes de datos de la WCA para poder extraer lo que necesito.

Este documento te explica todo lo que necesitas saber para arrancar.

---

## Fuentes de datos disponibles

La WCA expone datos por varios sitios distintos. Cada uno sirve un propósito diferente:

### 1. API REST pública (histórica y de configuración)

Base: `https://www.worldcubeassociation.org/api/v0/`

Sin autenticación para lo público. **Requiere User-Agent identificable** en las cabeceras HTTP (con un User-Agent vacío o genérico, la API puede rechazar las peticiones).

Endpoints principales:

- **Lista de competiciones** (filtrable):
  ```
  GET /api/v0/competitions?country_iso2=ES
  GET /api/v0/competitions?country_iso2=ES&start=2026-06-01&end=2026-12-31
  ```
  Devuelve array de competiciones con: `id`, `name`, `city`, `country_iso2`, `start_date`, `end_date`, `registration_open`, `registration_close`, `announced_at`, `cancelled_at`, `latitude_degrees`, `longitude_degrees`, `event_ids`, `delegates`, etc.

- **Detalle de una competición**:
  ```
  GET /api/v0/competitions/{compId}
  ```

- **WCIF completo (World Cube Competition Interchange Format)** — el "todo en uno" de una competición:
  ```
  GET /api/v0/competitions/{compId}/wcif/public
  ```
  Devuelve un JSON grande con:
  - `persons[]` — todos los inscritos con `wcaId`, `name`, `registrantId`, `roles`, `registration.status` (accepted/pending/deleted), `assignments[]` (tareas asignadas), `personalBests[]`
  - `events[]` — los eventos y sus rondas con `qualification`, `advancementCondition`, `timeLimit`, `cutoff`
  - `schedule.venues[].rooms[].activities[]` — el horario completo con actividades anidadas
  - `extensions[]` — datos extra de herramientas como Groupifier

- **Datos de una persona (PBs, competiciones, medallas)**:
  ```
  GET /api/v0/persons/{wcaId}
  ```
  Devuelve `person`, `personal_records` (todos los PBs single y average por evento), `competition_count`, `medals`, `records`.

- **Búsqueda de personas**:
  ```
  GET /api/v0/search/users?q=nombre
  ```

- **Resultados oficiales de una persona en competiciones concretas**:
  ```
  GET /api/v0/persons/{wcaId}/results
  ```

**Nota sobre timing**: los resultados oficiales se publican con retraso (típicamente 3-10 días después de una competición). Durante y justo después de la competición, hay que ir a las fuentes de "Live" (siguiente sección).

### 2. WCA Live (viejo) — resultados en tiempo real

Base: `https://live.worldcubeassociation.org/api`

API **GraphQL** pública. Se usa POST con `{ query, variables }` en el body.

Solo estas queries están expuestas en el root:

```
activeScoretakingTokens, competition, competitions, currentUser,
importableCompetitions, officialWorldRecords, person, recentRecords,
round, users
```

- **Listar competiciones activas o próximas**:
  ```graphql
  query($from: Date) {
    competitions(from: $from, limit: 200) {
      id
      wcaId
      name
      startDate
      endDate
    }
  }
  ```
  Nota: `id` aquí es el ID interno de WCA Live (numérico), distinto del `wcaId` de la WCA oficial (string tipo `ValdepenasOpen2026`).

- **Detalle de competición** con eventos y rondas:
  ```graphql
  query($id: ID!) {
    competition(id: $id) {
      id
      name
      competitionEvents {
        id
        event { id name }
        rounds {
          id
          name
          number
          advancementCondition { type level }
          results {
            ranking
            attempts { result }
            best
            average
            person { name wcaId }
          }
        }
      }
    }
  }
  ```

- **Detalle de una ronda concreta** (por si se quiere refrescar solo una):
  ```graphql
  query($id: ID!) {
    round(id: $id) {
      id
      results { ... }
    }
  }
  ```

**Límite de complejidad**: 5000. Una query "completa" sobre una competición grande (todos los eventos × todas las rondas × todos los resultados × todos los intentos) puede reventarlo. Estrategia: pedir estructura ligera primero, luego resultados por ronda en paralelo.

**Campo importante que NO existe**: `countryIso2` en Competition. No lo pidas o dará error.

**`CompetitionBrief`** (retornado por `importableCompetitions`) solo tiene `endDate, name, shortName, startDate, wcaId`. No hay `id` interno ahí. Además `importableCompetitions` requiere estar logueado, para uso público no sirve.

**Codificación de tiempos** en `attempts[].result` y `best`/`average`:
- Los tiempos vienen en **centisegundos**. Ejemplo: `1234` = 12.34s.
- `-1` = DNF.
- `-2` = DNS.
- `0` = sin intento aún.
- **Evento `333fm` (Fewest Moves)**: el single viene como entero de movimientos (ej. `47` = 47 movimientos). El average viene multiplicado por 100 (ej. `4700` = 47.00 movimientos, hay que dividir para mostrar decimales).
- **Evento `333mbf` (Multi-Blind)**: formato encoded especial. Ver documentación WCA si se necesita.

### 3. WCA Live (nueva) — problema abierto

Algunas competiciones (por ejemplo `ValdepenasOpen2026`, `ParlaOpen2026`) ya no publican en `live.worldcubeassociation.org` sino en:

```
https://www.worldcubeassociation.org/competitions/{compId}/live
https://www.worldcubeassociation.org/competitions/{compId}/live/rounds/{eventId}-r{roundNum}
```

Esta versión está construida con **Next.js con React Server Components**. Las peticiones internas usan formato `?_rsc=...` que no es JSON estándar sino formato interno de Next.js. **No hay API JSON pública identificada** ahí de momento.

Si necesitas datos de una competición que solo esté en esta URL, hay tres opciones:
- **Aceptar la limitación** (statu quo).
- **Parsear RSC** (frágil, formato interno de Next.js que puede cambiar sin aviso). Requiere confirmar que los datos son extraíbles con inspección Network.
- **Esperar** a que la WCA publique API oficial para esto.

Al día de hoy la mayoría de competiciones siguen en la versión vieja de WCA Live, así que para trabajos generales conviene usar la vieja y aceptar que algunas quedan fuera.

---

## Códigos de evento WCA

Los IDs internos de los eventos son:

```
333    → 3x3
222    → 2x2
444    → 4x4
555    → 5x5
666    → 6x6
777    → 7x7
333bf  → 3x3 Blindfolded
333fm  → 3x3 Fewest Moves
333oh  → 3x3 One-Handed
clock  → Clock
minx   → Megaminx
pyram  → Pyraminx
skewb  → Skewb
sq1    → Square-1
444bf  → 4x4 Blindfolded
555bf  → 5x5 Blindfolded
333mbf → 3x3 Multi-Blindfolded
```

---

## Formato de un WCA ID

Los WCA IDs siguen el patrón `YYYYXXXXNN` donde:
- `YYYY` = año en que la persona empezó a competir (4 dígitos).
- `XXXX` = primeras letras del apellido (4 caracteres, siempre mayúsculas).
- `NN` = número de secuencia dentro de los que comparten el prefijo anterior (2 dígitos).

Ejemplo: `2025MORA11` = Alguien apellidado "Mora..." que empezó a competir en 2025, número 11 en la secuencia.

**Importante**: NO es un código de país aunque a veces lo parezca. `ES2025...` sería malinterpretación, no existe.

---

## Zonas horarias

La API devuelve fechas de dos formas:
- **Fechas simples** (`start_date`, `end_date`) como `YYYY-MM-DD` sin hora ni zona.
- **Fechas con hora** (`registration_open`, actividades del schedule) como ISO 8601 en **UTC** con sufijo `Z`.

Para trabajo con datos españoles, convierte a `Europe/Madrid` antes de mostrar.

---

## Consideraciones de uso responsable

- **User-Agent identificable**: usa uno como `MiHerramienta/1.0 (contacto@dominio.com)` para que la WCA sepa quién eres.
- **Reintentos**: la API tiene picos de latencia. Configura reintentos con backoff exponencial. Ejemplo Python con urllib3: `total=3, connect=3, read=3, backoff_factor=2`.
- **Sin abusos**: no bombardees la API con miles de peticiones seguidas. Cachea localmente lo que sea estable.
- **Datos personales**: los WCA IDs y nombres son públicos, pero conviene ser cuidadoso con datos derivados.

---

## Herramientas mentales útiles

- Si necesitas **listar competiciones de un país**: API REST `country_iso2=XX`.
- Si necesitas **saber quién está inscrito**: WCIF `persons[]` filtrando por `registration.status === "accepted"`.
- Si necesitas **PBs históricos** de alguien: API REST `/persons/{wcaId}`.
- Si necesitas **tiempos en directo de una competición activa**: WCA Live GraphQL (viejo), pidiendo `competitions` para encontrar el `id` interno, luego `competition(id: ...)`.
- Si necesitas **el horario o las asignaciones** de una competición: WCIF `/wcif/public`.
- Si necesitas **número de inscritos** en una competición: WCIF `persons[]` filtrando por status.

---

## Cómo empezar

Cuéntame qué desarrollo quieres hacer. Por ejemplo:
- Consultar cuántos inscritos hay en X competición.
- Ver los tiempos que hizo alguien en una competición concreta.
- Sacar estadísticas agregadas (mejores medias de la última temporada, etc.).
- Comparar tiempos entre varias personas.
- Cualquier otra cosa que se pueda derivar de las fuentes anteriores.

Dime qué prefieres:
- ¿En qué lenguaje/entorno? Python (scripts, notebooks), JavaScript (HTML, Node), Bash con curl+jq, otro.
- ¿Uso puntual o herramienta reutilizable?
- ¿Salida en pantalla, archivo, web, base de datos?

Con esto empezamos.
