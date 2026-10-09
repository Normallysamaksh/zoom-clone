"""A small SQLite repository with a hosted libSQL HTTP transport for Vercel.

SQL and schema are identical locally and remotely. Each batch runs inside one
transaction. Cloud batches use Hrana conditions so errors roll back all writes.
"""

import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

import httpx

Statement = tuple[str, tuple[Any, ...]]


class Database:
    def __init__(
        self, path: str | None = None, url: str | None = None, token: str | None = None
    ):
        self.url = url if url is not None else os.getenv("TURSO_DATABASE_URL", "")
        self.token = token if token is not None else os.getenv("TURSO_AUTH_TOKEN", "")
        self.path = path or os.getenv(
            "DATABASE_PATH",
            str(Path(__file__).resolve().parent.parent / "data" / "meetings.db"),
        )
        self.initialized = False
        self.lock = threading.Lock()

    def connection(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    @staticmethod
    def value(value):
        if value is None:
            return {"type": "null"}
        if isinstance(value, (bool, int)):
            return {"type": "integer", "value": str(int(value))}
        if isinstance(value, float):
            return {"type": "float", "value": value}
        return {"type": "text", "value": str(value)}

    @staticmethod
    def decode(value):
        kind = value["type"]
        if kind == "null":
            return None
        if kind == "integer":
            return int(value["value"])
        if kind == "float":
            return float(value["value"])
        return value["value"]

    def batch(self, statements: list[Statement]) -> list[list[dict]]:
        if not self.url:
            if os.getenv("VERCEL"):
                raise RuntimeError(
                    "Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN for persistent SQLite on Vercel."
                )
            connection = self.connection()
            try:
                connection.execute("BEGIN IMMEDIATE")
                results = []
                for sql, args in statements:
                    cursor = connection.execute(sql, args)
                    results.append([dict(row) for row in cursor.fetchall()])
                connection.commit()
                return results
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()
        if not self.token:
            raise RuntimeError(
                "TURSO_AUTH_TOKEN must be configured for the hosted database."
            )
        url = self.url.replace("libsql://", "https://").rstrip("/")
        if not url.startswith("https://"):
            raise RuntimeError("Hosted database connections must use HTTPS.")
        steps = [{"stmt": {"sql": "BEGIN IMMEDIATE", "want_rows": False}}]
        for index, (sql, args) in enumerate(statements):
            steps.append(
                {
                    "condition": {"type": "ok", "step": index},
                    "stmt": {
                        "sql": sql,
                        "args": [self.value(v) for v in args],
                        "want_rows": True,
                    },
                }
            )
        steps.append(
            {
                "condition": {"type": "ok", "step": len(statements)},
                "stmt": {"sql": "COMMIT", "want_rows": False},
            }
        )
        steps.append(
            {
                "condition": {
                    "type": "not",
                    "cond": {"type": "ok", "step": len(statements) + 1},
                },
                "stmt": {"sql": "ROLLBACK", "want_rows": False},
            }
        )
        response = httpx.post(
            url + "/v2/pipeline",
            headers={"Authorization": f"Bearer {self.token}"},
            json={
                "requests": [
                    {
                        "type": "execute",
                        "stmt": {"sql": "PRAGMA foreign_keys=ON", "want_rows": False},
                    },
                    {"type": "batch", "batch": {"steps": steps}},
                    {"type": "close"},
                ]
            },
            timeout=15,
        )
        response.raise_for_status()
        pipeline = response.json()["results"]
        if pipeline[0]["type"] == "error":
            raise RuntimeError("Could not enable database relationship constraints.")
        result = pipeline[1]
        if result["type"] == "error":
            raise RuntimeError("Hosted database request failed.")
        batch = result["response"]["result"]
        if any(batch["step_errors"]):
            raise RuntimeError("Hosted database transaction failed.")
        results = []
        for item in batch["step_results"][1 : len(statements) + 1]:
            columns = [col["name"] for col in item["cols"]]
            results.append(
                [
                    dict(zip(columns, [self.decode(v) for v in row]))
                    for row in item["rows"]
                ]
            )
        return results

    def execute(self, sql: str, args: tuple = ()) -> list[dict]:
        return self.batch([(sql, args)])[0]

    def initialize(self):
        if self.initialized:
            return
        with self.lock:
            if self.initialized:
                return
            schema = (Path(__file__).parent / "schema.sql").read_text()
            self.batch(
                [
                    (statement.strip(), ())
                    for statement in schema.split(";")
                    if statement.strip()
                ]
            )
            self.initialized = True


db = Database()
