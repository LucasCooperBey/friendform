import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "friendform-theme";

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Storage can be unavailable in private modes.
  }
  return "system";
}

function systemIsDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyThemeClass(preference: ThemePreference): void {
  const dark = preference === "dark" || (preference === "system" && systemIsDark());
  document.documentElement.classList.toggle("dark", dark);
}

export function applyStoredTheme(): void {
  applyThemeClass(readPreference());
}

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  setOverride: (next: ThemePreference | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [override, setOverrideState] = useState<ThemePreference | null>(null);
  const effective = override ?? preference;

  useEffect(() => {
    applyThemeClass(effective);
    if (effective !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeClass("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [effective]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore blocked storage. The class still updates for this visit.
    }
  }, []);

  const setOverride = useCallback((next: ThemePreference | null) => {
    setOverrideState(next);
  }, []);

  const value = useMemo(
    () => ({ preference, setPreference, setOverride }),
    [preference, setPreference, setOverride],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
