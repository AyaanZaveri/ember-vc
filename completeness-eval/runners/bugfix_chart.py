#!/usr/bin/env python3
"""
Two controlled, isolated query tests against the live Firecrawl search API,
each changing exactly one token with everything else held fixed. Not a
pipeline-level eval (those have real run-to-run search variance) — these are
clean natural experiments, directly reproducible.

Test 1: regional_press's fixed template term "local news" was auto-quoted by
a helper that wraps any multi-word OR-term in quotes. Quoted vs unquoted,
same query otherwise: 0 results vs 6.

Test 2: category-probe queries anchored on the full topic including B2B
framing words like "manufacturers". With vs without that one word, same
operators otherwise, results scored for how many are genuine forums: 2/8 vs 6/8.

Run: python3 runners/bugfix_chart.py
"""
import sys
from pathlib import Path

sys.path.insert(0, "/Users/ayaanzaveri/.codex/skills/publication-grade-matplotlib/scripts")
sys.path.insert(0, str(Path(__file__).parent))
from beautiful_charts import create_beautiful_chart, save_chart, TAILWIND  # noqa: E402
from chart_style import tidy  # noqa: E402

ROOT = Path(__file__).parent.parent
FIG = ROOT / "figures"
FIG.mkdir(exist_ok=True)

BEFORE = TAILWIND["slate-400"]
AFTER = TAILWIND["orange-500"]

# Different metrics, kept honestly distinct on the x-axis labels: test 1 is a
# raw result count (out of a limit of 6), test 2 is how many of a fixed 8
# returned results were genuine forums (a quality count, not a total).
series = [
    {
        "label": "Before fix",
        "x": ['"local news" query\n(results, limit 6)', "forum probe query\n(genuine forums, of 8)"],
        "y": [0, 2],
        "color": BEFORE,
    },
    {
        "label": "After fix",
        "x": ['"local news" query\n(results, limit 6)', "forum probe query\n(genuine forums, of 8)"],
        "y": [6, 6],
        "color": AFTER,
    },
]

fig, ax = create_beautiful_chart(
    series,
    type="bar",
    title="Two query bugs, isolated and fixed",
    subtitle="Same query, one token changed, tested live against Firecrawl search. Same-second A/B, no other variables.",
    ylabel="Count (see x-axis for what's counted)",
    figsize=(9.5, 6.6),
)
tidy(fig, ax)
paths = save_chart(fig, FIG / "05_query_bugfixes", formats=("png", "svg"), dpi=300)
print("wrote", *[p.name for p in paths])
