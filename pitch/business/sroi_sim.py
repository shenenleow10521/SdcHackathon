"""SROI (Social Return on Investment) simulation for one HalaTuju pilot centre.

Method follows the Social Value International SROI principles: value outcomes in money,
then remove deadweight (what would have happened anyway) and attribution (credit owed to
others) before dividing by the investment. One year, so no drop-off is applied.

Every input is a range (triangular low, mode, high); 10,000 runs, fixed seed.
"""
import json
import numpy as np

SEED, RUNS = 20261101, 10_000
rng = np.random.default_rng(SEED)
tri = lambda lo, mode, hi: rng.triangular(lo, mode, hi, RUNS)

STAFF = 1500                      # one pilot shared-service centre (roadmap: 2-3 centres, ~1,500 staff)
PRICE = 25 * 12                   # RM 25 per worker a month, one year
WAGE = 2693                       # DOSM 2025 clerical median monthly wage (RM)
DAILY = WAGE / 26                 # Employment Act daily rate for a monthly-paid worker

inputs = {
    "exposed_share":   (0.20, 0.30, 0.40),   # staff in highly AI-exposed roles (assumption, GBS clerical-heavy)
    "layoff_risk":     (0.30, 0.45, 0.60),   # of those, share who would otherwise be let go within the year
    "redeploy_rate":   (0.30, 0.45, 0.60),   # of at-risk staff, share HalaTuju helps move to a new role
    "tenure_years":    (5, 9, 15),           # years of service (sets statutory severance)
    "months_jobless":  (2, 4, 6),            # months of pay lost if laid off before finding new work
    "deadweight":      (0.30, 0.45, 0.60),   # would have been redeployed anyway
    "attribution":     (0.20, 0.30, 0.40),   # credit owed to HR, trainers and courses
}
d = {k: tri(*v) for k, v in inputs.items()}

at_risk = STAFF * d["exposed_share"] * d["layoff_risk"]
redeployed = at_risk * d["redeploy_rate"]
severance = DAILY * 20 * d["tenure_years"]            # 20 days' wages per year of service
wages_kept = WAGE * d["months_jobless"]

gross_sev = redeployed * severance
gross_wage = redeployed * wages_kept
gross = gross_sev + gross_wage
keep = (1 - d["deadweight"]) * (1 - d["attribution"])
net = gross * keep
invest = STAFF * PRICE
sroi = net / invest
kept_jobs = redeployed * (1 - d["deadweight"])         # people kept in work who would otherwise have lost it

p = lambda x, q: float(np.percentile(x, q))
med = lambda x: p(x, 50)
hist, edges = np.histogram(np.clip(sroi, 0, 8), bins=32, range=(0, 8))

out = {
    "runs": RUNS, "seed": SEED, "staff": STAFF, "invest": invest, "wage": WAGE, "inputs": inputs,
    "sroi_p10": p(sroi, 10), "sroi_p50": med(sroi), "sroi_p90": p(sroi, 90),
    "p_value_above_cost": float((sroi > 1).mean()),
    "kept_jobs_p10": p(kept_jobs, 10), "kept_jobs_p50": med(kept_jobs), "kept_jobs_p90": p(kept_jobs, 90),
    "redeployed_p50": med(redeployed), "at_risk_p50": med(at_risk),
    "waterfall_median_run": None,
    "hist": hist.tolist(), "edges": edges.tolist(),
}
# Waterfall from medians of each component (shown as a typical run)
g_s, g_w = med(gross_sev), med(gross_wage)
g = g_s + g_w
dw = g * med(d["deadweight"])
att = (g - dw) * med(d["attribution"])
out["waterfall_median_run"] = {"severance": g_s, "wages": g_w, "gross": g, "deadweight": dw,
                               "attribution": att, "net": g - dw - att, "invest": invest}
json.dump(out, open("/home/claude/biz/sroi_sim.json", "w"), indent=1)
for k in ["sroi_p10", "sroi_p50", "sroi_p90", "p_value_above_cost", "kept_jobs_p10", "kept_jobs_p50", "kept_jobs_p90", "redeployed_p50", "at_risk_p50"]:
    print(f"{k:22} {out[k]:,.3f}")
print({k: round(v) for k, v in out["waterfall_median_run"].items()})
