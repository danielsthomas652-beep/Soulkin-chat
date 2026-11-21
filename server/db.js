// Database layer — three engines behind one small facade:
//
//   1. Turso (cloud mode): when TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are
//      both set, use @libsql/client against the hosted SQLite database.
//      This is the mode used on Render, whose free-tier disk is ephemeral —
//      the database (and photo blobs) live in Turso, not on local disk.
//   2. better-sqlite3 (local default): a SQLite file in data/.
//   3. node:sqlite (local fallback) if the native module is unavailable.
//
// Facade contract (used everywhere in server/index.js):
//   db.prepare(sql) -> { get(...args), all(...args), run(...args) }
//   db.exec(sql)    -> run multi-statement SQL (schema setup)
//   run() resolves to { changes, lastInsertRowid } on every engine.
// The local engines return plain values; the Turso engine returns Promises.
// Callers always `await`, which works for both. All SQL is identical across
// engines (positional `?` params only).
const path = require('path');
const fs = require('fs');

const TURSO_URL = process.env.TURSO_DATABASE_URL || '';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
const cloudMode = !!(TURSO_URL && TURSO_TOKEN);

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = cloudMode ? null : path.join(DATA_DIR, 'solkin.db');

let engine;
let db;

function normalizeLocalRun(info) {
  return {
    changes: info && info.changes != null ? Number(info.changes) : 0,
    lastInsertRowid: info && info.lastInsertRowid != null ? Number(info.lastInsertRowid) : null,
  };
}

function makeLocalFacade(raw) {
  return {
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
        run: (...args) => normalizeLocalRun(stmt.run(...args)),
      };
    },
    exec: (sql) => raw.exec(sql),
  };
}

function libsqlArg(a) {
  if (a === undefined) return null;
  if (Buffer.isBuffer(a)) return new Uint8Array(a); // BLOB (photo bytes)
  return a;
}

function makeTursoFacade(client) {
  return {
    prepare(sql) {
      return {
        get: async (...args) => {
          const rs = await client.execute({ sql, args: args.map(libsqlArg) });
          return rs.rows[0];
        },
        all: async (...args) => {
          const rs = await client.execute({ sql, args: args.map(libsqlArg) });
          return rs.rows;
        },
        run: async (...args) => {
          const rs = await client.execute({ sql, args: args.map(libsqlArg) });
          return {
            changes: rs.rowsAffected,
            lastInsertRowid: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : null,
          };
        },
      };
    },
    exec: async (sql) => { await client.executeMultiple(sql); },
  };
}

