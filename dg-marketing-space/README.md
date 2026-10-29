# DG Marketing Space

A Delivergate-branded desktop workspace (Electron) plus an admin dashboard (React + serverless API)
for account management and productivity reporting.

```
┌──────────────────────────── Employee PC ────────────────────────────┐
│  DG Marketing Space (Electron)                                      │
│  ┌──────────────┐   IPC (preload bridge)   ┌──────────────────────┐ │
│  │ Renderer     │ ◀──────────────────────▶ │ Main process         │ │
│  │ desktop shell│                          │ auth · telemetry     │ │
│  │ window mgr   │                          │ local app scanner    │ │
│  │ <webview>s   │                          │ offline report queue │ │
│  └──────────────┘                          └──────────┬───────────┘ │
└───────────────────────────────────────────────────────┼─────────────┘
                                   HTTPS + JWT          │  POST /api/auth/login
                                                        │  POST /api/telemetry/ingest (every 30 s)
┌───────────────────────── Vercel (free) ───────────────▼─────────────┐
│  admin/ — React dashboard (static)  +  /api/* serverless functions  │
└───────────────────────────────────────────────────────┬─────────────┘
                                                        │ service-role key (server only)
                                         ┌──────────────▼──────────────┐
                                         │ Supabase Postgres (free)    │
                                         │ employees · telemetry_reports│
                                         └─────────────────────────────┘
```

## Folder structure

```
dg-marketing-space/
├── client/                      Electron desktop app
│   ├── config.json              server URL, default app, telemetry intervals
│   ├── assets/                  logo, icon, wallpapers
│   └── src/
│       ├── main/
│       │   ├── main.js          window, webview security, IPC
│       │   ├── auth.js          sign-in via API, encrypted session restore
│       │   ├── telemetry.js     sampling, aggregation, queue + upload
│       │   ├── localApps.js     installed-app discovery and launching
│       │   ├── config.js        config loading
│       │   └── store.js         JSON store + OS-keychain-encrypted secrets
│       ├── preload/preload.js   the only renderer ↔ main bridge
│       └── renderer/            shell UI (vanilla JS, no build step)
│           ├── index.html  styles.css
│           ├── apps.js          built-in web apps + helpers
│           ├── windowManager.js drag / resize / min / max / close, webviews
│           ├── launcher.js      start menu, desktop icons, App Library, Settings
│           └── app.js           boot → sign in → desktop, taskbar, status
└── admin/                       Vercel project
    ├── api/                     serverless endpoints
    │   ├── auth/login.js
    │   ├── users/index.js       GET list, POST create
    │   ├── users/[id].js        PATCH (password, role, on/off), DELETE
    │   ├── telemetry/ingest.js
    │   └── metrics/summary.js · metrics/user.js
    ├── server/                  shared server code (auth, db, metrics)
    ├── supabase/schema.sql      tables + reporting functions
    └── src/                     React dashboard (Vite)
```

## What the desktop app records

| Signal | How | Notes |
|---|---|---|
| Active / idle / locked | `powerMonitor.getSystemIdleTime()` + lock/sleep events | Idle after 2 min without input (configurable) |
| Foreground app & time | In-shell window focus; other apps via `get-windows` | Window titles off by default (`captureWindowTitles`) |
| Web pages | Navigations inside workspace webviews | Query strings and `#fragments` are stripped |
| Mouse clicks | `uiohook-napi` (system-wide) or in-workspace fallback | Keyboard events are never subscribed |
| Mouse movement | Cursor position polled every sample | Share of active time with movement, clicks/hour |
| Displays | `screen.getAllDisplays()`; app → display via window bounds | Per display: workflow vs other time |
| Workflow vs other | Workflow = DG shell + desktop apps the user added to the workspace | Everything else counts as "other" |

Reports are aggregated every 30 s and queued on disk if the network is down.
The sign-in screen tells employees what's recorded; keep that notice accurate if you change what's collected.

---

## Deploy for live testing (free tiers)

### 1. Database — Supabase

