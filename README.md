# Venics Sales — Desktop

An offline-first Point-of-Sale (POS) and shop-management app for small retailers
(UI in Swahili). This is the **desktop build**: an installable Progressive Web App
(Chrome on Windows, Safari on macOS/iOS) — no Capacitor/native shell. It's tuned for
**shared machines** where several employees sign in and out on the same computer all day.

## Tech stack

- **Frontend:** React 19, React Router 7, Zustand, Tailwind CSS 4, Vite 6
- **Local storage:** Dexie (IndexedDB) — the app works fully offline
- **Backend:** Supabase (auth + Postgres), synced in the background via `src/services/sync.ts`
- **Durable session:** server-set **HttpOnly cookie** (`src/utils/webSession.ts` + `/api/session/*`),
  so the login survives Safari ITP storage eviction and the daily PWA reloads
- **Dev server / API:** Express (`server.ts`) runs Vite in middleware mode and serves the
  `/api/*` session endpoints; in production those are Vercel serverless functions
- **Assistant ("Venics Assistant"):** Google Gemini (`@google/genai`)
- **Also uses:** react-window (virtualized 1000-row lists), Recharts (reports), xlsx (Excel import), qrcode

## Prerequisites

- Node.js 18+

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` in the project root:
   ```bash
   VITE_SUPABASE_URL=<your-supabase-url>
   VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
   ```
   > The Supabase URL + anon key are public by design (they ship in the client bundle);
   > the real security boundary is Row Level Security, not key secrecy.
3. Run the app:
   ```bash
   npm run dev
   ```

## Scripts

| Command           | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `npm run dev`     | Starts the dev server — `tsx server.ts` (Express + Vite middleware + `/api`) |
| `npm run build`   | Writes `version.json` (`generate-version.js`) then builds the production bundle |
| `npm run preview` | Serves the production build locally                                  |
| `npm run lint`    | Type-checks the project (`tsc --noEmit`)                             |
| `npm run clean`   | Removes the `dist/` folder                                          |

## Resilience notes (why this build is different)

- **Shared-device sign-in/out:** logout is idempotent and login is self-healing — if a user
  force-closes the app mid-logout, the next boot finishes the teardown and lands on a clean
  Login (`store.ts` logout + `App.tsx` boot recovery + `utils/webSession.ts`). No stale
  session can resurrect the previous user or wedge the next login.
- **No white screen:** `index.html` paints a branded splash immediately and runs a mount
  watchdog that auto-recovers from a failed/stale chunk load (soft reload, or SW+cache wipe).
- **Catalog starter-pack:** a boss with an empty shop can bulk-import a curated product
  catalog (`src/components/catalog/`), which is cached in `localStorage` and works offline
  after the first download; already-imported items are marked so they aren't added twice.

## Roles

- **boss** (a.k.a. **admin**) — full access: executive dashboard, reports, staff management,
  catalog import
- **employee** — day-to-day selling; finer-grained variants exist (`staff`, `manager`, `cashier`)

## Backend

- Supabase Postgres schema + Row Level Security back every table.
- Product sync goes through the `sync_products_with_deltas(products_data jsonb)` RPC
  (stock is reconciled with per-row deltas rather than last-write-wins).
