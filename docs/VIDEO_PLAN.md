# HalaTuju pitch video: production plan

> **For:** the session that records and edits the video.
> **Goal:** a ~6:00 video (hard window 5:00–7:00) that looks like a real screen recording of the live app, edited like a product launch film: purposeful zooms, highlights timed to the words, a few motion-graphic scenes for what the app doesn't show.
> **Script:** `docs/PITCH.md` → "Full script" (11 scenes). Demo clicks and dry-run numbers: `docs/DEMO.md`. Both are the source of truth; this file is the production layer on top.

## Decisions already made (24 Oct, with the team)

| Item | Decision |
|---|---|
| Voice | **The team records its own voice later.** Cut the video to a generated neural voice's timing so their narration fits. Ship with subtitles burned in plus an `.srt`. |
| Music | **Subtle royalty-free track**, low under the voice (about −24 LUFS against voice at −16). Source: YouTube Audio Library or Pixabay Music (licence allows commercial use, credit in the YouTube description). Modern, warm, minimal: soft piano/pads or light electronic, ~90–110 BPM, no vocals. |
| Team card | **Product only for now:** HalaTuju logo and tagline. Leave a 3 s placeholder card at the end for the team name to be added later. |
| Length | **About 6:00.** |
| Format | 1920×1080, 16:9, 30 fps (60 fps for the map scenes if smooth), H.264 MP4, upload to YouTube (unlisted is fine). |

## Timing budget (measured)

Windows voice (David, rate 0) read each scene's voiceover on 24 Oct 05:40: **626 words, 4:24 total.** Re-time with a neural voice (`edge-tts`, installed: e.g. `en-US-AndrewNeural` or `en-GB-RyanNeural`, rate +0%) before cutting; human narration usually lands within ±8% of that.

| # | Scene | Voice (SAPI) | Visual-only beats to add | Target |
|---|---|---|---|---|
| 0 | Cold open: the reroute | 13.3 s | 2 s silence while the route swings; 1 s title hit | 0:20 |
| 1 | Priya | 19.3 s | email prop builds in (3 s) | 0:25 |
| 2 | The CV | 32.8 s | CV overlay + scrub effect (4 s) | 0:38 |
| 3 | The map | 20.4 s | map builds, slider plays 2026→2030 (8 s) | 0:30 |
| 4 | Her route | 39.3 s | sector filter, goal set, real course page opens (6 s) | 0:47 |
| 5 | 1,000 futures | 24.3 s | futures animation (5 s) | 0:30 |
| 6 | Beyond four jobs | 14.9 s | network list scroll (3 s) | 0:18 |
| 7 | Our model | 36 s | model card build + chart (6 s) | 0:42 |
| 8 | How the reroute works | 34.9 s | quote highlight, approve, toast (6 s) | 0:42 |
| 9 | Her employer | 11.8 s | HR view, SDG icons (4 s) | 0:16 |
| 10 | Close | 16.6 s | logo resolve + placeholder team card (6 s) | 0:23 |
| | **Total** | **4:24** | **~1:26** | **~5:50–6:05** |

If over 6:30: shorten scene 6 first, then trim scene 4's second half.

## Look and feel (style guide)

The film should feel like a calm, credible product, the same personality as the app (see `PRODUCT.md`): navigation-app clarity, not a flashy ad.

