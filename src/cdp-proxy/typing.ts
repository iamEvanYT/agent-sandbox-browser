/**
 * Per-key pause sampling ported from rewards-farmer src/mimic_typing.py.
 * Also expands insertText / character input into CDP key events.
 */

export type Rng = () => number;

export const FIRST_INTERVAL = [0.0, 0.1] as const;
export const SECOND_INTERVAL = [0.1, 0.2] as const;
export const THIRD_INTERVAL = [0.2, 0.4] as const;
export const FIRST_INTERVAL_PROBABILITY = 0.377;
export const SECOND_INTERVAL_PROBABILITY = 0.5492;
export const THIRD_INTERVAL_PROBABILITY =
  1 - (FIRST_INTERVAL_PROBABILITY + SECOND_INTERVAL_PROBABILITY);

const SHIFT_MODIFIER = 8;

const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "AltGraph",
  "Fn",
]);

export function isModifierKey(params: {
  key?: unknown;
  code?: unknown;
}): boolean {
  const key = String(params.key ?? "");
  const code = String(params.code ?? "");
  if (MODIFIER_KEYS.has(key)) return true;
  return /^(Shift|Control|Alt|Meta)/.test(key) || /^(Shift|Control|Alt|Meta)/.test(code);
}

export function sampleTypingDelaySeconds(rng: Rng = Math.random): number {
  const pick = rng();
  let interval: readonly [number, number];
  if (pick < FIRST_INTERVAL_PROBABILITY) {
    interval = FIRST_INTERVAL;
  } else if (pick < FIRST_INTERVAL_PROBABILITY + SECOND_INTERVAL_PROBABILITY) {
    interval = SECOND_INTERVAL;
  } else {
    interval = THIRD_INTERVAL;
  }
  const u = rng();
  return interval[0] + u * (interval[1] - interval[0]);
}

export function sampleTypingDelayMs(rng: Rng = Math.random): number {
  return sampleTypingDelaySeconds(rng) * 1000;
}

export interface KeyEventParams {
  type: "keyDown" | "keyUp" | "rawKeyDown" | "char";
  key: string;
  code?: string;
  text?: string;
  unmodifiedText?: string;
  windowsVirtualKeyCode?: number;
  nativeVirtualKeyCode?: number;
  modifiers?: number;
}

function punctuationCode(ch: string): { code: string; vk: number; shift: boolean; unmod: string } | null {
  const table: Record<string, { code: string; vk: number; shift: boolean; unmod: string }> = {
    " ": { code: "Space", vk: 32, shift: false, unmod: " " },
    ".": { code: "Period", vk: 190, shift: false, unmod: "." },
    ",": { code: "Comma", vk: 188, shift: false, unmod: "," },
    "-": { code: "Minus", vk: 189, shift: false, unmod: "-" },
    "=": { code: "Equal", vk: 187, shift: false, unmod: "=" },
    "/": { code: "Slash", vk: 191, shift: false, unmod: "/" },
    ";": { code: "Semicolon", vk: 186, shift: false, unmod: ";" },
    "'": { code: "Quote", vk: 222, shift: false, unmod: "'" },
    "[": { code: "BracketLeft", vk: 219, shift: false, unmod: "[" },
    "]": { code: "BracketRight", vk: 221, shift: false, unmod: "]" },
    "\\": { code: "Backslash", vk: 220, shift: false, unmod: "\\" },
    "`": { code: "Backquote", vk: 192, shift: false, unmod: "`" },
    "!": { code: "Digit1", vk: 49, shift: true, unmod: "1" },
    "@": { code: "Digit2", vk: 50, shift: true, unmod: "2" },
    "#": { code: "Digit3", vk: 51, shift: true, unmod: "3" },
    "$": { code: "Digit4", vk: 52, shift: true, unmod: "4" },
    "%": { code: "Digit5", vk: 53, shift: true, unmod: "5" },
    "^": { code: "Digit6", vk: 54, shift: true, unmod: "6" },
    "&": { code: "Digit7", vk: 55, shift: true, unmod: "7" },
    "*": { code: "Digit8", vk: 56, shift: true, unmod: "8" },
    "(": { code: "Digit9", vk: 57, shift: true, unmod: "9" },
    ")": { code: "Digit0", vk: 48, shift: true, unmod: "0" },
    "_": { code: "Minus", vk: 189, shift: true, unmod: "-" },
    "+": { code: "Equal", vk: 187, shift: true, unmod: "=" },
    "?": { code: "Slash", vk: 191, shift: true, unmod: "/" },
    ":": { code: "Semicolon", vk: 186, shift: true, unmod: ";" },
    '"': { code: "Quote", vk: 222, shift: true, unmod: "'" },
    "{": { code: "BracketLeft", vk: 219, shift: true, unmod: "[" },
    "}": { code: "BracketRight", vk: 221, shift: true, unmod: "]" },
    "|": { code: "Backslash", vk: 220, shift: true, unmod: "\\" },
    "~": { code: "Backquote", vk: 192, shift: true, unmod: "`" },
    "<": { code: "Comma", vk: 188, shift: true, unmod: "," },
    ">": { code: "Period", vk: 190, shift: true, unmod: "." },
  };
  return table[ch] ?? null;
}

