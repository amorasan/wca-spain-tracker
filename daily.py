"""Daily registration reminder.

Runs once a day at noon Madrid time. Looks at all competitions whose
registration_open date is "today" in Madrid timezone, and sends a single
Telegram message to all subscribers listing them.

If the opening time has already passed (e.g. opened at 09:00 and we're
running at 12:00), it says how long ago. Future ones say at what time
they open.

If no competitions open registration today, nothing is sent.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

DATA_FILE = Path("data/competitions.json")
SUBS_FILE = Path("data/subscribers.json")
TELEGRAM_URL = "https://api.telegram.org/bot{token}/sendMessage"

TOKEN = os.environ["TELEGRAM_TOKEN"]
CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]

MADRID = ZoneInfo("Europe/Madrid")


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
        print(f"[telegram] {chat_id} blocked the bot, dropping")
        return False
    if not resp.ok:
        print(f"[telegram] ERROR {resp.status_code} for {chat_id}: {resp.text}",
              file=sys.stderr)
    return True


def load_subscribers() -> list[str]:
    if not SUBS_FILE.exists():
        return []
    data = json.loads(SUBS_FILE.read_text(encoding="utf-8"))
    return [str(x) for x in data.get("subscribers", [])]


def prune_subscribers(blocked: list[str]) -> None:
    if not blocked:
        return
    subs = load_subscribers()
    kept = [s for s in subs if s not in blocked]
    SUBS_FILE.write_text(
        json.dumps({"subscribers": kept}, indent=2) + "\n",
        encoding="utf-8",
    )


def broadcast(text: str) -> None:
    targets = {CHAT_ID, *load_subscribers()}
    blocked = []
    for chat_id in targets:
        if not _send_one(chat_id, text):
            blocked.append(chat_id)
        time.sleep(0.05)
    prune_subscribers(blocked)


# --------------------------- Logic ---------------------------

def parse_iso_utc(iso: str) -> datetime:
    """Parse an ISO 8601 timestamp from the WCA API into an aware datetime."""
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def humanize_delta(delta_seconds: int) -> str:
    """Convert a positive number of seconds into a Spanish 'X horas Y minutos'."""
    minutes = delta_seconds // 60
    hours = minutes // 60
    mins = minutes % 60
    if hours == 0:
        return f"{mins} min"
    if mins == 0:
        return f"{hours} h"
    return f"{hours} h {mins} min"


def load_competitions() -> dict:
    if not DATA_FILE.exists():
        return {}
    raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return raw.get("competitions", raw if isinstance(raw, dict) else {})


def main() -> int:
    now = datetime.now(MADRID)
    today_madrid = now.date()

    comps = load_competitions()
    opening_today = []
    for c in comps.values():
        if c.get("cancelled_at"):
            continue
        ro = c.get("registration_open")
        if not ro:
            continue
        ro_madrid = parse_iso_utc(ro).astimezone(MADRID)
        if ro_madrid.date() == today_madrid:
            opening_today.append((ro_madrid, c))

    if not opening_today:
        print("No competitions open registration today. Nothing to send.")
        return 0

    opening_today.sort(key=lambda x: x[0])

    lines = ["📅 <b>Inscripciones que abren hoy</b>", ""]
    for ro_madrid, c in opening_today:
        delta = (ro_madrid - now).total_seconds()
        if delta >= 0:
            when = f"abre a las {ro_madrid.strftime('%H:%M')}"
        else:
            when = f"abierta desde hace {humanize_delta(int(-delta))}"

        plazas = c.get("competitor_limit") or "sin límite"
        lines.append(
            f"• <b>{c['name']}</b>\n"
            f"  📍 {c['city']}\n"
            f"  🕒 {when}\n"
            f"  👥 Plazas: {plazas}\n"
            f"  🔗 https://www.worldcubeassociation.org/competitions/{c['id']}/register"
        )

    broadcast("\n\n".join(lines))
    print(f"Sent reminder for {len(opening_today)} competition(s).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        try:
            broadcast(f"⚠️ <b>Fallo en el aviso diario</b>\n<code>{e}</code>")
        except Exception:
            pass
        raise
