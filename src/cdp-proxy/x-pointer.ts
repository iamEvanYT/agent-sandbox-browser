import { spawn } from "bun";

/**
 * Warp the X pointer so VNC shows a real cursor. CDP Input events never
 * move the X11 pointer on their own. The helper is installed in the image
 * as warp-x-pointer; headed mode only.
 */
export function createXPointer(
  display: string | undefined,
): (x: number, y: number) => void {
  if (!display) return () => {};
  return (x: number, y: number) => {
    spawn({
      cmd: [
        "warp-x-pointer",
        String(Math.round(x)),
        String(Math.round(y)),
      ],
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, DISPLAY: display },
    });
  };
}
