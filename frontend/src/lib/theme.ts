import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/lib/storage";

/** Theme preference: follow the OS, or a manual choice persisted in localStorage. */
export type ThemePref = "system" | "light" | "dark";

const KEY = "dipbuyer.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const listeners = new Set<() => void>();
let pref: ThemePref = parsePref(readStored(KEY));

function parsePref(v: string | null): ThemePref {
  return v === "light" || v === "dark" ? v : "system";
}

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

function isDark(): boolean {
  return pref === "dark" || (pref === "system" && systemDark());
}

function apply(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", isDark());
}

function emit(): void {
  apply();
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (pref === "system") emit();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      pref = parsePref(e.newValue);
      emit();
    }
  });
  apply();
}

export function setThemePref(next: ThemePref): void {
  pref = next;
  writeStored(KEY, next === "system" ? null : next);
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const snapshot = () => `${pref}:${isDark() ? "dark" : "light"}`;

export function useTheme(): { pref: ThemePref; dark: boolean; setPref: (p: ThemePref) => void } {
  const snap = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [p, mode] = snap.split(":") as [ThemePref, string];
  return { pref: p, dark: mode === "dark", setPref: setThemePref };
}
