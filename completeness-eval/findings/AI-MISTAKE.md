# What the AI tools got wrong (and how I caught it)

The whole eval rests on one thing: the **shared labeler** that decides what
counts as a "long-tail source." AI-assisted code for that labeler shipped two
bugs that would have quietly corrupted every number. Both were caught by looking
at the actual labeled output instead of trusting the summary.

## Bug 1 — a topic-blind labeler that silently under-counted the long tail

The first labeler was written against the espresso topic, so its curated
`trade_pub` / `regional_press` domain lists were **coffee-specific**
(`sca.coffee`, `dailycoffeenews.com`, …). It looked complete and passed the
espresso spot-check. But when the same code ran on the accounting and solar
topics, it had **no way to recognize `accountingtoday.com`, `pv-magazine.com`,
`solarpowerworldonline.com`** as trade pubs — they fell through to `other`.

The summary still printed happily: every method scored ~0 long-tail on those
topics. That *looked* like a real finding ("nobody surfaces the long tail!") and
I almost wrote it up as one.

**How I caught it:** I dumped the full domain list per method
(`OTHER bucket` + `all domains`) instead of trusting the counts. Seeing
`solarpowerworldonline.com` sitting in a method's output but scored as *not*
long-tail made the bug obvious — the source was there; the labeler just didn't
know what it was.

**Fix:** the ground-truth step already had to identify these domains via the
independent WebSearch oracle, so I turned that into a per-topic
`domainCategories` allowlist (`topics/*.gt.json`) that the shared labeler
consults first — the same knowledge base applied identically to both methods.
That's not a patch on top of the design; it *is* the design that makes the
labeler topic-aware and fair.

## Bug 2 — a regex that invented regional-press hits

To catch US local-TV outlets (`wpri.com`, `kxan.com`), the AI suggested a
broadcast-callsign heuristic:

```ts
/\b(w|k)[a-z]{2,4}\.com$/   // "US broadcast callsigns"
```

It reads plausibly. It also matches **`wave.com`** — which in the accounting
topic is Wave, an accounting-software *vendor*. So Ember's output got a phantom
`regional_press` hit, inflating its long-tail score on exactly the topic where it
was otherwise weakest.

**How I caught it:** the per-method long-tail dump printed
`regional_press | wave.com`. A regional newspaper called "wave.com" is nonsense
on its face — the label didn't match the thing. Tracing it back to the regex took
one minute.

**Fix:** deleted the generic callsign regex entirely (kept a comment documenting
why), and relied on the curated set + per-topic allowlist for real local outlets.
Re-scored from the saved raw output — no new API calls, because raw URLs and
scoring are deliberately decoupled.

## The lesson

Both bugs produced **plausible, confident, wrong** numbers, and both were
invisible from the summary line. The only thing that surfaced them was reading
the row-level labeled output and asking "does this specific label actually match
this specific URL?" For an eval whose entire job is to be trustworthy, the
row-level audit isn't optional — it's the product.
