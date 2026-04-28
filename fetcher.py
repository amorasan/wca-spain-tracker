"""WCA Spain competition tracker.

Run periodically by GitHub Actions. Fetches upcoming competitions in Spain
from the public WCA API, detects new ones and changes (dates, schedule,
registration, events) compared to the last run, and pushes notifications
to a Telegram chat. Persistent state lives in data/competitions.json,
which the workflow commits back to the repo so the next run can diff.

Env vars required:
  TELEGRAM_TOKEN     Bot token from @BotFather
  TELEGRAM_CHAT_ID   Your chat id (talk to @userinfobot to get it)

Optional:
  FORCE_DIGEST=1     Send the full upcoming list even if it is not Monday
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

API = "https://www.worldcubeassociation.org/api/v0"
DATA_FILE = Path("data/competitions.json")
TELEGRAM_URL = "https://api.telegram.org/bot{token}/sendMessage"

TOKEN = os.environ["TELEGRAM_TOKEN"]
CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]
FORCE_DIGEST = os.environ.get("FORCE_DIGEST") == "1"

# WCA asks API clients to identify themselves with a descriptive User-Agent
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "wca-spain-tracker/1.0 (personal monitor)",
    "Accept": "application/json",
})


# --------------------------- Telegram ---------------------------

def _send_one(chat_id: str, text: str) -> bool:
    """Send to a single chat. Returns False if the user blocked the bot."""
    resp = requests.post(
        TELEGRAM_URL.format(token=TOKEN),
        json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
        timeout=20,
    )
    if resp.status_code == 403:
        # User blocked the bot, drop them silently
        print(f"[telegram] {chat_id} blocked the bot, dropping")
        return False
    if not resp.ok:
        print(f"[telegram] ERROR {resp.status_code} for {chat_id}: {resp.text}",
              file=sys.stderr)
    return True


def telegram(text: str) -> None:
    """Send the message to the owner and to every subscriber."""
    targets = {CHAT_ID, *load_subscribers()}
    blocked = []
    for chat_id in targets:
        if not _send_one(chat_id, text):
            blocked.append(chat_id)
        time.sleep(0.05)  # well under Telegram's 30 msg/s limit
    if blocked:
        prune_subscribers(blocked)

# --------------------------- WCA API ---------------------------

def fetch_competitions() -> list[dict]:
    """All upcoming competitions in Spain, paginated."""
    out: list[dict] = []
    page = 1
    while True:
        r = SESSION.get(
            f"{API}/competitions",
            params={
                "country_iso2": "ES",
                "start": date.today().isoformat(),
                "per_page": 100,
                "page": page,
            },
            timeout=30,
        )
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        out.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return out


def fetch_wcif(comp_id: str) -> dict:
    """Public WCIF: full schedule, events, rounds, time limits, etc."""
    r = SESSION.get(f"{API}/competitions/{comp_id}/wcif/public", timeout=30)
    r.raise_for_status()
    return r.json()


# --------------------------- Diffing & formatting ---------------------------

def schedule_lines(wcif: dict) -> list[str]:
    """Sorted, human-readable schedule lines."""
    lines: list[str] = []
    for v in wcif.get("schedule", {}).get("venues", []):
        for room in v.get("rooms", []):
            for act in room.get("activities", []):
                start = act["startTime"][:16].replace("T", " ")
                lines.append(f"  • {start} — {act['name']}")
    return sorted(lines)


def schedule_summary(wcif: dict, limit: int = 25) -> str:
    lines = schedule_lines(wcif)
    if not lines:
        return "<i>Horario aún no publicado.</i>"
    if len(lines) > limit:
        return "\n".join(lines[:limit]) + f"\n  … ({len(lines) - limit} más)"
    return "\n".join(lines)


def short_view(comp: dict, wcif: dict) -> dict:
    """Minimal fields used for change detection and bot queries."""
    return {
        "id": comp["id"],
        "name": comp["name"],
        "city": comp["city"],
        "venue": comp.get("venue", ""),
        "start_date": comp["start_date"],
        "end_date": comp["end_date"],
        "registration_open": comp.get("registration_open"),
        "registration_close": comp.get("registration_close"),
        "competitor_limit": comp.get("competitor_limit"),
        "cancelled_at": comp.get("cancelled_at"),
        "events": [e["id"] for e in wcif.get("events", [])],
        "schedule": [
            {"name": act["name"], "start": act["startTime"], "end": act["endTime"]}
            for v in wcif.get("schedule", {}).get("venues", [])
            for room in v.get("rooms", [])
            for act in room.get("activities", [])
        ],
    }


def diff_fields(old: dict, new: dict) -> list[str]:
    keys = set(old) | set(new)
    return sorted(k for k in keys if old.get(k) != new.get(k))

MADRID = ZoneInfo("Europe/Madrid")

def fmt_dt_madrid(iso: str | None) -> str:
    """Convierte un timestamp ISO UTC a 'dd/mm/YYYY HH:MM' en hora peninsular."""
    if not iso:
        return "—"
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return dt.astimezone(MADRID).strftime("%d/%m/%Y %H:%M")

def format_competition(c: dict) -> str:
    return (
        f"<b>{c['name']}</b>\n"
        f"📍 {c['city']}\n"
        f"📅 {c['start_date']} → {c['end_date']}\n"
        f"📝 Inscripción: {fmt_dt_madrid(c.get('registration_open'))}"
        f" → {fmt_dt_madrid(c.get('registration_close'))}\n"
        f"🧩 Eventos: {', '.join(c['events']) if c['events'] else '—'}\n"
        f"🔗 https://www.worldcubeassociation.org/competitions/{c['id']}"
    )


# --------------------------- State persistence ---------------------------

def load_state() -> dict:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return {}


def save_state(state: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"updated_at": datetime.utcnow().isoformat() + "Z", "competitions": state}
    DATA_FILE.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )

SUBS_FILE = Path("data/subscribers.json")

def load_subscribers() -> list[str]:
    if not SUBS_FILE.exists():
        return []
    data = json.loads(SUBS_FILE.read_text(encoding="utf-8"))
    return [str(x) for x in data.get("subscribers", [])]


def prune_subscribers(blocked: list[str]) -> None:
    subs = load_subscribers()
    kept = [s for s in subs if s not in blocked]
    SUBS_FILE.write_text(
        json.dumps({"subscribers": kept}, indent=2) + "\n",
        encoding="utf-8",
    )

def is_digest_day() -> bool:
    """Weekly digest on Mondays (UTC)."""
    return datetime.utcnow().weekday() == 0


# --------------------------- Main ---------------------------

def main() -> int:
    raw_state = load_state()
    # Backwards compat: state used to be a flat {id: view} dict
    state = raw_state.get("competitions", raw_state) if isinstance(raw_state, dict) else {}

    new_state: dict = {}
    new_comps: list[tuple[dict, dict]] = []
    changed_comps: list[tuple[dict, dict, list[str]]] = []
    cancelled_comps: list[tuple[dict, dict]] = []

    competitions = fetch_competitions()
    print(f"Fetched {len(competitions)} competitions in Spain")

    for comp in sorted(fetch_competitions(), key=lambda c: c["start_date"], reverse=True):
        try:
            wcif = fetch_wcif(comp["id"])
        except requests.HTTPError as e:
            print(f"[warn] WCIF unavailable for {comp['id']}: {e}")
            wcif = {}

        view = short_view(comp, wcif)

        if view["cancelled_at"]:
            was_tracked_active = (
                comp["id"] in state
                and not state[comp["id"]].get("cancelled_at")
            )
            if was_tracked_active:
                cancelled_comps.append((view, wcif))
            # In all cancelled cases (just cancelled / discovered cancelled /
            # already cancelled last run), drop from new_state so it stops
            # appearing in queries and digests.
        else:
            new_state[comp["id"]] = view
            if comp["id"] not in state:
                new_comps.append((view, wcif))
            else:
                changed = diff_fields(state[comp["id"]], view)
                if changed:
                    changed_comps.append((view, wcif, changed))

        time.sleep(0.3)  # polite to the API

    save_state(new_state)

    # --- Notifications ---

    for view, wcif in new_comps:
        telegram(
            "🆕 <b>Nueva competición en España</b>\n\n"
            + format_competition(view)
            + "\n\n<b>Horario:</b>\n"
            + schedule_summary(wcif)
        )

    for view, wcif, changed in changed_comps:
        telegram(
            "🔔 <b>Competición actualizada</b>\n\n"
            + format_competition(view)
            + f"\n\n<i>Campos modificados:</i> {', '.join(changed)}"
            + "\n\n<b>Horario actual:</b>\n"
            + schedule_summary(wcif)
        )

    for view, _wcif in cancelled_comps:
        telegram(
            "🚫 <b>Competición cancelada</b>\n\n"
            + format_competition(view)
        )

    if FORCE_DIGEST and new_state:
        upcoming = sorted(new_state.values(), key=lambda c: c["start_date"])
        body = "\n\n".join(format_competition(c) for c in upcoming)
        telegram(f"📋 <b>Competiciones próximas en España</b>\n\n{body}")

    print(
        f"OK · {len(new_state)} totales · "
        f"{len(new_comps)} nuevas · {len(changed_comps)} cambiadas · "
        f"{len(cancelled_comps)} canceladas"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        # Notify failures so silent breakage does not happen
        try:
            telegram(f"⚠️ <b>Fallo en el sync de WCA</b>\n<code>{e}</code>")
        except Exception:
            pass
        raise