export function charToKeyEvents(ch: string): KeyEventParams[] {
  if (ch === "\n" || ch === "\r") {
    return [
      { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
      { type: "char", key: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
      { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
    ];
  }
  if (ch === "\t") {
    return [
      { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
      { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
    ];
  }

  const lower = ch.toLowerCase();
  if (lower.length === 1 && lower >= "a" && lower <= "z") {
    const vk = lower.toUpperCase().charCodeAt(0);
    const shifted = ch !== lower;
    const mods = shifted ? SHIFT_MODIFIER : 0;
    const code = `Key${lower.toUpperCase()}`;
    return [
      {
        type: "keyDown",
        key: ch,
        code,
        text: ch,
        unmodifiedText: lower,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
        modifiers: mods,
      },
      {
        type: "char",
        key: ch,
        text: ch,
        unmodifiedText: lower,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
        modifiers: mods,
      },
      {
        type: "keyUp",
        key: ch,
        code,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
        modifiers: mods,
      },
    ];
  }

  if (ch.length === 1 && ch >= "0" && ch <= "9") {
    const vk = ch.charCodeAt(0);
    const code = `Digit${ch}`;
    return [
      { type: "keyDown", key: ch, code, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk },
      { type: "char", key: ch, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk },
      { type: "keyUp", key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk },
    ];
  }

  const punct = punctuationCode(ch);
  if (punct) {
    const mods = punct.shift ? SHIFT_MODIFIER : 0;
    return [
      {
        type: "keyDown",
        key: ch,
        code: punct.code,
        text: ch,
        unmodifiedText: punct.unmod,
        windowsVirtualKeyCode: punct.vk,
        nativeVirtualKeyCode: punct.vk,
        modifiers: mods,
      },
      {
        type: "char",
        key: ch,
        text: ch,
        unmodifiedText: punct.unmod,
        windowsVirtualKeyCode: punct.vk,
        nativeVirtualKeyCode: punct.vk,
        modifiers: mods,
      },
      {
        type: "keyUp",
        key: ch,
        code: punct.code,
        windowsVirtualKeyCode: punct.vk,
        nativeVirtualKeyCode: punct.vk,
        modifiers: mods,
      },
    ];
  }

  return [{ type: "char", key: ch, text: ch, unmodifiedText: ch }];
}

export function expandTextToKeyEvents(text: string): KeyEventParams[][] {
  const groups: KeyEventParams[][] = [];
  for (const ch of text) {
    groups.push(charToKeyEvents(ch));
  }
  return groups;
}

export function isCharacterProducingKeyEvent(params: {
  type?: unknown;
  key?: unknown;
  text?: unknown;
}): boolean {
  const type = String(params.type ?? "");
  if (type === "char") return true;
  if (type === "keyUp") return false;
  if (isModifierKey(params)) return false;
  const text = params.text;
  if (typeof text === "string" && text.length > 0) return true;
  const key = String(params.key ?? "");
  return key.length === 1;
}
