# Venics Sales

An offline-first Point-of-Sale (POS) and shop-management app for small retailers
(UI in Swahili). It runs as a Progressive Web App and as an Android app (Capacitor).

## Tech stack

- **Frontend:** React 19, React Router, Zustand, Tailwind CSS, Vite
- **Local storage:** Dexie (IndexedDB) — the app works fully offline
- **Backend:** Supabase (auth + Postgres), synced in the background via `src/services/sync.ts`
- **AI assistant ("Mshauri"):** Google Gemini (`@google/genai`)
- **Mobile shell:** Capacitor (Android) + local notifications

## Prerequisites

- Node.js 18+

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the project root (see `.env.example`):
   ```bash
   VITE_SUPABASE_URL=<your-supabase-url>
   VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
   ```
   > The Supabase URL + anon key are public by design (they ship in the client
   > bundle); the real security boundary is Row Level Security, not key secrecy.

3. **AI assistant ("Venics Smart") setup.** The Gemini key is held server-side as a
   Supabase Edge Function secret — it is never shipped to the browser. Deploy the
   proxy and set the secret:
   ```bash
   supabase secrets set GEMINI_API_KEY=<your-gemini-key>
   supabase functions deploy gemini
   ```
   The client calls Gemini through the `gemini` Edge Function (`supabase/functions/gemini`)
   via `src/services/geminiProxy.ts`. Until this is deployed, AI features will
   return a friendly "service unavailable" message.

## Scripts

| Command           | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `npm run dev`     | Starts the dev server (`tsx server.ts`, Vite middleware) on port 3000 |
| `npm run build`   | Generates `version.json` and builds the production bundle            |
| `npm run preview` | Serves the production build locally (port 4173)                      |
| `npm run lint`    | Type-checks the project (`tsc --noEmit`)                             |
| `npm run clean`   | Removes the `dist/` folder                                           |

## Roles

There are two kinds of user in this app:

- **boss** (also stored as **admin**) — full access, executive dashboard, reports, staff management
- **employee** — day-to-day selling; finer-grained variants exist (`staff`, `manager`, `cashier`)

## Database schema

The Supabase schema lives in `supabase_schema.sql`, with assistant-chat tables in
`supabase/assistant_chats_schema.sql` and Edge Functions under `supabase/functions/`.
