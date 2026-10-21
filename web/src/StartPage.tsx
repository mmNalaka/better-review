import { useState } from "react";

import { CloneRoots } from "./CloneRoots";

/**
 * What the app shows before any pull request is named — no `?pr=` in the URL
 * and nothing passed on the command line. There is no default PR to fall back
 * to, so this is where a review starts.
 */

interface StartPageProps {
  readonly busy: boolean;
  readonly onOpen: (ref: string) => void;
}

export function StartPage({ busy, onOpen }: StartPageProps) {
  const [ref, setRef] = useState("");

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) onOpen(trimmed);
  };

  return (
    <main className="start">
      <div className="start-card">
        <h1 className="start-title">Read a pull request properly</h1>
        <p className="start-lede">
          Navigate by clicking function references, see how far each file sits from the change,
          tick hunks off as you read them, and publish the whole thing as a GitHub review.
        </p>

        <form
          className="prform start-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit(ref);
          }}
        >
          <input
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text").trim();
              if (!pasted) return;
              event.preventDefault();
              setRef(pasted);
              submit(pasted);
            }}
            placeholder="Paste a PR link, or owner/repo#123"
            aria-label="Pull request to open"
            spellCheck={false}
            autoFocus
          />
          <button type="submit" disabled={busy || ref.trim() === ""}>
            {busy ? "Opening…" : "Open"}
          </button>
        </form>

        <dl className="start-formats">
          <dt>Accepts</dt>
          <dd>
            <code>https://github.com/owner/repo/pull/123</code>
          </dd>
          <dd>
            <code>owner/repo#123</code>
          </dd>
          <dt>Or from a terminal</dt>
          <dd>
            <code>better-review owner/repo#123</code>
          </dd>
        </dl>

        <section className="start-foot">
          <h2 className="start-sub">Where your clones are found</h2>
          <CloneRoots />
          <p>
            Press <kbd>?</kbd> for how the review works and the keyboard shortcuts.
          </p>
        </section>
      </div>
    </main>
  );
}