1. Create a project at supabase.com (free).
2. **SQL Editor → New query** → paste `admin/supabase/schema.sql` → **Run**.
3. **Project Settings → API**: copy the **Project URL** and the **service_role** key.

### 2. Admin dashboard + API — Vercel

```bash
cd admin
npm install
npm i -g vercel
vercel login
vercel link                        # create a new project, root = this folder
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add JWT_SECRET          # e.g. output of: openssl rand -base64 48
vercel --prod
```

Or push the repo to GitHub, **Import** it on vercel.com, set **Root Directory = `admin`**, and add the
same three environment variables under **Settings → Environment Variables**.

Open the deployed URL and sign in as `adm_kavin` / `K@vi@2211`. The two test accounts (`adm_kavin`,
`test1`) are created in the database the first time they sign in.

Local development: copy `.env.example` to `.env`, then `npm run dev` (runs `vercel dev` with the API
at http://localhost:3000).

> **Netlify?** The dashboard builds the same way (`npm run build`, publish `dist`), but the `/api`
> functions use Vercel's `(req, res)` signature. On Netlify you'd move them to `netlify/functions/` and
> adapt the handlers — Vercel is the zero-change option.

### 3. Desktop client

```bash
cd client
# point the app at your Vercel deployment
#   config.json → "apiBase": "https://your-project.vercel.app"
npm install
npm start                 # normal mode
npm run start:offline     # no backend needed; only test1/test1 works, telemetry → userData/telemetry-offline.jsonl
npm run dev               # opens DevTools
```

Build installers (run on the target OS):

```bash
npm run dist:win     # NSIS installer  → client/dist/
npm run dist:mac     # DMG
npm run dist:linux   # AppImage + .deb
```

IT can change the server after install by placing a `config.json` in the app's `resources/` folder.

---

## Platform notes

- **Windows** — everything works out of the box.
- **macOS** — the first launch asks for **Accessibility** (needed for system-wide click counting) and,
  if `captureWindowTitles` is on, **Screen Recording** (macOS only exposes window titles with it).
  Without these, tracking falls back to workspace-only and the admin report says so.
- **Linux** — `get-windows` supports X11. On Wayland, foreground-app tracking falls back to workspace apps only.
- **Google sign-in inside the workspace** — the app removes "Electron" from its user agent so Gmail /
  Drive / Sheets sign-in works. If Google still shows "This browser may not be secure", sign in once
  with a passkey or via the account chooser; the session then persists. Each employee has their own
  browser profile (`persist:dg-<username>`), so signing out of the workspace never leaks one person's
  Google session to the next person on a shared PC.
- **Installed apps** — Windows lists Start-menu shortcuts (Microsoft Store apps without shortcuts won't
  appear; use **Add another program…**), macOS lists `.app` bundles, Linux lists `.desktop` entries.

## Before going beyond testing

- Set `DISABLE_BOOTSTRAP_ACCOUNTS=true` in Vercel once you've created real admin accounts, and change
  the `test1` password (or delete it) from the Employees page. The test credentials only live in
  `admin/server/auth.js` — they are never shipped to the browser or the desktop app.
- Add rate limiting on `/api/auth/login` (e.g. Vercel Firewall rules or Upstash Ratelimit).
- Code-sign the desktop installers (Windows Authenticode, Apple Developer ID + notarisation), otherwise
  SmartScreen / Gatekeeper will warn users.
- Check activity monitoring against the data-protection and employment rules where your staff work
  (in Sri Lanka, the Personal Data Protection Act No. 9 of 2022; GDPR for EU staff), and agree a
  retention period — `schema.sql` includes an optional 90-day cleanup job.

## Customising

- **Built-in apps** — edit `DG.webApps` in `client/src/renderer/apps.js` (id, name, URL, icon, colour).
- **Default app** — `defaultAppUrl` in `client/config.json`.
- **Telemetry cadence / idle threshold** — `telemetry` in `client/config.json`.
- **Wallpapers** — drop files in `client/assets/wallpapers/` and register them in `DG.WALLPAPERS` (`app.js`).
