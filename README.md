# Zoom Meeting Platform

An original fullstack assignment implementation of Zoom's browser meeting workflows. The frontend uses Next.js and TypeScript; the API uses Python and FastAPI; SQLite stores meetings, attendance, signaling, and chat.

## Features

- Responsive dashboard with instant, join, and schedule actions.
- Unique 11-digit meeting IDs and invitation links.
- Meeting validation, display names, and pre-join camera/microphone preview.
- Scheduling with topic, description, local date/time, and duration.
- Upcoming meetings and completed meeting history.
- Real WebRTC audio/video in small rooms, mute/video controls, and screen sharing.
- Participant list, raise hand, and meeting chat.
- Host-only mute all, remove participant, cancel scheduled meetings, and end for everyone.
- Device-local preferences and a seeded default user; no signup required.
- Vercel deployment configuration for both Next.js and FastAPI.

## Run locally

Requirements: Node.js 22 or newer, Python 3.12 or newer, and Chrome for the included browser tests.

```powershell
npm install
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-dev.txt
Copy-Item .env.example .env.local
npm run dev
```

On macOS/Linux, activate the environment with `source .venv/bin/activate` and copy the environment file with `cp .env.example .env.local`.

Open http://127.0.0.1:3000. `npm run dev` starts the frontend on port 3000 and the API on port 8000, loading `.env.local` for both. API documentation is available directly at http://127.0.0.1:8000/api/docs. Local SQLite data is created automatically at `data/meetings.db`; the schema and seed data initialize on the first API request. Stop both services with Ctrl+C.

To run them separately:

```powershell
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
npm run dev:web
```

If using a Python executable with another name, set `PYTHON_EXECUTABLE` before running `npm run dev`.

To run both services in production mode locally, run `npm run build` and then `npm run start:all`. The launcher automatically uses the project's `.venv` when present.

## Deploy the full application to Vercel

