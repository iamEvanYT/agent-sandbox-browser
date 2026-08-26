import { spawn, type Subprocess } from "bun";
import type { Config } from "../config";

export function startCdpProxy(cfg: Config): Subprocess {
  return spawn({
    cmd: [
      "socat",
      `TCP-LISTEN:${cfg.publicCdpPort},fork,reuseaddr,bind=0.0.0.0,keepalive,keepidle=10,keepintvl=5,keepcnt=3`,
      `TCP:127.0.0.1:${cfg.chromeCdpPort},keepalive,keepidle=10,keepintvl=5,keepcnt=3`,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
}
