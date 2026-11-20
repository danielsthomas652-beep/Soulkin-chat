# Solkin Chat — the real app (v1)

A working full-stack social web app: **real accounts, real hashed passwords, and one shared database**, so posts save, survive restarts, and are visible to every user — the things the old static prototype could never do.

## How to run it

```bash
cd ~/workspace/solkin-app
npm install     # only needed once (already done on this machine)
npm start       # = node server/index.js
```

Then open **http://localhost:3210** in a browser (phone or computer on the same network can use the machine's LAN address with port 3210). Port can be changed with `PORT=4000 npm start`.

Stop it with Ctrl+C. There is no background daemon — it runs only while that command runs.

On first run it creates `data/solkin.db` and seeds 3 sample people (Maya Chen, Sam Whitaker, Grace Liu) with a few friendly posts so the feed isn't empty. Seed accounts have random unknown passwords — they're just friendly faces in the feed; real people sign up themselves. The shipped database is in that clean seeded state (no test users).

## What's inside

| Piece | What it is |
|---|---|
| `server/index.js` | Express app: all API routes, auth, uploads, seeding |
| `tests/friends-test.js` | Scripted real-HTTP test suite for the friends system (`node tests/friends-test.js`, add `--engine=libsql` for the Turso facade) |
| `server/db.js` | Three engines behind one facade: **Turso** via `@libsql/client` when `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` are set (cloud mode); otherwise **better-sqlite3** (installed and working), with automatic fallback to built-in **node:sqlite** |
| `render.yaml` | Render Blueprint for the free deployment (see "Deploying" below) |
| `server/videos.js` | Videos-tab catalog: 41 free-license clips (Pexels/Mixkit), every URL probed |
| `server/songs.js` | 17 free-license songs (Kevin MacLeod, incompetech.com, CC-BY) |
| `public/` | The phone-first web UI (bright theme: #eef2f7 bg, white cards, navy #16305e, red touches) |
| `data/solkin.db` | The SQLite database (users, posts, likes, comments, reports, follows, friendships…) |
| `data/.session-secret` | Signing secret for login cookies (local mode: generated once, kept across restarts so logins survive; cloud mode: the `SESSION_SECRET` env var instead) |
| `uploads/` | User-uploaded photos/videos in **local mode** (multer; images + mp4/webm/mov; 60 MB cap). In **cloud mode** photos are stored as blobs in the DB (`media_blobs`, served at `/media/:id`, 5 MB cap) and video files are not stored — see "Deploying" |

## Features (all working end-to-end)

- **Auth** — sign up (display name, unique username, password ≥ 6 chars, optional under-18 checkbox → **Protected account** with a 🛡️ badge), log in, log out, `GET /api/me`. Passwords hashed with bcryptjs; sessions are HMAC-signed httpOnly cookies (30 days).
- **Public feed** — everyone's posts, newest first. Facebook-style composer ("What's on your mind?", Photo / Video / Music buttons, one Post button). Posts show name/time, text, and media **big, full-card-width**. Like (per-user toggle), Comment (list + add), Share (copies the post link), Report (stored in the `reports` table with a reason).
- **Profile** — name/username, Protected badge, stats (posts / likes received / comments), **My posts** (only yours), change display name, log out.
- **People** — every user with their post count, plus your relationship to each of them.
- **Friends** — real friend requests, stored in the `friendships` table (one row per pair; `pending` → `accepted`; declining or unfriending deletes the row). People page shows per-person state buttons (**Add Friend / Requested / Accept + Decline / Friends ✓**); a dedicated **Friends** tab lists incoming requests (Accept/Decline), your friends (with Unfriend), and requests you sent. Endpoints: `POST /api/friends/request {userId}`, `POST /api/friends/accept {requestId}` (addressee only), `POST /api/friends/decline {requestId}` (addressee only), `POST /api/friends/remove {userId}`, `GET /api/friends` → `{friends, incoming, outgoing}`; `GET /api/people` now also carries `relationship` (`none | pending_out | pending_in | friends | self`) and `friendRequestId` per person. **Safety rule (enforced server-side): a Protected (under-18) account and an adult account can never friend each other — requests across that line are refused with a 403 in both directions.** Same-band requests (both Protected, or both adult) work normally.
- **Videos tab** — sideways pager (swipe left/right, Prev/Next arrows, "1 / N" counter). Compact videos (~43% of screen height) with a side column: Follow (per-creator, saved), Like (saved), Comment (saved), Music. Tap a video for the full-screen viewer (swipes too, same sound state).
- **Sound, honestly handled** — every catalog clip was probed with ffprobe: 13 of the 41 have their own audio track; the other 28 have **no audio track at all**, so each carries a matched Kevin MacLeod library song as its sound. One Sound ON/OFF pill; the choice is remembered and applies across flips and in the viewer. Posted videos can also carry a picked song, played in sync.
- **Music picker** — search + category chips, tap to preview, "Use" to attach (to your video post, or to any catalog clip).
- **Safety basics** — profanity filter on posts/comments, Protected accounts for under-18 signups, report-a-post flow.

## Verification (actually run, against the real server)

A scripted end-to-end suite (real HTTP against the running app) — **30/30 checks passed**, run twice (before and after final tweaks):

1. ✅ Server boots; signup A and signup B succeed; duplicate username rejected (409); wrong password rejected (401).
2. ✅ A creates a text post → **B's feed shows A's post** (the shared-feed proof).
3. ✅ B likes + comments → A sees likeCount 1 / commentCount 1; like toggles off/on; B's report lands in the `reports` table (confirmed in SQLite).
4. ✅ Photo upload works and the uploaded file is served back from `/uploads/`.
5. ✅ Videos API returns 41 clips; every silent clip carries a song; video like/follow/comment all persist via the API.
6. ✅ People list, My posts, display-name change all work.
7. ✅ **Under-18 signup gets `isProtected: true`**, and it sticks on `/api/me`.
8. ✅ Profanity is filtered ("damn" → "****"); posting while logged out is refused (401).
9. ✅ **Server restart: posts, likes, comments, and logins all still there** (SQLite + persisted session secret).

### Friends verification (actually run)

A second scripted suite, `tests/friends-test.js` (real HTTP against a throwaway copy of the app, so the shipped DB is untouched) — **41/41 checks passed on the local engine, and 41/41 again on the Turso facade** (`@libsql/client` against a `file:` database, the same code path as cloud mode):

1. ✅ Two adults: A requests B → B sees it in `incoming` → B accepts → both list each other in `friends`; `/api/people` shows `pending_out` / `pending_in` / `friends` / `self` correctly, with the request id attached.
2. ✅ Duplicate request, reverse request while pending, request while already friends → all refused (409); self-request refused (400); only the addressee can accept/decline (requester and third party get 403); declining an accepted friendship → 409.
3. ✅ Decline deletes the row (the sender can re-request afterwards); unfriend works from either side, relationship returns to `none`, unfriending a non-friend → 404; `GET /api/friends` logged out → 401.
4. ✅ **Safety rule: adult → Protected refused (403, clear error) and Protected → adult refused (403), with no rows created; Protected → Protected request + accept works.**
5. ✅ **Full server restart: both friendships (adult–adult and Protected–Protected) still there.**
6. ✅ The shipped `data/solkin.db` boots cleanly with the new `friendships` table added by the schema migration, and `/api/people` serves the new fields.

Video sourcing: all 103 clips from the prototype's catalog were re-probed for this build (curl range request → HTTP 200/206, plus ffprobe for streams/duration). 102/103 passed on the first pass; the one failure passed on re-probe (transient 403). The best 41 were selected (Music 14, Advice 8, Dance 5, Pets 4, Comedy 3, Sports 3, Fitness 2, Cooking 2). All 17 song MP3s probed OK too. The ffprobe audio results exactly matched the prototype's earlier findings (26 of 103 clips have audio).

## Deploying (Render + Turso) — the free path

The app is ready to deploy for free: **Render** runs the server, **Turso** (hosted SQLite) holds the database. This split exists because Render's free tier has an **ephemeral disk** — anything written to local files (a SQLite file, uploaded photos) is wiped on every restart/redeploy. So in cloud mode the app keeps everything in Turso instead:

- All tables (users, posts, likes, …) live in the Turso database.
- Uploaded **photos** are stored as blobs in the `media_blobs` table (5 MB cap, images only) and served at `/media/:id` — they survive restarts.
- Uploaded **video files are not stored** in cloud mode (the post is kept, the file is skipped). The Videos-tab catalog and https video links in posts work as usual.
- Login sessions are signed with the `SESSION_SECRET` env var (Render generates it via `render.yaml`), so logins survive restarts too.

**Free-tier facts:** Render's free web service **spins down after ~15 minutes idle** and cold-starts on the next visit (first load can take ~30–60 s; it's awake after that). Turso's free tier is **persistent** — the data does not spin down or expire. Render also provides `PORT` automatically; the app already reads it.

