import { useCallback, useEffect, useState } from "react";
import type { BundledTheme } from "shiki";

import { ensureTheme, systemTheme } from "./highlighter";
import { deriveTokens, SYSTEM, THEMES, type ShikiThemeColours } from "./themes";

const KEY = "better-review:theme";

const read = (): string => {
  try {
    return localStorage.getItem(KEY) ?? SYSTEM;
  } catch {
    return SYSTEM;
  }
};

/**
 * The chosen editor theme, the app chrome derived from it, and re-derivation
 * when the system flips while set to "system".
 */
export function useTheme() {
  const [choice, setChoiceState] = useState<string>(read);
  const [resolved, setResolved] = useState<BundledTheme>(() =>
    read() === SYSTEM
      ? systemTheme()
      : (THEMES.find((t) => t.id === read())?.shiki ?? systemTheme()),
  );

  const setChoice = useCallback((next: string) => {
    setChoiceState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // remembering is a nicety
    }
  }, []);

  // Follow the OS while on "system".
  useEffect(() => {
    if (choice !== SYSTEM) {
      setResolved(THEMES.find((t) => t.id === choice)?.shiki ?? systemTheme());
      return;
    }
    const media = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setResolved(systemTheme());
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [choice]);

  // Paint the chrome from the editor theme's own colours.
  useEffect(() => {
    let live = true;
    void (async () => {
      const highlighter = await ensureTheme(resolved);
      if (!live) return;
      const tokens = deriveTokens(highlighter.getTheme(resolved) as ShikiThemeColours);
      const root = document.documentElement;
      for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
      root.dataset.theme = (highlighter.getTheme(resolved).type ?? "dark") === "dark" ? "dark" : "light";
    })();
    return () => {
      live = false;
    };
  }, [resolved]);

  return { choice, setChoice, resolved };
}
