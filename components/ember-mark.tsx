"use client"

import { FirecrawlHeat } from "@/components/fc-heat"

/**
 * The Ember wordmark — Firecrawl heat glyph + "Ember" heading with the soft
 * primary blur behind it. Lifted from the chat composer's EmberLogo so the
 * completeness surface keeps the same brand mark (minus the chat-only layout
 * animation, which isn't needed here).
 */
export function EmberMark({ className = "" }: { className?: string }) {
  return (
    <div className={`relative flex items-center gap-2 ${className} -ml-2.75`}>
      <div className="absolute -inset-x-5 inset-y-1 rounded-full bg-primary/10 blur-3xl dark:bg-primary/20" />
      <div className="relative -top-1 size-14 shrink-0">
        <FirecrawlHeat />
      </div>
      <h1 className="relative font-heading text-4xl font-semibold tracking-tight text-foreground select-none">
        Ember
      </h1>
    </div>
  )
}
