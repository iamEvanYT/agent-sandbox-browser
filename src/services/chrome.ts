import { spawn, type Subprocess } from "bun";
import type { Config } from "../config";
import { cleanupChromeLocks } from "../runtime";
import { log } from "../log";

// Detect which browser binary to use
async function getBrowserBinary(): Promise<string> {
  // Check for google-chrome first (amd64), then chromium (arm64)
  const checkBinary = (binary: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const proc = spawn({
        cmd: ["which", binary],
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.exited.then((code) => resolve(code === 0));
    });
  };

  if (await checkBinary("google-chrome")) {
    return "google-chrome";
  }
  if (await checkBinary("chromium")) {
    return "chromium";
  }
  if (await checkBinary("chromium-browser")) {
    return "chromium-browser";
  }
  throw new Error("No supported browser found (google-chrome or chromium)");
}

export async function startChrome(cfg: Config): Promise<Subprocess> {
  cleanupChromeLocks(cfg.home);

  const browserBinary = await getBrowserBinary();
  log(`Using browser: ${browserBinary}`);

  const args = [
    ...(cfg.headless ? ["--headless=new", "--disable-gpu"] : []),
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${cfg.chromeCdpPort}`,
    `--user-data-dir=${cfg.home}/.chrome`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=TranslateUI",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--metrics-recording-only",
    "--no-sandbox",
    "--disable-background-networking",
    "--disable-component-update",
    "--enable-features=NetworkService,NetworkServiceInProcess",
    "--disable-blink-features=AutomationControlled",
    "about:blank",
  ];

  const proc = spawn({
    cmd: [browserBinary, ...args],
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      ...(cfg.headless ? {} : { DISPLAY: cfg.display }),
      HOME: cfg.home,
      XDG_CONFIG_HOME: `${cfg.home}/.config`,
      XDG_CACHE_HOME: `${cfg.home}/.cache`,
    },
  });

  // Wait for Chrome to be ready
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(
        `http://127.0.0.1:${cfg.chromeCdpPort}/json/version`,
        { signal: AbortSignal.timeout(1000) }
      );
      if (res.ok) {
        log(`Chrome is ready on port ${cfg.chromeCdpPort}`);
        return proc;
      }
    } catch {}
    await Bun.sleep(100);
  }

  log("Warning: Chrome may not be fully ready");
  return proc;
}
