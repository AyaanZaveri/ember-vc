"""
Shared layout polish for charts built with the publication helper.

The helper (beautiful_charts.create_beautiful_chart) reserves a fixed band at the
top, pins the title/subtitle near the very top edge, and floats the legend up on
the title row — which leaves a big gap, collides the subtitle with the legend,
and runs the axes close to the figure edges. tidy() reflows all of it into a
clean stacked header with generous, even outer padding.

Vertical order (top -> down):
    title
      (small gap)
    subtitle
      (small gap)
    legend            <- left-aligned, UNDER the title+subtitle block
      (gap)
    plot

Everything is inset from all four edges so there's real white space around the
card. Kept as one small post-processor so we don't fork the shared helper — call
it right before save_chart().
"""
from __future__ import annotations

from matplotlib.axes import Axes
from matplotlib.figure import Figure


def tidy(
    fig: Figure,
    ax: Axes,
    *,
    # Axes box (fraction of figure). Generous margins on every side = white space.
    top: float = 0.74,
    bottom: float = 0.19,
    left: float = 0.14,
    right: float = 0.90,
    # Stacked header (figure-fraction y positions, top -> down).
    header_x: float = 0.065,
    title_y: float = 0.945,
    subtitle_y: float = 0.898,   # small gap under the title
    legend_y: float = 0.840,     # small gap under the title+subtitle block
) -> None:
    """Reflow a helper-built figure: stacked header + even outer padding."""
    fig.subplots_adjust(top=top, bottom=bottom, left=left, right=right)

    texts = list(fig.texts)
    if len(texts) >= 1:
        texts[0].set_position((header_x, title_y))     # title
    if len(texts) >= 2:
        texts[1].set_position((header_x, subtitle_y))  # subtitle

    # Legend: pin its top-left corner just under the subtitle, left-aligned with
    # the header, in FIGURE coords so it lands there regardless of bar heights.
    legend = ax.get_legend()
    if legend is not None:
        legend.set_bbox_to_anchor((header_x, legend_y), transform=fig.transFigure)
        legend._loc = 2  # 2 = upper-left corner of the legend box sits on the anchor
