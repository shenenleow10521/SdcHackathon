# SDC Hackathon 2026: Preliminary Round Requirements (AI Reference)

> **Purpose:** A single source of truth for any AI or teammate working on our SDC Hackathon 2026 prelim submission.
> **Built from:** every file in `SDC Hackathon 2026 - Participant Resources-20261021T062905Z-1-002.zip` (analysed 2026-10-21).
> **Precedence rule (from organisers):** *"If anything conflicts, the Terms & Conditions win."* Discord is the official channel; announcements there override this file.

---

## 0. Source files analysed

| # | File (inside `extracted/SDC Hackathon 2026 - Participant Resources/`) | Type | How it was read |
|---|---|---|---|
| 1 | `5. Online Orientation Briefing /1. SDC Hackathon Online Orientation Slides.pdf` | 44-slide PDF (orientation held 19 Oct 2026) | Text layer + every slide viewed as an image (many slides are image-only) |
| 2 | `4. Participant Guideline (Docs & Tutorials)/2. Video Tutorials Needed/3. Mentorship Booking & Submission Method/2. Detailed Submission.mp4` | 4 min 06 s, 1080p screen recording | Transcribed with faster-whisper large-v3 (GPU) + screenshots every 8 s read visually |

**Missing material:** the zip name ends in `-1-002`, which means it is **part 2 of a split Google Drive download**. Folders `1.`–`3.` and other items in folder `4.` are not in this zip. That likely includes the **official PRD template** and the **Tech & Tools Declaration template**, both referenced in the slides. **Update 24 Oct:** both templates were found in the organisers' Drive folder "2. Template for docs inside GitHub Rep", with the repo template https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template. Our answers, field by field: `submission/SDC2026_Dsaise_Preliminary.pdf` and `submission/SDC2026_Dsaise_TechDeclaration.pdf`.

---

## 1. Event at a glance

- **Name:** SDC (Sustainably Developing Code) Hackathon 2026, "Build AI That Matters"
- **Organisers:** XMUM AI Club and XMUM Rotaract Club (Rotaract Club of Xiamen University Malaysia)
- **Format:** 2-week hybrid AI hackathon built around the 17 UN SDGs. Online prelims, then physical finals at Xiamen University Malaysia (XMUM).
- **Prize pool:** RM 16,000
- **Teams:** 1–5 members, open to foundation, diploma and undergraduate students at a Malaysian university
- **Fee:** RM50 + RM25 refundable deposit. The RM25 is refunded **only for a valid, complete submission**. A finalist no-show without 48 h notice forfeits it.
- **Website:** https://sdchack.my (team portal: https://sdchack.my/portal)
- **Formal contact:** sdc.xmumhack@gmail.com, or the official Discord
- **Sponsors:** Aiversecity (Diamond), Alphared Solutions (Platinum), RunPod (Tech), Replit (Tech), Kracked Devs (Tech). Also ORION AI Youth Community (membership benefits slide).

---

## 2. Timeline (all times MYT)

| Date | Event |
|---|---|
| 18 Aug | Registration opened |
| 18 Oct | Registration closed |
| **19 Oct, 8 PM** | Orientation + problem statement release. **Prelim round opens. The build clock starts here.** |
| 19–25 Oct | Phase 1 (online): Preliminary Round |
| **25 Oct (Sun), 7:59:59 AM** | **PRELIM SUBMISSION DEADLINE.** Sunday *morning*, not Sunday night or midnight. |
| 25–28 Oct | Interim: judging and shortlisting |
| 28 Oct, 8 PM | Finalists announced |
| 29 Oct, 12 PM | Finalists must confirm by this time |
| 28–30 Oct | Phase 2 (online): "Upgrading Round". Top 15 teams per domain refine their solutions. |
| 31 Oct | Final Phase (physical): 24-hour hackathon at XMUM |
| 1 Nov | Final pitching and closing ceremony at XMUM |

---

## 3. The two domains (randomly assigned, locked once allocated)

Rules for both domains: **must link to at least 1 SDG.** The domain cannot be changed.

> Our assigned domain: **_TODO: fill in (1 or 2)_**

### Domain 1: Aiversecity Future-Ready Workforce
**Problem statement:** How might we build an AI-powered solution that continuously tracks AI advancement to predict which skills and jobs will emerge or decline, matches today's workforce and tomorrow's talent to the right future roles, and generates personalised reskilling pathways, while showing how each role and skill connects to the 17 UN Sustainable Development Goals?

**6 must-haves:**
1. Skills profile intake
2. AI-trend signal layer (updatable, with a dated source)
3. Future-role matching + skills gap
4. Personalised reskilling pathway
5. SDG mapping
6. More than one future scenario

