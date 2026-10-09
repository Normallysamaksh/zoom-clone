"""Idempotent seed data; secrets for the default host are never returned in lists."""

import hashlib
import os
from datetime import datetime, timedelta, timezone

try:
    from .db import Database
except ImportError:
    from db import Database


def seed(database: Database):
    now = datetime.now(timezone.utc)
    database.execute(
        "INSERT OR IGNORE INTO users(id, display_name, created_at) VALUES (?, ?, ?)",
        ("default-user", "Alex Morgan", now.isoformat()),
    )
    if os.getenv("SEED_SAMPLE_DATA", "true").lower() != "true":
        return
    rows = [
        (
            "83245678901",
            "Product design sync",
            "Review the latest designs and align on next steps.",
            now + timedelta(hours=1),
            30,
            "scheduled",
        ),
        (
            "84512345678",
            "Weekly team standup",
            "Share updates and plan the week.",
            now + timedelta(days=1),
            45,
            "scheduled",
        ),
        (
            "86790123456",
            "Project kickoff",
            "Let's make great things together.",
            now + timedelta(days=2),
            60,
            "scheduled",
        ),
        (
            "81234567890",
            "Engineering catch-up",
            "",
            now - timedelta(days=1),
            30,
            "ended",
        ),
        ("82345678901", "Design review", "", now - timedelta(days=2), 45, "ended"),
    ]
    # Seeded upcoming meetings are joinable sample rooms, without an exposed host secret.
    statements = []
    for meeting_id, title, description, date, duration, status in rows:
        statements.append(
            (
                "INSERT OR IGNORE INTO meetings(id,host_id,title,description,scheduled_at,duration,status,host_token_hash,created_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    meeting_id,
                    "default-user",
                    title,
                    description,
                    date.isoformat(),
                    duration,
                    status,
                    hashlib.sha256(os.urandom(32)).hexdigest(),
                    now.isoformat(),
                    date.isoformat() if status == "ended" else None,
                ),
            )
        )
        statements.append(
            (
                "INSERT OR IGNORE INTO sessions(id,meeting_id,started_at,ended_at) VALUES (?,?,?,?)",
                (
                    "sample-" + meeting_id,
                    meeting_id,
                    date.isoformat() if status == "ended" else None,
                    date.isoformat() if status == "ended" else None,
                ),
            )
        )
    database.batch(statements)
