import { describe, expect, test } from "bun:test";
import { x11LockPaths } from "./runtime";

describe("x11LockPaths", () => {
  test("maps :1 to the standard X lock files", () => {
    expect(x11LockPaths(":1")).toEqual({
      lockFile: "/tmp/.X1-lock",
      socket: "/tmp/.X11-unix/X1",
    });
  });

  test("accepts a bare display number", () => {
    expect(x11LockPaths("2").lockFile).toBe("/tmp/.X2-lock");
  });
});
