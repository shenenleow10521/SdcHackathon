"""Estimated time from opening HalaTuju to a costed route, for a first-time user.

Method: Keystroke-Level Model (Card, Moran & Newell, 1980). Operator times:
  M (mental preparation) 1.35 s · P (point with mouse) 1.1 s · B (click) 0.2 s · H (hand to mouse) 0.4 s.
Reading times use 200-300 words a minute. KLM describes a practised user, so every human
operator is multiplied by a first-time-user factor drawn from 1.5 to 3.0. System waits use the
app's measured CV-reading time (about 15 s, README) as a 10-25 s range.
Steps follow the app's journey: Set up my profile -> upload CV -> wait for skills -> answer up to
3 follow-up questions -> confirm the skills checklist -> pick a ranked job -> pick a route type.
10,000 runs, fixed seed. This is an estimate, not a user test.
"""
import json
import numpy as np

SEED, RUNS = 20261101, 10_000
rng = np.random.default_rng(SEED)
M, P, B, H = 1.35, 1.1, 0.2, 0.4
klm = lambda m=1, p=1, b=1: m * M + p * P + b * B

novice = rng.uniform(1.5, 3.0, RUNS)                       # first-time user is slower than KLM's expert
wpm = rng.uniform(200, 300, RUNS)
read = lambda words: words / wpm * 60

human = (
    H + klm()                                              # open menu: Set up my profile
    + klm() + rng.uniform(3, 6, RUNS)                      # choose upload, pick the file in the file dialog
    + rng.integers(0, 4, RUNS) * (read(15) + klm())        # 0-3 follow-up questions, read and answer each
    + read(60) + klm()                                     # scan about 10 skills, confirm the checklist
    + read(80) + klm()                                     # read the ranked jobs, pick one
    + read(30) + klm()                                     # choose Fastest, Balanced or Safest
) * novice
system = rng.uniform(10, 25, RUNS) + rng.uniform(1, 3, RUNS)   # CV reading + plan computed (fixed formulas)
total = human + system

out = {"runs": RUNS, "seed": SEED, "p_under_60s": float((total <= 60).mean()),
       "median_s": float(np.median(total)), "p10_s": float(np.percentile(total, 10)), "p90_s": float(np.percentile(total, 90))}
json.dump(out, open("/home/claude/biz/klm_sim.json", "w"), indent=1)
print({k: round(v, 3) for k, v in out.items()})
