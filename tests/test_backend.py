"""Workflow and permission tests against local SQLite and the hosted transport.

The hosted transport is exercised through a faithful in-process Hrana adapter.
An actual Turso account and Vercel deployment are separate deployment checks.
"""

import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.db import Database
from backend.main import create_app


@pytest.fixture(params=["local", "hosted-transport"])
def api_client(tmp_path, monkeypatch, request):
    monkeypatch.setenv("SEED_SAMPLE_DATA", "false")
    path = str(tmp_path / "test.db")
    database = Database(path=path, url="", token="")
    if request.param == "hosted-transport":
        database.url = "libsql://test.turso.io"
        database.token = "test-token"

        def post(url, *, headers, json, timeout):
            assert url == "https://test.turso.io/v2/pipeline"
            assert headers["Authorization"] == "Bearer test-token"
            assert json["requests"][-1] == {"type": "close"}
            conn = sqlite3.connect(path, timeout=15)
            assert json["requests"][0]["stmt"]["sql"] == "PRAGMA foreign_keys=ON"
            conn.execute(json["requests"][0]["stmt"]["sql"])
            results, errors = [], []

            def condition(c):
                if not c:
                    return True
                if c["type"] == "ok":
                    return results[c["step"]] is not None
                if c["type"] == "not":
                    return not condition(c["cond"])
                raise AssertionError("Unexpected condition")

            for step in json["requests"][1]["batch"]["steps"]:
                if not condition(step.get("condition")):
                    results.append(None)
                    errors.append(None)
                    continue
                try:
                    stmt = step["stmt"]
                    args = [Database.decode(v) for v in stmt.get("args", [])]
                    cursor = conn.execute(stmt["sql"], args)
                    cols = [{"name": col[0]} for col in cursor.description or []]
                    rows = [
                        [Database.value(v) for v in row] for row in cursor.fetchall()
                    ]
                    results.append({"cols": cols, "rows": rows})
                    errors.append(None)
                except sqlite3.Error as error:
                    results.append(None)
                    errors.append({"message": str(error)})
            conn.close()
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={
                    "results": [
                        {
                            "type": "ok",
                            "response": {
                                "type": "execute",
                                "result": {"cols": [], "rows": []},
                            },
                        },
                        {
                            "type": "ok",
                            "response": {
                                "type": "batch",
                                "result": {
                                    "step_results": results,
                                    "step_errors": errors,
                                },
                            },
                        },
                        {"type": "ok", "response": {"type": "close"}},
                    ]
                },
            )

        monkeypatch.setattr(httpx, "post", post)
    client = TestClient(create_app(database))
    assert client.get("/api/v1/health").status_code == 200
    return client, database


