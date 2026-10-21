import { CloneRoots } from "./CloneRoots";
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
          <h3>Where your clones are found</h3>
          <CloneRoots />
        </section>

        <section className="help-part">
          <h3>Reading</h3>
          <p>
            The explorer lists what the pull request changed. Click a file to open it; the diff sits
            beside the whole file so you can see a change in its surroundings. <b>Whole repo</b>{" "}
            switches to the full tree with the changed files marked in place.
          </p>
          <p>
            Click any symbol in the file pane to jump to where it is defined. Each jump adds a{" "}
            <b>hop</b> to the trail along the top. Going back — a click on a hop, <b>[</b>, or the
            browser's Back — returns to the line you clicked from, and the hops ahead stay until
            you jump somewhere new, so <b>]</b> or Forward takes you there again.{" "}
            <b>The changes</b> starts again. The <b>ring</b> beside a file says how far it sits
            from the change: <i>changed</i>, then ring 1 for what calls it, ring 2 for what calls
            that.
          </p>
          <p>
            Double-click a word (or drag across it) in the file pane to highlight every place it
            appears in that file. Click anywhere to clear it.
          </p>
          <p>
            <b>History</b> (or <b>h</b>) lists every commit that touched the open file, renames
            included. Pick one to lay that version beside the pull request head, side by side —{" "}
            <b>n</b> and <b>p</b> step between the changes, <b>Esc</b> goes back.
          </p>
        </section>

        <section className="help-part">
          <h3>Callers and reading order</h3>
          <p>
            <b>⌥-click</b> a symbol, or press <b>r</b> after clicking one, to list everything in the
            repo that calls it — or every reference, for something that is not a function. Callers
            in changed files come first; pick one to hop there, and Back returns you.
          </p>
          <p>
            Above the changed files, <b>callees first</b> orders them so code you read has already
            been seen where it is used, and <b>entry points first</b> starts where calls come in.
            Both come from the calls the blast radius found between changed files; files with no
            such calls stay at the end. <b>j</b> and <b>k</b> follow whichever order is chosen.
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
          <h3>Re-reviewing after a push</h3>
          <p>
            <b>Finish pass</b> remembers the head you have just read, and publishing a review does
            the same. When the author pushes again, a strip under the toolbar says how many commits
            arrived, whether history was rewritten, and how many hunks are <b>new</b>,{" "}
            <b>edited</b> or <b>gone</b>. <b>What's new</b> narrows the explorer to those files.
          </p>
          <p>
            An <b>edited</b> hunk is a rewrite of one you had ticked or noted: open its "what
            changed since" panel to see the version you read against this one, and carry its notes
            across. The page also checks GitHub every couple of minutes and offers a reload when
            something new lands.
          </p>
        </section>

        <section className="help-part">
          <h3>Description and conversation</h3>
          <p>
            The <b>comments</b> counter at the top opens the pull request's own description and
            conversation — its body, general comments, and review summaries GitHub already holds.
            It is read-only: nothing posted here comes from this panel.
          </p>
        </section>

        <section className="help-part">
          <h3>Existing review threads</h3>
          <p>
            Threads already on the pull request appear under the lines they were left on, with an
            accent-coloured rail, apart from your own flagged notes. Resolved threads start folded. Outdated
            ones, whose line has gone, are listed at the top of the file's hunks.
          </p>
          <p>
            <b>Reply</b>, <b>Resolve</b> and <b>Unresolve</b> post to GitHub at once. They are
            not held for your review. Threads are hidden while you are narrowed to one commit,
            because GitHub numbers their lines against the head.
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