### Domain 2: Orbyte Smart SME Challenge
**Problem statement:** How might we design a reliable, easy-to-learn automation product for the Orbyte ecosystem that removes one recurring operational burden for micro and small businesses, improves accuracy and consistency, and keeps people in control, so it can serve many SMEs?

**6 must-haves:**
1. One clear SME problem
2. Automated journey: trigger → data → logic → approval → logged outcome
3. Human control
4. Orbyte fit and reuse
5. Business benefit + SDG link
6. Ease of learning

> The website says the **full problem statement is shared on Discord**. Check Discord for the complete brief; the slides show a summary.

---

## 4. Rules for both domains

1. **Public, open or synthetic data only.** No real personal data. No dataset is provided; use public, open or self-collected data and **credit sources**.
2. **Be transparent about AI.** Declare every model you use. Don't let your system invent facts.
3. **Keep humans in charge.** Your solution supports decisions; it doesn't replace them.

**Every submission needs a working prototype, a functional UI and a pitch.** Missing one = incomplete. A great pitch cannot replace a working build.

---

## 5. Preliminary judging rubric

| Weight | Criterion | What judges look for |
|---|---|---|
| **30%** | Innovation & Creativity | A sharply framed, specific problem and an original approach. **Not a re-skinned chatbot.** |
| **25%** | Problem-Solution Fit | The whole chain in your domain brief is covered, **all six must-haves explained**, humans stay in control. |
| **25%** | Feasibility of Build | A rough but working version of your most important feature, **shown live**, backed by GitHub, **plus your hardest risk and a fallback**. |
| **20%** | Clarity of Proposal | Problem → approach → expected outcome. Easy to explain back, and follows the format and length limits. |

- Your **most important feature must run live**.
- **Prelim score does not carry forward** to the finals.
- **Public GitHub repo required.**

---

## 6. Preliminary submission: the 6 required items

"6 items · Submit at sdchack.my · One official submission per team"

| # | Item | Requirement |
|---|---|---|
| 1 | **Product Requirement Doc (PRD)** | Use the **official template**: problem, SDG alignment, target users, scope, key features. *(Official template: see the update in section 0.)* |
| 2 | **Pitch Deck Slides** | Problem, solution, technical approach and expected impact. Must match the story in the video. |
| 3 | **Live Prototype Link** | Deployed link or accessible build. **A video or static mock-up does not count.** |
| 4 | **Tech & Tools Declaration** | All APIs, cloud services, AI tools, LLMs, datasets, models and sponsor resources. Must include Replit proof (and RunPod proof if GPU was used). |
| 5 | **GitHub Repository Link** | Public, and it must reflect what you demo. |
| 6 | **Pitching Video (5–7 min)** | Includes a prototype demo, uploaded to **YouTube**. Recorded, not live. |

### What the website submission form actually shows (from the tutorial video, preview mode)
The "Submit your project" page on sdchack.my has only:
- **Your domain** (display only). Note: *"The full problem statement is shared on Discord; this page is only for the GitHub link."*
- **GitHub repository** URL field: *"Must be public; we check this when you submit."*
- **Mandatory checkbox:** *"Our project integrates our API Premium sponsor's technology, mandatory for both rounds. Submissions without it are disqualified."*
- *"You can resubmit as many times as you like until 25 October 2026."*

See section 11 for the conflicts this raises.

---

## 7. Compulsory tools and GitHub rules

### Replit (COMPULSORY)
- **Every team must use it.** Everyone gets Replit Core.
- Proof goes in the declaration, from **your own account**: a live deployment URL, a project link with history, or a finished credit.
- Missing proof = deductions or not eligible.

### RunPod (for GPU work)
- **Any training, fine-tuning or running of a model on a GPU must use RunPod.**
- Proof: a screenshot showing **Pod ID or endpoint, GPU type and runtime**.
- US$25 credit per team.

### GitHub: 4 repo rules
1. **Create the repo after the 19 Oct release** (not before).
2. **Private while building, public before you submit.**
3. Include an **Apache License 2.0** `LICENSE` file.
4. **Add the committee's accounts as collaborators** (get usernames from Discord).

Also:
- **Keep a genuine commit history.** One giant last-minute commit gets reviewed.
- **Never expose API keys or passwords.** Use env vars / secrets, and check git history too.
- No commits after the deadline (deductions or disqualification). The repo is treated as frozen.

---

## 8. AI usage policy

Permitted and encouraged as **a productivity assistant, not a substitute.**

