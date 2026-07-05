# Completeness eval

An eval harness testing the customer's #1 complaint: *what actually surfaces
the long tail (trade pubs, regional press, niche/community forums) that a
plain `search` at `limit: 50` buries?*

It runs four methods as black boxes across three topics — the **status-quo
baseline**, a fixed **search-operator** recipe (no LLM), the same operators but
**LLM-written**, and **Ember's LLM discovery pipeline** — labels every result
with one shared, method-agnostic labeler, and measures how many distinct
**usable** (extractable) long-tail sources each surfaces.

Full writeup (results, methodology, and the AI-introduced labeling bugs) is
summarized in the root [ONEPAGER.md](../ONEPAGER.md).

## Reading the numbers: what the labeler does and doesn't measure

The fixed operator recipe surfaces more usable long-tail sources than Ember's
current discovery loop, but the two numbers aren't counting the same thing.

The shared labeler that scores every method never checks whether a result is
actually relevant to the topic, only whether the URL looks like a forum or
trade pub (curated domain lists + regex on the host/path, no LLM, no page
content). The fixed-operator and LLM-operator methods hand the labeler
whatever they find and stop there, so a forum thread that matches
`intitle:forum` but isn't actually about the query still counts. Ember, by
contrast, runs every candidate through its own relevance floor and classifier
before counting it as found, which is stricter than what this eval measures.
So part of the gap is the fixed recipe getting credit for off-topic noise
Ember correctly throws away, not real coverage Ember is missing.

Part of the gap is real, though, and worth naming plainly:

1. The fixed recipe re-searches while excluding the SEO-winner domains it
   already found. Ember's category probes never do this, and it's the single
   move that maps most directly onto the customer's complaint.
2. Ember only runs 3 category probes at limit 8 each. The fixed recipe runs 5
   probes, including the base query, at limit 10 to 20.

Ember is already a hybrid of the two candidates, not a pick between them:
fixed operator templates like the winning recipe, but narrower, plus
LLM-supplied topic vocabulary (never LLM-written operator syntax, that was
tested and rejected), plus its own relevance and classifier filtering neither
candidate has. The fix is narrow: fold the exclude-and-research probe into
`lib/completeness/category-probes.ts` and widen the existing probe limits.

## What's in this folder

| Path | What |
| --- | --- |
| `topics/*.gt.json` | Per-topic ground truth: ground-truth long-tail URLs plus a domain-to-category allowlist, built independently via web search. |
| `raw/` | Raw captured URLs per topic, one entry per method, from `runners/orchestrate.ts`. |
| `lib/labeler.ts` | The one shared, method-agnostic source-type labeler used to score every method's output identically. |
| `labeled/` | Every raw URL relabeled by the shared labeler. |
| `scores/` | Computed metrics per topic: long-tail counts, category coverage, ground-truth recall. |
| `runners/orchestrate.ts` | Runs each method (baseline, fixed operators, LLM-written operators, Ember) as a black box and writes `raw/`. |
| `runners/score.ts` | Offline scorer: relabels `raw/` and writes `labeled/` and `scores/`, no API calls, so re-scoring never costs credits. |
| `runners/graphs.py` | Renders `figures/` from `scores/`. |
| `figures/` | Chart outputs from `graphs.py`. |
