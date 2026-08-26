export interface Config {
  readonly headless: boolean;
  readonly enableNoVnc: boolean;
  readonly display: string;
  readonly home: string;
  /** Chrome's loopback CDP port (not published). */
  readonly chromeCdpPort: number;
  /** Public CDP port (socat proxy → chromeCdpPort). */
  readonly publicCdpPort: number;
  readonly vncPort: number;
  readonly noVncPort: number;
  readonly screen: string;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  return {
    headless: env.HEADLESS === "1",
    enableNoVnc: env.ENABLE_NOVNC !== "0",
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
