"use client"

import { memo } from "react"

import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselItem,
  InlineCitationCarouselNext,
  InlineCitationCarouselPrev,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation"
import {
  parseTextWithCitations,
  normalizeCitationMarkers,
  resolveFaviconUrl,
  type ParsedSource,
  type TextSegment,
} from "@/lib/ai/citations"
import { MessageResponse } from "@/components/ai-elements/message"

// ---------------------------------------------------------------------------
// Single citation pill (one or more sources merged into one badge)
// ---------------------------------------------------------------------------

interface CitationGroupProps {
  /** Raw marker text, e.g. "[1][2]". Used as human-readable label. */
  raw: string
  /** 0-based indices resolved from the raw marker. */
  indices: number[]
  /** All known sources for this message. */
  sources: ParsedSource[]
}

const CitationGroup = memo(function CitationGroup({
  raw,
  indices,
  sources,
}: CitationGroupProps) {
  // Resolve sources for this citation group, skipping out-of-range indices
  const citationSources = indices
    .map((i) => sources[i])
    .filter((s): s is ParsedSource => s !== undefined)

  if (citationSources.length === 0) {
    // Unknown citation — render as plain text so content stays readable
    return <span>{raw}</span>
  }

  const sourceUrls = citationSources.map((s) => s.url)

  const showCarouselNav = citationSources.length > 1

  return (
    <InlineCitation>
      <InlineCitationCard>
        <InlineCitationCardTrigger
          sources={sourceUrls}
          favicon={citationSources[0] ? resolveFaviconUrl(citationSources[0], 32) : undefined}
          className="-mt-2"
        />
        <InlineCitationCardBody className="bg-background/50 shadow-xl/5 backdrop-blur-sm">
          <InlineCitationCarousel>
            {showCarouselNav && (
              <InlineCitationCarouselHeader>
                <InlineCitationCarouselPrev />
                <InlineCitationCarouselIndex />
                <InlineCitationCarouselNext />
              </InlineCitationCarouselHeader>
            )}
            <InlineCitationCarouselContent>
              {citationSources.map((source, i) => (
                <InlineCitationCarouselItem key={`${source.url}-${i}`}>
                  <InlineCitationSource
                    description={source.description}
                    favicon={resolveFaviconUrl(source, 64)}
                    title={source.title}
                    url={source.url}
                  />
                </InlineCitationCarouselItem>
              ))}
            </InlineCitationCarouselContent>
          </InlineCitationCarousel>
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  )
})

export function SourceCitation({
  raw,
  sources,
}: {
  raw?: string
  sources: ParsedSource[]
}) {
  const indices = sources.map((_, index) => index)
  const fallbackRaw =
    raw ?? sources.map((_, index) => `[${index + 1}]`).join("")

  return <CitationGroup indices={indices} raw={fallbackRaw} sources={sources} />
}

function collectCitationGroups(segments: TextSegment[]) {
  const indices: number[] = []
  const seen = new Set<number>()

  for (const segment of segments) {
    if (segment.kind !== "citation") {
      continue
    }

    for (const index of segment.indices) {
      if (seen.has(index)) {
        continue
      }

      seen.add(index)
      indices.push(index)
    }
  }

  if (indices.length === 0) {
    return []
  }

  return [
    {
      raw: indices.map((index) => `[${index + 1}]`).join(""),
      indices,
    },
  ]
}

export function CitationAwareMarkdown({
  text,
  sources,
}: {
  text: string
  sources: ParsedSource[]
}) {
  const segments = parseTextWithCitations(text)

  if (segments.length === 0) {
    return null
  }

  const citationGroups = collectCitationGroups(segments)
  const textWithoutInlineCitations = stripCitationMarkersForMarkdown(text)

  return (
    <>
      <MessageResponse
        className={`inline [&>*:last-child]:inline ${
          citationGroups.length > 0 ? "mr-1" : ""
        }`}
      >
        {textWithoutInlineCitations}
      </MessageResponse>
      {citationGroups.length > 0 ? (
        <span className="inline-flex flex-wrap items-baseline gap-x-1 align-baseline">
          {citationGroups.map((group, index) => (
            <CitationGroup
              indices={group.indices}
              key={`${group.raw}-${index}`}
              raw={group.raw}
              sources={sources}
            />
          ))}
        </span>
      ) : null}
    </>
  )
}

export function stripCitationMarkersForMarkdown(text: string): string {
  text = normalizeCitationMarkers(text)

  return text
    .replace(/\s*\[\d+\](?:\s*\[\d+\])*/g, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
}
