import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";
import { isNovncEnabled, planServices } from "./plan";

function ids(cfg: { headless: boolean; enableNoVnc: boolean }) {
  return planServices(cfg).map((s) => s.id);
}

function deps(
  cfg: { headless: boolean; enableNoVnc: boolean },
  id: string,
) {
  return planServices(cfg).find((s) => s.id === id)?.dependsOn ?? null;
}

describe("loadConfig", () => {
  test("defaults to headed with noVNC", () => {
    const cfg = loadConfig({});
    expect(cfg.headless).toBe(false);
    expect(cfg.enableNoVnc).toBe(true);
    expect(cfg.publicCdpPort).toBe(9222);
    expect(cfg.chromeCdpPort).toBe(9223);
  });

  test("HEADLESS=1 enables headless", () => {
    expect(loadConfig({ HEADLESS: "1" }).headless).toBe(true);
    expect(loadConfig({ HEADLESS: "0" }).headless).toBe(false);
  });

  test("ENABLE_NOVNC=0 disables noVNC", () => {
    expect(loadConfig({ ENABLE_NOVNC: "0" }).enableNoVnc).toBe(false);
    expect(loadConfig({ ENABLE_NOVNC: "1" }).enableNoVnc).toBe(true);
  });
});

describe("planServices", () => {
  test("headed + noVNC is display → browser → proxy → vnc stack", () => {
    expect(ids({ headless: false, enableNoVnc: true })).toEqual([
      "xvfb",
      "chrome",
      "cdp-proxy",
      "x11vnc",
      "novnc",
    ]);
    expect(deps({ headless: false, enableNoVnc: true }, "chrome")).toEqual([
      "xvfb",
    ]);
    expect(deps({ headless: false, enableNoVnc: true }, "x11vnc")).toEqual([
      "xvfb",
    ]);
    expect(deps({ headless: false, enableNoVnc: true }, "novnc")).toEqual([
      "x11vnc",
    ]);
    expect(deps({ headless: false, enableNoVnc: true }, "cdp-proxy")).toEqual(
      [],
    );
    expect(
      planServices({ headless: false, enableNoVnc: true }).find(
        (s) => s.id === "cdp-proxy",
      )?.displayName,
    ).toBe("CDP proxy");
  });

  test("headed without noVNC omits the vnc stack", () => {
    expect(ids({ headless: false, enableNoVnc: false })).toEqual([
      "xvfb",
      "chrome",
      "cdp-proxy",
    ]);
  });

  test("headless is chrome + proxy only, even if noVNC is requested", () => {
    expect(ids({ headless: true, enableNoVnc: true })).toEqual([
      "chrome",
      "cdp-proxy",
    ]);
    expect(ids({ headless: true, enableNoVnc: false })).toEqual([
      "chrome",
      "cdp-proxy",
    ]);
    expect(deps({ headless: true, enableNoVnc: true }, "chrome")).toEqual([]);
    expect(isNovncEnabled({ headless: true, enableNoVnc: true })).toBe(false);
  });
});

describe("planServices invariants", () => {
  test("every dependency is started before its dependent", () => {
    for (const cfg of [
      { headless: false, enableNoVnc: true },
      { headless: false, enableNoVnc: false },
      { headless: true, enableNoVnc: true },
    ]) {
      const plan = planServices(cfg);
      const index = new Map(plan.map((s, i) => [s.id, i]));
      for (const svc of plan) {
        for (const dep of svc.dependsOn) {
          expect(index.has(dep)).toBe(true);
          expect(index.get(dep)!).toBeLessThan(index.get(svc.id)!);
        }
      }
    }
  });
});
