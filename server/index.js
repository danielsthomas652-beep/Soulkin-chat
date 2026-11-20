// Solkin Chat — real app server (Express + SQLite).
// Real accounts, hashed passwords, signed cookie sessions, one shared feed.
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const WebSocket = require('ws');
const { db, engine, cloudMode, initDb } = require('./db');
const { SONGS, songById } = require('./songs');
const { VIDEOS } = require('./videos');

const ROOT = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------- session secret ----------
// Cloud mode (Render): read from the SESSION_SECRET env var — the disk is
// ephemeral, so the data/.session-secret file fallback is local-mode only.
// If SESSION_SECRET is missing in cloud mode we fall back to a random
// per-boot secret (logins then reset whenever the service restarts), so
// set SESSION_SECRET in the Render dashboard / render.yaml.
const SECRET_FILE = path.join(ROOT, 'data', '.session-secret');
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  if (!cloudMode && fs.existsSync(SECRET_FILE)) SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  else {
    SECRET = crypto.randomBytes(32).toString('hex');
    if (!cloudMode) fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
    else console.warn('[sessions] SESSION_SECRET env var not set — using a per-boot secret; logins will reset on restart.');
  }
}

// ---------- tiny profanity filter ----------
const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'damn', 'crap', 'piss', 'dick', 'pussy', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'retard'];
const BAD_RE = new RegExp('\\b(' + BAD_WORDS.join('|') + ')\\b', 'gi');
function cleanText(s) {
  return String(s || '').replace(BAD_RE, (m) => '*'.repeat(m.length));
}

// ---------- session cookie (signed, httpOnly) ----------
const COOKIE = 'solkin_session';
function signSession(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + 30 * 24 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function readSession(req) {
  const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  let val;
  try { val = decodeURIComponent(raw.slice(COOKIE.length + 1)); } catch (e) { return null; }
  const dot = val.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = val.slice(0, dot), sig = val.slice(dot + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.uid || data.exp < Date.now()) return null;
    return data.uid;
  } catch (e) { return null; }
}
function setSessionCookie(res, userId) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(signSession(userId))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

// ---------- helpers ----------
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, displayName: u.display_name, username: u.username, isProtected: !!u.is_protected, createdAt: u.created_at };
}
async function getUserById(id) { return await db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
async function authUser(req) {
  const uid = readSession(req);
  return uid ? getUserById(uid) : null;
}
async function requireAuth(req, res, next) {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in first.' });
  req.user = u;
  next();
}
async function postRow(p, meId) {
  const likeCount = (await db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?').get(p.id)).c;
  const commentCount = (await db.prepare('SELECT COUNT(*) c FROM comments WHERE post_id = ?').get(p.id)).c;
  const liked = meId ? !!(await db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(p.id, meId)) : false;
  const song = p.song_id ? songById(p.song_id) : null;
  return {
    id: p.id, text: p.text, mediaUrl: p.media_url, mediaType: p.media_type,
    song: song ? { id: song.id, title: song.title, artist: song.artist, src: song.src } : null,
    createdAt: p.created_at,
    author: publicUser(await getUserById(p.user_id)),
    likeCount, commentCount, likedByMe: liked,
  };
}

// ---------- uploads ----------
// Local mode: files land on disk in uploads/ and are served from /uploads/.
// Cloud mode (Render's disk is ephemeral, files would vanish): multer keeps
// the upload in memory instead; the POST /api/posts handler then stores
// PHOTOS as blobs in the database (media_blobs, served via /media/:id).
// Video file uploads in cloud mode are NOT stored (see the posts handler) —
// the post is kept, the file is skipped; catalog videos and https video
// links are unaffected.
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };
const PHOTO_BLOB_MAX = 5 * 1024 * 1024; // cloud-mode photo cap: 5 MB
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.mimetype)) cb(null, true);
  else cb(new Error('That file type is not allowed — pictures and short videos only.'));
};
const upload = cloudMode
  ? multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 }, fileFilter })
  : multer({
      storage: multer.diskStorage({
        destination: UPLOADS_DIR,
        filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + (EXT_BY_MIME[file.mimetype] || '')),
      }),
      limits: { fileSize: 60 * 1024 * 1024 }, // 60 MB cap
      fileFilter,
    });

