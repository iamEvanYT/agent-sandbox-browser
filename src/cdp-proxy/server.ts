import { parseSpeedMultiplier } from "../config";
import { startCdpProxyServer } from "./proxy";
import { createXPointer } from "./x-pointer";

const listenPort = Number(process.env.CDP_LISTEN_PORT ?? 9222);
const target = process.env.CDP_TARGET ?? "http://127.0.0.1:9223";
const humanize = process.env.ENABLE_HUMANIZE === "1";
const mouseSpeed = parseSpeedMultiplier(process.env.HUMANIZE_MOUSE_SPEED, 1);
const typeSpeed = parseSpeedMultiplier(process.env.HUMANIZE_TYPE_SPEED, 1);
const display =
  humanize && process.env.HUMANIZE_X_POINTER === "1"
    ? process.env.DISPLAY
    : undefined;

const server = startCdpProxyServer({
  listenPort,
  target,
  humanize,
  mouseSpeed,
  typeSpeed,
  movePointer: createXPointer(display),
});

console.error(
  `cdp-proxy listening on :${server.port} → ${target} humanize=${humanize ? "on" : "off"} mouseSpeed=${mouseSpeed} typeSpeed=${typeSpeed}`,
);

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`received ${signal}, closing cdp-proxy`);
  server.stop(true);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
