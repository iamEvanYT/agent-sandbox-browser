import { log } from "./log";
import {
  isRunning,
  killProcess,
  type ProcessHandle,
} from "./process";

export interface ManagedService {
  readonly id: string;
  readonly displayName: string;
  readonly dependsOn: readonly string[];
  start(): Promise<ProcessHandle>;
}

export interface SupervisorOptions {
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Generic process supervisor: start in given order, restart a crashed
 * service together with everything that depends on it, shut down in
 * reverse-dependency waves.
 */
export class Supervisor {
  private readonly procs = new Map<string, ProcessHandle | null>();
  private stopped = false;
  private readonly pollMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly services: readonly ManagedService[],
    options: SupervisorOptions = {},
  ) {
    this.pollMs = options.pollMs ?? 2000;
    this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
  }

  async start(): Promise<void> {
    for (const svc of this.services) {
      const proc = await svc.start();
      this.procs.set(svc.id, proc);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    log("Shutting down...");
    for (const wave of shutdownWaves(this.services)) {
      await Promise.all(wave.map((svc) => this.kill(svc)));
    }
  }

  async monitor(): Promise<void> {
    while (!this.stopped) {
      await this.sleep(this.pollMs);
      if (this.stopped) break;

      for (const svc of this.services) {
        if (this.stopped) break;
        if (!isRunning(this.procs.get(svc.id))) {
          log(`${svc.displayName} crashed, restarting...`);
          await this.restartWithDependents(svc);
        }
      }
    }
  }

  /** Visible for tests. */
  handle(id: string): ProcessHandle | null {
    return this.procs.get(id) ?? null;
  }

  private async kill(svc: ManagedService): Promise<void> {
    await killProcess(this.procs.get(svc.id), svc.displayName);
    this.procs.set(svc.id, null);
  }

  private async restartWithDependents(svc: ManagedService): Promise<void> {
    if (this.stopped) return;
    const affected = this.affected(svc.id);
    for (const s of [...affected].reverse()) {
      await this.kill(s);
    }
    for (const s of affected) {
      if (this.stopped) return;
      const proc = await s.start();
      this.procs.set(s.id, proc);
    }
  }

  private affected(id: string): ManagedService[] {
    const ids = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of this.services) {
        if (!ids.has(s.id) && s.dependsOn.some((d) => ids.has(d))) {
          ids.add(s.id);
          changed = true;
        }
      }
    }
    return this.services.filter((s) => ids.has(s.id));
  }
}

/** Waves of services that nothing remaining depends on (leaves first). */
export function shutdownWaves(
  services: readonly ManagedService[],
): ManagedService[][] {
  const remaining = new Set(services.map((s) => s.id));
  const byId = new Map(services.map((s) => [s.id, s]));
  const waves: ManagedService[][] = [];

  while (remaining.size > 0) {
    const waveIds = [...remaining].filter((id) => {
      for (const other of remaining) {
        if (other === id) continue;
        if (byId.get(other)!.dependsOn.includes(id)) return false;
      }
      return true;
    });

    if (waveIds.length === 0) {
      waves.push([...remaining].map((id) => byId.get(id)!));
      break;
    }

    waves.push(waveIds.map((id) => byId.get(id)!));
    for (const id of waveIds) remaining.delete(id);
  }

  return waves;
}
