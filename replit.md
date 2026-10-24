# HalaTuju on Replit

## Stack and layout

Keep the imported structure: Node.js 22, TypeScript, Express, and the existing vanilla JavaScript frontend in `web/`. The server serves both the frontend and `/api` routes.

## Running

- Click **Run** to start the **Start application** workflow (`npm run dev`).
- The server binds to `0.0.0.0:5000`; `.replit` sets `PORT=5000`.
- `/` is the landing page; `/app` is the career planner; `/api/health` reports database and service status.
- First startup creates and seeds the embedded PGlite database at `data/pglite`. No external database is required. `data/` is ignored by Git; do not reset it to troubleshoot startup.
- `npm start` runs the server without the development watcher.
- `npm run check` runs TypeScript checks and the automated tests.
- With the workflow running, `npx tsx scripts/smoke-api.ts https://$REPLIT_DEV_DOMAIN` runs the existing read-only API smoke checks.

## Current service configuration

This setup uses the existing no-sign-in demo behavior and bundled seed data. No API credentials were supplied or invented.

- Without `GEMINI_API_KEY`, live AI extraction, explanations, and agent research are unavailable; the app's existing basic/template paths still work where implemented.
- Embedding and web-search providers are not configured. Optional settings are listed in `.env.example`.
- `SCOUT_SCHEDULE=off` disables background research until the required services are configured. Set it to `on` after configuring and verifying those services.
- Supabase sign-in remains unconfigured. The imported app intentionally exposes staff/demo routes when neither accounts nor an admin token is configured. This is a development/demo setup, not a private production deployment.
- To enable existing integrations, use Replit Secrets for provider credentials. Do not commit `.env` or credentials. Keep the existing PGlite database unless the user explicitly requests a database change.
