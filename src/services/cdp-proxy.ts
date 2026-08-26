import { spawn, type Subprocess } from "bun";
import { join } from "path";
import type { Config } from "../config";

export function startCdpProxy(cfg: Config): Subprocess {
  const serverPath = join(import.meta.dir, "../cdp-proxy/server.ts");
  return spawn({
    cmd: ["bun", "run", serverPath],
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      CDP_LISTEN_PORT: String(cfg.publicCdpPort),
      CDP_TARGET: `http://127.0.0.1:${cfg.chromeCdpPort}`,
      ENABLE_HUMANIZE: cfg.enableHumanize ? "1" : "0",
      HUMANIZE_MOUSE_SPEED: String(cfg.humanizeMouseSpeed),
      HUMANIZE_TYPE_SPEED: String(cfg.humanizeTypeSpeed),
      HUMANIZE_X_POINTER: cfg.enableHumanize && !cfg.headless ? "1" : "0",
      DISPLAY: cfg.headless ? "" : cfg.display,
    },
  });
}
