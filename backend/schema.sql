CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY CHECK(length(id) = 11 AND id NOT GLOB '*[^0-9]*'),
  host_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT,
  duration INTEGER NOT NULL CHECK(duration BETWEEN 5 AND 480),
  status TEXT NOT NULL CHECK(status IN ('scheduled', 'active', 'ended')),
  host_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
  started_at TEXT,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
  token_hash TEXT NOT NULL UNIQUE,
  is_host INTEGER NOT NULL DEFAULT 0 CHECK(is_host IN (0, 1)),
  muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0, 1)),
  video_off INTEGER NOT NULL DEFAULT 0 CHECK(video_off IN (0, 1)),
  hand_raised INTEGER NOT NULL DEFAULT 0 CHECK(hand_raised IN (0, 1)),
  removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0, 1)),
  joined_at TEXT NOT NULL,
  left_at TEXT,
  last_seen REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES participants(id),
  target_id TEXT NOT NULL REFERENCES participants(id),
  kind TEXT NOT NULL CHECK(kind IN ('offer', 'answer', 'ice')),
  payload TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  content TEXT NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meetings_schedule ON meetings(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_participants_presence ON participants(session_id, last_seen);
CREATE INDEX IF NOT EXISTS idx_signals_target ON signals(target_id, id);
CREATE INDEX IF NOT EXISTS idx_signals_age ON signals(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
