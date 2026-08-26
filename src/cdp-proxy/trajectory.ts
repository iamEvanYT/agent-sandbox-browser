/**
 * Mouse path math ported from rewards-farmer src/mouse_trajectory.py.
 * Same cubic Bézier, distortion zones, logistic-sigmoid velocity, and Fitts
 * constants. No numpy; formulas are unchanged.
 */

export type Point = { x: number; y: number };
export type Interval = readonly [number, number];
/** rng() must return a number in [0, 1). */
export type Rng = () => number;

export const DEFAULT_INTERMEDIATE_RADIUS_INTERVAL: Interval = [20, 40];
export const DEFAULT_DEVIATION_INTERVAL: Interval = [1, 5];
export const DEFAULT_DISTORTION_ZONE_TIME_LENGTH = 0.05;
export const DEFAULT_DISTORTION_FREQUENCY = 0.15;
export const FITTS_LAW_A = 0.55;
export const FITTS_LAW_B = 0.1276;
export const SAME_SPOT_PX = 3;
export const DEFAULT_TARGET_WIDTH = 20;
export const SAMPLE_DT_SEC = 0.01;

export function randint(a: number, b: number, rng: Rng): number {
  return a + Math.floor(rng() * (b - a + 1));
}

export function randomAnysign(a: number, b: number, rng: Rng): number {
  const result = randint(a, b, rng);
  if (randint(0, 1, rng)) return -result;
  return result;
}

export function cubicBezierSingleCoordinate(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const firstCoeff = (1 - t) ** 3;
  const secondCoeff = 3 * t * (1 - t) ** 2;
  const thirdCoeff = 3 * (1 - t) * t ** 2;
  const fourthCoeff = t ** 3;
  return firstCoeff * p0 + secondCoeff * p1 + thirdCoeff * p2 + fourthCoeff * p3;
}

export function cubicBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  return {
    x: cubicBezierSingleCoordinate(p0.x, p1.x, p2.x, p3.x, t),
    y: cubicBezierSingleCoordinate(p0.y, p1.y, p2.y, p3.y, t),
  };
}

export function getBezierPath(
  start: Point,
  end: Point,
  rng: Rng,
  intermediateRadiusInterval: Interval = DEFAULT_INTERMEDIATE_RADIUS_INTERVAL,
): (t: number) => Point {
  const p0 = start;
  const p3 = end;
  const p1: Point = {
    x: p0.x + randomAnysign(intermediateRadiusInterval[0], intermediateRadiusInterval[1], rng),
    y: p0.y + randomAnysign(intermediateRadiusInterval[0], intermediateRadiusInterval[1], rng),
  };
  const p2: Point = {
    x: p3.x + randomAnysign(intermediateRadiusInterval[0], intermediateRadiusInterval[1], rng),
    y: p3.y + randomAnysign(intermediateRadiusInterval[0], intermediateRadiusInterval[1], rng),
  };
  return (t: number) => cubicBezier(p0, p1, p2, p3, t);
}

export function getDistortedBezierPath(
  start: Point,
  end: Point,
  rng: Rng,
  intermediateRadiusInterval: Interval = DEFAULT_INTERMEDIATE_RADIUS_INTERVAL,
  distortionZoneTimeLength: number = DEFAULT_DISTORTION_ZONE_TIME_LENGTH,
  distortionFrequency: number = DEFAULT_DISTORTION_FREQUENCY,
  deviationInterval: Interval = DEFAULT_DEVIATION_INTERVAL,
): (t: number) => Point {
  const zoneCount = Math.floor(1 / distortionZoneTimeLength);
  const distortionZones: Array<[number, number]> = [];
  for (let i = 0; i < zoneCount; i++) {
    if (rng() < distortionFrequency) {
      distortionZones.push([
        i * distortionZoneTimeLength,
        (i + 1) * distortionZoneTimeLength,
      ]);
    }
  }
  const distortionOffsets: Point[] = distortionZones.map(() => ({
    x: randomAnysign(deviationInterval[0], deviationInterval[1], rng),
    y: randomAnysign(deviationInterval[0], deviationInterval[1], rng),
  }));

  const bezierPath = getBezierPath(start, end, rng, intermediateRadiusInterval);

  return (t: number): Point => {
    const truePoint = bezierPath(t);
    for (let i = 0; i < distortionZones.length; i++) {
      const zone = distortionZones[i]!;
      if (t >= zone[0] && t <= zone[1]) {
        return distortPoint(truePoint, distortionOffsets[i]!, zone, t);
      }
    }
    return truePoint;
  };
}