// ---------- seed (first run only) ----------
async function seed() {
  const n = (await db.prepare('SELECT COUNT(*) c FROM users').get()).c;
  if (n > 0) return;
  const hash = bcrypt.hashSync(crypto.randomBytes(12).toString('hex'), 10); // seed accounts are not for logging in
  const mkUser = db.prepare('INSERT INTO users (display_name, username, pass_hash, is_protected) VALUES (?, ?, ?, ?)');
  const maya = (await mkUser.run('Maya Chen', 'maya.sings', hash, 0)).lastInsertRowid;
  const sam = (await mkUser.run('Sam Whitaker', 'sam.w', hash, 0)).lastInsertRowid;
  const grace = (await mkUser.run('Grace Liu', 'grace.reads', hash, 0)).lastInsertRowid;
  const mkPost = db.prepare('INSERT INTO posts (user_id, text, media_url, media_type, song_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const v1 = VIDEOS.find((v) => v.id === 'v1');
  await mkPost.run(maya, 'Rehearsal night — trying the new chorus one more time 🎶', v1 ? v1.src : null, v1 ? 'video' : null, v1 && v1.songId ? v1.songId : null, hoursAgo(3));
  await mkPost.run(sam, 'First day here — hi everybody! 👋 Say hi back so I know this thing works.', null, null, null, hoursAgo(2));
  await mkPost.run(grace, 'One small step today beats ten perfect plans tomorrow. Start tiny. 💛', null, null, null, hoursAgo(1));
  console.log('[seed] sample users + posts created');
}

// ---------- app ----------
const app = express();
const server = http.createServer(app); // shared by Express and the WebSocket signaling layer
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(ROOT, 'public')));

// ----- auth -----
app.post('/api/signup', async (req, res) => {
  const { displayName, username, password, under18 } = req.body || {};
  const name = String(displayName || '').trim().slice(0, 40);
  const uname = String(username || '').trim().toLowerCase();
  if (name.length < 2) return res.status(400).json({ error: 'Please add your name.' });
  if (!/^[a-z0-9_.]{3,20}$/.test(uname)) return res.status(400).json({ error: 'Username needs 3–20 letters, numbers, dots or underscores.' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password needs at least 6 characters.' });
  if (await db.prepare('SELECT 1 FROM users WHERE username = ?').get(uname)) return res.status(409).json({ error: 'That username is taken — try another.' });
  const hash = bcrypt.hashSync(String(password), 10);
  const info = await db.prepare('INSERT INTO users (display_name, username, pass_hash, is_protected) VALUES (?, ?, ?, ?)')
    .run(cleanText(name), uname, hash, under18 ? 1 : 0);
  const user = await getUserById(info.lastInsertRowid);
  setSessionCookie(res, user.id);
  res.json({ user: publicUser(user) });
});
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.pass_hash)) {
    return res.status(401).json({ error: 'Username or password did not match. Try again.' });
  }
  setSessionCookie(res, user.id);
  res.json({ user: publicUser(user) });
});
app.post('/api/logout', (req, res) => { clearSessionCookie(res); res.json({ ok: true }); });
app.get('/api/me', async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: 'Not logged in.' });
  const stats = {
    posts: (await db.prepare('SELECT COUNT(*) c FROM posts WHERE user_id = ?').get(u.id)).c,
    likesReceived: (await db.prepare('SELECT COUNT(*) c FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?').get(u.id)).c,
    comments: (await db.prepare('SELECT COUNT(*) c FROM comments WHERE user_id = ?').get(u.id)).c,
  };
  res.json({ user: publicUser(u), stats });
});
app.patch('/api/me', requireAuth, async (req, res) => {
  const name = String((req.body || {}).displayName || '').trim().slice(0, 40);
  if (name.length < 2) return res.status(400).json({ error: 'Name is too short.' });
  await db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(cleanText(name), req.user.id);
  res.json({ user: publicUser(await getUserById(req.user.id)) });
});

