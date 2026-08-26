import { log } from "./log";

/** Minimal handle the supervisor needs. Bun's Subprocess satisfies this. */
export interface ProcessHandle {
  readonly exitCode: number | null;
  kill(signal?: string | number): void;
}

export function isRunning(proc: ProcessHandle | null | undefined): boolean {
  if (!proc) return false;
  return proc.exitCode === null;
}

export async function killProcess(
  proc: ProcessHandle | null | undefined,
  name: string,
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
