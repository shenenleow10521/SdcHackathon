import json, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
r = json.load(open("sroi_sim.json")); w = r["waterfall_median_run"]
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#444", "axes.titleweight": "bold", "axes.titlesize": 13, "axes.titlepad": 12})
fig, a1 = plt.subplots(figsize=(8.2, 5.4))
labels = ["Severance\navoided", "Wages\nkept", "Gross\nvalue", "Would\nhappen\nanyway", "Credit\nto others", "Net\nvalue", "Cost"]
lo = [0, w["severance"], 0, w["gross"] - w["deadweight"], w["net"], 0, 0]
hi = [w["severance"], w["gross"], w["gross"], w["gross"], w["gross"] - w["deadweight"], w["net"], w["invest"]]
cols = ["#1f77b4", "#1f77b4", "#7f7f7f", "#d62728", "#d62728", "#2ca02c", "#ff7f0e"]
x = np.arange(len(labels))
a1.bar(x, np.array(hi) - np.array(lo), bottom=lo, color=cols, width=0.62, edgecolor="none")
for i, lvl in [(0, hi[0]), (3, lo[3])]:
    a1.plot([x[i] + 0.31, x[i + 1] - 0.31], [lvl, lvl], color="#999", lw=0.8, ls="--")
for i, (l, h) in enumerate(zip(lo, hi)):
    a1.text(x[i], h + 50_000, ("−" if i in (3, 4) else "") + f"{(h-l)/1e6:.2f}M", ha="center", va="bottom", fontsize=10.5, color="#222")
a1.text(5, w["net"] + 300_000, f"{w['net']/w['invest']:.2f}× cost", ha="center", fontsize=12, fontweight="bold", color="#2ca02c")
a1.set_xticks(x, labels, fontsize=10)
a1.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"RM {v/1e6:.1f}M" if v else "0"))
a1.set_ylim(0, 3.1e6); a1.grid(axis="y", color="#e5e5e5", lw=0.8); a1.set_axisbelow(True)
a1.set_title("Social value in one year (median of 10,000 runs)", loc="left", fontsize=12)
fig.tight_layout()
fig.savefig("/home/claude/final-pitch/assets/sroi_wf.png", dpi=180, facecolor="white")
print("ok")
