import { GROUPS, SHORTCUTS } from "./shortcuts";

/**
 * What this app does and how to drive it.
 *
 * The shortcut table is generated from the same list the bindings use, so it
 * cannot describe a key that does nothing. The prose is the short version of
 * the README: enough to work the tool without leaving it.
 */

interface HelpProps {
  readonly onClose: () => void;
}

export function Help({ onClose }: HelpProps) {
  return (
    <aside className="help" aria-label="Help">
      <header className="commits-head">
        <span className="eyebrow">How this works</span>
        <button className="commits-close" onClick={onClose} title="Close — Esc">
          ×
        </button>
      </header>

      <div className="help-body">
        <section className="help-part">
          <h3>Reading</h3>
          <p>
            The explorer lists what the pull request changed. Click a file to open it; the diff sits
            beside the whole file so you can see a change in its surroundings. <b>Whole repo</b>{" "}
            switches to the full tree with the changed files marked in place.
          </p>
          <p>
            Click any symbol in the file pane to jump to where it is defined. Each jump adds a{" "}
            <b>hop</b> to the trail along the top — click a hop to go back to it, or{" "}
            <b>the changes</b> to start again. The <b>ring</b> beside a file says how far it sits
            from the change: <i>changed</i>, then ring 1 for what calls it, ring 2 for what calls
            that.
          </p>
        </section>

        <section className="help-part">
          <h3>Marking what you have read</h3>
          <p>
            Tick the box on a file's row to mark the whole file, or the box in a hunk's header bar
            for one hunk. A file reads <b>✓</b> when every hunk is ticked, <b>◑</b> when some are,
            and <b>⚠</b> when a hunk you had ticked has changed since — you did the work and the
            ground moved, which is not the same as unread.
          </p>
          <p>
            Marks are keyed to the content of a hunk, not its line numbers, so a rebase that only
            shifts code keeps your progress. They are saved as you go, per pull request.
          </p>
        </section>

        <section className="help-part">
          <h3>Commenting</h3>
          <p>
            Press <b>+</b> on any line in the diff. Drag down the gutter, or shift-click another
            line, to comment on a range. <b>⌘↵</b> saves, <b>Esc</b> cancels.
          </p>
          <p>
            <b>Suggest a change</b> fills the box with the lines you selected so you can edit them
            into what you would rather see. That is GitHub's own suggestion format, so it arrives
            with an "Apply suggestion" button on it.
          </p>
        </section>

        <section className="help-part">
          <h3>Submitting the review</h3>
          <p>
            Comments gather in the <b>⚑ findings</b> drawer rather than posting one at a time. When
            you are done, choose <b>Comment</b>, <b>Request changes</b> or <b>Approve</b>, and
            submit: they all go to GitHub as a single review.
          </p>
          <p>
            You always see exactly what will be posted, on the lines it will land on, before it
            goes — and nothing is sent until you confirm. A note whose code has changed since you
            wrote it is reported as skipped rather than posted somewhere it no longer fits.
          </p>
        </section>

        <section className="help-part">
          <h3>Keys</h3>
          {GROUPS.map((group) => (
            <div className="help-keys" key={group}>
              <span className="eyebrow">{group}</span>
              <dl>
                {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                  <div className="help-key" key={shortcut.key}>
                    <dt>
                      <kbd>{shortcut.shown}</kbd>
                    </dt>
                    <dd>{shortcut.does}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          <p className="help-note">
            Keys are ignored while you are typing, so <b>c</b> in a comment is just a letter.
          </p>
        </section>
      </div>
    </aside>
  );
}
