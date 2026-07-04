"use client"

import { motion, useInView } from "motion/react"
import { useMemo, useRef, type CSSProperties } from "react"

import { cn } from "@/lib/utils"

type ShimmeringTextProps = {
  text: string
  duration?: number
  delay?: number
  repeat?: boolean
  repeatDelay?: number
  className?: string
  startOnView?: boolean
  once?: boolean
  inViewMargin?: string
  spread?: number
  color?: string
  shimmerColor?: string
}

export function ShimmeringText({
  text,
  duration = 2,
  delay = 0,
  repeat = true,
  repeatDelay = 0.5,
  className,
  startOnView = true,
  once = false,
  inViewMargin,
  spread = 2,
  color = "var(--muted-foreground)",
  shimmerColor = "var(--primary)",
}: ShimmeringTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  type InViewOptions = NonNullable<Parameters<typeof useInView>[1]>
  const isInView = useInView(ref, {
    margin: inViewMargin as InViewOptions["margin"],
    once,
  })
  const shouldAnimate = startOnView ? isInView : true
  const dynamicSpread = useMemo(() => text.length * spread, [spread, text])

  return (
    <motion.span
      ref={ref}
      animate={
        shouldAnimate
          ? {
              backgroundPosition: "0% center",
            }
          : undefined
      }
      className={cn(
        "inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        className
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "linear-gradient(90deg, transparent calc(50% - var(--spread)), var(--shimmer-color), transparent calc(50% + var(--spread))), linear-gradient(var(--text-color), var(--text-color))",
          "--text-color": color,
          "--shimmer-color": shimmerColor,
        } as CSSProperties
      }
      transition={{
        delay,
        duration,
        ease: "linear",
        repeat: repeat ? Number.POSITIVE_INFINITY : 0,
        repeatDelay,
      }}
    >
      {text}
    </motion.span>
  )
}