- **Typography:** Geist (the app's font) for every caption, card and subtitle. Weights 500/600; numbers with tabular figures. No monospace, no all-caps tiny labels.
- **Colour:** the app's tokens from `web/styles.css`: night-sky stage (`--stage-a #142036` → `--stage-b #05070c`), route orange (`--l-path #f08a5d`), your skills blue (`--n-have #3987e5`), learn green (`--n-learn #199e70`), risk red (`--n-risk #e66767`), white text. One accent per shot.
- **Motion:** ease-out (cubic-bezier(.22,1,.36,1)), 300–600 ms for UI highlights, 800–1200 ms for camera moves. No bounce, no spin, no glitch effects. Every move has a reason (it points at what the voice is saying).
- **Highlights on screen recordings:** one technique at a time:
  1. **Push-in zoom** (1.0 → 1.35–1.6×) on the panel being discussed, held while the line is spoken, then ease back.
  2. **Spotlight:** dim the rest of the frame to 55% with a soft-edged rounded rectangle around the element (12 px radius, 1 px white 30% outline, no glow).
  3. **Number pop:** the key number (e.g. 57%, 97%) gets a brief scale 1.0→1.06→1.0 and a caption card beside it.
  Never stack two of these at once.
- **Captions vs subtitles:** captions are design elements (big number cards, 2–5 words); subtitles are the transcript, bottom-centred, Geist 500, 34 px on a 1080 frame, white on a 60% black rounded box, max 2 lines, max ~42 characters per line.
- **Cursor:** headless Chrome has no cursor. Inject a fake cursor (a crisp macOS-style arrow SVG, 22 px, soft shadow) that glides between targets on a bezier path (500–700 ms) and shows a small click ripple. Hide it when not interacting.
- **Transitions:** straight cuts between app shots; a 400 ms cross-dissolve only when leaving or entering motion-graphic scenes. Optional quick "camera fly" on the 3D map is already in the app (the reroute moment).
- **Sample labels:** keep the app's own Sample labels visible when on screen (persona, HR team, employers). Never hide them in the edit.

## Recording pipeline

1. **Demo server:** follow `docs/DEMO.md` → Pre-demo checklist: `bash demo/reset.sh`, `bash demo/start.sh` (port 4330, accounts off, RunPod embeddings), wait for health, `bash demo/prime.sh` (warms RunPod, loads the recorded market run). Re-run prime 10 minutes before each recording batch.
2. **Browser:** Playwright with system Chrome and the GPU on: `chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11","--enable-gpu","--ignore-gpu-blocklist","--enable-webgl"] })`. Verified on this machine: WebGL renders on the RTX 4070 (D3D11). A working Playwright install with example scripts is in the earlier session's scratchpad `shots/` folder; reinstall `playwright-core@1.49.1` in a fresh scratch folder if needed.
3. **Viewport:** 1600×900 at `deviceScaleFactor: 1.2` → 1920×1080 frames (16:9). Check the app layout at 1600×900 first (the app was tuned at 1440×900; side panel and map must not crowd).
4. **Capture:** prefer frame capture via the Chrome DevTools Protocol (`Page.startScreencast` at full quality, or a fixed-interval `page.screenshot` loop for deterministic frames), then encode with ffmpeg (`-c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p`). Playwright's built-in `recordVideo` is a fallback (lower quality). ffmpeg 9.0.1 is installed (WinGet Gyan.FFmpeg).
5. **One clip per scene**, scripted and repeatable: every click from `docs/DEMO.md`, with waits on visible UI state (not fixed sleeps), so a retake is one command.
6. **Browser state:** clear `localStorage` keys `halatuju.*` before each run; set `halatuju.tourDone=true` so the guided tour doesn't pop up.

## Shot list

App = screen recording of the live demo server. MG = motion graphic (HTML/CSS/GSAP or canvas rendered to video, in the style guide). Clicks follow `docs/DEMO.md`; numbers in _[brackets]_ are read off the app on the day.

### 0 · Cold open: the reroute (0:00–0:20)
- **App:** Priya's map at 2030, goal ESG set, Review queue open on the Microsoft change (signal #6, microsoft.com, 22 Oct 2026). Cursor clicks **Approve and apply**.
- **Highlight:** push-in on the source card's date and quote (1.4×) while "22 October" is said; ease out to the full map for the reroute.
- **Beat:** 2 s of silence while the old route fades red and the new one lights up. Then a 1 s title hit: HalaTuju wordmark fades in over the map, lower third.
- Record this clip **last** (it needs the approved state) or from a separate primed run.

### 1 · Priya (0:20–0:45)
- **MG:** a quiet, believable email on a laptop-screen mock (fictional company "Seri Mutiara Shared Services", from the crafted CV): subject "Changes to AP operations next year", body: *"From next year, AI agents will run invoice matching. Staff who move into new roles within six months will be redeployed."* Small "Sample scenario" tag in a corner.
- Then a simple portrait card: "Priya Nair, accounts payable, 11 years, Penang" with three questions appearing one by one as they're spoken. No stock photo of a real person; use an illustrated avatar or initials ("PN", like the app).

### 2 · The CV (0:45–1:23)
- **MG → App:** the real `demo/priya-cv.pdf` page slides in at an angle over the onboarding screen (drop shadow, 1.0 → 0.8 scale), a scan line sweeps down it and the personal details (name, phone, IC, email, address, the "Female · Indian · Married" line) blur and turn into labelled tags ("name", "phone", "IC"), then the page drops into the upload box.
- **App:** the reading stages, then the summary. Spotlight the found skills with their evidence line; push-in on the ESCO count.
- **Captions:** "97% current job" and "99.4% personal details removed" as two number cards (source tiny underneath: "36 held-out test CVs").

### 3 · The map (1:23–1:53)
- **App:** the map builds (the app's own intro swoop). Then press play on the year slider: skills turn grey one by one. Cut to the **My skills** tab as the at-risk group grows.
- **Highlight:** small labels pop beside the skills as they close: "Invoice entry → 2027", "Three-way matching → 2028".

### 4 · Her route (1:53–2:40)
- **App:** Explore (top four cards; spotlight each briefly), **Find other jobs → Sustainability**, the map rebuilds with sustainability jobs; **ESG & Carbon Reporting Analyst → Set as my goal**; My goal: route rows (hover the rows so the map previews each route), "Next up" card; click the GHG Protocol course: the real page opens (record the real site for 2 s, then back); **Find openings → MyFutureJobs**: the live search results page for 2 s.
- **Highlight:** push-in on "57%"; spotlight the route rows while "six weeks" is said; number pop on the deadline line.

### 5 · 1,000 futures (2:40–3:10)
- **MG intro (3–4 s):** 1,000 thin route lines fanning out from Priya's position toward the goal, each line a future; green ones arrive, red ones break off. Counter ticks to "1,000". Then cut to the app card.
- **App:** "Your plan works in _[100]_% of 1,000 possible futures"; switch to the Safest route: _[88]_% with its failure reason. Spotlight the reason line.

### 6 · Beyond four jobs (3:10–3:28)
- **App:** ESCO view for her current role → "Closest moves" list; slow scroll. Caption: "3,039 jobs · EU ESCO classification".

### 7 · Our model (3:28–4:10)
- **MG:** a clean scatter plot animating in: model score vs expert ratings on 185 held-out jobs, points landing on the diagonal, then the label "r = 0.92". A second small bar compare: "Our model 0.92 · GPT-4 labels 0.85" (from `ml/artifacts/eval.json`: per-occupation Pearson 0.919 vs 0.853; plot real numbers only, from that file). Then a RunPod strip: "Trained on a RunPod RTX 4090 · 2.5 minutes" (pod `38jijj8fe5dazu`, `ml/artifacts/runpod_run.json`).
- **App:** a skill drawer showing the model's estimate, to tie it back to the product.
- Last line: "agrees with the ILO's index at 0.79 across 2,956 jobs" as a caption card.

### 8 · How the reroute works (4:10–4:52)
- **MG:** a simple flow strip (4 steps, icons + 2-word labels): *Reads 74 trusted sites → Checks the quote → Second AI reviews → A person approves*. Each step lights up as it's spoken.
- **App:** the review queue, the quote highlighted on the source card, **Approve and apply**, the "Rerouting…" state, the before/after toast. Push-in on the toast.
- **Caption:** "ESCO has 0 of her 5 AI-era skills" while that line is spoken.

### 9 · Her employer (4:52–5:08)
- **App:** HR view (sample team, labelled). Pan across "who moves where, by when, at what cost".
- **MG overlay:** SDG icons 8, 4, 9, 12, 13 slide in along the bottom (official UN SDG icon files; follow the UN's SDG icon usage guidelines). No voice for them.

### 10 · Close (5:08–5:30, plus card)
- **MG:** a tidy proof strip with real logos/marks where usage allows: Replit, RunPod, ESCO, ILO, DOSM, MyCOL; "419 tests", "50-CV benchmark". Then the HalaTuju logo resolves on the night-sky gradient with the tagline: "When AI changes the road, your route changes with it."
- **Placeholder team card (3 s):** "Team _[name]_" (to be filled).
- Say "running on Replit" only if the Replit deployment works on the day; otherwise "built for Replit" (see `docs/PITCH.md`).

## Subtitles

- Generate from the final narration (or the script text if narration isn't recorded yet), split at natural phrases, 1–2 lines, 1.2–6 s each, at least 80 ms gaps.
- Deliver burned-in (for YouTube viewers on mute) **and** as `halatuju.srt`.
- Spell numbers the way they appear on screen ("97%", "1,000", "RM 2,693").

## Assets checklist

| Asset | Status | Where |
|---|---|---|
| Crafted CV | ✅ | `demo/priya-cv.pdf`, `demo/priya-cv.txt` |
| App logo / favicon | ✅ | `web/assets/favicon.svg` (logo mark), wordmark = "HalaTuju" in Geist 650 |
| Source logos (MyFutureJobs, JobStreet, Coursera, GHG Protocol, IFRS…) | being added on 24 Oct | `web/assets/logos/` (with source URLs in its README) |
| Model numbers for the chart | ✅ | `ml/artifacts/eval.json` (per-occupation and per-task), `runpod_run.json` |
| Company email prop | ❌ to make | MG, fictional company, "Sample scenario" tag |
| SDG icons | ❌ to download | UN official SDG icons (check usage guidelines) |
| Music track | ❌ to choose | YouTube Audio Library / Pixabay Music; credit in description |
| Team name | ❌ from the team | end card placeholder |

## Honesty rules for the edit (non-negotiable)

- Only real app footage for app scenes: no mocked UI passed off as the product. Motion graphics are clearly illustrative (email, futures fan, flow strip, charts drawn from real result files).
- Every number on screen must exist in the app or in a result file in this repo (see the Source column in `docs/PITCH.md`).
- Keep "Sample" labels visible where the app shows them. Priya is a sample persona.
- Don't say or show "live on Replit" unless it is.
- The weaker benchmark numbers (ESCO skill precision 71.7%, per-task model error) stay out of the video and in the README and Q&A, where they are reported in full.

## Built for frame-precise edits later (required)

The video must stay editable without regenerating everything:
- **One file per scene:** raw recording, its overlay/highlight definitions (code or JSON with frame numbers), and the rendered scene clip. Changing a caption, a zoom or a cut point re-renders only that scene.
- **A timeline file** (`timeline.json`: scene order, in/out frames, transitions, subtitle cues, music in/out and ducking points) drives the final assembly. Re-assembly concatenates the rendered scene clips with identical encode settings, so unchanged scenes are stream-copied, not re-encoded (seconds).
- **Keep the raw recordings** at full quality, so a scene can be re-cut without re-recording.
- **Also export an editor project** for hand edits: the scene clips plus an FCPXML or EDL that DaVinci Resolve (free) opens as a timeline, and the `.srt` for subtitles, so the team can trim frames themselves.
- Record the exact app state for each scene (the DEMO.md step and the scripted actions), so any scene can be re-recorded identically if the app changes.

## Deliverables

1. `halatuju-pitch.mp4` (1920×1080, ~6:00, burned-in subtitles, music, no narration yet or with the team's narration).
2. `halatuju-pitch-clean.mp4` (same, without burned-in subtitles) and `halatuju.srt`.
3. A per-scene timing sheet (start/end, the line spoken) so the team can record narration to picture.
4. The scripts used to record and render, kept in a scratch folder (not the repo), so any scene can be re-rendered.
