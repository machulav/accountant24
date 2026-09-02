import { describe, expect, it } from "vitest";
import { type ActiveCandidate, pickActiveIndex } from "../feature-scroll";

function candidate(index: number, isIntersecting: boolean, distanceToCenter: number): ActiveCandidate {
  return { index, isIntersecting, distanceToCenter };
}

describe("pickActiveIndex()", () => {
  it("should return the current index when there are no candidates", () => {
    expect(pickActiveIndex([], 2)).toBe(2);
  });

  it("should return the current index when no candidate intersects", () => {
    expect(pickActiveIndex([candidate(0, false, 10), candidate(1, false, 5)], 3)).toBe(3);
  });

  it("should return the sole intersecting candidate", () => {
    expect(pickActiveIndex([candidate(4, true, 900)], 0)).toBe(4);
  });

  it("should return the intersecting candidate nearest to the viewport center", () => {
    const candidates = [candidate(1, true, 300), candidate(2, true, 120), candidate(3, true, 480)];
    expect(pickActiveIndex(candidates, 0)).toBe(2);
  });

  it("should ignore a nearer candidate that does not intersect", () => {
    expect(pickActiveIndex([candidate(1, false, 10), candidate(2, true, 500)], 0)).toBe(2);
  });

  it("should return the first candidate on a distance tie", () => {
    expect(pickActiveIndex([candidate(1, true, 200), candidate(2, true, 200)], 0)).toBe(1);
  });
});
