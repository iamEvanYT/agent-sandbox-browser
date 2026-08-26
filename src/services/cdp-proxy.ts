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
      HUMANIZE_X_POINTER: cfg.headless ? "0" : "1",
      DISPLAY: cfg.headless ? "" : cfg.display,
    },
  });
}
