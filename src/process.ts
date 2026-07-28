import type { Subprocess } from "bun";
import { log } from "./log";

export function isRunning(proc: Subprocess | null): boolean {
  if (!proc) return false;
  return proc.exitCode === null;
}

export async function killProcess(
  proc: Subprocess | null,
  name: string
): Promise<void> {
  if (!proc || !isRunning(proc)) return;

  log(`Stopping ${name}...`);
  proc.kill("SIGTERM");

  // Wait up to 5 seconds for graceful shutdown
  for (let i = 0; i < 50; i++) {
    if (!isRunning(proc)) return;
    await Bun.sleep(100);
  }

  // Force kill
  proc.kill("SIGKILL");
}
