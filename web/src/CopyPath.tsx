import { useCallback } from "react";

import { useCopy } from "./clipboard";

/**
 * The open file's path, at the top of the app and copyable.
 * Shown here rather than only in the code-pane header, because that header is
 * hidden in "Diff only" mode and the path should never be unavailable.
 */

interface CopyPathProps {
  readonly path: string;
  /** 0-based; appended as `path:line` when present, matching editor convention. */
  readonly line?: number | null;
}

export function CopyPath({ path, line }: CopyPathProps) {
  const { state, copy: run } = useCopy();

  const copy = useCallback(
    (withLine: boolean) => void run(withLine && line != null ? `${path}:${line + 1}` : path),
    [path, line, run],
  );

  const dir = path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))}/` : "";
  const base = path.slice(path.lastIndexOf("/") + 1);

  return (
    <div className="copypath">
      <button
        className="copypath-path"
        onClick={() => copy(false)}
        title={`Copy ${path}`}
        aria-label={`Copy path ${path}`}
      >
        <span className="path-prefix">{dir}</span>
        <span className="path-base">{base}</span>
      </button>
      {line != null && (
        <button
          className="copypath-line"
          onClick={() => copy(true)}
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
