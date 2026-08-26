import type { Config } from "../config";
import { planServices, type ServiceId } from "../plan";
import type { ManagedService, ProcessHandle } from "../supervisor";
import { startXvfb } from "./xvfb";
import { startChrome } from "./chrome";
import { startCdpProxy } from "./cdp-proxy";
import { startX11Vnc, startNovnc } from "./vnc";

const starters: Record<
  ServiceId,
  (cfg: Config) => ProcessHandle | Promise<ProcessHandle>
> = {
  xvfb: startXvfb,
  chrome: startChrome,
  "cdp-proxy": startCdpProxy,
  x11vnc: startX11Vnc,
  novnc: startNovnc,
};

export function createManagedServices(cfg: Config): ManagedService[] {
  return planServices(cfg).map((entry) => ({
    ...entry,
    start: async () => starters[entry.id](cfg),
  }));
}
