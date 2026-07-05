#!/usr/bin/env python3
"""
Read scores/*.json and render the eval figures with the shared publication
helper. One grouped-bar figure per metric + a summary. PNG@300 + SVG each.
"""
import json
import os
import sys
from pathlib import Path

# The publication-grade-matplotlib helper lives outside the repo. Point at it via
# BEAUTIFUL_CHARTS_DIR, else the default skills location under the current user's
# home — no hardcoded absolute path.
HELPER_DIR = Path(
    os.environ.get(
        "BEAUTIFUL_CHARTS_DIR",
        Path.home() / ".codex/skills/publication-grade-matplotlib/scripts",
    )
)
sys.path.insert(0, str(HELPER_DIR))
sys.path.insert(0, str(Path(__file__).parent))
from beautiful_charts import create_beautiful_chart, save_chart, TAILWIND  # noqa: E402
from chart_style import tidy  # noqa: E402

# runners/ -> completeness-eval/
ROOT = Path(__file__).resolve().parent.parent
FIG = ROOT / "figures"
FIG.mkdir(exist_ok=True)

TOPICS = ["espresso", "accounting", "solar"]
TOPIC_LABEL = {"espresso": "Espresso\nmachines", "accounting": "Accounting\nsoftware", "solar": "Commercial\nsolar"}
# Desired display order; only methods actually present in the scored data render.
METHOD_ORDER = ["baseline", "operators", "llm-operators", "ember"]
METHOD_LABEL = {
    "baseline": "Baseline (search @50)",
    "operators": "Operators (fixed, no LLM)",
    "llm-operators": "Operators (LLM-written)",
    "ember": "Ember",
}
METHOD_COLOR = {
    "baseline": TAILWIND["slate-400"],
    "operators": TAILWIND["blue-500"],
    "llm-operators": TAILWIND["blue-700"],
    "ember": TAILWIND["orange-500"],
}

scores = {t: json.load(open(ROOT / "scores" / f"{t}.json"))["scores"] for t in TOPICS}
present = set().union(*(scores[t].keys() for t in TOPICS))
METHODS = [m for m in METHOD_ORDER if m in present]
xlabels = [TOPIC_LABEL[t] for t in TOPICS]


def series(metric, scale=1.0):
    return [
        {
            "label": METHOD_LABEL[m],
            "x": xlabels,
            "y": [round(scores[t][m][metric] * scale, 2) for t in TOPICS],
            "color": METHOD_COLOR[m],
        }
        for m in METHODS
    ]


def chart(metric, title, subtitle, ylabel, fname, scale=1.0):
    fig, ax = create_beautiful_chart(
        series(metric, scale), type="bar", title=title, subtitle=subtitle,
        xlabel=None, ylabel=ylabel, figsize=(9.8, 6.6),
    )
    tidy(fig, ax)
    paths = save_chart(fig, FIG / fname, formats=("png", "svg"), dpi=300)
    print("wrote", *[p.name for p in paths])


# 1. Headline: distinct EXTRACTABLE long-tail sources (domains) — the usable ones
# (reddit/quora/youtube excluded: you can't scrape + cite them in a report).
chart(
    "longTailExtractableDomains",
    "Usable long-tail sources surfaced",
    "Extractable trade pubs + regional press + forums (unique domains). Non-scrapeable sources (reddit/quora/youtube) excluded. One shared labeler.",
    "Extractable long-tail domains",
    "01_longtail_domains",
)

# 2. Signal-to-noise: fraction of each method's output that is long-tail.
chart(
    "longTailFraction",
    "Long-tail share of results",
    "Long-tail domains as % of all domains returned. The customer's complaint: baseline is ~all SEO winners.",
    "% of returned domains",
    "02_longtail_fraction",
    scale=100.0,
)

# 3. Category coverage: how many of the 4 wanted long-tail categories appear.
chart(
    "categoryCoverage",
    "Long-tail category coverage",
    "How many of {trade_pub, regional_press, community_forum, niche_forum} each method surfaced (max 4).",
    "Categories covered (of 4)",
    "03_category_coverage",
)

# 4. Summary across topics: total distinct EXTRACTABLE long-tail sources.
totals = [
    {
        "label": METHOD_LABEL[m],
        "x": ["Total across 3 topics"],
        "y": [sum(scores[t][m]["longTailExtractableDomains"] for t in TOPICS)],
        "color": METHOD_COLOR[m],
    }
    for m in METHODS
]
fig, ax = create_beautiful_chart(
    totals, type="bar",
    title="Total usable long-tail sources (3 topics)",
    subtitle="Sum of distinct extractable long-tail domains across espresso + accounting + solar.",
    ylabel="Extractable long-tail domains", figsize=(8.4, 6.4),
)
tidy(fig, ax)
save_chart(fig, FIG / "04_summary_total", formats=("png", "svg"), dpi=300)
print("wrote 04_summary_total")
