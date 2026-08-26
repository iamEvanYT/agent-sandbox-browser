import { describe, expect, test } from "bun:test";
import {
  Supervisor,
  shutdownWaves,
  type ManagedService,
} from "./supervisor";
import type { ProcessHandle } from "./process";

class FakeProc implements ProcessHandle {
  exitCode: number | null = null;
  signals: Array<string | number | undefined> = [];

  kill(signal?: string | number): void {
    this.signals.push(signal);
    this.exitCode = 0;
  }

  crash(): void {
    this.exitCode = 1;
  }
}

function fakeService(
  id: string,
  dependsOn: string[],
  starts: FakeProc[],
): ManagedService {
  return {
    id,
    displayName: id,
    dependsOn,
    start: async () => {
      const proc = new FakeProc();
      starts.push(proc);
      return proc;
    },
  };
}

describe("shutdownWaves", () => {
  test("kills leaves before roots", () => {
    const services = [
      fakeService("xvfb", [], []),
      fakeService("chrome", ["xvfb"], []),
      fakeService("proxy", [], []),
      fakeService("x11vnc", ["xvfb"], []),
      fakeService("novnc", ["x11vnc"], []),
    ];
    const waves = shutdownWaves(services).map((w) =>
      w.map((s) => s.id).sort(),
    );
    expect(waves[0]).toEqual(["chrome", "novnc", "proxy"]);
    expect(waves[1]).toEqual(["x11vnc"]);
    expect(waves[2]).toEqual(["xvfb"]);
  });
});

describe("Supervisor", () => {
  test("starts in plan order", async () => {
    const order: string[] = [];
    const services: ManagedService[] = ["a", "b", "c"].map((id) => ({
      id,
      displayName: id,
      dependsOn: [],
      start: async () => {
        order.push(id);
        return new FakeProc();
      },
    }));
    const sup = new Supervisor(services);
    await sup.start();
    expect(order).toEqual(["a", "b", "c"]);
    await sup.stop();
  });

  test("restarting a service also restarts its dependents", async () => {
    const xvfbStarts: FakeProc[] = [];
    const chromeStarts: FakeProc[] = [];
    const vncStarts: FakeProc[] = [];
    const proxyStarts: FakeProc[] = [];

    const services = [
      fakeService("xvfb", [], xvfbStarts),
      fakeService("chrome", ["xvfb"], chromeStarts),
      fakeService("proxy", [], proxyStarts),
      fakeService("x11vnc", ["xvfb"], vncStarts),
    ];

    let resume: () => void = () => {};
    const sleep = () =>
      new Promise<void>((resolve) => {
        resume = resolve;
      });

    const sup = new Supervisor(services, { pollMs: 1, sleep });
    await sup.start();
    expect(xvfbStarts.length).toBe(1);
    expect(chromeStarts.length).toBe(1);
    expect(vncStarts.length).toBe(1);
    expect(proxyStarts.length).toBe(1);

    const firstXvfb = xvfbStarts[0]!;
    const firstChrome = chromeStarts[0]!;
    const firstVnc = vncStarts[0]!;
    const firstProxy = proxyStarts[0]!;

    const monitor = sup.monitor();
    firstXvfb.crash();
    resume();
    await Bun.sleep(20);

    expect(xvfbStarts.length).toBe(2);
    expect(chromeStarts.length).toBe(2);
    expect(vncStarts.length).toBe(2);
    expect(proxyStarts.length).toBe(1);
    expect(firstChrome.signals.length).toBeGreaterThan(0);
    expect(firstVnc.signals.length).toBeGreaterThan(0);
    expect(firstProxy.signals.length).toBe(0);
    expect(sup.handle("chrome")).not.toBe(firstChrome);

    await sup.stop();
    resume();
    await monitor;
  });

  test("a leaf crash does not bounce its dependency", async () => {
    const xvfbStarts: FakeProc[] = [];
    const chromeStarts: FakeProc[] = [];
    const services = [
      fakeService("xvfb", [], xvfbStarts),
      fakeService("chrome", ["xvfb"], chromeStarts),
    ];

    let resume: () => void = () => {};
    const sleep = () =>
      new Promise<void>((resolve) => {
        resume = resolve;
      });

    const sup = new Supervisor(services, { pollMs: 1, sleep });
    await sup.start();
    const monitor = sup.monitor();
    const firstXvfb = xvfbStarts[0]!;
    chromeStarts[0]!.crash();
    resume();
    await Bun.sleep(20);

    expect(chromeStarts.length).toBe(2);
    expect(xvfbStarts.length).toBe(1);
    expect(firstXvfb.signals.length).toBe(0);

    await sup.stop();
    resume();
    await monitor;
  });
});
