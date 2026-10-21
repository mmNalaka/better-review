import { useEffect, useState } from "react";

import { loadConfig } from "./api";

/**
 * Where the server looks for local clones, and how to change it. Shown on the
 * start page and in help, because "no local clone found" is the first wall a
 * new user hits, and the fix is a setting they cannot see from the browser.
 */

export function CloneRoots() {
  const [roots, setRoots] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadConfig()
      .then((config) => live && setRoots(config.cloneRoots))
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="clone-roots">
      <p>
        Pull requests are read from a local clone. The server looks one level inside each clone
        root for a repo whose <code>origin</code> matches.
      </p>
      {roots && roots.length > 0 && (
        <p>
          Searching now:{" "}
          {roots.map((root, index) => (
            <span key={root}>
              {index > 0 && ", "}
              <code>{root}</code>
            </span>
          ))}
        </p>
      )}
      {error && <p className="notice">Could not read the server's settings: {error}</p>}
      <p>
        To look elsewhere, set <code>BR_CLONE_ROOTS</code> to a <code>:</code>-separated list and
        restart the server:
      </p>
      <pre className="clone-roots-cmd">BR_CLONE_ROOTS=~/work:~/code bun start</pre>
      <p>
        To keep it, add <code>export BR_CLONE_ROOTS=~/work:~/code</code> to your shell profile.
      </p>
    </div>
  );
}
