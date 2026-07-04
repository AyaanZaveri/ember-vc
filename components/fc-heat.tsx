"use client"

// import { Heatmap } from "@paper-design/shaders-react"

export function FirecrawlHeat() {
  return (
    <div className="relative size-full overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/firecrawl-logo-orange.svg"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-contain scale-[1.17]"
        draggable={false}
      />
      {/* <Heatmap
        className="absolute inset-0 h-full w-full"
        width="100%"
        height="100%"
        image="/firecrawl-logo-bw.svg"
        colors={["#ff8652", "#ff4d00"]}
        colorBack="#00000000"
        contour={0.5}
        angle={0}
        innerGlow={0.5}
        outerGlow={0.12}
        speed={1}
        scale={1.16}
      /> */}
    </div>
  )
}
