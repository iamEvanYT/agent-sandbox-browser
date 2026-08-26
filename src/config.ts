export interface Config {
  readonly headless: boolean;
  readonly enableNoVnc: boolean;
  readonly enableHumanize: boolean;
  readonly humanizeMouseSpeed: number;
  readonly humanizeTypeSpeed: number;
  readonly display: string;
  readonly home: string;
  /** Chrome's loopback CDP port (not published). */
  readonly chromeCdpPort: number;
  /** Public CDP port (humanizing proxy → chromeCdpPort). */
  readonly publicCdpPort: number;
  readonly vncPort: number;
  readonly noVncPort: number;
  readonly screen: string;
}

/** Speed 2 means delays are halved. Non-finite or <= 0 falls back. */
export function parseSpeedMultiplier(
  raw: string | undefined,
  fallback = 1,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function scaleDelayMs(delayMs: number, speed: number): number {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return delayMs / s;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const baseSpeed = parseSpeedMultiplier(env.HUMANIZE_SPEED, 1);
  return {
    headless: env.HEADLESS === "1",
    enableNoVnc: env.ENABLE_NOVNC !== "0",
    enableHumanize: env.ENABLE_HUMANIZE === "1",
    humanizeMouseSpeed: parseSpeedMultiplier(env.HUMANIZE_MOUSE_SPEED, baseSpeed),
    humanizeTypeSpeed: parseSpeedMultiplier(env.HUMANIZE_TYPE_SPEED, baseSpeed),
    display: ":1",
    home: "/home/agent",
    chromeCdpPort: 9223,
    publicCdpPort: 9222,
    vncPort: 5900,
    noVncPort: 6080,
    screen: "1280x800x24",
  };
}

export const config: Config = loadConfig();
