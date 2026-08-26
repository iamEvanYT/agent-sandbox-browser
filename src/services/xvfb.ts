import { spawn, type Subprocess } from "bun";
import type { Config } from "../config";
import { cleanupXLocks } from "../runtime";
import { log } from "../log";

async function setVisibleXCursor(display: string): Promise<void> {
  const proc = spawn({
    cmd: ["xsetroot", "-display", display, "-cursor_name", "left_ptr"],
    stdout: "ignore",
    stderr: "ignore",
  });
  await Promise.race([proc.exited, Bun.sleep(500)]);
}

export async function startXvfb(cfg: Config): Promise<Subprocess> {
  cleanupXLocks(cfg.display);

  const proc = spawn({
    cmd: [
      "Xvfb",
      cfg.display,
      "-screen",
      "0",
      cfg.screen,
      "-ac",
      "-nolisten",
      "tcp",
    ],
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, DISPLAY: cfg.display },
  });

  for (let i = 0; i < 50; i++) {
    const check = spawn({
      cmd: ["xdpyinfo", "-display", cfg.display],
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await check.exited;
    if (exitCode === 0) {
      log("Xvfb is ready");
      await setVisibleXCursor(cfg.display);
      return proc;
    }
    await Bun.sleep(100);
  }

  log("Warning: Xvfb may not be fully ready");
  return proc;
}