if (cloudMode) {
  const { createClient } = require('@libsql/client');
  const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  db = makeTursoFacade(client);
  engine = 'turso (@libsql/client)';
} else {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let raw;
  try {
    const BetterSQLite3 = require('better-sqlite3');
    raw = new BetterSQLite3(DB_PATH);
    engine = 'better-sqlite3';
  } catch (e) {
    const { DatabaseSync } = require('node:sqlite');
    raw = new DatabaseSync(DB_PATH);
    engine = 'node:sqlite';
  }
  try { raw.exec('PRAGMA journal_mode = WAL;'); } catch (e) { /* fine either way */ }
  try { raw.exec('PRAGMA foreign_keys = ON;'); } catch (e) { /* fine either way */ }
  db = makeLocalFacade(raw);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  is_protected INTEGER NOT NULL DEFAULT 0,
  phone TEXT,
  avatar TEXT,
  share_location INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  location_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  media_type TEXT,
  song_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS likes (
  post_id INTEGER NOT NULL REFERENCES posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS video_likes (
  video_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (video_id, user_id)
);
CREATE TABLE IF NOT EXISTS video_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS follows (
  user_id INTEGER NOT NULL REFERENCES users(id),
  creator TEXT NOT NULL,
  PRIMARY KEY (user_id, creator)
);
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  addressee_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  known_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  low_id INTEGER GENERATED ALWAYS AS (MIN(requester_id, addressee_id)) STORED,
  high_id INTEGER GENERATED ALWAYS AS (MAX(requester_id, addressee_id)) STORED,
  UNIQUE (low_id, high_id)
);
CREATE TABLE IF NOT EXISTS media_blobs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  is_snap INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (sender_id, recipient_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages (recipient_id, read_at, id);
`;

// Creates all tables if needed. Must be awaited once at startup, before
// seeding or serving requests. Local engines run it synchronously inside.
async function initDb() {
  await db.exec(SCHEMA);
  // Migration for databases created before the cross-band friend rule:
  // friendships.known_confirmed records the Protected user's "I know this
  // person in real life" attestation on cross-band (adult <-> Protected)
  // rows. CREATE TABLE IF NOT EXISTS above only covers fresh databases.
  const cols = await db.prepare("SELECT name FROM pragma_table_info('friendships')").all();
  if (!cols.some((c) => c.name === 'known_confirmed')) {
    await db.exec('ALTER TABLE friendships ADD COLUMN known_confirmed INTEGER NOT NULL DEFAULT 0');
  }
  // Migration for databases created before photo DMs: messages.media_url /
  // media_type carry an optional photo on a message, stored exactly like
  // post media (a /media/:id blob in cloud mode, an /uploads/ file in
  // local mode). Same reasoning as above — IF NOT EXISTS only covers
  // fresh databases.
  const msgCols = await db.prepare("SELECT name FROM pragma_table_info('messages')").all();
  if (!msgCols.some((c) => c.name === 'media_url')) {
    await db.exec('ALTER TABLE messages ADD COLUMN media_url TEXT');
  }
  if (!msgCols.some((c) => c.name === 'media_type')) {
    await db.exec('ALTER TABLE messages ADD COLUMN media_type TEXT');
  }
  // Migration for databases created before disappearing snaps:
  // messages.is_snap marks a Snapchat-style snap (its media_url is
  // server-only — never sent to any client) and opened_at records the
  // one moment the recipient opened it, at which point the stored
  // picture is deleted and media_url is nulled (see the snap-open
  // endpoint in server/index.js). Same reasoning as above.
  if (!msgCols.some((c) => c.name === 'is_snap')) {
    await db.exec('ALTER TABLE messages ADD COLUMN is_snap INTEGER NOT NULL DEFAULT 0');
  }
  if (!msgCols.some((c) => c.name === 'opened_at')) {
    await db.exec('ALTER TABLE messages ADD COLUMN opened_at TEXT');
  }
  // Migration for databases created before phone dialing: users.phone is
  // the owner's optional phone number, shared ONLY with accepted friends
  // so they can tap-to-call (see visiblePhone in server/index.js). A
  // Protected user's number is stored but never exposed by the API.
  const userCols = await db.prepare("SELECT name FROM pragma_table_info('users')").all();
  if (!userCols.some((c) => c.name === 'phone')) {
    await db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
  }
  // Migration for databases created before the Friend Map: location
  // sharing is opt-in (share_location, default 0 = off) and lat/lng/
  // location_at hold the owner's last shared fix. They are only ever
  // written by POST /api/location while sharing is on (never for
  // Protected accounts — see server/index.js) and only ever read back
  // through the visibleLocation gate.
  if (!userCols.some((c) => c.name === 'share_location')) {
    await db.exec('ALTER TABLE users ADD COLUMN share_location INTEGER NOT NULL DEFAULT 0');
  }
  if (!userCols.some((c) => c.name === 'lat')) {
    await db.exec('ALTER TABLE users ADD COLUMN lat REAL');
  }
  if (!userCols.some((c) => c.name === 'lng')) {
    await db.exec('ALTER TABLE users ADD COLUMN lng REAL');
  }
  if (!userCols.some((c) => c.name === 'location_at')) {
    await db.exec('ALTER TABLE users ADD COLUMN location_at TEXT');
  }
  // Migration for databases created before avatars:
  // users.avatar holds the owner's preset portrait id ("p01".."p24",
  // validated against the shared whitelist in public/avatars.js
  // before every write — see PATCH /api/me). NULL means "no avatar
  // yet" and the client falls back to the initial-letter circle,
  // exactly as before avatars existed. (Rows from the short-lived
  // build-a-character maker hold a JSON config; those are not valid
  // ids and read back as "no avatar".)
  if (!userCols.some((c) => c.name === 'avatar')) {
    await db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
  }
}

module.exports = { db, engine, cloudMode, initDb, DB_PATH };
