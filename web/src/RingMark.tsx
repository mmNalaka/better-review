import type { FileRing } from "./useRings";

/**
 * Ticket 09: three rendered states, five causes. `working` is transient and
 * must never look like a permanent gap; `not applicable` is not a failure to
 * measure; `unknown` means we should have placed it and could not. The cause
 * shows on hover rather than earning a glyph.
 */

interface RingMarkProps {
  readonly ring: FileRing | undefined;
  readonly done: boolean;
}

export function RingMark({ ring, done }: RingMarkProps) {
  if (!ring) {
    return done ? (
      <span className="ringmark na" title="not applicable">–</span>
    ) : (
      <span className="ringmark working" title="working out the blast radius">◐</span>
    );
  }

  switch (ring.kind) {
    case "changed":
      return <span className="ringmark r0" title="changed by this pull request"><i className="dot r0" /></span>;
    case "ring":
      return (
        <span className={`ringmark r${Math.min(ring.ring ?? 1, 3)}`} title={`ring ${ring.ring}`}>
          <i className={`dot r${Math.min(ring.ring ?? 1, 3)}`} />
          {ring.ring}
        </span>
      );
    case "out-of-range":
      return <span className="ringmark out" title="out of range — no call path to the change">·</span>;
    case "unknown":
      return <span className="ringmark unk" title={`unknown — ${ring.reason ?? ""}`}>?</span>;
    case "not-applicable":
      return <span className="ringmark na" title="not applicable — no language server covers this file">–</span>;
  }
}