1. **The idea must be yours.** Problem framing, solution design and technical decisions come from the team, not an AI-generated idea.
2. **Review and adapt.** Using AI output unedited, wholesale, is not acceptable.
3. **Declare it.** Every AI tool, LLM, API, dataset and model goes in the Tech & Tools Declaration. Undeclared use = deductions or disqualification.
4. **Be able to explain it.** Any member can be asked about any part. Can't explain a core feature? You may be flagged, even if you wrote it by hand.

The team stays fully responsible for the correctness, originality, licensing and security of AI output.

> **Note for AI assistants on this project:** your use must itself be declared (tool name + what it was used for). Every teammate must understand any code you produce well enough to explain it to judges.

---

## 9. Academic integrity

- **Built during the hackathon.** The clock starts at the 19 Oct problem statement release. Pre-built projects, or ones entered elsewhere, are not eligible.
- **Small pre-existing code is OK** (login modules, utilities) as supporting parts only. The core idea and major features must be new. **Declare anything significant.**
- **Registered members only.** No outsiders writing code or producing deliverables. Mentors advise but never build, code or design.
- **Don't exaggerate.** Fabricating capabilities is itself a violation. Organisers can check commit history, run similarity checks and interview the team.
- To report misconduct, tell a committee member or open a private Discord ticket. Reports are confidential.

---

## 10. Penalties

| Violation | Consequence |
|---|---|
| Overtime (e.g. video over 7 min) | **−1 point per 30 seconds over** |
| Undeclared tools or AI | Deductions or disqualification |
| Missing Replit / RunPod proof | Deductions or not eligible |
| Inaccessible / private repo | Eligibility may be affected |
| Pre-built work / one giant commit | Review, possible disqualification |
| Unexplainable, mostly-AI work | Deductions or disqualification |
| Commits after the deadline | Deductions or disqualification |
| Late submission | Not accepted |

Range: warning → deductions → finalist status cancelled → DQ → future ban. Judges' decision is final.

**Deadline rules:** no late submissions. After the deadline there are no changes, no resubmission, and the repo is frozen. **Valid = complete:** every file there, every link opens, every declaration done. Submit early, then **open every link in an incognito window**.

---

## 11. Conflicts and open questions (ask on Discord: #ask-the-organizers)

1. **Where do the 6 items go?** The slides say submit 6 items at sdchack.my, but the website form shown in the tutorial only takes a GitHub link. Safest assumption until confirmed: **put links to all 6 items in the repo README** (PRD, deck, live prototype URL, declaration, YouTube video) and also commit the PRD, deck and declaration files into the repo. Then submit the GitHub link on the site.
2. **"API Premium sponsor's technology, mandatory for both rounds."** This appears only on the submit form, not in the slides. It is unclear which sponsor this means (Replit is the only tool the slides call compulsory; the slide tiers are Diamond / Platinum / Tech, with no "Premium" tier). The video was a preview with fake data, so the wording may be a placeholder. **Confirm before building.** If it is real, it is a disqualification-level rule.
3. **Deadline wording.** The form says "until 25 October 2026"; the slides say **25 Oct 7:59:59 AM MYT**. Treat 7:59:59 AM as the binding time.
4. **Domain naming.** The website preview shows "Domain A"; the slides use "Domain 1 / Domain 2". This is cosmetic, but check which label the portal shows for our team.
5. **Committee GitHub usernames** for the collaborator rule are not in these files. Get them from Discord.
6. ~~Templates for the PRD and declaration are not in this zip part.~~ Found on 24 Oct (see section 0). Submit them as `SDC2026_TeamName_Preliminary.pdf` and `SDC2026_TeamName_TechDeclaration.pdf`.

---

## 12. Presentation format

### Preliminary (this round)
- **Recorded, not live.**
- **5–7 minute pitching video on YouTube** (overtime penalty: −1 pt per 30 s over).
- **Prototype demo inside the video.**
- Slides should match the story in the video.

### Final (if shortlisted)
- Live on **1 Nov at XMUM**: **10 min pitch + 5 min judges' Q&A**.
- Cover problem, solution, tech, SDG relevance, impact, feasibility + live demo.
- Slides as **.pptx**, must open before your slot.
- Bring your own laptop with HDMI or an adapter.
- **Submit a backup recorded pitch video.**
- Organisers aren't responsible for demo failures caused by your own equipment or setup.

---

## 13. Platform how-to (from the tutorial video)

