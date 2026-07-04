"use client"

import * as React from "react"
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
let transitionTimeout: number | undefined

function isTheme(theme: string | undefined): theme is Theme {
  return theme === "light" || theme === "dark" || theme === "system"
}

function isResolvedTheme(theme: string | undefined): theme is ResolvedTheme {
  return theme === "light" || theme === "dark"
}

function startThemeTransition() {
  if (typeof window === "undefined") {
    return
  }

  const root = document.documentElement

  root.classList.add("theme-transitioning")
  window.clearTimeout(transitionTimeout)
  transitionTimeout = window.setTimeout(() => {
    root.classList.remove("theme-transitioning")
  }, 220)
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
      startThemeTransition()
      setNextTheme(nextTheme)
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
