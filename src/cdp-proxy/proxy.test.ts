import { describe, expect, test } from "bun:test";
import { startCdpProxyServer, type CdpMessage, type ProxyOptions } from "./proxy";

interface ChromeMsg extends CdpMessage {}

async function waitUntil(
  pred: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await Bun.sleep(10);
  }
}

async function withProxy(
  fn: (ctx: {
    proxyPort: number;
    chromeReceived: ChromeMsg[];
    send: (msg: CdpMessage) => void;
    replies: CdpMessage[];
    close: () => void;
  }) => Promise<void>,
  extra: Partial<ProxyOptions> = {},
): Promise<void> {
  const chromeReceived: ChromeMsg[] = [];
  const chrome = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, server) {
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        server.upgrade(req);
        return undefined;
      }
      const url = new URL(req.url);
      if (url.pathname.startsWith("/json")) {
        return Response.json([
          {
            id: "fake",
            webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/page/fake`,
          },
        ]);
      }
      return new Response("ok");
    },
    websocket: {
      idleTimeout: 0,
      message(ws, message) {
        const raw =
          typeof message === "string"
            ? message
            : new TextDecoder().decode(message);
        const msg = JSON.parse(raw) as ChromeMsg;
        chromeReceived.push(msg);
        if (msg.method === "Page.getLayoutMetrics") {
          ws.send(
            JSON.stringify({
              id: msg.id,
              result: {
                cssVisualViewport: { clientWidth: 1280, clientHeight: 800 },
              },
            }),
          );
          return;
        }
        if (typeof msg.id === "number") {
          ws.send(JSON.stringify({ id: msg.id, result: {} }));
        }
      },
    },
  });

  const proxy = startCdpProxyServer({
    listenPort: 0,
    listenHost: "127.0.0.1",
    target: `http://127.0.0.1:${chrome.port}`,
    sleep: extra.sleep ?? (async () => {}),
    humanize: extra.humanize,
    mouseSpeed: extra.mouseSpeed,
    typeSpeed: extra.typeSpeed,
  });

  const replies: CdpMessage[] = [];
  const ws = new WebSocket(
    `ws://127.0.0.1:${proxy.port}/devtools/page/fake`,
  );
  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("ws error")));
  });
  ws.addEventListener("message", (event) => {
    const raw =
      typeof event.data === "string"
        ? event.data
        : new TextDecoder().decode(event.data as ArrayBuffer);
    replies.push(JSON.parse(raw) as CdpMessage);
  });
  await opened;

  try {
    await fn({
      proxyPort: proxy.port,
      chromeReceived,
      send: (msg) => ws.send(JSON.stringify(msg)),
      replies,
      close: () => ws.close(),
    });
  } finally {
    try {
      ws.close();
    } catch {
      // already closed
    }
    proxy.stop(true);
    chrome.stop(true);
  }
}

function mouseEvents(received: ChromeMsg[]): ChromeMsg[] {
  return received.filter((m) => m.method === "Input.dispatchMouseEvent");
}

describe("HTTP passthrough", () => {
  test("rewrites webSocketDebuggerUrl onto the proxy host", async () => {
    await withProxy(async ({ proxyPort }) => {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/json/list`);
      expect(res.ok).toBe(true);
      const body = (await res.json()) as Array<{ webSocketDebuggerUrl: string }>;
      expect(body[0]?.webSocketDebuggerUrl).toBe(
        `ws://127.0.0.1:${proxyPort}/devtools/page/fake`,
      );
    });
  });
});

describe("non-input CDP", () => {
  test("forwards Runtime.evaluate unchanged and returns the result id", async () => {
    await withProxy(async ({ chromeReceived, send, replies }) => {
      send({
        id: 7,
        method: "Runtime.evaluate",
        params: { expression: "1+1" },
      });
      await waitUntil(() => replies.some((r) => r.id === 7));
      const forwarded = chromeReceived.find((m) => m.method === "Runtime.evaluate");
      expect(forwarded).toEqual({
        id: 7,
        method: "Runtime.evaluate",
        params: { expression: "1+1" },
      });
      expect(replies.some((r) => r.id === 7)).toBe(true);
      expect(replies.some((r) => typeof r.id === "number" && r.id >= 1_000_000)).toBe(
        false,
      );
    });
  });
});

