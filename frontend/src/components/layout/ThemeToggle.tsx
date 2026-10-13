import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme, type ThemePref } from "@/lib/theme";

const NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemePref, string> = { system: "System theme", light: "Light theme", dark: "Dark theme" };

/** Cycles system → light → dark (persisted in localStorage). */
export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  const Icon = pref === "system" ? Monitor : pref === "light" ? Sun : Moon;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setPref(NEXT[pref])}
      title={`${LABEL[pref]} (click for ${LABEL[NEXT[pref]].toLowerCase()})`}
      aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[NEXT[pref]]}`}
    >
      <Icon />
    </Button>
  );
}
