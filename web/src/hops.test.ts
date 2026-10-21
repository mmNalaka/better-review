import { describe, expect, test } from "bun:test";

import {
  NO_WALK,
  decodeTrail,
  encodeTrail,
  hereOf,
  moveTo,
  pushHop,
  startTrail,
  type Hop,
  type Walk,
} from "./hops";

const hop = (path: string, line: number): Hop => ({ path, line, ring: "unknown" });

/** a.ts → b.ts → c.ts, standing on c.ts. */
const walked = (): Walk => {
  const start = startTrail(hop("a.ts", 0));
  const second = pushHop(start, 12, hop("b.ts", 40));
  return pushHop(second, 55, hop("c.ts", 7));
};

describe("walking the trail", () => {
  test("an explorer click starts at hop zero", () => {
    const walk = startTrail(hop("a.ts", 0));
    expect(walk.hops).toHaveLength(1);
    expect(hereOf(walk)?.path).toBe("a.ts");
  });

  test("nothing is open before the first hop", () => {
    expect(hereOf(NO_WALK)).toBeNull();
  });

  test("a jump remembers the line it was clicked from", () => {
    const walk = walked();
    expect(walk.hops.map((h) => `${h.path}:${h.line}`)).toEqual(["a.ts:12", "b.ts:55", "c.ts:7"]);
    expect(walk.at).toBe(2);
  });

  test("going back keeps the hops ahead, so forward still works", () => {
    const back = moveTo(walked(), 0);
    expect(hereOf(back)?.path).toBe("a.ts");
    expect(hereOf(back)?.line).toBe(12);
    expect(back.hops).toHaveLength(3);
    expect(hereOf(moveTo(back, 1))?.path).toBe("b.ts");
  });

  test("diverging from a hop behind you discards what was ahead", () => {
    const diverged = pushHop(moveTo(walked(), 0), 30, hop("d.ts", 3));
    expect(diverged.hops.map((h) => `${h.path}:${h.line}`)).toEqual(["a.ts:30", "d.ts:3"]);
    expect(diverged.at).toBe(1);
  });

  test("moving past either end stays put", () => {
    const walk = walked();
    expect(moveTo(walk, 9)).toBe(walk);
    expect(moveTo(moveTo(walk, 0), -1).at).toBe(0);
  });

  test("walking never changes the walk it was given", () => {
    const walk = walked();
    const before = JSON.stringify(walk);
    pushHop(moveTo(walk, 1), 99, hop("e.ts", 1));
    expect(JSON.stringify(walk)).toBe(before);
  });
});

describe("the trail in the URL", () => {
  const changed = new Set(["b.ts"]);

  test("round-trips the hops and where you stand", () => {
    const back = moveTo(walked(), 1);
    const { trail, at } = encodeTrail(back);
    const restored = decodeTrail(trail, at, changed);
    expect(restored.hops.map((h) => `${h.path}:${h.line}`)).toEqual(["a.ts:12", "b.ts:55", "c.ts:7"]);
    expect(restored.at).toBe(1);
    expect(restored.hops[1]?.ring).toBe("changed");
  });

  test("standing on the last hop leaves the position out", () => {
    expect(encodeTrail(walked()).at).toBeNull();
  });

  test("an old link without a position stands on the last hop", () => {
    expect(decodeTrail("a.ts:1,b.ts:2", null, changed).at).toBe(1);
  });

  test("a position out of range is clamped", () => {
    expect(decodeTrail("a.ts:1,b.ts:2", "7", changed).at).toBe(1);
    expect(decodeTrail("a.ts:1,b.ts:2", "nope", changed).at).toBe(1);
  });

  test("no trail is no walk", () => {
    expect(decodeTrail(null, null, changed)).toEqual(NO_WALK);
    expect(encodeTrail(NO_WALK)).toEqual({ trail: null, at: null });
  });
});