### Team portal (sdchack.my/portal)
- Log in with the **team leader's email** and the password emailed at registration (format `SDC-xxxx-xxxx-xxxx`). Use **one leader account**; only the leader email receives notifications.
- The dashboard shows team members (members can't be added or removed after registering; email sdc.xmumhack@gmail.com for spelling fixes), **per-member Discord access links** (private, expire after 4 days), and a WhatsApp community link (a second announcement platform).
- The Mentoring and Project Submission sections unlock after Orientation Day / domain assignment.

### Mentor booking
- **One session per team.** Browse mentors (each shows role, expertise and open times) and pick a slot. **Strictly first-come, first-served**, so book early and bring specific questions.
- After booking, the dashboard shows the mentor, time and a **universal Zoom link**. A confirmation email goes to the team leader.
- You can move or cancel, **but not when the session is less than 24 hours away.**
- At session time the page shows a **"Join the meeting"** button. An admin guides you in the main Zoom room.
- After the session it's marked Completed; nothing more to book.
- Mentors give feedback only and will not write code.

### Project submission
- Open the Submit page when submissions open, paste the **public GitHub repo URL**, tick the sponsor checkbox (see section 11), and press **Submit**. Resubmission is allowed until the deadline.

### Discord (official comms: "I didn't see it" isn't accepted)
- **#announcements:** critical updates and schedule reminders. Don't mute it.
- **#ask-tech:** platform bugs and technical support.
- **#ask-the-organizers:** general public questions.
- **#open-ticket → Create Ticket:** private, team-specific issues (creates e.g. `ticket-0004`). Close it when resolved.
- Others: #welcome, #rules-and-conduct, #introductions, #general, #looking-for-team, #feedbacks.
- If you haven't claimed the Verified (after-payment) role, ask the team leader for the Discord role claim link on https://sdchack.my/portal.
- If GitHub or Replit goes down, organisers assess it and announce any extension on Discord.

---

## 14. Prelim submission checklist (do before 25 Oct, 7:59:59 AM MYT; aim for 24 Oct)

**Build**
- [ ] Domain confirmed and full problem statement read on Discord
- [ ] All **6 domain must-haves** implemented or clearly explained
- [ ] SDG link(s) stated explicitly
- [ ] Only public, open or synthetic data; sources credited; no real personal data
- [ ] Human-in-control step visible in the UI
- [ ] System does not invent facts (grounding, citations or dated sources shown)
- [ ] Most important feature **runs live** at a deployed URL
- [ ] Built and deployed on **Replit** (from our own account)
- [ ] Any GPU work done on **RunPod** (screenshot: Pod ID/endpoint, GPU type, runtime)
- [ ] Sponsor-technology requirement confirmed and met (section 11, item 2)
- [ ] Hardest risk identified, with a fallback

**Repo**
- [ ] Repo created **after** 19 Oct 8 PM
- [ ] `LICENSE` = Apache 2.0
- [ ] Committee accounts added as collaborators
- [ ] Steady, genuine commit history (no single giant dump)
- [ ] No secrets in code or history
- [ ] README links to all 6 items
- [ ] Repo switched to **public** before submitting

**Deliverables**
- [ ] 1. PRD on the official template
- [ ] 2. Pitch deck (problem, solution, tech approach, impact) matching the video
- [ ] 3. Live prototype link (not a video or mock-up)
- [ ] 4. Tech & Tools Declaration (every API, AI tool/LLM, dataset, model, cloud service, sponsor resource, plus Replit/RunPod proof)
- [ ] 5. Public GitHub repo link
- [ ] 6. YouTube pitch video, **5:00–7:00**, includes a live prototype demo, viewable publicly or as unlisted

**Final check**
- [ ] Submitted on sdchack.my
- [ ] Every link opened in an **incognito window**
- [ ] Every team member can explain every core feature
- [ ] No commits after the deadline

---

## Appendix A: Video transcript, "2. Detailed Submission.mp4"

*Transcribed with faster-whisper large-v3. Lightly cleaned: a line Whisper repeated over background music (02:29–02:37) was removed, and a few obvious mishearings were fixed (e.g. "next session" → "next section").*

```
[00:00] Welcome to the SDC Hackathon.
[00:03] Today, I will demonstrate how to use our Mentor Booking System, Project Submission, and our official Discord.
[00:10] First, let's log in to your account.
[00:14] After logging in, you will see your team dashboard.
[00:18] Right now, if you scroll down, the Mentoring and Project Submission section is not open yet.
[00:24] But don't worry, let me show you exactly how they will work once the event kicks off.
[00:28] Once Mentor Booking opens, the interface will look like this.
[00:34] You can browse through our expert mentors and select an available time slot.
[00:43] Please note that slots are strictly first-come, first-served.
[00:46] If a mentor is fully booked, it will indicate that there are no available times left, so we highly recommend booking as early as possible.
[00:56] After you confirm a slot, your dashboard updates with your booking details and the Universal Zoom link.
[01:02] If your schedule changes, you can move your session to another available time.
[01:15] However, please be aware of our strict rule.
[01:18] If your session is less than 24 hours away, you will no longer be able to modify or cancel it.
[01:29] When it is exactly time for your mentoring to begin, the page updates dynamically.
[01:34] The link will turn into a large Join the Meeting button.
[01:37] Simply click it to hop into the main Zoom room, where our admin will guide you.
[01:43] Once your session is over, it will be marked as completed.
[01:54] Moving on to the next section, you will see the Mentoring and Project Submission section.
[01:56] This part is quick and straightforward.
[01:58] When submissions open, access this page,
[02:01] paste your team's official GitHub repository link,
[02:04] and hit Submit before the deadline.
[02:10] Finally, let's explore our official Discord server,
[02:14] which will serve as your central communication hub throughout the entire SDC Hackathon.
[02:23] First and foremost, always keep an eye on the Announcements channel.
[02:27] Our committee will be dropping all critical updates, schedule reminders, and important updates.
[02:37] Next, we know that building projects can sometimes be challenging.
[02:44] If you run into any bugs on our platform, or if you need technical support while working on your submissions, simply head over to the Ask Tech channel.
[02:52] Just type your questions there, and our technical team will be on standby to assist you as quickly as possible.
[03:01] In addition to technical support, we have a dedicated help desk for any other inquiries.
[03:06] You can ask general questions in the Ask the Organizers channel.
[03:09] For private or team-specific issues, go to the Open Ticket channel and click the Create Ticket button.
[03:17] This will generate a private channel like Ticket 0004, just for you and our committee.
[03:23] Once your issue is resolved, simply close the ticket to keep things organized.
[03:28] We are here to ensure you have a smooth hackathon experience.
[03:31] That wraps up our platform walkthrough.
[03:35] As you prepare for the competition, remember that all these tools, the mentoring sessions,
[03:40] the Discord community, and our tech support are here to help you succeed and bring your ideas to life.
[03:47] We are incredibly excited to see the innovative solutions your team will build for this year's SDC Hackathon.
[03:53] Take full advantage of the resources, collaborate closely with your teammates, and most importantly, enjoy the process.
[04:01] We wish you the absolute best of luck on your journey, and happy hacking!
```

**On-screen text not spoken in the video:**
- Submit page checkbox: "Our project integrates our API Premium sponsor's technology, mandatory for both rounds. Submissions without it are disqualified."
- Submit page: "Must be public; we check this when you submit." / "You can resubmit as many times as you like until 25 October 2026." / "The full problem statement is shared on Discord; this page is only for the GitHub link."
- Locked-session notice: "Less than 24 hours to go, so this session can no longer be moved or cancelled. If something has gone wrong, email sdc.xmumhack@gmail.com."
- Completed session: "Each team gets one session, so there's nothing more to book."
- #announcements: "For those who haven't claimed the verified (after payment) role: please ask your team leader for the discord role claim link on the SDC website. https://sdchack.my/portal"

---

## Appendix B: Slide index (Orientation PDF, 44 pages)

| Pages | Content |
|---|---|
| 1–4 | Sponsor intro ("Intelligence is Infrastructure"), title, agenda, house rules |
| 5–13 | Organizing Chairperson (Yap Zheng Hui), Faculty Representative, sponsor slides: Aiversecity (Diamond), ORION AI Youth Community benefits, Alphared Solutions (Platinum), RunPod, Replit, Kracked Devs (Tech); speaker video frame |
| 14–15 | Programme timeline (section 2) |
| 16–17 | Competition briefing agenda. "If anything conflicts, the Terms & Conditions win." |
| 18–19 | Participant Drive / Google Drive folder tour (divider slides, no content) |
| 20 | Two domains + must-haves (section 3) |
| 21 | Rules for both domains (section 4) |
| 22 | Prelim rubric (section 5) |
| 23 | AI usage policy (section 8) |
| 24 | Academic integrity (section 9) |
| 25–28 | How to submit; prelim submission 6 items (section 6) |
| 29 | Tools & GitHub rules (section 7) |
| 30 | Deadline (sections 2, 10) |
| 31 | "Submit early!" |
| 32 | Presentation format (section 12) |
| 33 | Penalties (section 10) |
| 34 | FAQs (folded into sections 1, 4, 7, 9, 13) |
| 35 | Questions / key reminders |
| 36–38 | Website & Discord demo divider + video frames (Appendix A) |
| 39–44 | Live domain allocation, Q&A, thank you, MC run-sheet notes |
