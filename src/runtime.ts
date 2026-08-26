import { unlinkSync, rmSync, mkdirSync, existsSync } from "fs";

export function ensureDirectories(home: string): void {
  const dirs = [
    home,
    `${home}/.chrome`,
    `${home}/.config`,
    `${home}/.cache`,
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function x11LockPaths(display: string): {
  lockFile: string;
  socket: string;
} {
  const n = display.startsWith(":") ? display.slice(1) : display;
  return {
    lockFile: `/tmp/.X${n}-lock`,
    socket: `/tmp/.X11-unix/X${n}`,
  };
}

export function cleanupXLocks(display: string): void {
  const { lockFile, socket } = x11LockPaths(display);
  try {
    unlinkSync(lockFile);
  } catch {
    // missing lock is fine
  }
  try {
    rmSync(socket, { force: true });
  } catch {
    // missing socket is fine
  }
}

export const CHROME_LOCK_NAMES = [
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
] as const;

export function cleanupChromeLocks(home: string): void {
  const chromeDir = `${home}/.chrome`;
  for (const file of CHROME_LOCK_NAMES) {
    try {
      unlinkSync(`${chromeDir}/${file}`);
    } catch {
      // missing lock is fine
    }
  }
}
