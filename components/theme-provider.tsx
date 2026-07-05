"use client"

import * as React from "react"
import { flushSync } from "react-dom"
import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextTheme,
  type ThemeProviderProps,
} from "next-themes"

type Theme = "light" | "dark" | "system"
type ResolvedTheme = "light" | "dark"

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const THEME_STORAGE_KEY = "ember:theme"

function isTheme(theme: string | undefined): theme is Theme {
  return theme === "light" || theme === "dark" || theme === "system"
}

function isResolvedTheme(theme: string | undefined): theme is ResolvedTheme {
  return theme === "light" || theme === "dark"
}

function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme
      storageKey={THEME_STORAGE_KEY}
      {...props}
    >
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

function useTheme(): ThemeContextValue {
  const { theme, resolvedTheme, setTheme: setNextTheme } = useNextTheme()

  const setTheme = React.useCallback(
    (nextTheme: Theme) => {
      // Crossfade the whole document as a single snapshot so borders,
      // backgrounds, and color-scheme all change together — no per-element
      // transition storm, no desync between fills and borders.
      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => void
      }

      if (
        typeof window === "undefined" ||
        typeof doc.startViewTransition !== "function" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setNextTheme(nextTheme)
        return
      }

      doc.startViewTransition(() => {
        flushSync(() => setNextTheme(nextTheme))
      })
    },
    [setNextTheme]
  )

  return {
    theme: isTheme(theme) ? theme : "system",
    resolvedTheme: isResolvedTheme(resolvedTheme) ? resolvedTheme : "light",
    setTheme,
  }
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider }
export { useTheme }
