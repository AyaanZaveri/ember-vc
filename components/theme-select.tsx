"use client"

import * as React from "react"
import { Laptop, Moon, Sun } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const THEMES = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "system", label: "System", Icon: Laptop },
] as const

type ThemeId = (typeof THEMES)[number]["id"]

function isThemeId(value: string): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

export function ThemeSelect() {
  const { theme, setTheme } = useTheme()

  const currentTheme = theme ?? "system"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          aria-label="Change theme"
        >
          <Sun className="rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            value={currentTheme}
            onValueChange={(value) => {
              if (isThemeId(value)) {
                setTheme(value)
              }
            }}
          >
            {THEMES.map(({ id, label, Icon }) => (
              <DropdownMenuRadioItem key={id} value={id}>
                <Icon />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
