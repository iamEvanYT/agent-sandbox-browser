import type { Config } from "./config";

export const SERVICE_IDS = [
  "xvfb",
  "chrome",
  "cdp-proxy",
  "x11vnc",
  "novnc",
] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];

export interface ServicePlanEntry {
  readonly id: ServiceId;
  readonly displayName: string;
  readonly dependsOn: readonly ServiceId[];
}

export function isNovncEnabled(
  cfg: Pick<Config, "headless" | "enableNoVnc">,
): boolean {
  return cfg.enableNoVnc && !cfg.headless;
}

/**
 * Which processes run, in start order, with process-level dependencies.
 *
 * Headless: Chrome does not need X, so Xvfb/VNC stay out of the plan.
 * CDP proxy (socat) is process-independent of Chrome — it reconnects per
 * connection — so a Chrome restart does not bounce the proxy.
 */
export function planServices(
  cfg: Pick<Config, "headless" | "enableNoVnc">,
): ServicePlanEntry[] {
  const plan: ServicePlanEntry[] = [];

  if (!cfg.headless) {
    plan.push({ id: "xvfb", displayName: "Xvfb", dependsOn: [] });
  }

  plan.push({
    id: "chrome",
    displayName: "Chrome",
    dependsOn: cfg.headless ? [] : ["xvfb"],
  });

  plan.push({
    id: "cdp-proxy",
    displayName: "socat",
    dependsOn: [],
  });

  if (isNovncEnabled(cfg)) {
    plan.push({ id: "x11vnc", displayName: "x11vnc", dependsOn: ["xvfb"] });
    plan.push({
      id: "novnc",
      displayName: "websockify",
      dependsOn: ["x11vnc"],
    });
  }

  return plan;
}
