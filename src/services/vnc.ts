import { spawn, type Subprocess } from "bun";
import type { Config } from "../config";

export function startX11Vnc(cfg: Config): Subprocess {
  return spawn({
    cmd: [
      "x11vnc",
      "-display",
      cfg.display,
      "-rfbport",
      String(cfg.vncPort),
      "-shared",
      "-forever",
      "-nopw",
      "-localhost",
      "-cursor",
      "arrow",
    ],
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, DISPLAY: cfg.display },
  });
}

export function startNovnc(cfg: Config): Subprocess {
  return spawn({
    cmd: [
      "websockify",
      "--web",
      "/usr/share/novnc/",
      String(cfg.noVncPort),
      `localhost:${cfg.vncPort}`,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
}
