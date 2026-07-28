import { spawn, type Subprocess } from "bun";
import { config } from "../config";
import { cleanupXLocks } from "../cleanup";
import { log } from "../log";

export async function startXvfb(): Promise<Subprocess> {
  cleanupXLocks();

  const proc = spawn({
    cmd: [
      "Xvfb",
      config.display,
      "-screen",
      "0",
      "1280x800x24",
      "-ac",
      "-nolisten",
      "tcp",
    ],
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, DISPLAY: config.display },
  });

  // Wait for X server to be ready
  for (let i = 0; i < 50; i++) {
    const check = spawn({
      cmd: ["xdpyinfo", "-display", config.display],
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await check.exited;
    if (exitCode === 0) {
      log("Xvfb is ready");
      return proc;
    }
    await Bun.sleep(100);
  }

  log("Warning: Xvfb may not be fully ready");
  return proc;
}
