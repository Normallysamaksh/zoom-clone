"""FastAPI meeting workflows. All room state is durable, with no process-local rooms."""

import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

if __package__:
    from .db import Database, db
    from .models import (
        ChatInput,
        HostInput,
        JoinInput,
        MeetingInput,
        RemoveInput,
        SignalInput,
        UpdateInput,
    )
    from .seed import seed
else:
    from db import Database, db
    from models import (
        ChatInput,
        HostInput,
        JoinInput,
        MeetingInput,
        RemoveInput,
        SignalInput,
        UpdateInput,
    )
    from seed import seed

PRESENCE_SECONDS = 60
MAX_PARTICIPANTS = 6


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def participant_public(row):
    return {
        key: bool(row[key])
        if key in ("is_host", "muted", "video_off", "hand_raised")
        else row[key]
        for key in ("id", "name", "is_host", "muted", "video_off", "hand_raised")
    }


def meeting_public(row):
    return {
        key: row[key]
        for key in (
            "id",
            "host_id",
            "host_name",
            "title",
            "description",
            "scheduled_at",
            "duration",
            "status",
            "created_at",
            "ended_at",
        )
    }


def create_app(database: Database = db):
    application = FastAPI(
        title="Zoom Meeting Platform API",
        version="1.0.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    origins = [
        item.strip()
        for item in os.getenv(
            "ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
    ]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
    )
    ready = False
    lock = threading.Lock()

    def prepare():
        nonlocal ready
        if not ready:
            with lock:
                if not ready:
                    database.initialize()
                    seed(database)
                    ready = True

    @application.exception_handler(RuntimeError)
    async def database_unavailable(request, error):
        logging.error("Database operation failed: %s", type(error).__name__)
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Database unavailable. Check the server database configuration and try again."
            },
        )

    @application.middleware("http")
    async def response_headers(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    router = APIRouter(prefix="/api/v1", dependencies=[Depends(prepare)])

    def meeting_row(meeting_id):
        if not re.fullmatch(r"\d{11}", meeting_id):
            raise HTTPException(
                404, "Meeting not found. Check the meeting ID and try again."
            )
        rows = database.execute(
            "SELECT m.*, u.display_name AS host_name FROM meetings m JOIN users u ON u.id=m.host_id WHERE m.id=?",
            (meeting_id,),
        )
        if not rows:
            raise HTTPException(
                404, "Meeting not found. Check the meeting ID and try again."
            )
        return rows[0]

    def authorized(meeting_id: str, authorization: str | None = Header(default=None)):
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "A participant token is required.")
        token = authorization.removeprefix("Bearer ")
        rows = database.execute(
            "SELECT p.*, s.meeting_id FROM participants p JOIN sessions s ON s.id=p.session_id WHERE p.token_hash=? AND s.meeting_id=?",
            (digest(token), meeting_id),
        )
        if not rows:
            raise HTTPException(401, "Invalid participant token.")
        person = rows[0]
        if person["removed"]:
            raise HTTPException(403, "You were removed from this meeting.")
        if person["left_at"] or person["last_seen"] < time.time() - PRESENCE_SECONDS:
            raise HTTPException(403, "Your session expired. Please rejoin the meeting.")
        return person

    def active(person):
        if meeting_row(person["meeting_id"])["status"] == "ended":
            raise HTTPException(409, "This meeting has ended.")

    def require_host(person):
        if not person["is_host"]:
            raise HTTPException(403, "Only the host can perform this action.")

    @router.get("/health")
    def health():
        return {
            "status": "ok",
            "database": "hosted-sqlite" if database.url else "sqlite",
        }

    @router.get("/meetings")
    def list_meetings():
        rows = database.execute(
            "SELECT m.*, u.display_name AS host_name FROM meetings m JOIN users u ON u.id=m.host_id ORDER BY m.created_at DESC LIMIT 250"
        )
        return [meeting_public(row) for row in rows]

    @router.post("/meetings", status_code=201)
    def create_meeting(body: MeetingInput):
        token = secrets.token_urlsafe(32)
        meeting_id = str(secrets.randbelow(90000000000) + 10000000000)
        # A unique constraint protects against collisions; generate again before inserting.
        while database.execute("SELECT id FROM meetings WHERE id=?", (meeting_id,)):
            meeting_id = str(secrets.randbelow(90000000000) + 10000000000)
        created = now()
        scheduled = (
            body.scheduled_at.astimezone(timezone.utc).isoformat()
            if body.scheduled_at
            else None
        )
        status = "scheduled" if scheduled else "active"
        database.batch(
            [
                (
                    "INSERT INTO meetings(id,host_id,title,description,scheduled_at,duration,status,host_token_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        meeting_id,
                        "default-user",
                        body.title,
                        body.description,
                        scheduled,
                        body.duration,
                        status,
                        digest(token),
                        created,
                    ),
                ),
                (
                    "INSERT INTO sessions(id,meeting_id,started_at) VALUES (?,?,?)",
                    (str(uuid4()), meeting_id, None if scheduled else created),
                ),
            ]
        )
        return {"meeting": meeting_public(meeting_row(meeting_id)), "host_token": token}

    @router.get("/meetings/{meeting_id}")
    def get_meeting(meeting_id: str):
        return meeting_public(meeting_row(meeting_id))

    @router.post("/meetings/{meeting_id}/cancel")
    def cancel_meeting(meeting_id: str, body: HostInput):
        meeting = meeting_row(meeting_id)
        if not secrets.compare_digest(
            digest(body.host_token), meeting["host_token_hash"]
        ):
            raise HTTPException(403, "Only the meeting host can cancel this meeting.")
        if meeting["status"] == "active":
            raise HTTPException(
                409, "This meeting is in progress. End it from the meeting room."
            )
        ended = now()
        database.batch(
            [
                (
                    "UPDATE meetings SET status=?, ended_at=? WHERE id=?",
                    ("ended", ended, meeting_id),
                ),
                (
                    "UPDATE sessions SET ended_at=? WHERE meeting_id=?",
                    (ended, meeting_id),
                ),
            ]
        )
        return {"ok": True}

    @router.post("/meetings/{meeting_id}/join", status_code=201)
    def join_meeting(meeting_id: str, body: JoinInput):
        meeting = meeting_row(meeting_id)
        if meeting["status"] == "ended":
            raise HTTPException(409, "This meeting has ended.")
        is_host = bool(
            body.host_token
            and secrets.compare_digest(
                digest(body.host_token), meeting["host_token_hash"]
            )
        )
        if body.host_token and not is_host:
            raise HTTPException(
                403, "The host invitation is invalid. Join as a participant instead."
            )
        session = database.execute(
            "SELECT id FROM sessions WHERE meeting_id=?", (meeting_id,)
        )[0]["id"]
        participant_id = str(uuid4())
        token = secrets.token_urlsafe(32)
        joined_at = now()
        current = time.time()
        result = database.batch(
            [
                (
                    "INSERT INTO participants(id,session_id,name,token_hash,is_host,muted,video_off,joined_at,last_seen) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM participants WHERE session_id=? AND removed=0 AND left_at IS NULL AND last_seen>?) < ? AND EXISTS(SELECT 1 FROM meetings WHERE id=? AND status<>?) RETURNING *",
                    (
                        participant_id,
                        session,
                        body.name,
                        digest(token),
                        is_host,
                        body.muted,
                        body.video_off,
                        joined_at,
                        current,
                        session,
                        current - PRESENCE_SECONDS,
                        MAX_PARTICIPANTS,
                        meeting_id,
                        "ended",
                    ),
                ),
                (
                    "UPDATE meetings SET status=? WHERE id=? AND status<>? AND EXISTS(SELECT 1 FROM participants WHERE id=?)",
                    ("active", meeting_id, "ended", participant_id),
                ),
                (
                    "UPDATE sessions SET started_at=COALESCE(started_at,?) WHERE id=? AND EXISTS(SELECT 1 FROM participants WHERE id=?)",
                    (joined_at, session, participant_id),
                ),
            ]
        )
        if not result[0]:
            raise HTTPException(
                409,
                "This room is full or the meeting has ended. Please try again later.",
            )
        return {
            "participant": participant_public(result[0][0]),
            "token": token,
            "meeting": meeting_public(meeting_row(meeting_id)),
        }

    @router.get("/meetings/{meeting_id}/state")
    def room_state(
        meeting_id: str,
        cursor: int = Query(default=0, ge=0),
        person=Depends(authorized),
    ):
        current = time.time()
        results = database.batch(
            [
                (
                    "UPDATE participants SET last_seen=? WHERE id=?",
                    (current, person["id"]),
                ),
                (
                    "SELECT * FROM participants WHERE session_id=? AND left_at IS NULL AND removed=0 AND last_seen>? ORDER BY joined_at",
                    (person["session_id"], current - PRESENCE_SECONDS),
                ),
                (
                    "SELECT id,sender_id,kind,payload FROM signals WHERE target_id=? AND id>? AND created_at>? ORDER BY id LIMIT 200",
                    (person["id"], cursor, current - 300),
                ),
                (
                    "SELECT m.id,p.name,m.content,m.created_at FROM messages m JOIN participants p ON p.id=m.participant_id WHERE m.session_id=? ORDER BY m.id DESC LIMIT 100",
                    (person["session_id"],),
                ),
                ("DELETE FROM signals WHERE created_at<?", (current - 300,)),
            ]
        )
        return {
            "participants": [participant_public(p) for p in results[1]],
            "signals": [{**s, "payload": json.loads(s["payload"])} for s in results[2]],
            "messages": list(reversed(results[3])),
            "status": meeting_row(meeting_id)["status"],
        }

    @router.post("/meetings/{meeting_id}/update")
    def update_participant(
        meeting_id: str, body: UpdateInput, person=Depends(authorized)
    ):
        active(person)
        values = body.model_dump(exclude_none=True)
        if values:
            # Column names come only from the Pydantic model, never raw user input.
            fields = ",".join(f"{key}=?" for key in values)
            database.execute(
                f"UPDATE participants SET {fields},last_seen=? WHERE id=?",
                tuple(int(v) for v in values.values()) + (time.time(), person["id"]),
            )
        return {"ok": True}

    @router.post("/meetings/{meeting_id}/signal")
    def relay_signal(meeting_id: str, body: SignalInput, person=Depends(authorized)):
        active(person)
        payload = json.dumps(body.payload)
        if len(payload) > 100000:
            raise HTTPException(413, "Connection message is too large.")
        target = database.execute(
            "SELECT id FROM participants WHERE id=? AND session_id=? AND removed=0 AND left_at IS NULL AND last_seen>?",
            (body.target_id, person["session_id"], time.time() - PRESENCE_SECONDS),
        )
        if not target or body.target_id == person["id"]:
            raise HTTPException(404, "Participant is no longer in this meeting.")
        database.execute(
            "INSERT INTO signals(session_id,sender_id,target_id,kind,payload,created_at) VALUES (?,?,?,?,?,?)",
            (
                person["session_id"],
                person["id"],
                body.target_id,
                body.kind,
                payload,
                time.time(),
            ),
        )
        return {"ok": True}

    @router.post("/meetings/{meeting_id}/chat", status_code=201)
    def chat(meeting_id: str, body: ChatInput, person=Depends(authorized)):
        active(person)
        database.execute(
            "INSERT INTO messages(session_id,participant_id,content,created_at) VALUES (?,?,?,?)",
            (person["session_id"], person["id"], body.content, now()),
        )
        return {"ok": True}

    @router.post("/meetings/{meeting_id}/mute-all")
    def mute_all(meeting_id: str, person=Depends(authorized)):
        active(person)
        require_host(person)
        database.execute(
            "UPDATE participants SET muted=1 WHERE session_id=? AND id<>? AND left_at IS NULL AND removed=0",
            (person["session_id"], person["id"]),
        )
        return {"ok": True}

    @router.post("/meetings/{meeting_id}/remove")
    def remove_participant(
        meeting_id: str, body: RemoveInput, person=Depends(authorized)
    ):
        active(person)
        require_host(person)
        if body.participant_id == person["id"]:
            raise HTTPException(400, "Use Leave meeting to leave the room.")
        rows = database.execute(
            "UPDATE participants SET removed=1,left_at=? WHERE id=? AND session_id=? RETURNING id",
            (now(), body.participant_id, person["session_id"]),
        )
        if not rows:
            raise HTTPException(404, "Participant not found in this meeting.")
        return {"ok": True}

    @router.post("/meetings/{meeting_id}/leave")
    def leave_meeting(meeting_id: str, person=Depends(authorized)):
        database.execute(
            "UPDATE participants SET left_at=? WHERE id=?", (now(), person["id"])
        )
        return {"ok": True}

    @router.post("/meetings/{meeting_id}/end")
    def end_meeting(meeting_id: str, person=Depends(authorized)):
        require_host(person)
        ended = now()
        database.batch(
            [
                (
                    "UPDATE meetings SET status=?,ended_at=? WHERE id=?",
                    ("ended", ended, meeting_id),
                ),
                (
                    "UPDATE sessions SET ended_at=? WHERE id=?",
                    (ended, person["session_id"]),
                ),
            ]
        )
        return {"ok": True}

    application.include_router(router)
    return application


app = create_app()