// ----- feed -----
app.get('/api/posts', async (req, res) => {
  const me = await authUser(req);
  const rows = await db.prepare('SELECT * FROM posts ORDER BY id DESC LIMIT 100').all();
  res.json({ posts: await Promise.all(rows.map((p) => postRow(p, me && me.id))) });
});
app.get('/api/my/posts', requireAuth, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM posts WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json({ posts: await Promise.all(rows.map((p) => postRow(p, req.user.id))) });
});
app.post('/api/posts', requireAuth, upload.single('media'), async (req, res) => {
  const text = cleanText(String(req.body.text || '').trim().slice(0, 1000));
  let mediaUrl = null, mediaType = null;
  if (req.file) {
    if (cloudMode) {
      // Cloud mode: no durable disk, so photos are stored as DB blobs and
      // served from /media/:id. Video files are NOT stored in cloud mode —
      // the post is kept, the file is skipped (catalog videos and https
      // video links still work; see README "Deploying").
      if (req.file.mimetype.startsWith('image/')) {
        if (req.file.size > PHOTO_BLOB_MAX) return res.status(413).json({ error: 'That photo is too big (5 MB max).' });
        const blobId = crypto.randomBytes(12).toString('hex');
        await db.prepare('INSERT INTO media_blobs (id, user_id, mime, data) VALUES (?, ?, ?, ?)')
          .run(blobId, req.user.id, req.file.mimetype, req.file.buffer);
        mediaUrl = '/media/' + blobId;
        mediaType = 'image';
      }
    } else {
      mediaUrl = '/uploads/' + req.file.filename;
      mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';
    }
  } else if (req.body.mediaUrl && /^https:\/\//.test(req.body.mediaUrl)) {
    mediaUrl = req.body.mediaUrl;
    mediaType = req.body.mediaType === 'image' ? 'image' : 'video';
  }
  if (!text && !mediaUrl) return res.status(400).json({ error: 'Write something or add a picture/video first.' });
  const songId = req.body.songId && songById(req.body.songId) ? req.body.songId : null;
  const info = await db.prepare('INSERT INTO posts (user_id, text, media_url, media_type, song_id) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, text, mediaUrl, mediaType, songId);
  res.json({ post: await postRow(await db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid), req.user.id) });
});
app.post('/api/posts/:id/like', requireAuth, async (req, res) => {
  const pid = +req.params.id;
  if (!(await db.prepare('SELECT 1 FROM posts WHERE id = ?').get(pid))) return res.status(404).json({ error: 'Post not found.' });
  const existing = await db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(pid, req.user.id);
  if (existing) await db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(pid, req.user.id);
  else await db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(pid, req.user.id);
  const count = (await db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?').get(pid)).c;
  res.json({ liked: !existing, likeCount: count });
});
app.get('/api/posts/:id/comments', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM comments WHERE post_id = ? ORDER BY id ASC LIMIT 200').all(+req.params.id);
  const comments = [];
  for (const c of rows) comments.push({ id: c.id, text: c.text, createdAt: c.created_at, author: publicUser(await getUserById(c.user_id)) });
  res.json({ comments });
});
app.post('/api/posts/:id/comments', requireAuth, async (req, res) => {
  const pid = +req.params.id;
  if (!(await db.prepare('SELECT 1 FROM posts WHERE id = ?').get(pid))) return res.status(404).json({ error: 'Post not found.' });
  const text = cleanText(String((req.body || {}).text || '').trim().slice(0, 500));
  if (!text) return res.status(400).json({ error: 'Write a comment first.' });
  const info = await db.prepare('INSERT INTO comments (post_id, user_id, text) VALUES (?, ?, ?)').run(pid, req.user.id, text);
  const c = await db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
  res.json({ comment: { id: c.id, text: c.text, createdAt: c.created_at, author: publicUser(req.user) } });
});
app.post('/api/posts/:id/report', requireAuth, async (req, res) => {
  const pid = +req.params.id;
  if (!(await db.prepare('SELECT 1 FROM posts WHERE id = ?').get(pid))) return res.status(404).json({ error: 'Post not found.' });
  await db.prepare('INSERT INTO reports (post_id, reporter_id, reason) VALUES (?, ?, ?)')
    .run(pid, req.user.id, String((req.body || {}).reason || '').slice(0, 200));
  res.json({ ok: true });
});