The repository contains a `vercel.json` using [Vercel Services](https://vercel.com/kb/guide/vercel-services): Next.js runs from the repository root, and FastAPI runs from `backend/`. `/api/*` routes to FastAPI; all other routes go to Next.js on the same domain. The configuration explicitly names both frameworks.

Vercel functions cannot provide a durable local SQLite file across deployments and instances. The backend therefore supports hosted SQLite through Turso/libSQL's HTTP protocol while keeping the same schema and SQL. It deliberately refuses to use an ephemeral local database when `VERCEL` is set.

1. Create a Turso/libSQL database and obtain its database URL and authentication token.
2. Push this repository to your own public GitHub repository and import it into Vercel. Keep the repository root as the project root, and allow Vercel to use the checked-in Services configuration. Both services belong to one deployment.
3. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for the **backend** service. Enable them for the deployment environments you plan to use. The schema and sample data are created automatically on the first request.
4. Keep `NEXT_PUBLIC_DEMO_MODE` unset or set to `false` for the frontend. **Do not set `BACKEND_URL` on Vercel**; it is only a local development proxy setting. Never upload `.env.local`.
5. For calls across different networks, supply a TURN relay through the frontend's `NEXT_PUBLIC_ICE_SERVERS` variable (JSON array; example below). STUN is configured by default, but restrictive NAT/firewalls can require TURN. Use scoped/temporary credentials: all `NEXT_PUBLIC_*` values are visible to the browser. Changing them requires rebuilding the frontend.
6. Deploy and visit `/api/v1/health`; it should report `hosted-sqlite`. Test a meeting using two devices, including one on mobile data, before submission.

```json
[
  { "urls": "stun:stun.l.google.com:19302" },
  { "urls": "turn:YOUR_RELAY_HOST:3478", "username": "YOUR_SCOPED_USER", "credential": "YOUR_TEMPORARY_CREDENTIAL" }
]
```

You can also host FastAPI on a persistent Python service with SQLite and deploy just the frontend to Vercel. In that configuration use a Next.js-only deployment config and set the frontend's `BACKEND_URL` to the public HTTPS backend URL. The checked-in configuration targets the all-Vercel deployment.

No public deployment is claimed by this repository. A live Vercel/Turso deployment requires your accounts and environment variables. The hosted SQL transport is tested with an in-process implementation of the documented protocol; a live cloud database is an additional deployment check.

## Test

With both development servers running:

```powershell
python -m pytest
npm run typecheck
npm run test:e2e
npm run build
```

The backend suite tests local SQLite and the hosted HTTP transport, including transactional rollback, unauthorized host actions, stale presence, signaling isolation, and concurrent room capacity. Playwright uses generated canvas frames and audio tones to verify real audio and video arriving between independent browser processes, chat delivery, mute-all disabling the actual audio track, participant removal, and end meeting. Only the media inputs are substituted for testing; the peer connection, signaling, encoding, and network transport are real. Separate tests exercise browser permission denial and joining without media.

Run against a fresh development database for predictable test fixtures. Browser tests create test meetings in the running API. Unit tests use isolated temporary databases. If the operating system restricts its temp directory, use `python -m pytest --basetemp=tmp/backend-tests` with a directory reserved for test data.

## Database design

`backend/schema.sql` is the source of truth. Foreign keys, check constraints, and indexes protect the data and support common queries.

| Table | Purpose and relationships |
| --- | --- |
| `users` | Default workspace identity; one user can host multiple meetings. |
| `meetings` | Topic, schedule, duration, lifecycle, and hashed host capability; belongs to a host. |
| `sessions` | Actual start/end times; one session per meeting in this assignment. |
| `participants` | Per-join identity, hashed bearer token, media preferences, presence, and attendance; belongs to a session. |
| `signals` | WebRTC offers, answers, and ICE candidates addressed between session participants. |
| `messages` | Persisted chat linked to a session and its author. |

Join capacity is checked inside the same transaction as participant insertion. Presence expires after 60 seconds without a heartbeat. Signaling messages expire after five minutes and are cleaned during state polling. Chat returns the latest 100 messages; meeting lists return the latest 250 meetings.

## Implementation decisions and assumptions

- A default user, Alex Morgan, is assumed logged in, as required. This is an assignment demo with no account isolation or production authentication.
- Each newly created meeting returns a random host capability once. The creating browser stores it locally; guests never receive it from meeting lists or invitation links. Participant actions require a separate bearer token. The database stores hashes of both token types.
- Seeded meetings demonstrate the dashboard and can be joined as a guest. Create your own meeting to test host controls; sample host secrets are not exposed.
- Meeting IDs are generated with Python's cryptographic random generator and enforced as unique by SQLite.
- Dates are stored in UTC and displayed in each browser's local timezone. Scheduled meetings can be joined early; duration is metadata and does not impose an automatic cutoff.
- Ending or cancelling a meeting prevents new joins. Leaving preserves an active room for other participants. Rejoining creates a new attendance record.
- Removed participants lose their current session. With no authentication, they can use the public invitation to join again under a new session; persistent identity bans are outside this assignment.
- WebRTC uses a mesh of peer connections, limited to six active participants. This is intended for small rooms. Larger calls require a media server/SFU.
- Clients poll room state approximately once per second. This keeps signaling compatible with serverless deployments without process-local state. Media travels directly between browsers or through your TURN relay, not through SQLite.
- Camera and microphone access require localhost or HTTPS. Permission denial is handled; joining without media remains possible. Screen sharing requires browser support and explicit browser permission.
- Host muting turns off the guest's microphone track through the normal client. It is not a media-server-enforced moderation mechanism.
- Recordings, virtual backgrounds, recurring meetings, calendar integrations, login/signup, and Zoom's proprietary infrastructure are outside scope.
- The UI follows Zoom's web Home actions and meeting toolbar conventions. The screenshots document this implementation; pixel-for-pixel parity with every Zoom version is not claimed.

## Project structure

```text
app/                       Next.js routes and responsive styles
components/                Dashboard, dialogs, pre-join, and meeting room
lib/api.ts                 API client and explicit design-preview adapter
lib/use-meeting.ts          Peer negotiation, signaling, and live room state
backend/main.py            HTTP routes, workflow rules, and authorization
backend/models.py          Request validation
backend/db.py              SQLite transactions and hosted SQL transport
backend/schema.sql         Schema, constraints, and indexes
backend/seed.py             Idempotent sample data
tests/                     API and browser tests
scripts/                   Development startup and design capture
frontend_designs.pdf       26-page document containing 25 frontend screenshots
output/screenshots/        Original screenshots and capture manifest
vercel.json                Frontend/backend deployment and public routing
```

## Frontend design document

`frontend_designs.pdf` contains actual screenshots of the frontend's desktop and mobile screens, captured before backend integration using explicit preview mode. The PDF has been rendered and visually checked. The UI remains the same in live API mode.

To recapture designs, temporarily set `NEXT_PUBLIC_DEMO_MODE=true` in `.env.local`, restart the frontend, and run `node scripts/capture-frontend.mjs`. PDF generation additionally requires `reportlab`, `pypdf`, and Pillow, then `python scripts/build-design-pdf.py`. Restore `NEXT_PUBLIC_DEMO_MODE=false` before testing or submitting the live application.

## Reference material

- [Zoom Web App workflows](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064261)
- [WebRTC peer connections](https://webrtc.org/getting-started/peer-connections)
- [Vercel Services](https://vercel.com/kb/guide/vercel-services)
- [libSQL HTTP protocol](https://github.com/tursodatabase/libsql/blob/main/docs/HTTP_V2_SPEC.md)

All application code was written for this assignment. Reference documentation informed the workflows and deployment configuration; no existing clone repository was used.
