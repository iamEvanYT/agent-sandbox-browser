import { describe, expect, test } from "bun:test";
import {
  charToKeyEvents,
  expandTextToKeyEvents,
  FIRST_INTERVAL,
  FIRST_INTERVAL_PROBABILITY,
  isModifierKey,
  sampleTypingDelaySeconds,
  SECOND_INTERVAL,
  SECOND_INTERVAL_PROBABILITY,
  THIRD_INTERVAL,
} from "./typing";

describe("sampleTypingDelaySeconds", () => {
  test("first interval when pick is below 0.377", () => {
    const values = [0.0, 0.5];
    let i = 0;
    const rng = () => values[i++]!;
    expect(sampleTypingDelaySeconds(rng)).toBeCloseTo(
      FIRST_INTERVAL[0] + 0.5 * (FIRST_INTERVAL[1] - FIRST_INTERVAL[0]),
      10,
    );
  });

  test("second interval when pick is in the middle band", () => {
    const values = [FIRST_INTERVAL_PROBABILITY, 0];
    let i = 0;
    const rng = () => values[i++]!;
    expect(sampleTypingDelaySeconds(rng)).toBeCloseTo(SECOND_INTERVAL[0], 10);
  });

  test("third interval when pick is in the remainder", () => {
    const values = [FIRST_INTERVAL_PROBABILITY + SECOND_INTERVAL_PROBABILITY, 1];
    let i = 0;
    const rng = () => values[i++]!;
    expect(sampleTypingDelaySeconds(rng)).toBeCloseTo(THIRD_INTERVAL[1], 10);
  });
});

describe("charToKeyEvents", () => {
  test("expands a letter into keyDown, char, keyUp", () => {
    const events = charToKeyEvents("a");
    expect(events.map((e) => e.type)).toEqual(["keyDown", "char", "keyUp"]);
    expect(events[0]?.key).toBe("a");
    expect(events[0]?.code).toBe("KeyA");
    expect(events[1]?.text).toBe("a");
  });

  test("marks shifted letters", () => {
    const events = charToKeyEvents("A");
    expect(events[0]?.modifiers).toBe(8);
    expect(events[0]?.text).toBe("A");
  });
});

describe("expandTextToKeyEvents", () => {
  test("groups per character", () => {
    const groups = expandTextToKeyEvents("Hi");
    expect(groups.length).toBe(2);
    expect(groups[0]?.[0]?.key).toBe("H");
    expect(groups[1]?.[0]?.key).toBe("i");
  });
});

describe("isModifierKey", () => {
  test("Shift and Control are modifiers", () => {
    expect(isModifierKey({ key: "Shift" })).toBe(true);
    expect(isModifierKey({ key: "Control", code: "ControlLeft" })).toBe(true);
    expect(isModifierKey({ code: "AltLeft" })).toBe(true);
    expect(isModifierKey({ key: "a", code: "KeyA" })).toBe(false);
  });
});
