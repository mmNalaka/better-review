import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The open file's path, at the top of the app and copyable.
 * Shown here rather than only in the code-pane header, because that header is
 * hidden in "Diff only" mode and the path should never be unavailable.
 */

const FEEDBACK_MS = 1400;

async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context and permission; fall back to a
    // hidden textarea so the button still works if it is unavailable.
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

interface CopyPathProps {
  readonly path: string;
  /** 0-based; appended as `path:line` when present, matching editor convention. */
  readonly line?: number | null;
}

export function CopyPath({ path, line }: CopyPathProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (withLine: boolean) => {
      const text = withLine && line != null ? `${path}:${line + 1}` : path;
      setState((await toClipboard(text)) ? "copied" : "failed");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), FEEDBACK_MS);
    },
    [path, line],
  );

  const dir = path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))}/` : "";
  const base = path.slice(path.lastIndexOf("/") + 1);

  return (
    <div className="copypath">
      <button
        className="copypath-path"
        onClick={() => void copy(false)}
        title={`Copy ${path}`}
        aria-label={`Copy path ${path}`}
      >
        <span className="path-prefix">{dir}</span>
        <span className="path-base">{base}</span>
      </button>
      {line != null && (
        <button
          className="copypath-line"
          onClick={() => void copy(true)}
          title={`Copy ${path}:${line + 1}`}
        >
          :{line + 1}
        </button>
      )}
      <span className={`copypath-said ${state}`} role="status">
        {state === "copied" ? "copied" : state === "failed" ? "copy failed" : ""}
      </span>
    </div>
  );
}
