# mLT. chat — the real app (v1)

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
| `server/index.js` | Express app: all API routes, auth, uploads, seeding, plus the WebSocket signaling layer for video calls (`ws`, same HTTP server) |
| `tests/friends-test.js` | Scripted real-HTTP test suite for the friends system (`node tests/friends-test.js`, add `--engine=libsql` for the Turso facade) |
| `tests/crossband-test.js` | Scripted HTTP + WebSocket suite for the cross-band friend rule (Protected holds the key) and the cross-band video-call refusal (`node tests/crossband-test.js`, add `--engine=libsql` for the Turso facade) |
| `tests/video-test.js` | Scripted HTTP + WebSocket test suite for video-call signaling and the call rules (`node tests/video-test.js`, add `--engine=libsql` for the Turso facade) |
| `tests/editor-test.js` | Scripted served-files + API suite for the Post Editor flow and swipe navigation (`node tests/editor-test.js`, add `--engine=libsql` for the Turso facade) |
| `tests/camera-test.js` | Scripted served-files + API suite for the in-app camera (buttons, viewfinder wiring, capture → editor path) (`node tests/camera-test.js`, add `--engine=libsql` for the Turso facade) |
| `tests/messages-test.js` | Scripted HTTP + WebSocket suite for private messaging (friend gate, cross-band rule, unread/read, live dm push, restart persistence) (`node tests/messages-test.js`, add `--engine=libsql` for the Turso facade) |
| `tests/message-photos-test.js` | Scripted HTTP + WebSocket suite for photo DMs (multipart send, storage/serving in both modes, gate + cross-band refusals, oversize/video refusals, old-schema DB migration, restart persistence) (`node tests/message-photos-test.js`, add `--engine=libsql` for the Turso facade) |
| `tests/phone-dial-test.js` | Scripted HTTP suite for phone dialing (set/clear/validate the profile phone number, friends-only visibility, Protected numbers never exposed, cross-band confirmed/unconfirmed gates, old-schema DB migration, restart persistence) (`node tests/phone-dial-test.js`, add `--engine=libsql` for the Turso facade) |
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
- **Public feed** — everyone's posts, newest first. The feed composer ("What's on your mind?", Photo / Video / Music buttons) is only an entry point: tapping the text box or any of its buttons opens the full-screen **Post Editor**, where every post is finished before it goes out — a big media preview with **Add/Change photo**, **Add/Change video**, and **Remove media**, a caption field (starting from anything typed in the composer), and **Add music** (the existing song picker; the chosen song shows as a removable tag on the editor and plays with the video — songs ride on videos, same as before). Both the composer row and the editor also carry a **📸 Camera** button that opens the **in-app camera** (see below), so a brand-new picture can be taken and posted without ever leaving the app; the gallery Photo/Video buttons work exactly as before. **Nothing is published until Post is tapped in the editor**; Cancel throws the whole draft away. Posting itself is the unchanged `POST /api/posts` flow (multipart with media + `songId`, JSON for text-only). Posts show name/time, text, and media **big, full-card-width**. Like (per-user toggle), Comment (list + add), Share (copies the post link), Report (stored in the `reports` table with a reason).
- **In-app camera** — a **📸 Camera** button on the feed composer row and inside the Post Editor opens a full-screen viewfinder (`getUserMedia`). It starts on the **rear camera** (`facingMode: 'environment'`) so you can photograph other people, Snapchat-style; **Flip** switches to the front camera (`'user'`) and back (old tracks are stopped before the new stream starts). The big **Take picture** button draws the current frame to a canvas and produces a JPEG (`camera-photo.jpg`) that lands in the Post Editor as the draft's photo — the exact same `setEditorFile()` state the gallery picker feeds, so the rest of the posting flow is untouched. (The camera has a second target: opened from a message thread's 📷 sheet it runs in `'thread'` mode and the capture is sent as a photo DM instead — see "Photo messages".) Closing the camera (✕ or Escape) always stops its tracks and leaves the draft unchanged. Camera failures — permission denied, no camera found, camera busy in another app, or `getUserMedia` unavailable (e.g. a non-HTTPS page) — become plain-language toasts, never a crash.
- **Navigation** — bottom tabs (Feed, Videos, People, Friends, Chat, Profile) plus **swipe between pages**: on the Feed, People, Friends, Chat, and Profile pages, a clear left/right swipe (~60px and mostly horizontal, so normal scrolling never triggers it) moves to the next/previous tab in bottom-nav order. The Videos page is exempt — its pager owns sideways swipes — and swipes that start in a form field, the top/bottom bars, an open overlay (editor, viewer, call, sheet), or a horizontally scrolling strip never change the page.
- **Profile** — name/username, Protected badge, stats (posts / likes received / comments), **My posts** (only yours), change display name, log out.
- **People** — every user with their post count, plus your relationship to each of them.
- **Friends** — real friend requests, stored in the `friendships` table (one row per pair; `pending` → `accepted`; declining or unfriending deletes the row). People page shows per-person state buttons (**Add Friend / Requested / Accept + Decline / Friends ✓**); a dedicated **Friends** tab lists incoming requests (Accept/Decline), your friends (with Unfriend), and requests you sent. Endpoints: `POST /api/friends/request {userId, knowsPerson?}`, `POST /api/friends/accept {requestId, knowsPerson?}` (addressee only), `POST /api/friends/decline {requestId}` (addressee only), `POST /api/friends/remove {userId}`, `GET /api/friends` → `{friends, incoming, outgoing}`; `GET /api/people` now also carries `relationship` (`none | pending_out | pending_in | friends | self`) and `friendRequestId` per person. Pending items in both endpoints also carry `crossBand`, `knownConfirmed`, and `attestBy` (`me | them | null`). **Cross-band rule (enforced server-side): people who know each other in real life can be friends across the adult / Protected (under-18) line; strangers cannot — and the Protected user always holds the key.** A Protected user sending a request to an adult must confirm "I know this person in real life" (`knowsPerson: true`, stored on the row as `known_confirmed`); without it the request is refused (400) and never created. An adult's request to a Protected user IS created as pending, and the Protected addressee sees it in a separate **"Requests from grown-ups"** section with a warning — accepting it requires the same confirmation from the Protected user (400 without it); declining works as always. When the Protected user initiated (already confirmed), the adult accepts normally and just sees a "Protected account (under 18)" note. Same-band requests (both Protected, or both adult) work exactly as before, no confirmation needed. **Video calls stay stricter: adult ↔ Protected calls are refused at call setup even between cross-band friends.**
- **Video calls (friends only, 1:1)** — real WebRTC calls between friends who are both online. Each friend in the Friends tab shows an **online dot** (green = here now) and a **📹 Video call** button; the person called gets a popup with **Accept / Decline**; the call screen shows their video big, yours small, with **Mute / Camera on-off / Hang up**. Signaling runs over a WebSocket at **`/ws`**, authenticated with the same signed session cookie as the REST API (no cookie → 401 on upgrade). The server relays ONLY the setup messages (`call`, `offer`, `answer`, `ice`, `decline`, `hangup` — see "Video call protocol" below); picture and sound travel directly between the two devices (`RTCPeerConnection`, public STUN `stun:stun.l.google.com:19302`). Presence is tracked in memory (socket open = online) and pushed to friends live (`presence`, `friend-online`, `friend-offline`); `GET /api/friends` also carries an `online` flag per friend. **Call rules, enforced server-side:** calls only between *accepted* friends; **a Protected↔adult call is refused at setup even if a friendship row somehow exists** (defense in depth); one call per user at a time (busy callers/callees get a plain-language error); calling an offline friend answers "isn't online right now". Call state is deliberately in-memory only — nothing about a call is stored.
- **Messages (private 1:1 DMs, friends only)** — a **Chat** bottom-nav tab lists one row per friend (avatar, name, last-message preview, unread pill), ordered by most recent conversation; the tab button itself carries a live **unread badge**. Tapping a row — or the **💬 Message** button next to each friend in the Friends tab — opens the thread full-screen: bubbles (mine navy, theirs white), an input + Send bar, and live append when a new message arrives while the thread is open. Threads live in the `messages` table (`sender_id`, `recipient_id`, `text`, `media_url`, `media_type`, `created_at`, `read_at`); opening a thread marks everything that friend sent me in it as read. Endpoints: `POST /api/messages/:userId {text}` → the created message; `GET /api/messages/:userId` → `{user, messages}` (last 200, oldest → newest, marks read); `GET /api/conversations` → `{conversations: [{user, lastMessage, unread}], totalUnread}`. **Rules, enforced server-side:** messages only between *accepted* friends (non-friends get a 403 with a plain-language reason, for sending AND for reading a thread); **cross-band friends confirmed under the knows-in-real-life rule (`known_confirmed = 1`) MAY message** — the Protected user already confirmed they know this person — while a cross-band friendship row *without* that confirmation (which the API can't create) is refused too, as defense in depth. **Video calls stay stricter: cross-band calls are still refused even between confirmed friends.** Same profanity filter as posts, ~1000-char cap, empty messages refused (400), messaging yourself refused (400). Real-time: a new message is pushed over the existing `/ws` socket to the recipient if they're online — `{type:'dm', message}` (with the sender attached) followed by `{type:'dm-unread', count}` with their new unread total, so the badge is live; on load the badge comes from `GET /api/conversations`' `totalUnread`.
- **Photo messages** — the **📷 button** beside the thread input opens a small sheet with two choices: **Photo** (pick from the gallery, `accept="image/*"`) or **Camera** (the same in-app camera, opened in a `'thread'` mode so the capture is delivered to the thread instead of the Post Editor — the editor path is unchanged). A photo can go with a caption (anything typed in the input rides along) or on its own. Sending is `POST /api/messages/:userId` as multipart/form-data with the same `media` field posts use; the server stores the image **exactly like post media** — a `media_blobs` row served at `/media/:id` in cloud mode, an `/uploads/` file in local mode, same **5 MB cap** — and saves `media_url`/`media_type` on the message row (added to existing databases by an idempotent startup migration, same pattern as `known_confirmed`). Photos pass through the **same messaging gate** as text — no shortcut for non-friends or unconfirmed cross-band pairs. In the thread the photo shows inline in the bubble (tap it to open the full picture); a photo with no caption previews in the conversation list as **"📷 Photo"**, and the live `dm` push and toast carry/show the photo too. Video files are refused for messages (400, "pictures only") — videos belong in posts.
- **Phone dialing (tap-to-call a friend's real phone)** — Profile carries an optional **phone number** field (type it, Save; clear the box and Save to remove it). Saving goes through the existing `PATCH /api/me` as `{phone}` (either field can be sent on its own); the server strips spaces/dashes/parentheses, keeps one leading `+`, and requires 7–15 digits — anything else is a 400 in plain language. The number lives in a `users.phone` column (added to existing databases by an idempotent startup migration, same pattern as `known_confirmed`), and `GET /api/me` returns it to its owner as `user.phone`. Everyone else sees it only through the server-side `visiblePhone` rule, attached as a `phone` field on friends in `GET /api/friends`, on people in `GET /api/people`, and on the `user` of `GET /api/conversations` and `GET /api/messages/:userId`: the number is exposed **only to accepted friends**, **a Protected user's number is NEVER returned to anyone** (they can store one; it is simply never served), and **cross-band pairs additionally need `known_confirmed = 1`** — the same gate as cross-band messaging — before the adult's number is shown to the Protected friend (an unconfirmed cross-band friendship exposes no number in either direction; non-friends and pending relationships get `phone: null`). Where a number is shared, the client renders a **📞 Call** link (`<a href="tel:…">`) next to the Message button in the Friends list and in the message-thread header — tapping it opens the phone's own dialer with the number filled in (the app itself places no calls and has no calling service).
- **Videos tab** — sideways pager (swipe left/right, Prev/Next arrows, "1 / N" counter). Compact videos (~43% of screen height) with a side column: Follow (per-creator, saved), Like (saved), Comment (saved), Music. Tap a video for the full-screen viewer (swipes too, same sound state).
- **Sound, honestly handled** — every catalog clip was probed with ffprobe: 13 of the 41 have their own audio track; the other 28 have **no audio track at all**, so each carries a matched Kevin MacLeod library song as its sound. One Sound ON/OFF pill; the choice is remembered and applies across flips and in the viewer. Posted videos can also carry a picked song, played in sync.
- **Music picker** — search + category chips, tap to preview, "Use" to attach (to your video post, or to any catalog clip).
- **Safety basics** — profanity filter on posts/comments/messages, Protected accounts for under-18 signups, report-a-post flow.

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

A second scripted suite, `tests/friends-test.js` (real HTTP against a throwaway copy of the app, so the shipped DB is untouched) — **43/43 checks passed on the local engine, and 43/43 again on the Turso facade** (`@libsql/client` against a `file:` database, the same code path as cloud mode):

1. ✅ Two adults: A requests B → B sees it in `incoming` → B accepts → both list each other in `friends`; `/api/people` shows `pending_out` / `pending_in` / `friends` / `self` correctly, with the request id attached.
2. ✅ Duplicate request, reverse request while pending, request while already friends → all refused (409); self-request refused (400); only the addressee can accept/decline (requester and third party get 403); declining an accepted friendship → 409.
3. ✅ Decline deletes the row (the sender can re-request afterwards); unfriend works from either side, relationship returns to `none`, unfriending a non-friend → 404; `GET /api/friends` logged out → 401.
4. ✅ **Cross-band rule, in brief: Protected → adult without the "knows in real life" confirmation refused (400); adult → Protected request created pending and flagged cross-band; Protected accepting it without the confirmation refused (400); declining it works, and no cross-band friendship results.** (The full matrix is verified by `tests/crossband-test.js` — see below.)
5. ✅ **Full server restart: both friendships (adult–adult and Protected–Protected) still there.**
6. ✅ The shipped `data/solkin.db` boots cleanly with the new `friendships` table added by the schema migration, and `/api/people` serves the new fields.

### Cross-band friend rule verification (actually run)

A fourth scripted suite, `tests/crossband-test.js` (real HTTP + real WebSocket clients against a throwaway copy of the app) — **39/39 checks passed on the local engine, and 39/39 again on the Turso facade**:

1. ✅ **Protected → adult without `knowsPerson`** (missing or `false`) → **400** with a plain-language explanation, and **no friendship row is created** (the adult's incoming stays empty, relationship stays `none`).
2. ✅ **Protected → adult with `knowsPerson: true`** → request created; the attestation is stored (`knownConfirmed: true` visible to both sides); the **adult accepts normally, no attestation asked from the adult** → friends both ways.
3. ✅ **Adult → Protected** → request created pending (200, `crossBand: true` — no longer a 403). The Protected addressee's views show `attestBy: "me"`, the adult's show `attestBy: "them"`, in both `GET /api/friends` and `GET /api/people`. Accepting **without** `knowsPerson` (or with `false`) → **400**, request still pending; accepting **with** it → friends, attestation recorded.
4. ✅ **Decline works as before** for adult-initiated requests, and the adult can re-request afterwards.
5. ✅ **Same-band flows unchanged**: adult ↔ adult and Protected ↔ Protected requests and accepts succeed with no `knowsPerson` anywhere (and the full friends suite above still passes as regression).
6. ✅ **Cross-band friends still cannot video call**: with a real cross-band friendship in place (created through the API under the rule), call attempts in *both* directions are refused at signaling setup with the safety error, and neither side receives an `incoming-call`.
7. ✅ **Full server restart: the cross-band friendship and its recorded attestation are still there.**
8. ✅ In-place smoke test: the shipped app boots against the real `data/solkin.db` — the startup migration adds the `known_confirmed` column to the existing `friendships` table — and the served HTML/JS contain the "Requests from grown-ups" section and the confirm dialog.

### Video call protocol (WebSocket, `/ws`)

All messages are JSON. The socket requires the session cookie. Client → server: `{type:'call', to}` asks to start a call; `{type:'offer'|'answer', callId, sdp}` and `{type:'ice', callId, candidate}` are relayed verbatim to the *other participant only*; `{type:'decline', callId}` (callee, while ringing) and `{type:'hangup', callId}` (either side) end a call. Server → client: `{type:'presence', online:[friendIds]}`, `{type:'friend-online'|'friend-offline', user}`, `{type:'incoming-call', callId, from}`, `{type:'ringing', callId, to}`, the relayed `offer`/`answer`/`ice` (with `from`), `{type:'declined', callId, by}`, `{type:'ended', callId, reason:'hangup'|'disconnected'}`, and `{type:'call-error', error}` with a plain-language reason (not friends / safety rule / busy / already in a call / offline / call gone).

### Video call verification (actually run)

A third scripted suite, `tests/video-test.js` (real HTTP signups/friendships + real WebSocket clients with session cookies, against a throwaway copy of the app) — **29/29 checks passed on the local engine, and 29/29 again on the Turso facade** (`@libsql/client` against a `file:` database):

1. ✅ Socket auth: a WebSocket upgrade without the session cookie is refused (401, no presence); with it, presence flows — a user gets their online-friends list, friends are told when they come online, and `GET /api/friends` marks friends `online: true/false` correctly.
2. ✅ **(a) Full call between friends:** A calls B → B gets `incoming-call`, A gets `ringing` → offer, answer, and ICE candidates are relayed in both directions with payloads intact → B's hangup delivers `ended` to A. Decline delivers `declined`.
3. ✅ **(b) Non-friend call refused:** A calling C (not a friend) gets a `call-error` ("only video call your friends"); C receives nothing.
4. ✅ **(c) Safety rule at call setup:** with an adult–Protected `accepted` friendship row inserted straight into the database (bypassing the friend-request rule), calls in *both* directions are still refused with the safety error, and neither side receives an `incoming-call`.
5. ✅ **(d) No third-party leakage:** a bystander friend receives no call signaling at all, and a non-participant who tries to inject an ICE candidate into a live call gets an error while the candidate reaches neither participant.
6. ✅ Busy rules: a caller already in a call can't start another; calling a friend who is on another call returns "on another call right now"; calling an offline friend returns "isn't online right now".
7. ✅ In-place smoke test: the shipped app boots against the real `data/solkin.db`, serves the call UI (popup, call screen, video elements) in its HTML/JS/CSS, and refuses unauthenticated socket upgrades.

**Not verified (needs humans):** actual camera/microphone media — two real devices, two real people, one accepting a call from the other and seeing/hearing each other. Headless tests can only prove the signaling, the rules, and that the UI ships in the served files. Also untested: NAT setups where STUN alone isn't enough (some strict/corporate networks need a TURN server, which v1 doesn't have).

### Post editor verification (actually run)

A fifth scripted suite, `tests/editor-test.js` (real HTTP against a throwaway copy of the app) — **28/28 checks passed on the local engine, and 28/28 again on the Turso facade**:

1. ✅ The served HTML ships the Post Editor overlay (media preview area, caption field, Add/Change photo + video, Remove media, Add music + song-tag spot, Post and Cancel) and keeps the feed composer's entry points — while the composer's old direct-post button and its in-composer media preview / song tag are gone.
2. ✅ The served JS opens the editor from the composer text box and its Photo/Video/Music buttons, routes the editor's Add music through the existing song picker (`{type:'editor'}`), publishes **only** from the editor's Post button through the unchanged `POST /api/posts` flow, and discards the draft on Cancel. No direct-post handler remains anywhere in the client.
3. ✅ The swipe-between-pages handler ships with the bottom-nav tab order, the ~60px mostly-horizontal threshold, the Videos-view exemption, and the overlay / form-field / horizontal-scroller guards.
4. ✅ The posting contract is unchanged end to end: signup → text post → photo-upload post → a second user's feed shows both. In-place smoke test: the shipped app boots against the real `data/solkin.db` and serves the editor with no direct-post button.

**Not verified (needs a human tap-through):** the editor's feel on a real phone (file picker, preview sizing, keyboard behavior) and the actual swipe gestures in a hand — headless checks prove the code ships in the served files and the API behaves, not how the gestures feel.

### Camera verification (actually run)

A sixth scripted suite, `tests/camera-test.js` (real HTTP against a throwaway copy of the app) — **23/23 checks passed on the local engine, and 23/23 again on the Turso facade**, with the editor (28/28), friends (43/43), crossband (39/39), and video (29/29) suites all still passing on both engines:

1. ✅ The served HTML ships **📸 Camera** buttons on the feed composer row and in the Post Editor (the gallery Photo/Video buttons are unchanged), plus the full-screen camera view: viewfinder video element, **Flip** button, big **Take picture** capture button, and a close (✕) button.
2. ✅ The served JS opens the camera from both buttons, starts it on the **rear camera** (`facingMode: 'environment'` by default), flips rear ↔ front by restarting the stream with the other `facingMode`, draws captures to a canvas as a JPEG `File` named `camera-photo.jpg`, and feeds it into the editor through the gallery picker's own `setEditorFile(file, 'image')` path. Leaving the camera always stops its tracks, and the swipe navigation treats the open camera as an overlay.
3. ✅ Camera failures are mapped to plain-language messages in the shipped code (permission denied, no camera found, camera busy, `getUserMedia` unsupported).
4. ✅ The posting contract is unchanged end to end: a real JPEG photo post (with the capture's own filename) succeeds through the editor's multipart path, and a second user's feed shows it. In-place smoke test: the shipped app boots against the real `data/solkin.db` and serves the camera screen in its HTML/JS.

**Not verified (needs a human tap-through on a phone):** the actual camera hardware — the browser permission prompt, whether the rear lens is truly the default on a given phone, front/rear flip behavior, and picture quality. Headless checks prove the code ships in the served files and follows the right API calls; only a person holding a phone can prove the camera itself behaves.

### Messages verification (actually run)

A seventh scripted suite, `tests/messages-test.js` (real HTTP + real WebSocket clients against a throwaway copy of the app) — **45/45 checks passed on the local engine, and 45/45 again on the Turso facade**, with the friends (43/43), crossband (39/39), video (29/29), editor (28/28), and camera (23/23) suites all still passing on both engines (the editor suite's swipe tab-order assertion was updated to the new six-tab bottom nav):

1. ✅ The served HTML/JS ship the Chat view, the full-screen thread view, the nav unread badge, and the live `dm` handling; messaging endpoints refuse logged-out callers (401).
2. ✅ **Friend gate:** non-friends get 403 (plain language) for sending in both directions and for opening a thread; a nonexistent user gets 404; empty/whitespace messages and messaging yourself get 400.
3. ✅ **Same-band pair:** A ↔ B exchange messages; both threads show them oldest → newest with correct mine/theirs flags.
4. ✅ **Profanity + length:** a message containing "damn" is stored and returned filtered ("****"); a 1500-char message is capped at 1000.
5. ✅ **Unread + mark-read:** after two new messages, B's `GET /api/conversations` shows unread 2 / totalUnread 2 with the latest message as `lastMessage`; A (who already opened the thread) shows 0; B opening the thread brings B back to 0.
6. ✅ **Live push:** with B's WebSocket connected, A's send arrives as `{type:'dm'}` (text, senderId, sender profile) followed by `{type:'dm-unread', count: 1}`.
7. ✅ **Cross-band confirmed friends CAN message** both ways (Protected → adult and adult → Protected), with unread counting and mark-read behaving the same.
8. ✅ **Defense in depth:** a cross-band `accepted` row with `known_confirmed = 0`, inserted straight into the database (the API can't create one), gets 403 for sends from *both* sides and for opening the thread.
9. ✅ **Regression:** the same confirmed cross-band friends still cannot video call — refused at signaling setup with the safety error, no `incoming-call` delivered.
10. ✅ **Full server restart: all threads (same-band and cross-band) are still there, in order.** In-place smoke test: the shipped app boots against the real `data/solkin.db` — the boot schema adds the `messages` table and its indexes to the existing database — and serves the Chat UI.

**Not verified (needs a human tap-through on a phone):** the chat's feel in a hand — bubble layout on a small screen, keyboard behavior with the thread input, badge placement, and how the live-append feels while typing. Headless checks prove the API, the rules, and that the UI ships in the served files.

### Message photos verification (actually run)

An eighth scripted suite, `tests/message-photos-test.js` (real HTTP + a real WebSocket client against a throwaway copy of the app) — **29/29 checks passed on the local engine, and 29/29 again on the Turso facade**, with the messages (45/45), friends (43/43), crossband (39/39), video (29/29), editor (28/28), and camera (23/23) suites all still passing on both engines (one camera-suite assertion was updated to the camera's new explicit-target wiring — both composer/editor buttons now call `openCamera('editor')`; behavior unchanged):

1. ✅ The suite pre-creates the temp DB with the **old messages schema (no media columns)** — the server's startup migration adds `media_url`/`media_type`, and the first photo send succeeds against that migrated DB (the same path the production DB takes on deploy).
2. ✅ **Photo-only DM:** a friend sends a real PNG by multipart (`media` field) with no text → 200, `text: ''`, `mediaType: 'image'`, and a `mediaUrl` of `/uploads/…` (local) or `/media/:id` (libsql/cloud). The URL serves the photo back **byte-identical** with an image content type.
3. ✅ **Photo + caption:** the caption rides along and is profanity-filtered like any message text.
4. ✅ Thread GET and `GET /api/conversations` both carry the media fields; a photo-only `lastMessage` has `mediaUrl` set and `text: ''` — exactly what the client's **"📷 Photo"** conversation preview keys off. The served HTML/JS ship the thread 📷 attach button, the gallery picker, `sendThreadPhoto`, and both camera targets (`openCamera('thread')` for the thread, `openCamera('editor')` for the unchanged post-editor path).
5. ✅ **Refusals:** non-friend photo send → 403; multipart with neither text nor photo → 400; a video file → 400 ("pictures only"); a photo over the 5 MB posts cap → 413. Text-only JSON sends still work, with `mediaUrl: null`.
6. ✅ **Live push:** with the recipient's WebSocket connected, a photo send arrives as `{type:'dm'}` carrying the media fields.
7. ✅ **Cross-band:** confirmed cross-band friends (Protected → adult) can send photos; a forced unconfirmed cross-band row is refused 403 from both sides — the gate is the same one text messages use.
8. ✅ **Full server restart: photo messages are still in the thread, and the first photo still serves byte-identical.** In-place smoke test: the shipped app boots against the real `data/solkin.db` — the migration adds the two media columns to the existing `messages` table — and serves the attach UI.

**Not verified (needs a human tap-through on a phone):** the photo-DM feel in a hand — the attach sheet, the gallery picker, aiming the real camera at a thread (hardware/permission behavior is the camera suite's known limit), photo sizing inside bubbles on a small screen, and tap-to-open-full-photo behavior. Headless checks prove the API, the storage, the rules, and that the UI ships in the served files.

### Phone dialing verification (actually run)

A ninth scripted suite, `tests/phone-dial-test.js` (real HTTP against a throwaway copy of the app) — **49/49 checks passed on the local engine, and 49/49 again on the Turso facade**, with the message-photos (29/29), messages (45/45), friends (43/43), crossband (39/39), video (29/29), editor (28/28), and camera (23/23) suites all still passing on both engines:

1. ✅ The suite pre-creates the temp DB with the **old users schema (no phone column)** — the server's startup migration adds `users.phone`, and signups + the whole flow run against that migrated DB. (Also verified in place: the shipped app booted once against a copy of the real `data/solkin.db` — the migration added the column, all 3 users / 3 posts intact.)
2. ✅ **Set / normalize / clear:** `(555) 123-4567` is stored as `5551234567`; `+1 (555) 111-0001` keeps its `+`; letters, 5 digits, and 19 digits are each refused 400 with a plain-language error; an empty string clears the number; a name-only PATCH leaves the phone untouched; `GET /api/me` returns the owner's own number throughout.
3. ✅ **Visibility matrix:** strangers, anonymous visitors, and pending relationships (both directions, in People and Friends) get `phone: null` and the number appears nowhere in those payloads. Accepted adult friends see each other's numbers in `GET /api/friends`, `GET /api/people`, `GET /api/conversations`, and the thread payload.
4. ✅ **Protected numbers never leak:** a Protected user can store a number and see it on their own `/api/me`, but same-band friends, a confirmed cross-band adult friend, and every list/thread payload show `phone: null` — each payload was scanned for the digits.
5. ✅ **Cross-band gates:** a confirmed cross-band friendship exposes the ADULT's number to the Protected friend (Friends list, People, thread) while the Protected number stays hidden; a forced **unconfirmed** cross-band row exposes no number in either direction (and its thread stays closed by the messaging gate, 403).
6. ✅ **Full server restart: numbers persist** — a friend still sees the number afterwards, and the owner still sees their own.

**Not verified (needs a human tap-through on a phone):** the actual dialer hand-off — tapping 📞 Call opening the phone's dialer with the number filled in is standard `tel:` behavior, but only a real phone proves it on this UI; also the Call button's fit in the Friends row on a small screen. Headless checks prove the API, the safety rules, and that the UI ships in the served files.

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
5. **Safety/ops before inviting kids publicly** — an admin view for the `reports` table, email verification, password reset, and a published privacy policy/terms. The Protected-account flag exists, and the friend rule is enforced server-side (cross-band friendships only with the Protected user's "knows in real life" confirmation); video calls enforce the stricter line at call setup (no adult ↔ Protected calls at all). Messaging follows the friend rule: only accepted friends can message, cross-band only with the recorded confirmation — and that gate must gate any future group/story features too.
6. **App stores (later, optional)** — this is a web app; it can be wrapped (PWA/Capacitor) for Google Play ($25 one-time developer fee) and Apple ($99/yr). Not needed to launch on the web.

## Honest limits of v1

- No groups, no stories yet — feed, videos, people, friends, private messages (text + photos; no video DMs), video calls, tap-to-call phone links (the phone's own dialer places the call — there is no in-app voice calling), profile only. The thread view loads the last 200 messages of a conversation.
- Video calls are 1:1, friends-only, and need both people online at the same time. They use a public STUN server only — on some strict networks (some workplaces, hotels, carrier NATs) a call may fail to connect media until a TURN server is added. Call/presence state is in-memory on the single server process, so a server restart drops any live call (posts, friendships, and everything in the DB are unaffected).
- Video catalog clips stream from Pexels/Mixkit (their bandwidth, their uptime); user photo uploads are stored on local disk (local mode) or as DB blobs (cloud mode); user video uploads are stored only in local mode.
- One server process, no load balancing — fine for launch-day scale. (This also means presence/calls assume a single instance; the free Render service is one instance, so this holds.)