describe("mouse humanization", () => {
  test("a teleport click becomes a path then the original press", async () => {
    await withProxy(async ({ chromeReceived, send, replies }) => {
      send({
        id: 1,
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          x: 500,
          y: 400,
          button: "left",
          buttons: 1,
          clickCount: 1,
          pointerType: "mouse",
          modifiers: 0,
        },
      });
      await waitUntil(() => replies.some((r) => r.id === 1));
      const mice = mouseEvents(chromeReceived);
      const moves = mice.filter((m) => m.params?.type === "mouseMoved");
      const presses = mice.filter((m) => m.params?.type === "mousePressed");
      expect(moves.length).toBeGreaterThan(5);
      expect(presses.length).toBe(1);
      expect(presses[0]?.id).toBe(1);
      expect(presses[0]?.params?.x).toBe(500);
      expect(presses[0]?.params?.y).toBe(400);
      expect(presses[0]?.params?.clickCount).toBe(1);
      expect(presses[0]?.params?.pointerType).toBe("mouse");
      expect(presses[0]?.params?.modifiers).toBe(0);
      expect(presses[0]?.params?.buttons).toBe(1);
      const lastMove = moves.at(-1);
      expect(lastMove?.params?.x).toBe(500);
      expect(lastMove?.params?.y).toBe(400);
      expect(typeof lastMove?.id).toBe("number");
      expect(lastMove!.id!).toBeGreaterThanOrEqual(1_000_000);
    });
  });

  test("a same-spot click does not inject another arc", async () => {
    await withProxy(async ({ chromeReceived, send, replies }) => {
      send({
        id: 1,
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseMoved", x: 200, y: 200, buttons: 0 },
      });
      await waitUntil(() => replies.some((r) => r.id === 1));
      chromeReceived.length = 0;
      send({
        id: 2,
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          x: 200,
          y: 200,
          button: "left",
          buttons: 1,
          clickCount: 1,
        },
      });
      await waitUntil(() => replies.some((r) => r.id === 2));
      const mice = mouseEvents(chromeReceived);
      expect(mice.length).toBe(1);
      expect(mice[0]?.params?.type).toBe("mousePressed");
      expect(mice[0]?.id).toBe(2);
    });
  });
});

describe("keyboard humanization", () => {
  test("insertText expands into per-character key events", async () => {
    await withProxy(async ({ chromeReceived, send, replies }) => {
      send({ id: 3, method: "Input.insertText", params: { text: "Hi" } });
      await waitUntil(() => replies.some((r) => r.id === 3));
      const keys = chromeReceived.filter((m) => m.method === "Input.dispatchKeyEvent");
      expect(chromeReceived.some((m) => m.method === "Input.insertText")).toBe(false);
      expect(keys.length).toBeGreaterThanOrEqual(6);
      expect(keys.some((m) => m.params?.key === "H")).toBe(true);
      expect(keys.some((m) => m.params?.key === "i")).toBe(true);
      expect(keys.every((m) => typeof m.id === "number" && m.id >= 1_000_000)).toBe(
        true,
      );
    });
  });

  test("modifier-only events pass through without extra key events", async () => {
    await withProxy(async ({ chromeReceived, send, replies }) => {
      send({
        id: 4,
        method: "Input.dispatchKeyEvent",
        params: { type: "keyDown", key: "Shift", code: "ShiftLeft", modifiers: 8 },
      });
      await waitUntil(() => replies.some((r) => r.id === 4));
      const keys = chromeReceived.filter((m) => m.method === "Input.dispatchKeyEvent");
      expect(keys.length).toBe(1);
      expect(keys[0]?.id).toBe(4);
      expect(keys[0]?.params?.key).toBe("Shift");
    });
  });
});

describe("opt-in and speed", () => {
  test("humanize false forwards a teleport click unchanged", async () => {
    await withProxy(
      async ({ chromeReceived, send, replies }) => {
        send({
          id: 9,
          method: "Input.dispatchMouseEvent",
          params: {
            type: "mousePressed",
            x: 500,
            y: 400,
            button: "left",
            clickCount: 1,
          },
        });
        await waitUntil(() => replies.some((r) => r.id === 9));
        const mice = mouseEvents(chromeReceived);
        expect(mice.length).toBe(1);
        expect(mice[0]?.id).toBe(9);
        expect(mice[0]?.params?.type).toBe("mousePressed");
        expect(mice[0]?.params?.x).toBe(500);
      },
      { humanize: false },
    );
  });

  test("mouseSpeed 2 halves sample delays", async () => {
    const sleeps: number[] = [];
    await withProxy(
      async ({ send, replies }) => {
        send({
          id: 10,
          method: "Input.dispatchMouseEvent",
          params: { type: "mouseMoved", x: 500, y: 400 },
        });
        await waitUntil(() => replies.some((r) => r.id === 10));
      },
      {
        mouseSpeed: 2,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(sleeps.length).toBeGreaterThan(5);
    expect(sleeps.every((ms) => ms === 5)).toBe(true);
  });
});
