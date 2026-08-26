import { config } from "./config";
import { log } from "./log";
import { ensureDirectories } from "./runtime";
import { isNovncEnabled } from "./plan";
import { Supervisor } from "./supervisor";
import { createManagedServices } from "./services";

async function main() {
  log("Starting agent sandbox...");

  const supervisor = new Supervisor(createManagedServices(config));

  let stopping = false;
  const onSignal = async () => {
    if (stopping) return;
    stopping = true;
    await supervisor.stop();
    process.exit(0);
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  ensureDirectories(config.home);
  await supervisor.start();

  log(`CDP proxy listening on port ${config.publicCdpPort}`);
  if (isNovncEnabled(config)) {
    log(`noVNC available on port ${config.noVncPort}`);
  }

  await supervisor.monitor();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