function distortPoint(
  truePoint: Point,
  distortionOffset: Point,
  distortionZone: [number, number],
  t: number,
): Point {
  const distortionZoneLength = distortionZone[1] - distortionZone[0];
  const distortionZoneProgress = (t - distortionZone[0]) / distortionZoneLength;
  if (distortionZoneProgress < 0.5) {
    return {
      x: truePoint.x + distortionOffset.x * distortionZoneProgress * 2,
      y: truePoint.y + distortionOffset.y * distortionZoneProgress * 2,
    };
  }
  return {
    x: truePoint.x + distortionOffset.x * (1 - (distortionZoneProgress - 0.5) * 2),
    y: truePoint.y + distortionOffset.y * (1 - (distortionZoneProgress - 0.5) * 2),
  };
}

export function logisticSigmoid(x: number): number {
  return 2 / (1 + Math.exp(-x)) - 1;
}

export function getPathWithTransformedVelo(
  start: Point,
  end: Point,
  rng: Rng,
  intermediateRadiusInterval: Interval = DEFAULT_INTERMEDIATE_RADIUS_INTERVAL,
  distortionZoneTimeLength: number = DEFAULT_DISTORTION_ZONE_TIME_LENGTH,
  distortionFrequency: number = DEFAULT_DISTORTION_FREQUENCY,
  deviationInterval: Interval = DEFAULT_DEVIATION_INTERVAL,
): (t: number) => Point {
  const bezierPath = getDistortedBezierPath(
    start,
    end,
    rng,
    intermediateRadiusInterval,
    distortionZoneTimeLength,
    distortionFrequency,
    deviationInterval,
  );
  return (t: number) => bezierPath(logisticSigmoid(t));
}

export function getFinalPathFromRealTime(
  movementTime: number,
  start: Point,
  end: Point,
  rng: Rng,
  intermediateRadiusInterval: Interval = DEFAULT_INTERMEDIATE_RADIUS_INTERVAL,
  distortionZoneTimeLength: number = DEFAULT_DISTORTION_ZONE_TIME_LENGTH,
  distortionFrequency: number = DEFAULT_DISTORTION_FREQUENCY,
  deviationInterval: Interval = DEFAULT_DEVIATION_INTERVAL,
): (t: number) => Point {
  const path = getPathWithTransformedVelo(
    start,
    end,
    rng,
    intermediateRadiusInterval,
    distortionZoneTimeLength,
    distortionFrequency,
    deviationInterval,
  );
  return (t: number): Point => {
    if (t < 0) return start;
    if (t > movementTime) return end;
    const normalizedT = (t / movementTime) * 4.5;
    return path(normalizedT);
  };
}

export function getMovementTimeFromFittsLaw(
  distance: number,
  targetWidth: number,
): number {
  const indexOfDifficulty = Math.log2((2.0 * distance) / targetWidth);
  return FITTS_LAW_A + FITTS_LAW_B * indexOfDifficulty;
}

export function sampleTrajectory(
  start: Point,
  end: Point,
  rng: Rng = Math.random,
  targetWidth: number = DEFAULT_TARGET_WIDTH,
): { points: Point[]; delaysMs: number[]; movementTimeSec: number } {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (distance < SAME_SPOT_PX) {
    return { points: [{ ...end }], delaysMs: [0], movementTimeSec: 0 };
  }
  const movementTime = getMovementTimeFromFittsLaw(distance, targetWidth);
  if (!(movementTime > 0)) {
    return { points: [{ ...end }], delaysMs: [0], movementTimeSec: 0 };
  }
  const pathFn = getFinalPathFromRealTime(movementTime, start, end, rng);
  const points: Point[] = [];
  const delaysMs: number[] = [];
  const dt = SAMPLE_DT_SEC;
  for (let t = dt; t < movementTime; t += dt) {
    points.push(pathFn(t));
    delaysMs.push(dt * 1000);
  }
  points.push({ ...end });
  delaysMs.push(dt * 1000);
  return { points, delaysMs, movementTimeSec: movementTime };
}
