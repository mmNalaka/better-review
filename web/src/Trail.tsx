import type { Hop } from "./hops";

/**
 * The chain from ticket 03 and 07: hops carry no digit (you can count the
 * links) but each carries the ring marker of the code it sits in, so leaving
 * changed code is visible without new vocabulary.
 */

interface TrailProps {
  readonly trail: readonly Hop[];
  readonly onJump: (index: number) => void;
  readonly onBackToChanges: () => void;
}

const label = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function Trail({ trail, onJump, onBackToChanges }: TrailProps) {
  if (trail.length === 0) return null;

  return (
    <div className="trail">
      <button className="trail-home" onClick={onBackToChanges}>
        ← the changes
      </button>
      {trail.map((hop, index) => (
        <span key={`${hop.path}:${hop.line}:${index}`} className="trail-link">
          <span className="sep">›</span>
          <button
            className={`hop${index === trail.length - 1 ? " here" : ""}${hop.stale ? " stale" : ""}`}
            onClick={() => onJump(index)}
            title={hop.stale ? "That symbol has moved" : `${hop.path}:${hop.line + 1}`}
          >
            <i className={`dot ${hop.ring === "changed" ? "r0" : "unk"}`} />
            {label(hop.path)}
            <span className="hop-line">:{hop.line + 1}</span>
          </button>
        </span>
      ))}
      {trail.length > 1 && (
        <span className="hopcount">
          {trail.length - 1} {trail.length === 2 ? "hop" : "hops"} in
        </span>
      )}
    </div>
  );
}
