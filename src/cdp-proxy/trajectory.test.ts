import { describe, expect, test } from "bun:test";
import {
  cubicBezier,
  FITTS_LAW_A,
  FITTS_LAW_B,
  getMovementTimeFromFittsLaw,
  logisticSigmoid,
  sampleTrajectory,
  SAME_SPOT_PX,
} from "./trajectory";

function lcg(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

describe("cubicBezier", () => {
  test("t=0 is p0 and t=1 is p3", () => {
    const p0 = { x: 10, y: 20 };
    const p1 = { x: 40, y: 80 };
    const p2 = { x: 90, y: 70 };
    const p3 = { x: 200, y: 50 };
    expect(cubicBezier(p0, p1, p2, p3, 0)).toEqual(p0);
    expect(cubicBezier(p0, p1, p2, p3, 1)).toEqual(p3);
  });
});

describe("logisticSigmoid", () => {
  test("matches 2/(1+e^{-x})-1", () => {
    expect(logisticSigmoid(0)).toBeCloseTo(0, 10);
    expect(logisticSigmoid(4.5)).toBeCloseTo(2 / (1 + Math.exp(-4.5)) - 1, 10);
    expect(logisticSigmoid(20)).toBeCloseTo(1, 5);
  });
});

describe("Fitts law", () => {
  test("uses rewards-farmer a=0.5500 and b=0.1276", () => {
    expect(FITTS_LAW_A).toBe(0.55);
    expect(FITTS_LAW_B).toBe(0.1276);
  });

  test("MT = a + b * log2(2D/W)", () => {
    const distance = 100;
    const targetWidth = 20;
    const id = Math.log2((2.0 * distance) / targetWidth);
    expect(getMovementTimeFromFittsLaw(distance, targetWidth)).toBeCloseTo(
      0.55 + 0.1276 * id,
      10,
    );
  });
});

describe("sampleTrajectory", () => {
  test("same-spot clicks do not draw a huge arc", () => {
    const start = { x: 100, y: 100 };
    const end = { x: 101, y: 100 };
    const { points, movementTimeSec } = sampleTrajectory(start, end, lcg(1));
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(SAME_SPOT_PX);
    expect(movementTimeSec).toBe(0);
    expect(points).toEqual([end]);
    for (const p of points) {
      expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeLessThan(5);
    }
  });

  test("a long move ends on the target and bows off the straight line", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 200, y: 0 };
    const { points, delaysMs, movementTimeSec } = sampleTrajectory(
      start,
      end,
      lcg(42),
    );
    expect(movementTimeSec).toBeGreaterThan(0.5);
    expect(points.length).toBeGreaterThan(10);
    expect(points.at(-1)).toEqual(end);
    expect(delaysMs.length).toBe(points.length);
    const maxAbsY = Math.max(...points.map((p) => Math.abs(p.y)));
    expect(maxAbsY).toBeGreaterThan(5);
  });
});
