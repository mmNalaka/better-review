import { useCallback, useEffect, useRef, useState } from "react";

/** Copying, in one place: the path in the mode bar and the branches share it. */

const FEEDBACK_MS = 1400;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The Clipboard API needs a secure context and permission; fall back to a
    // hidden textarea so the control still works without one.
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(field);
      return ok;
    } catch {
      return false;
    }
  }
}

export type CopyState = "idle" | "copied" | "failed";

export function useCopy() {
  const [state, setState] = useState<CopyState>("idle");
  const [what, setWhat] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string, label?: string) => {
    setState((await copyText(text)) ? "copied" : "failed");
    setWhat(label ?? null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState("idle");
      setWhat(null);
    }, FEEDBACK_MS);
  }, []);

  return { state, what, copy };
}
