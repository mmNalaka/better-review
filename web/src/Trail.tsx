import type { Walk } from "./hops";

/**
 * The chain from ticket 03 and 07: hops carry no digit (you can count the
 * links) but each carries the ring marker of the code it sits in, so leaving
 * changed code is visible without new vocabulary. Hops ahead of where you
 * stand stay on the chain, dimmed, until you diverge from them.
 */

interface TrailProps {
  readonly walk: Walk;
  readonly onJump: (index: number) => void;
  readonly onBackToChanges: () => void;
}

const label = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function Trail({ walk, onJump, onBackToChanges }: TrailProps) {
  const { hops, at } = walk;
  if (hops.length === 0) return null;

  return (
    <div className="trail">
      <button className="trail-home" onClick={onBackToChanges}>
        ← the changes
      </button>
      {hops.map((hop, index) => (
        <span key={`${hop.path}:${hop.line}:${index}`} className="trail-link">
          <span className="sep">›</span>
          <button
            className={`hop${index === at ? " here" : index > at ? " ahead" : ""}${
              hop.stale ? " stale" : ""
            }`}
            onClick={() => onJump(index)}
            title={hop.stale ? "That symbol has moved" : `${hop.path}:${hop.line + 1}`}
          >
            <i className={`dot ${hop.ring === "changed" ? "r0" : "unk"}`} />
            {label(hop.path)}
            <span className="hop-line">:{hop.line + 1}</span>
          </button>
        </span>
      ))}
      {at > 0 && (
        <span className="hopcount" title="[ and ] step back and forward along the trail">
          {at} {at === 1 ? "hop" : "hops"} in
        </span>
      )}
    </div>
  );
}