// ----- photo blobs (cloud mode storage; table exists in local mode too) --
function blobToBuffer(data) {
  if (!data) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Buffer.from(data);
  return Buffer.from(data);
}
app.get('/media/:id', async (req, res) => {
  const row = await db.prepare('SELECT mime, data FROM media_blobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(blobToBuffer(row.data));
});

// ----- people -----
app.get('/api/people', async (req, res) => {
  const me = await authUser(req);
  const rows = await db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count
                             FROM users u ORDER BY post_count DESC, u.id ASC`).all();
  const people = [];
  for (const u of rows) {
    const entry = { ...publicUser(u), postCount: u.post_count, relationship: 'none', friendRequestId: null };
    if (me) {
      if (u.id === me.id) entry.relationship = 'self';
      else {
        const f = await friendshipBetween(me.id, u.id);
        if (f) {
          entry.friendRequestId = f.id;
          if (f.status === 'accepted') entry.relationship = 'friends';
          else entry.relationship = f.requester_id === me.id ? 'pending_out' : 'pending_in';
        }
      }
    }
    people.push(entry);
  }
  res.json({ people });
});

// ----- friends -----
// One row per pair of users (the table enforces it): status 'pending' means
// requester_id asked addressee_id; 'accepted' means they're friends.
// Declining or unfriending DELETES the row, so a fresh request can be sent
// later. SAFETY RULE (owner's standing rule): a Protected (under-18) account
// and an adult account can never friend each other — requests across that
// line are refused. Same-band requests (both Protected, or both adult) are
// fine.
async function friendshipBetween(a, b) {
  return await db.prepare('SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)').get(a, b, b, a);
}
app.post('/api/friends/request', requireAuth, async (req, res) => {
  const targetId = +((req.body || {}).userId);
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Missing userId.' });
  if (targetId === req.user.id) return res.status(400).json({ error: "You can't send a friend request to yourself." });
  const target = await getUserById(targetId);
  if (!target) return res.status(404).json({ error: 'That person was not found.' });
  if (!!req.user.is_protected !== !!target.is_protected) {
    return res.status(403).json({ error: "For safety, friend requests between Protected (under-18) accounts and adult accounts aren't allowed." });
  }
  const existing = await friendshipBetween(req.user.id, targetId);
  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: "You're already friends with " + target.display_name + '.' });
    if (existing.requester_id === req.user.id) return res.status(409).json({ error: 'Friend request already sent — waiting for them to answer.' });
    return res.status(409).json({ error: target.display_name + ' already sent you a request — accept it from your Friends page.' });
  }
  const info = await db.prepare("INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')").run(req.user.id, targetId);
  res.json({ ok: true, requestId: info.lastInsertRowid, relationship: 'pending_out' });
});
app.post('/api/friends/accept', requireAuth, async (req, res) => {
  const rid = +((req.body || {}).requestId);
  const f = Number.isInteger(rid) && rid > 0 ? await db.prepare('SELECT * FROM friendships WHERE id = ?').get(rid) : null;
  if (!f) return res.status(404).json({ error: 'That request was not found.' });
  if (f.addressee_id !== req.user.id) return res.status(403).json({ error: 'Only the person who received this request can accept it.' });
  if (f.status === 'accepted') return res.status(409).json({ error: "You're already friends." });
  await db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(rid);
  res.json({ ok: true, relationship: 'friends' });
});
app.post('/api/friends/decline', requireAuth, async (req, res) => {
  const rid = +((req.body || {}).requestId);
  const f = Number.isInteger(rid) && rid > 0 ? await db.prepare('SELECT * FROM friendships WHERE id = ?').get(rid) : null;
  if (!f) return res.status(404).json({ error: 'That request was not found.' });
  if (f.addressee_id !== req.user.id) return res.status(403).json({ error: 'Only the person who received this request can decline it.' });
  if (f.status === 'accepted') return res.status(409).json({ error: "You're already friends — unfriend instead if you want to end it." });
  await db.prepare('DELETE FROM friendships WHERE id = ?').run(rid);
  res.json({ ok: true });
});
app.post('/api/friends/remove', requireAuth, async (req, res) => {
  const targetId = +((req.body || {}).userId);
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Missing userId.' });
  const f = await friendshipBetween(req.user.id, targetId);
  if (!f || f.status !== 'accepted') return res.status(404).json({ error: "You're not friends with that person." });
  await db.prepare('DELETE FROM friendships WHERE id = ?').run(f.id);
  res.json({ ok: true });
});
app.get('/api/friends', requireAuth, async (req, res) => {
  const meId = req.user.id;
  const rows = await db.prepare('SELECT * FROM friendships WHERE requester_id = ? OR addressee_id = ? ORDER BY id ASC').all(meId, meId);
  const friends = [], incoming = [], outgoing = [];
  for (const f of rows) {
    const otherId = f.requester_id === meId ? f.addressee_id : f.requester_id;
    const other = publicUser(await getUserById(otherId));
    if (!other) continue;
    if (f.status === 'accepted') friends.push({ ...other, online: onlineSockets.has(otherId) });
    else if (f.addressee_id === meId) incoming.push({ ...other, requestId: f.id, createdAt: f.created_at });
    else outgoing.push({ ...other, requestId: f.id, createdAt: f.created_at });
  }
  res.json({ friends, incoming, outgoing });
});

// ----- video chat signaling (WebSocket, /ws) -----
// 1:1 friend video calls. The WebSocket carries ONLY signaling (call setup,
// SDP offer/answer, ICE candidates, hangup/decline) — the actual audio/video
// flows peer-to-peer via WebRTC. Presence and all call state live in memory
// on this one process (v1 scale); nothing about a call is stored in the DB.
//
// Auth: the upgrade request must carry the same signed session cookie as
// the REST API (readSession) — no cookie, no socket.
//
// CALL RULES — enforced here, server-side, non-negotiable:
//   * Calls only between ACCEPTED friends (friendships table).
//   * If exactly one side is Protected (under-18), the call is refused at
//     setup time — even if a friendship row somehow exists (defense in
//     depth; the friend-request rule already prevents the pairing).
//   * One call per user at a time; signaling is relayed ONLY between the
//     two participants of a call — third parties receive nothing.
const wss = new WebSocket.WebSocketServer({ noServer: true });
const onlineSockets = new Map(); // userId -> Set<ws> (presence: >= 1 open socket)
const calls = new Map();         // callId -> { id, callerId, calleeId, state: 'ringing' | 'active' }
const callOfUser = new Map();    // userId -> callId

function wsSend(userId, obj) {
  const set = onlineSockets.get(userId);
  if (!set) return;
  const data = JSON.stringify(obj);
  for (const s of set) { if (s.readyState === WebSocket.OPEN) { try { s.send(data); } catch (e) { /* socket going away */ } } }
}
async function acceptedFriendIds(userId) {
  const rows = await db.prepare("SELECT requester_id, addressee_id FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)").all(userId, userId);
  return rows.map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id));
}
async function sendPresence(user) {
  const ids = await acceptedFriendIds(user.id);
  wsSend(user.id, { type: 'presence', online: ids.filter((id) => onlineSockets.has(id)) });
}
async function notifyFriendsPresence(user, online) {
  const ids = await acceptedFriendIds(user.id);
  for (const id of ids) wsSend(id, { type: online ? 'friend-online' : 'friend-offline', user: publicUser(user) });
}
function endCall(call, notifyUserId, msg) {
  calls.delete(call.id);
  if (callOfUser.get(call.callerId) === call.id) callOfUser.delete(call.callerId);
  if (callOfUser.get(call.calleeId) === call.id) callOfUser.delete(call.calleeId);
  if (notifyUserId) wsSend(notifyUserId, msg);
}

async function startVideoCall(ws, me, msg) {
  const fail = (error) => wsSend(me.id, { type: 'call-error', error });
  const targetId = +msg.to;
  if (!Number.isInteger(targetId) || targetId <= 0) return fail('That call could not be started.');
  if (targetId === me.id) return fail("You can't call yourself.");
  const target = await getUserById(targetId);
  if (!target) return fail('That person was not found.');
  const f = await friendshipBetween(me.id, targetId);
  if (!f || f.status !== 'accepted') return fail('You can only video call your friends — add ' + target.display_name + ' as a friend first.');
  if (!!me.is_protected !== !!target.is_protected) {
    return fail("For safety, video calls between Protected (under-18) accounts and adult accounts aren't allowed.");
  }
  if (callOfUser.has(me.id)) return fail("You're already in a call.");
  if (callOfUser.has(targetId)) return fail(target.display_name + ' is on another call right now.');
  if (!onlineSockets.has(targetId)) return fail(target.display_name + " isn't online right now — video calls work when you're both here.");
  const call = { id: crypto.randomBytes(8).toString('hex'), callerId: me.id, calleeId: targetId, state: 'ringing' };
  calls.set(call.id, call);
  callOfUser.set(me.id, call.id);
  callOfUser.set(targetId, call.id);
  wsSend(targetId, { type: 'incoming-call', callId: call.id, from: publicUser(me) });
  wsSend(me.id, { type: 'ringing', callId: call.id, to: publicUser(target) });
}

function relayCallMessage(ws, me, msg) {
  const call = calls.get(String(msg.callId || ''));
  if (!call || (call.callerId !== me.id && call.calleeId !== me.id)) {
    wsSend(me.id, { type: 'call-error', callId: msg.callId || null, error: 'That call is no longer available.' });
    return;
  }
  const otherId = call.callerId === me.id ? call.calleeId : call.callerId;
  if (msg.type === 'decline') {
    if (call.calleeId !== me.id || call.state !== 'ringing') return; // only the person being called can decline, and only while it rings
    endCall(call, otherId, { type: 'declined', callId: call.id, by: publicUser(me) });
    return;
  }
  if (msg.type === 'hangup') {
    endCall(call, otherId, { type: 'ended', callId: call.id, reason: 'hangup' });
    return;
  }
  // offer / answer / ice — relayed only between the two participants.
  if (msg.type === 'offer' && call.callerId !== me.id) return; // the caller makes the offer
  if (msg.type === 'answer') {
    if (call.calleeId !== me.id) return; // only the person called can answer
    call.state = 'active';
  }
  const out = { type: msg.type, callId: call.id, from: me.id };
  if (msg.type === 'ice') out.candidate = msg.candidate;
  else out.sdp = msg.sdp;
  wsSend(otherId, out);
}

async function handleSignal(ws, raw) {
  let msg;
  try { msg = JSON.parse(String(raw)); } catch (e) { return; }
  const me = ws.user;
  if (!me || !msg || typeof msg.type !== 'string') return;
  if (msg.type === 'call') return startVideoCall(ws, me, msg);
  if (['offer', 'answer', 'ice', 'decline', 'hangup'].includes(msg.type)) return relayCallMessage(ws, me, msg);
}

server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (e) { /* ignore */ }
  if (pathname !== '/ws') { socket.destroy(); return; }
  const uid = readSession(req); // same signed cookie as the REST API
  if (!uid) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => { ws.userId = uid; wss.emit('connection', ws, req); });
});

wss.on('connection', async (ws) => {
  const user = await getUserById(ws.userId);
  if (!user) { try { ws.close(); } catch (e) { /* ignore */ } return; }
  ws.user = user;
  let set = onlineSockets.get(user.id);
  const firstSocket = !set || set.size === 0;
  if (!set) { set = new Set(); onlineSockets.set(user.id, set); }
  set.add(ws);
  sendPresence(user).catch(() => {});
  if (firstSocket) notifyFriendsPresence(user, true).catch(() => {});
  ws.on('message', (raw) => { handleSignal(ws, raw).catch((e) => console.error('[ws] signaling error:', e && e.message ? e.message : e)); });
  ws.on('close', () => {
    const s = onlineSockets.get(user.id);
    if (s) { s.delete(ws); if (s.size === 0) onlineSockets.delete(user.id); }
    const callId = callOfUser.get(user.id);
    if (callId) {
      const call = calls.get(callId);
      if (call) {
        const otherId = call.callerId === user.id ? call.calleeId : call.callerId;
        endCall(call, otherId, { type: 'ended', callId: call.id, reason: 'disconnected' });
      }
    }
    if (!onlineSockets.has(user.id)) notifyFriendsPresence(user, false).catch(() => {});
  });
});

// ----- videos -----
app.get('/api/videos', async (req, res) => {
  const me = await authUser(req);
  const myLikes = new Set(), myFollows = new Set();
  if (me) {
    (await db.prepare('SELECT video_id FROM video_likes WHERE user_id = ?').all(me.id)).forEach((r) => myLikes.add(r.video_id));
    (await db.prepare('SELECT creator FROM follows WHERE user_id = ?').all(me.id)).forEach((r) => myFollows.add(r.creator));
  }
  const videos = [];
  for (const v of VIDEOS) {
    const extraLikes = (await db.prepare('SELECT COUNT(*) c FROM video_likes WHERE video_id = ?').get(v.id)).c;
    const commentCount = (await db.prepare('SELECT COUNT(*) c FROM video_comments WHERE video_id = ?').get(v.id)).c;
    const song = v.songId ? songById(v.songId) : null;
    videos.push({
      id: v.id, cat: v.cat, caption: v.caption, src: v.src, dur: v.dur,
      creator: v.creator, handle: v.handle, hasOwnAudio: v.hasOwnAudio,
      song: song ? { id: song.id, title: song.title, artist: song.artist, src: song.src } : null,
      likeCount: v.baseLikes + extraLikes, likedByMe: myLikes.has(v.id),
      following: myFollows.has(v.creator), commentCount,
    });
  }
  res.json({ videos });
});
app.post('/api/videos/:id/like', requireAuth, async (req, res) => {
  const vid = req.params.id;
  if (!VIDEOS.find((v) => v.id === vid)) return res.status(404).json({ error: 'Video not found.' });
  const existing = await db.prepare('SELECT 1 FROM video_likes WHERE video_id = ? AND user_id = ?').get(vid, req.user.id);
  if (existing) await db.prepare('DELETE FROM video_likes WHERE video_id = ? AND user_id = ?').run(vid, req.user.id);
  else await db.prepare('INSERT INTO video_likes (video_id, user_id) VALUES (?, ?)').run(vid, req.user.id);
  const base = VIDEOS.find((v) => v.id === vid).baseLikes;
  const extra = (await db.prepare('SELECT COUNT(*) c FROM video_likes WHERE video_id = ?').get(vid)).c;
  res.json({ liked: !existing, likeCount: base + extra });
});
app.post('/api/videos/:id/follow', requireAuth, async (req, res) => {
  const v = VIDEOS.find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Video not found.' });
  const existing = await db.prepare('SELECT 1 FROM follows WHERE user_id = ? AND creator = ?').get(req.user.id, v.creator);
  if (existing) await db.prepare('DELETE FROM follows WHERE user_id = ? AND creator = ?').run(req.user.id, v.creator);
  else await db.prepare('INSERT INTO follows (user_id, creator) VALUES (?, ?)').run(req.user.id, v.creator);
  res.json({ following: !existing, creator: v.creator });
});
app.get('/api/videos/:id/comments', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM video_comments WHERE video_id = ? ORDER BY id ASC LIMIT 200').all(req.params.id);
  const comments = [];
  for (const c of rows) comments.push({ id: c.id, text: c.text, createdAt: c.created_at, author: publicUser(await getUserById(c.user_id)) });
  res.json({ comments });
});
app.post('/api/videos/:id/comments', requireAuth, async (req, res) => {
  if (!VIDEOS.find((v) => v.id === req.params.id)) return res.status(404).json({ error: 'Video not found.' });
  const text = cleanText(String((req.body || {}).text || '').trim().slice(0, 500));
  if (!text) return res.status(400).json({ error: 'Write a comment first.' });
  const info = await db.prepare('INSERT INTO video_comments (video_id, user_id, text) VALUES (?, ?, ?)').run(req.params.id, req.user.id, text);
  const c = await db.prepare('SELECT * FROM video_comments WHERE id = ?').get(info.lastInsertRowid);
  res.json({ comment: { id: c.id, text: c.text, createdAt: c.created_at, author: publicUser(req.user) } });
});

// ----- songs -----
app.get('/api/songs', (req, res) => res.json({ songs: SONGS }));

// ----- errors / start -----
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is too big (60 MB max).' });
  if (err) return res.status(400).json({ error: err.message || 'Something went wrong.' });
  next();
});

const PORT = process.env.PORT || 3210;
async function start() {
  try {
    await initDb();
    await seed();
  } catch (e) {
    console.error(`[db] Failed to initialise the database (${engine}):`, e && e.message ? e.message : e);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`Solkin Chat running at http://localhost:${PORT}  (db: ${engine}${cloudMode ? ', cloud mode' : ''})`);
  });
}
start();
