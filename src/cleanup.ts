import { unlinkSync, rmSync, mkdirSync, existsSync } from "fs";
import { config } from "./config";

export function cleanupXLocks() {
  try {
    unlinkSync("/tmp/.X1-lock");
  } catch {}
  try {
    rmSync("/tmp/.X11-unix/X1", { force: true });
  } catch {}
}

export function cleanupChromeLocks() {
  const chromeDir = `${config.home}/.chrome`;
  for (const file of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      unlinkSync(`${chromeDir}/${file}`);
    } catch {}
  }
}

export function ensureDirectories() {
  const dirs = [
    config.home,
    `${config.home}/.chrome`,
    `${config.home}/.config`,
    `${config.home}/.cache`,
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
