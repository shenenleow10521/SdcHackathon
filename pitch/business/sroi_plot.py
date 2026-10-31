import json, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
r = json.load(open("sroi_sim.json")); w = r["waterfall_median_run"]
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#444", "axes.titleweight": "bold", "axes.titlesize": 13, "axes.titlepad": 12})
fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 4.6), gridspec_kw={"width_ratios": [1.75, 1]})
# waterfall
labels = ["Severance\navoided", "Wages\nkept", "Gross\nvalue", "Would happen\nanyway", "Credit to\nothers", "Net social\nvalue", "Pilot\ncost"]
lo = [0, w["severance"], 0, w["gross"] - w["deadweight"], w["net"], 0, 0]
hi = [w["severance"], w["gross"], w["gross"], w["gross"], w["gross"] - w["deadweight"], w["net"], w["invest"]]
cols = ["#1f77b4", "#1f77b4", "#7f7f7f", "#d62728", "#d62728", "#2ca02c", "#ff7f0e"]
x = np.arange(len(labels))
a1.bar(x, np.array(hi) - np.array(lo), bottom=lo, color=cols, width=0.6, edgecolor="none")
for i in range(len(x) - 1):
    if i in (0, 3):
        lvl = hi[i] if i == 0 else lo[i]
        a1.plot([x[i] + 0.3, x[i + 1] - 0.3], [lvl, lvl], color="#999", lw=0.8, ls="--")
for i, (l, h) in enumerate(zip(lo, hi)):
    v = h - l; neg = i in (3, 4)
    a1.text(x[i], h + 50_000, ("−" if neg else "") + f"{v/1e6:.2f}M", ha="center", va="bottom", fontsize=10, color="#222")
a1.annotate(f"{w['net']/w['invest']:.2f}× cost", xy=(5.5, w["net"] + 220_000), ha="center", fontsize=11, fontweight="bold", color="#2ca02c")
a1.set_xticks(x, labels, fontsize=10)
a1.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"RM {v/1e6:.1f}M" if v else "0"))
a1.set_ylim(0, 3.1e6); a1.grid(axis="y", color="#e5e5e5", lw=0.8); a1.set_axisbelow(True)
a1.set_title("Social value of one pilot centre, median run", loc="left")
# distribution
rng = np.random.default_rng(0)
edges = np.array(r["edges"]); hist = np.array(r["hist"])
mid = (edges[:-1] + edges[1:]) / 2; bw = edges[1] - edges[0]
keep = mid < 6
a2.bar(mid[keep], hist[keep], width=bw * 0.92, color=["#d62728" if m < 1 else "#2ca02c" for m in mid[keep]], edgecolor="none")
a2.axvline(1, color="#d62728", ls="--", lw=1)
a2.axvline(r["sroi_p50"], color="#222", lw=1.4)
a2.axvspan(r["sroi_p10"], r["sroi_p90"], color="#2ca02c", alpha=0.08)
a2.text(r["sroi_p50"] + 0.08, hist.max() * 0.98, f"median {r['sroi_p50']:.2f}×", fontsize=10, va="top")
a2.text(0.9, hist.max() * 0.5, "break-even", fontsize=9.5, color="#d62728", ha="right", va="center", rotation=90)
a2.set_xlim(0, 6); a2.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}×"))
a2.set_xlabel("Return per RM 1"); a2.set_ylabel("Runs")
a2.grid(axis="y", color="#e5e5e5", lw=0.8); a2.set_axisbelow(True)
a2.set_title("10,000 simulated pilots", loc="left")
fig.tight_layout(w_pad=3)
fig.savefig("/home/claude/final-pitch/assets/sroi.png", dpi=170, facecolor="white")
print("saved")
