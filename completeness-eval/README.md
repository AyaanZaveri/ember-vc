# Completeness eval

An empirical test of the customer's #1 complaint: *what actually surfaces the
long tail (trade pubs, regional press, niche/community forums) that a plain
`search` at `limit: 50` buries?*

It runs four methods as black boxes across three topics — the **status-quo
baseline**, a fixed **search-operator** recipe (no LLM), the same operators but
**LLM-written**, and **Ember's LLM discovery pipeline** — labels every result
with one shared, method-agnostic labeler, and measures how many distinct
**usable** (extractable) long-tail sources each surfaces.

**Headline (usable long-tail domains, summed over 3 topics):**

| Baseline | Ember | LLM-operators | **Operators (fixed, no LLM)** |
| :-: | :-: | :-: | :-: |
| 0 | 4 | 8 | **32** |

A fixed, zero-LLM operator recipe beats everything — including the *same operators
written by an LLM* (which over-constrained the queries) and Ember's LLM pipeline.
The baseline's "long tail" was 0 usable (only non-scrapeable reddit). Operators
win *recall* but pull in some off-topic forums — exactly the precision gap Ember's
classifier is built to close. Takeaway for Ember: **probe with fixed operators,
filter with the classifier.**

Start with **[findings/RESULTS.md](findings/RESULTS.md)**. Repro in
[findings/METHODOLOGY.md](findings/METHODOLOGY.md). The AI-introduced labeling
bugs and how they were caught: [findings/AI-MISTAKE.md](findings/AI-MISTAKE.md).

![long-tail domains](figures/01_longtail_domains.png)
