#!/usr/bin/env python3
"""
Renders the classifier eval results (tests/classifier/results/latest.json) into
a grouped bar chart: match accuracy vs. exact-category accuracy, per source
category. The gap between the two bars (when there is one) is the interesting
story — it shows the model confusing similar categories (e.g. retailer vs
vendor_blog) while the deterministic keep/drop decision stays correct.

Run: python3 tests/classifier/plot_results.py
"""

import json
import os
import sys
from pathlib import Path

# The helper lives outside the repo — point at it via BEAUTIFUL_CHARTS_DIR, else
# the default skills location under the current user's home. No hardcoded path.
HELPER_DIR = Path(
    os.environ.get(
        "BEAUTIFUL_CHARTS_DIR",
        Path.home() / ".codex/skills/publication-grade-matplotlib/scripts",
    )
)
sys.path.insert(0, str(HELPER_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "completeness-eval" / "runners"))

from beautiful_charts import TAILWIND, create_beautiful_chart, save_chart  # noqa: E402
from chart_style import tidy  # noqa: E402

RESULTS_DIR = Path(__file__).parent / "results"
LATEST_PATH = RESULTS_DIR / "latest.json"


def main() -> None:
    if not LATEST_PATH.exists():
        raise SystemExit(
            f"No results found at {LATEST_PATH}. Run the eval first:\n"
            "  node --env-file=.env tests/classifier/eval.ts"
        )

    record = json.loads(LATEST_PATH.read_text())
    per_category = sorted(record["perCategory"], key=lambda c: c["category"])

    x_labels = [f"{c['category']}\n(n={c['total']})" for c in per_category]
    match_pct = [
        round(100 * c["matchHits"] / c["total"], 1) if c["total"] else 0.0
        for c in per_category
    ]
    category_pct = [
        round(100 * c["categoryHits"] / c["total"], 1) if c["total"] else 0.0
        for c in per_category
    ]

    summary = record["summary"]
    subtitle = (
        f"Overall: match {summary['matchAccuracy'] * 100:.1f}%  |  "
        f"category {summary['categoryAccuracy'] * 100:.1f}%  |  "
        f"{record['fixtureCount']} hand-labeled real search results"
    )

    fig, ax = create_beautiful_chart(
        [
            {
                "x": x_labels,
                "y": match_pct,
                "label": "Match accuracy (keep/drop decision)",
                "color": TAILWIND["orange-400"],
            },
            {
                "x": x_labels,
                "y": category_pct,
                "label": "Exact category accuracy",
                "color": TAILWIND["orange-600"],
            },
        ],
        type="bar",
        title="Source-Type Classifier — Accuracy by Category",
        subtitle=subtitle,
        xlabel="Source category (hand-labeled ground truth)",
        ylabel="Accuracy (%)",
        figsize=(12.5, 6.5),
        legend=True,
    )
    ax.set_ylim(0, 115)
    ax.tick_params(axis="x", labelsize=8.5, rotation=0)
    for label in ax.get_xticklabels():
        label.set_linespacing(1.4)

    # Compact header + even outer padding (see completeness-eval/runners/chart_style).
    tidy(fig, ax)

    out_paths = save_chart(fig, RESULTS_DIR / "accuracy_by_category", formats=("png", "svg"))
    for path in out_paths:
        print(f"Saved: {path}")


if __name__ == "__main__":
    main()
