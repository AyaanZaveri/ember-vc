"use client"

import { MeshGradient } from "@paper-design/shaders-react"
import { AnimatePresence, motion } from "framer-motion"
import { useEffect, useState } from "react"

import { useTheme } from "@/components/theme-provider"

/**
 * The Ember ambient glow — the theme-aware MeshGradient wash behind the app.
 * Lifted verbatim from the original chat composer so the completeness surface
 * keeps the exact same background, just reused as a standalone layer.
 */
export function AmbientBackground({ intensity = "full" }: { intensity?: "full" | "soft" }) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const isDark = resolvedTheme === "dark"
  const gradientColors = isDark
    ? ["#ff4c00", "#c2410c", "#7c2d12", "#1c1917"]
    : ["#fff7ed", "#ffedd5", "#fed7aa", "#ff4c00"]

  const targetOpacity =
    intensity === "soft"
      ? isDark
        ? 0.22
        : 0.36
      : isDark
        ? 0.32
        : 0.58

  return (
    <AnimatePresence>
      {mounted && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: targetOpacity }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
        >
          <MeshGradient
            colors={gradientColors}
            speed={0.5}
            distortion={0.38}
            swirl={0.15}
            style={{ width: "100%", height: "100%" }}
          />
          <div className="absolute inset-0 bg-background/35" />
          {/* Radial wash to blend/soften edges in both dark and light modes */}
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle, transparent 16%, var(--background) 92%)`,
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