def create(client, scheduled=False):
    body = {
        "title": "Test meeting",
        "description": "A useful conversation",
        "duration": 30,
    }
    if scheduled:
        body["scheduled_at"] = (
            datetime.now(timezone.utc) + timedelta(days=1)
        ).isoformat()
    response = client.post("/api/v1/meetings", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def join(client, created, name="Guest", host=False):
    response = client.post(
        f"/api/v1/meetings/{created['meeting']['id']}/join",
        json={"name": name, "host_token": created["host_token"] if host else ""},
    )
    assert response.status_code == 201, response.text
    return response.json()


def room(created, action):
    return f"/api/v1/meetings/{created['meeting']['id']}/{action}"


def auth(person):
    return {"Authorization": "Bearer " + person["token"]}


def test_creation_and_no_secret_leak(api_client):
    client, database = api_client
    created = create(client)
    meeting = created["meeting"]
    assert len(meeting["id"]) == 11 and meeting["id"].isdigit()
    assert meeting["status"] == "active"
    assert "host_token" not in client.get("/api/v1/meetings").text
    assert "host_token_hash" not in client.get("/api/v1/meetings").text
    assert client.get("/api/v1/meetings/" + meeting["id"]).json() == meeting
    assert database.execute("SELECT COUNT(*) AS n FROM sessions")[0]["n"] == 1


def test_schedule_and_cancel_authorization(api_client):
    client, _ = api_client
    created = create(client, scheduled=True)
    assert created["meeting"]["status"] == "scheduled"
    assert (
        client.post(room(created, "cancel"), json={"host_token": "wrong"}).status_code
        == 403
    )
    assert (
        client.post(
            room(created, "cancel"), json={"host_token": created["host_token"]}
        ).status_code
        == 200
    )
    assert client.get("/api/v1/meetings").json()[0]["status"] == "ended"
    assert (
        client.post(room(created, "join"), json={"name": "Late guest"}).status_code
        == 409
    )


@pytest.mark.parametrize(
    "body",
    [
        {"title": "   "},
        {"title": "x", "duration": 0},
        {"title": "x", "duration": 900},
        {"title": "x", "scheduled_at": "2000-01-01T10:00:00Z"},
        {"title": "x", "scheduled_at": "2099-01-01T10:00:00"},
    ],
)
def test_invalid_schedules(api_client, body):
    client, _ = api_client
    assert client.post("/api/v1/meetings", json=body).status_code == 422


def test_invalid_meeting_and_display_name(api_client):
    client, _ = api_client
    assert client.get("/api/v1/meetings/not-a-meeting").status_code == 404
    assert client.get("/api/v1/meetings/99999999999").status_code == 404
    created = create(client)
    assert client.post(room(created, "join"), json={"name": " "}).status_code == 422
    assert (
        client.post(room(created, "join"), json={"name": "x" * 61}).status_code == 422
    )
    assert (
        client.post(
            room(created, "join"), json={"name": "Host", "host_token": "fake"}
        ).status_code
        == 403
    )


def test_join_presence_and_identity(api_client):
    client, _ = api_client
    created = create(client, scheduled=True)
    host = join(client, created, "Host", host=True)
    guest = join(client, created)
    assert host["participant"]["is_host"] is True
    assert guest["participant"]["is_host"] is False
    state = client.get(room(created, "state"), headers=auth(host)).json()
    assert len(state["participants"]) == 2
    assert state["status"] == "active"
    assert client.get(room(created, "state")).status_code == 401
    assert (
        client.get(
            room(created, "state"), headers={"Authorization": "Bearer fake"}
        ).status_code
        == 401
    )


def test_signaling_delivery_cursor_and_room_isolation(api_client):
    client, _ = api_client
    created = create(client)
    host = join(client, created, host=True)
    guest = join(client, created)
    other = create(client)
    outsider = join(client, other)
    signal = {
        "target_id": guest["participant"]["id"],
        "kind": "offer",
        "payload": {"sdp": "test", "type": "offer"},
    }
    assert (
        client.post(
            room(created, "signal"), headers=auth(host), json=signal
        ).status_code
        == 200
    )
    state = client.get(room(created, "state"), headers=auth(guest)).json()
    assert len(state["signals"]) == 1
    assert state["signals"][0]["payload"] == signal["payload"]
    cursor = state["signals"][0]["id"]
    assert not client.get(
        room(created, f"state?cursor={cursor}"), headers=auth(guest)
    ).json()["signals"]
    assert not client.get(room(created, "state"), headers=auth(host)).json()["signals"]
    assert client.get(room(created, "state"), headers=auth(outsider)).status_code == 401
    signal["target_id"] = outsider["participant"]["id"]
    assert (
        client.post(
            room(created, "signal"), headers=auth(host), json=signal
        ).status_code
        == 404
    )


def test_chat_and_participant_updates(api_client):
    client, _ = api_client
    created = create(client)
    host = join(client, created, host=True)
    guest = join(client, created)
    assert (
        client.post(
            room(created, "chat"),
            headers=auth(guest),
            json={"content": "Hello everyone"},
        ).status_code
        == 201
    )
    assert (
        client.post(
            room(created, "chat"), headers=auth(guest), json={"content": " "}
        ).status_code
        == 422
    )
    assert (
        client.post(
            room(created, "update"),
            headers=auth(guest),
            json={"muted": True, "hand_raised": True},
        ).status_code
        == 200
    )
    state = client.get(room(created, "state"), headers=auth(host)).json()
    assert state["messages"][0]["content"] == "Hello everyone"
    person = next(
        p for p in state["participants"] if p["id"] == guest["participant"]["id"]
    )
    assert person["muted"] and person["hand_raised"]
    assert (
        client.post(
            room(created, "update"), headers=auth(guest), json={"is_host": True}
        ).status_code
        == 422
    )


def test_host_controls_enforced(api_client):
    client, _ = api_client
    created = create(client)
    host = join(client, created, host=True)
    guest = join(client, created)
    for action in ("mute-all", "end"):
        assert (
            client.post(room(created, action), headers=auth(guest), json={}).status_code
            == 403
        )
    assert (
        client.post(
            room(created, "remove"),
            headers=auth(guest),
            json={"participant_id": host["participant"]["id"]},
        ).status_code
        == 403
    )
    assert (
        client.post(room(created, "mute-all"), headers=auth(host), json={}).status_code
        == 200
    )
    state = client.get(room(created, "state"), headers=auth(guest)).json()
    assert next(
        p for p in state["participants"] if p["id"] == guest["participant"]["id"]
    )["muted"]
    assert (
        client.post(
            room(created, "remove"),
            headers=auth(host),
            json={"participant_id": guest["participant"]["id"]},
        ).status_code
        == 200
    )
    assert client.get(room(created, "state"), headers=auth(guest)).status_code == 403
    assert (
        len(
            client.get(room(created, "state"), headers=auth(host)).json()[
                "participants"
            ]
        )
        == 1
    )


def test_end_and_leave_lifecycle(api_client):
    client, _ = api_client
    created = create(client)
    host = join(client, created, host=True)
    guest = join(client, created)
    assert (
        client.post(room(created, "leave"), headers=auth(guest), json={}).status_code
        == 200
    )
    assert client.get(room(created, "state"), headers=auth(guest)).status_code == 403
    guest = join(client, created)
    assert (
        client.post(room(created, "end"), headers=auth(host), json={}).status_code
        == 200
    )
    assert (
        client.get(room(created, "state"), headers=auth(guest)).json()["status"]
        == "ended"
    )
    assert (
        client.post(
            room(created, "chat"), headers=auth(guest), json={"content": "late"}
        ).status_code
        == 409
    )
    assert client.post(room(created, "join"), json={"name": "late"}).status_code == 409


def test_stale_presence_and_capacity(api_client):
    client, database = api_client
    created = create(client)
    host = join(client, created, host=True)
    guests = [join(client, created, f"Guest {i}") for i in range(5)]
    assert (
        client.post(room(created, "join"), json={"name": "Overflow"}).status_code == 409
    )
    database.execute(
        "UPDATE participants SET last_seen=? WHERE id=?",
        (time.time() - 90, guests[0]["participant"]["id"]),
    )
    assert (
        len(
            client.get(room(created, "state"), headers=auth(host)).json()[
                "participants"
            ]
        )
        == 5
    )
    assert (
        client.get(room(created, "state"), headers=auth(guests[0])).status_code == 403
    )
    join(client, created, "Replacement")


def test_database_relationships_and_transaction_rollback(api_client):
    _, database = api_client
    before = database.execute("SELECT COUNT(*) AS n FROM users")[0]["n"]
    with pytest.raises((sqlite3.IntegrityError, RuntimeError)):
        database.batch(
            [
                (
                    "INSERT INTO users(id,display_name,created_at) VALUES (?,?,?)",
                    ("temporary", "Temporary", "now"),
                ),
                (
                    "INSERT INTO sessions(id,meeting_id) VALUES (?,?)",
                    ("orphan", "99999999999"),
                ),
            ]
        )
    assert database.execute("SELECT COUNT(*) AS n FROM users")[0]["n"] == before


def test_capacity_is_atomic_under_concurrent_joins(api_client):
    client, _ = api_client
    created = create(client)
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(
            executor.map(
                lambda i: (
                    client.post(
                        room(created, "join"), json={"name": f"Concurrent {i}"}
                    ).status_code
                ),
                range(8),
            )
        )
    assert results.count(201) == 6
    assert results.count(409) == 2


def test_vercel_requires_durable_database(tmp_path, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    database = Database(path=str(tmp_path / "must-not-exist.db"), url="", token="")
    with pytest.raises(RuntimeError, match="persistent SQLite"):
        database.execute("SELECT 1")
    assert not (tmp_path / "must-not-exist.db").exists()
