# Methodology & reproduction

## Pipeline

```
topics/*.gt.json        per-topic ground truth + domain→category allowlist
        │                (built independently via WebSearch, not Firecrawl)
        ▼
runners/orchestrate.ts  run each method on a topic (black box) → raw/<slug>.json
        │                 baseline       = Firecrawl /v2/search limit 50
        │                 operators      = fixed structural operator probes (no LLM):
        │                                  intitle:forum, inurl:forum,
        │                                  "magazine OR journal OR association",
        │                                  + exclude top-6 SEO-winner domains
        │                                  (no hardcoded sites — no site:reddit.com)
        │                 llm-operators  = same lever, but the NIM model writes the
        │                                  dork queries per topic
        │                 ember          = ember's discoverAndClassify (its own runner)
        ▼
runners/score.ts        RE-LABEL every URL with the shared labeler + allowlist,
        │                 compute metrics → labeled/<slug>.json, scores/<slug>.json
        ▼
runners/graphs.py       scores/*.json → figures/*.png|svg  (shared chart helper)
```

Raw capture and scoring are **decoupled on purpose**: improving the labeler or
the allowlist re-runs `score.ts` only — no Firecrawl/LLM credits are spent to
re-measure.

## Layout

| Path | What |
| --- | --- |
| `lib/normalize.ts` | URL canonicalization (shared by methods + GT) |
| `lib/labeler.ts` | the one method-agnostic source-type labeler |
| `topics/*.gt.json` | ground-truth long-tail URLs + per-topic allowlist |
| `runners/orchestrate.ts` | run methods on a topic, save raw URLs |
| `runners/score.ts` | relabel + score offline |
| `runners/graphs.py` | render figures |
| `raw/` `labeled/` `scores/` `figures/` | outputs at each stage |
| `findings/` | this writeup |

## Reproduce

```bash
# 1. run methods on each topic
#    needs FIRECRAWL_API_KEY; NVIDIA_NIM_API_KEY for llm-operators; ember uses its own .env
export FIRECRAWL_API_KEY=fc-...
export NVIDIA_NIM_API_KEY=nvapi-...
bun runners/orchestrate.ts "commercial espresso machine manufacturers" espresso
bun runners/orchestrate.ts "small business accounting software" accounting
bun runners/orchestrate.ts "commercial solar installation companies" solar

# 2. score (offline, no credits) + 3. graph
for s in espresso accounting solar; do bun runners/score.ts $s; done
python3 runners/graphs.py
```

`orchestrate.ts` takes an optional 3rd arg — a CSV of methods to (re)run — and
merges into the existing `raw/<slug>.json`, preserving the others. So you can add
or re-run one method without paying to re-run the rest:

```bash
bun runners/orchestrate.ts "commercial solar installation companies" solar operators
```

The Ember adapter is `Code/ember/tests/_eval_discover.ts` — it calls Ember's real
`discoverAndClassify` and prints the discovered source set as JSON. It runs the
same way Ember's own eval does (`node --env-file=.env …`); it does not start a
server or modify the product.

## Metrics

- **longTailExtractableDomains** — distinct long-tail domains you can actually
  scrape + cite (reddit/quora/youtube/etc. excluded). **Headline** — the usable
  completeness number.
- **longTailDomains** — all distinct domains labeled `trade_pub` / `regional_press`
  / `community_forum` / `niche_forum`, incl. non-extractable. Reported alongside.
- **longTailFraction** — longTailDomains ÷ total domains returned. Signal-to-noise.
- **categoryCoverage** — how many of the 4 wanted categories appear (0–4).
- **gtRecall** — exact-URL hits against the independent GT set (secondary; the GT
  set is intentionally small, so treat low values as "GT is incomplete," not
  "method found nothing").
- **emberAgreement** — for Ember only: how often its own classifier's keep/drop
  matches the shared labeler's long-tail call, on Ember's own output. Reported for
  transparency; not used to score completeness.
