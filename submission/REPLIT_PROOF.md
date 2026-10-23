# Replit proof of use

Replit is compulsory for every team. The proof must come **from our own account**: a live deployment URL, a project link with history, or a finished credit. A video or static mock-up does not count as the live prototype.

**Status: to do by the team.** The repo is ready to deploy (`.replit`: Node 22, PostgreSQL 16, `npm start`, VM deployment), but it is not deployed yet.

## Steps

1. **Import:** Replit → **Create Repl → Import from GitHub** → `shenenleow10521/SdcHackathon` (from the team leader's account).
2. **Secrets** (🔒 tab), from `.env.example`:
   - `GEMINI_API_KEY` (and `GEMINI_API_KEY_2` if you have a second key)
   - `RUNPOD_API_KEY`, `RUNPOD_EMBED_ENDPOINT_ID=a7ipau1nmqogxs`, `EMBED_PROVIDER=runpod`
   - `TAVILY_API_KEY`
   - `DATABASE_URL`: the Replit PostgreSQL URL (created by the `postgresql-16` module) or the Supabase pooler URL
   - `ADMIN_TOKEN`: a long random string, so the public site's review queue and approve buttons are not open to everyone
   - Optional: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS` for sign-in; `DEMO_MODE=true` so a failed live source replays the last recorded run (labelled "replayed")
3. **Run** once in the workspace and check the console line `HalaTuju on http://localhost:3000 ... embed=runpod-bge-m3`.
4. **Deploy:** Deploy → **Reserved VM** (the daily Job market researcher needs an always-on server) → copy the `*.replit.app` URL.
5. **Check in an incognito window:** `/` (landing), `/app` (the map), `/api/health` (`db.ok`, `llm.ok`, `embed.provider = runpod-bge-m3`). Upload `demo/priya-cv.pdf` once. Optionally run `npx tsx scripts/smoke-api.ts https://<url>` (read-only).
6. Put the URL in the README **Links** table (Live demo and Replit project) and in `submission/TECH_DECLARATION.md`.

## Screenshots to add

Save them in this folder and export this page with them as `REPLIT PROOF OF USE.pdf`.

1. _[screenshot: the Replit project with our account name and the Git / history pane]_ → `replit-project.png`
2. _[screenshot: Deployments page showing the live URL and "Running", with the date]_ → `replit-deployment.png`
3. _[screenshot: the live URL open in the browser, showing the map]_ → `replit-live.png`
4. _[screenshot: Replit Core / credit usage page, if available]_ → `replit-usage.png`

| Item | Value |
|---|---|
| Replit account | _[username]_ |
| Project URL | _[https://replit.com/@…/…]_ |
| Live deployment URL | _[https://….replit.app]_ |
| Deployed on | _[date, time MYT]_ |
