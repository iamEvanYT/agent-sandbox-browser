import { spawn, type Subprocess } from "bun";

export function startSocat(): Subprocess {
  return spawn({
    cmd: [
      "socat",
      "TCP-LISTEN:9222,fork,reuseaddr,bind=0.0.0.0,keepalive,keepidle=10,keepintvl=5,keepcnt=3",
      "TCP:127.0.0.1:9223,keepalive,keepidle=10,keepintvl=5,keepcnt=3",
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
}
