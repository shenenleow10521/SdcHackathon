"""HalaTuju business case: 10,000-run Monte Carlo over 36 months (Jan 2027 to Dec 2029).

Every input is a range around the pilot assumptions in our pitch deck (appendix: costs and break-even):
price RM 25 per seat a month, cost to serve RM 0.50 per seat, fixed cost RM 24,451.50 a month
(team of 3 + hosting + daily market checks), 20 employers x 500 staff by year 3.
Run: python3 business_sim.py  ->  prints the results and writes business_sim.json
"""
import json
import numpy as np

RUNS, MONTHS, SEED = 10_000, 36, 20261101
rng = np.random.default_rng(SEED)

def tri(lo, mode, hi, n=RUNS):
    return rng.triangular(lo, mode, hi, n)

# ---- inputs (low, most likely, high) ----
IN = {
    "pilot_employers":      (1, 2.5, 4),        # signed in H1 2027 (deck: 2-3 centres)
    "new_employers_per_mo": (0.25, 0.55, 0.9),  # after the pilot (deck: 20 employers by year 3)
    "seats_per_employer":   (200, 500, 900),    # deck: about 500 staff each
    "monthly_churn":        (0.005, 0.015, 0.03),
    "price_realised":       (0.7, 0.9, 1.0),    # share of RM 25 actually charged (pilot discounts)
    "cost_to_serve":        (0.3, 0.5, 1.5),    # RM per seat a month
    "fixed_overrun":        (1.0, 1.1, 1.5),    # x RM 24,451.50 a month
    "pilot_discount":       (0.3, 0.5, 0.8),    # pilot employers pay this share of the price for their first 6 months
}
TEAM_STEP_SEATS, TEAM_STEP_COST = 5_000, 16_000  # our assumption: hire 2 more (RM 8,000 each) once seats pass 5,000
PRICE, FIXED = 25.0, 24_451.50

def simulate(params, runs, rng):
    pe = np.round(params["pilot_employers"]).astype(int)
    lam = params["new_employers_per_mo"]
    seats_each = params["seats_per_employer"]
    churn = params["monthly_churn"]
    price = PRICE * params["price_realised"]
    serve = params["cost_to_serve"]
    fixed = FIXED * params["fixed_overrun"]
    disc = params["pilot_discount"]
    employers = np.zeros(runs); pilot = np.zeros(runs)
    seats = np.zeros((runs, MONTHS)); profit = np.zeros((runs, MONTHS))
    for m in range(MONTHS):
        if m < 6:   # pilot employers sign over the first six months, at a discount
            add = np.where(m < pe * 2, 0.5, 0.0); employers += add; pilot += add
        else:
            employers += rng.poisson(lam)
        employers *= (1 - churn); pilot *= (1 - churn)
        s = employers * seats_each
        s_pilot = pilot * seats_each if m < 12 else 0
        seats[:, m] = s
        revenue = (s - s_pilot) * price + s_pilot * price * disc
        team = np.where(s > TEAM_STEP_SEATS, TEAM_STEP_COST, 0)
        profit[:, m] = revenue - s * serve - fixed - team
    return seats, profit

params = {k: tri(*v) for k, v in IN.items()}
seats, profit = simulate(params, RUNS, rng)
cum = np.cumsum(profit, axis=1)

be = np.argmax(profit >= 0, axis=1).astype(float); be[~(profit >= 0).any(axis=1)] = np.inf
be_month = be + 1
arr_y3 = (seats[:, -1] * PRICE * params["price_realised"]) * 12
funding = -cum.min(axis=1)

pct = lambda a, q: float(np.percentile(a[np.isfinite(a)], q)) if np.isfinite(a).any() else None
res = {
    "runs": RUNS, "months": MONTHS, "seed": SEED, "inputs": IN,
    "p_breakeven_by_18": float((be_month <= 18).mean()),
    "p_breakeven_by_24": float((be_month <= 24).mean()),
    "p_breakeven_by_36": float((be_month <= 36).mean()),
    "breakeven_month_p50": pct(be_month, 50), "breakeven_month_p10": pct(be_month, 10), "breakeven_month_p90": pct(be_month, 90),
    "seats_y3_p10": float(np.percentile(seats[:, -1], 10)), "seats_y3_p50": float(np.percentile(seats[:, -1], 50)), "seats_y3_p90": float(np.percentile(seats[:, -1], 90)),
    "arr_y3_p10": float(np.percentile(arr_y3, 10)), "arr_y3_p50": float(np.percentile(arr_y3, 50)), "arr_y3_p90": float(np.percentile(arr_y3, 90)),
    "funding_p50": float(np.percentile(funding, 50)), "funding_p90": float(np.percentile(funding, 90)),
    "profit_y3_p10": float(np.percentile(profit[:, -12:].sum(axis=1), 10)), "profit_y3_p50": float(np.percentile(profit[:, -12:].sum(axis=1), 50)), "profit_y3_p90": float(np.percentile(profit[:, -12:].sum(axis=1), 90)),
    "cash_positive_month_p50": pct((np.argmax(cum >= 0, axis=1) + 1).astype(float) * np.where((cum >= 0).any(axis=1), 1, np.inf), 50),
    "p_cash_positive_by_36": float((cum[:, -1] >= 0).mean()),
    "fan_profit": {q: [float(x) for x in np.percentile(profit, q, axis=0)] for q in (10, 25, 50, 75, 90)},
    "fan_seats": {q: [float(x) for x in np.percentile(seats, q, axis=0)] for q in (10, 25, 50, 75, 90)},
}

# ---- tornado: move one input to its P10 / P90, others at their mode; measure year-3 seats and break-even month ----
def single(overrides, n=4000):
    r = np.random.default_rng(SEED + 1)
    p = {k: np.full(n, v[1], dtype=float) for k, v in IN.items()}
    for k, v in overrides.items(): p[k] = np.full(n, v, dtype=float)
    s, pr = simulate(p, n, r)
    return float(np.median(pr[:, -12:].sum(axis=1)))
base = single({})
tornado = []
for k, (lo, mode, hi) in IN.items():
    a, b = single({k: lo}), single({k: hi})
    tornado.append({"input": k, "low": a, "high": b, "swing": abs(b - a)})
tornado.sort(key=lambda t: -t["swing"])
res["tornado_base_profit_y3"] = base; res["tornado"] = tornado

# ---- employer ROI ----
staff = 500
annual = staff * PRICE * 12
res["employer"] = {"staff": staff, "annual_cost": annual, "severance_per_clerk": 22_800,
                   "redeployments_to_pay_back": annual / 22_800}

json.dump(res, open("business_sim.json", "w"), indent=1)
for k in ["p_breakeven_by_18", "p_breakeven_by_24", "p_breakeven_by_36", "breakeven_month_p10", "breakeven_month_p50", "breakeven_month_p90",
          "seats_y3_p10", "seats_y3_p50", "seats_y3_p90", "profit_y3_p10", "profit_y3_p50", "profit_y3_p90", "cash_positive_month_p50", "p_cash_positive_by_36", "arr_y3_p10", "arr_y3_p50", "arr_y3_p90", "funding_p50", "funding_p90"]:
    print(f"{k:24s} {res[k]:,.3f}" if isinstance(res[k], float) else f"{k:24s} {res[k]}")
print("tornado base profit y3", round(base))
for t in tornado: print(f"  {t['input']:22s} low {t['low']:>12,.0f}  high {t['high']:>12,.0f}  swing {t['swing']:>12,.0f}")
print("employer", res["employer"])
