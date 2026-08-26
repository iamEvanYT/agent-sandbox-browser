import { startCdpProxyServer } from "./proxy";
import { createXPointer } from "./x-pointer";

const listenPort = Number(process.env.CDP_LISTEN_PORT ?? 9222);
const target = process.env.CDP_TARGET ?? "http://127.0.0.1:9223";
const display =
  process.env.HUMANIZE_X_POINTER === "1" ? process.env.DISPLAY : undefined;

const server = startCdpProxyServer({
  listenPort,
  target,
  movePointer: createXPointer(display),
});

console.error(`cdp-proxy listening on :${server.port} → ${target}`);

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