### Exact steps, in order

1. **Create the Turso database** (at [turso.tech](https://turso.tech), free account):
   - Create a database (e.g. name it `solkin`).
   - From the database's Connect page, copy the **database URL** (`libsql://…turso.io`) and create/copy an **auth token**. These two values are the only credentials the app needs. Keep the token private — anyone with it can read/write the database.
2. **Put this code in a GitHub repo** (Render deploys from GitHub): push the `solkin-app` folder as the repo root, including `render.yaml`. Do **not** commit `data/` or any real token.
3. **Create the Render service**: in Render, choose **New → Blueprint** and point it at the repo — `render.yaml` already specifies a free Node web service with `npm install` / `node server/index.js`. (Manual equivalent: New → Web Service, plan **Free**, build command `npm install`, start command `node server/index.js`.)
4. **Set the environment variables** in the Render service (Blueprint will prompt for the `sync: false` ones):
   - `TURSO_DATABASE_URL` = the `libsql://…` URL from step 1
   - `TURSO_AUTH_TOKEN` = the token from step 1
   - `SESSION_SECRET` = auto-generated by `render.yaml` (`generateValue: true`); if you created the service manually, set any long random string.
   - Do **not** set `PORT` — Render provides it.
5. **Deploy**: Render builds and starts the service. First boot creates all tables in Turso and seeds the 3 sample people automatically. Open the service's `onrender.com` URL — sign up and post; then restart the service from the dashboard and confirm your post is still there (it will be — it's in Turso, not on the disk).

Local development is unchanged: with no `TURSO_*` env vars set, `npm start` uses the local SQLite file exactly as before.

### What was verified for this deployment prep (and what wasn't)

Verified on this machine: local mode end-to-end (signup → post → second user sees it, photo/video disk uploads, **true-restart** persistence of posts and logins, existing seeded DB boots fine). Cloud mode was verified by running the exact cloud code path — `@libsql/client` engine selected by the env vars — against a local `file:` libsql database: full signup/post/shared-feed flow, photo blob stored and served back byte-identical, photo > 5 MB rejected (413), video upload keeping the post with no stored file, and posts/logins/photo blobs all surviving a true restart. Pointing the env vars at an unreachable remote fails loudly at boot (naming the Turso engine) rather than silently falling back to a local file.

**Not yet verified** (needs the real accounts from the steps above): the live network round-trip to an actual Turso cloud database with a real token, and a real Render build/deploy. Those are the first two things to check right after deploying — the restart test in step 5 covers both.

## What remains for a public launch

The free Render + Turso deployment above is the launch path. The older alternative still works too:

1. **A host with persistent storage** — a small VPS (e.g. Hetzner/DigitalOcean-class, ~$5/mo) running the app in local mode (SQLite file + disk uploads), kept alive with a process manager (pm2/systemd) and a real `SESSION_SECRET`. Tom will need to create the hosting account himself (his name/payment).
2. **HTTPS + a domain** — required before real people log in (passwords must never travel over plain HTTP). A free option: put it behind a Cloudflare Tunnel or Caddy with automatic Let's Encrypt on a cheap domain (~$10/yr).
3. **Backups** — local mode: schedule a daily copy of `data/solkin.db` + `uploads/` somewhere safe. Cloud mode: the data lives in Turso — export it periodically (`turso db shell` / `.dump`) and keep a copy.
4. **Scaling notes** — SQLite + one Node process comfortably serves a small community (hundreds of users). If it grows: move the DB to Postgres, move uploads to object storage (S3/R2), add image resizing, and put sessions in the DB. The API shape won't need to change.
5. **Safety/ops before inviting kids publicly** — an admin view for the `reports` table, email verification, password reset, and a published privacy policy/terms. The Protected-account flag exists, and the friend-request rule is already enforced (adults and Protected accounts can't friend each other); the same rule must gate any future messaging feature — v1 has no DMs on purpose.
6. **App stores (later, optional)** — this is a web app; it can be wrapped (PWA/Capacitor) for Google Play ($25 one-time developer fee) and Apple ($99/yr). Not needed to launch on the web.

## Honest limits of v1

- No DMs, no groups, no stories yet — feed, videos, people, friends, profile only.
- Video catalog clips stream from Pexels/Mixkit (their bandwidth, their uptime); user photo uploads are stored on local disk (local mode) or as DB blobs (cloud mode); user video uploads are stored only in local mode.
- One server process, no load balancing — fine for launch-day scale.
