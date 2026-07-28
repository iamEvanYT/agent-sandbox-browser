import { spawn, type Subprocess } from "bun";
import { config } from "../config";

export function startX11Vnc(): Subprocess {
  return spawn({
    cmd: [
      "x11vnc",
      "-display",
      config.display,
      "-rfbport",
      "5900",
      "-shared",
      "-forever",
      "-nopw",
      "-localhost",
    ],
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, DISPLAY: config.display },
  });
}

export function startWebsockify(): Subprocess {
  return spawn({
    cmd: [
      "websockify",
      "--web",
      "/usr/share/novnc/",
      "6080",
      "localhost:5900",
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
}
