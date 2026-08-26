import type { Server, ServerWebSocket } from "bun";
import { sampleTrajectory, SAME_SPOT_PX, type Point } from "./trajectory";
import {
  expandTextToKeyEvents,
  isModifierKey,
  sampleTypingDelayMs,
  type KeyEventParams,
} from "./typing";
import { scaleDelayMs } from "../config";

const INJECTED_ID_START = 1_000_000;
const VIEWPORT_TIMEOUT_MS = 1500;
const DEFAULT_VIEWPORT_W = 1280;
const DEFAULT_VIEWPORT_H = 800;

export interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: unknown;
  error?: unknown;
}

export interface ProxyOptions {
  listenPort: number;
  listenHost?: string;
  target: string;
  /** Default true so unit tests keep covering the path. Production sets this from ENABLE_HUMANIZE. */
  humanize?: boolean;
  /** 2 means mouse delays are halved. */
  mouseSpeed?: number;
  /** 2 means typing delays are halved. */
  typeSpeed?: number;
  movePointer?: (x: number, y: number) => void;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
}

interface WsData {
  path: string;
  target: WebSocket | null;
  ready: boolean;
  buffer: string[];
  lastX: number;
  lastY: number;
  hasPosition: boolean;
  buttons: number;
  nextInjectedId: number;
  pendingInjected: Set<number>;
  inputTail: Promise<void>;
  viewportW: number;
  viewportH: number;
  hasViewport: boolean;
  lastWasChar: boolean;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function rewriteDebuggerUrls(data: unknown, proxyHost: string): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => rewriteDebuggerUrls(item, proxyHost));
  }
  if (data !== null && typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (key === "webSocketDebuggerUrl" && typeof value === "string") {
        try {
          const u = new URL(value);
          const scheme = u.protocol === "wss:" ? "wss" : "ws";
          out[key] = `${scheme}://${proxyHost}${u.pathname}${u.search}`;
        } catch {
          out[key] = value;
        }
      } else {
        out[key] = rewriteDebuggerUrls(value, proxyHost);
      }
    }
    return out;
  }
  return data;
}

export function startCdpProxyServer(options: ProxyOptions): Server<WsData> {
  const targetBase = new URL(options.target);
  const targetWsOrigin =
    (targetBase.protocol === "https:" ? "wss:" : "ws:") + "//" + targetBase.host;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const movePointer = options.movePointer ?? (() => {});
  const rng = options.rng ?? Math.random;
  const humanize = options.humanize !== false;
  const mouseSpeed = options.mouseSpeed ?? 1;
  const typeSpeed = options.typeSpeed ?? 1;
  const injectedWaiters = new Map<
    number,
    (result: Record<string, unknown> | null) => void
  >();

  async function proxyHttp(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const targetUrl = `${targetBase.origin}${url.pathname}${url.search}`;
    const headers = new Headers(req.headers);
    headers.set("host", targetBase.host);
    headers.delete("connection");

    const init: RequestInit = {
      method: req.method,
      headers,
      redirect: "manual",
    };
    if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
      init.body = req.body;
    }

    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(`Bad gateway: ${message}`, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const proxyHost = req.headers.get("host") ?? `localhost:${server.port}`;

    if (contentType.includes("json") || url.pathname.startsWith("/json")) {
      const text = await upstream.text();
      let body = text;
      try {
        const parsed: unknown = JSON.parse(text);
        body = JSON.stringify(rewriteDebuggerUrls(parsed, proxyHost));
      } catch {
        // leave non-JSON /json bodies alone
      }
      const outHeaders = new Headers();
      outHeaders.set("content-type", contentType || "application/json");
      return new Response(body, { status: upstream.status, headers: outHeaders });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  }

  function enqueueInput(data: WsData, task: () => Promise<void>): void {
    data.inputTail = data.inputTail.then(task, task);
  }

  function sendToTarget(data: WsData, msg: CdpMessage): void {
    if (!data.target || data.target.readyState !== WebSocket.OPEN) return;
    data.target.send(JSON.stringify(msg));
  }

  function injectId(data: WsData): number {
    const id = data.nextInjectedId++;
    data.pendingInjected.add(id);
    return id;
  }

  function replyToClient(ws: ServerWebSocket<WsData>, msg: CdpMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  async function fetchViewport(data: WsData, sessionId?: string): Promise<void> {
    if (!data.target || data.target.readyState !== WebSocket.OPEN) {
      data.viewportW = DEFAULT_VIEWPORT_W;
      data.viewportH = DEFAULT_VIEWPORT_H;
      data.hasViewport = true;
      return;
    }
    const id = injectId(data);
    const msg: CdpMessage = { id, method: "Page.getLayoutMetrics" };
    if (sessionId) msg.sessionId = sessionId;

    const result = await new Promise<Record<string, unknown> | null>((resolve) => {
      const timeout = setTimeout(() => {
        data.pendingInjected.delete(id);
        injectedWaiters.delete(id);
        resolve(null);
      }, VIEWPORT_TIMEOUT_MS);
      injectedWaiters.set(id, (res) => {
        clearTimeout(timeout);
        resolve(res);
      });
      sendToTarget(data, msg);
    });

    if (!result) {
      data.viewportW = DEFAULT_VIEWPORT_W;
      data.viewportH = DEFAULT_VIEWPORT_H;
      data.hasViewport = true;
      return;
    }

    const cssVisual = result.cssVisualViewport as
      | { clientWidth?: number; clientHeight?: number }
      | undefined;
    const layout = result.layoutViewport as
      | { clientWidth?: number; clientHeight?: number }
      | undefined;
    const visual = result.visualViewport as
      | { clientWidth?: number; clientHeight?: number }
      | undefined;

    data.viewportW =
      cssVisual?.clientWidth ?? layout?.clientWidth ?? visual?.clientWidth ?? DEFAULT_VIEWPORT_W;
    data.viewportH =
      cssVisual?.clientHeight ?? layout?.clientHeight ?? visual?.clientHeight ?? DEFAULT_VIEWPORT_H;
    data.hasViewport = true;
  }

  async function startPosition(data: WsData, sessionId?: string): Promise<Point> {
    if (data.hasPosition) return { x: data.lastX, y: data.lastY };
    if (!data.hasViewport) await fetchViewport(data, sessionId);
    return { x: data.viewportW / 2, y: data.viewportH / 2 };
  }

  function clampPoint(data: WsData, p: Point): Point {
    if (!data.hasViewport) return p;
    return {
      x: clamp(p.x, 0, Math.max(0, data.viewportW - 2)),
      y: clamp(p.y, 0, Math.max(0, data.viewportH - 2)),
    };
  }

  async function injectMoves(
    data: WsData,
    points: Point[],
    delaysMs: number[],
    original: CdpMessage,
  ): Promise<void> {
    const orig = original.params ?? {};
    const pointerType = orig.pointerType ?? "mouse";
    const modifiers = orig.modifiers ?? 0;
    const sessionId = original.sessionId;
    for (let i = 0; i < points.length; i++) {
      const p = clampPoint(data, points[i]!);
      const id = injectId(data);
      const msg: CdpMessage = {
        id,
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseMoved",
          x: p.x,
          y: p.y,
          buttons: data.buttons,
          pointerType,
          modifiers,
        },
      };
      if (sessionId) msg.sessionId = sessionId;
      sendToTarget(data, msg);
      movePointer(p.x, p.y);
      data.lastX = p.x;
      data.lastY = p.y;
      data.hasPosition = true;
      const delay = scaleDelayMs(delaysMs[i] ?? 0, mouseSpeed);
      if (delay > 0) await sleep(delay);
    }
  }

  async function handleMouseEvent(data: WsData, msg: CdpMessage): Promise<void> {
    const params = msg.params ?? {};
    const type = String(params.type ?? "");
    const x = Number(params.x ?? 0);
    const y = Number(params.y ?? 0);

    if (type === "mouseWheel") {
      sendToTarget(data, msg);
      if (typeof params.buttons === "number") data.buttons = params.buttons;
      return;
    }

    const from = await startPosition(data, msg.sessionId);
    const to = { x, y };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const jumped = !data.hasPosition || dist >= SAME_SPOT_PX;

    if (
      jumped &&
      (type === "mousePressed" || type === "mouseReleased" || type === "mouseMoved")
    ) {
      const { points, delaysMs } = sampleTrajectory(from, to, rng);
      await injectMoves(data, points, delaysMs, msg);
    }

    sendToTarget(data, msg);
    movePointer(x, y);
    data.lastX = x;
    data.lastY = y;
    data.hasPosition = true;
    if (typeof params.buttons === "number") data.buttons = params.buttons;
  }

  async function handleInsertText(
    ws: ServerWebSocket<WsData>,
    data: WsData,
    msg: CdpMessage,
  ): Promise<void> {
    const text = String(msg.params?.text ?? "");
    if (!text) {
      if (typeof msg.id === "number") replyToClient(ws, { id: msg.id, result: {} });
      return;
    }
    const groups = expandTextToKeyEvents(text);
    for (const group of groups) {
      for (const params of group) {
        sendInjectedKey(data, params, msg.sessionId);
      }
      const delay = scaleDelayMs(sampleTypingDelayMs(rng), typeSpeed);
      if (delay > 0) await sleep(delay);
    }
    if (typeof msg.id === "number") replyToClient(ws, { id: msg.id, result: {} });
  }

  function sendInjectedKey(
    data: WsData,
    params: KeyEventParams,
    sessionId?: string,
  ): void {
    const id = injectId(data);
    const msg: CdpMessage = {
      id,
      method: "Input.dispatchKeyEvent",
      params: { ...params },
    };
    if (sessionId) msg.sessionId = sessionId;
    sendToTarget(data, msg);
  }

  async function handleKeyEvent(data: WsData, msg: CdpMessage): Promise<void> {
    const params = msg.params ?? {};
    const type = String(params.type ?? "");

    if (isModifierKey(params)) {
      sendToTarget(data, msg);
      data.lastWasChar = false;
      return;
    }

    if (type === "char") {
      sendToTarget(data, msg);
      data.lastWasChar = true;
      const delay = scaleDelayMs(sampleTypingDelayMs(rng), typeSpeed);
      if (delay > 0) await sleep(delay);
      return;
    }

    if (type === "keyUp") {
      sendToTarget(data, msg);
      if (!data.lastWasChar) {
        const delay = scaleDelayMs(sampleTypingDelayMs(rng), typeSpeed);
        if (delay > 0) await sleep(delay);
      }
      data.lastWasChar = false;
      return;
    }

    sendToTarget(data, msg);
    data.lastWasChar = false;
  }

  function handleClientMessage(ws: ServerWebSocket<WsData>, raw: string): void {
    const data = ws.data;
    if (!data.ready) {
      data.buffer.push(raw);
      return;
    }

    let msg: CdpMessage;
    try {
      msg = JSON.parse(raw) as CdpMessage;
    } catch {
      data.target?.send(raw);
      return;
    }

    if (!humanize) {
      sendToTarget(data, msg);
      return;
    }

    if (msg.method === "Input.dispatchMouseEvent") {
      enqueueInput(data, () => handleMouseEvent(data, msg));
      return;
    }
    if (msg.method === "Input.insertText") {
      enqueueInput(data, () => handleInsertText(ws, data, msg));
      return;
    }
    if (msg.method === "Input.dispatchKeyEvent") {
      enqueueInput(data, () => handleKeyEvent(data, msg));
      return;
    }

    sendToTarget(data, msg);
  }

  function handleTargetMessage(ws: ServerWebSocket<WsData>, raw: string): void {
    const data = ws.data;
    let msg: CdpMessage;
    try {
      msg = JSON.parse(raw) as CdpMessage;
    } catch {
      if (ws.readyState === WebSocket.OPEN) ws.send(raw);
      return;
    }

    if (typeof msg.id === "number" && data.pendingInjected.has(msg.id)) {
      data.pendingInjected.delete(msg.id);
      const waiter = injectedWaiters.get(msg.id);
      if (waiter) {
        injectedWaiters.delete(msg.id);
        waiter(
          msg.result && typeof msg.result === "object"
            ? (msg.result as Record<string, unknown>)
            : null,
        );
      }
      return;
    }

    if (ws.readyState === WebSocket.OPEN) ws.send(raw);
  }

  function connectTarget(ws: ServerWebSocket<WsData>): void {
    const data = ws.data;
    const targetUrl = `${targetWsOrigin}${data.path}`;
    const target = new WebSocket(targetUrl);
    data.target = target;

    target.addEventListener("open", () => {
      data.ready = true;
      for (const buffered of data.buffer) handleClientMessage(ws, buffered);
      data.buffer = [];
    });

    target.addEventListener("message", (event) => {
      const raw =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);
      handleTargetMessage(ws, raw);
    });

    target.addEventListener("close", (event) => {
      if (ws.readyState === WebSocket.OPEN) ws.close(event.code, event.reason);
    });

    target.addEventListener("error", () => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, "target error");
    });
  }

  const clients = new Set<ServerWebSocket<WsData>>();

  const server: Server<WsData> = Bun.serve({
    port: options.listenPort,
    hostname: options.listenHost ?? "0.0.0.0",
    fetch(req, srv) {
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const url = new URL(req.url);
        const ok = srv.upgrade(req, {
          data: {
            path: url.pathname + url.search,
            target: null,
            ready: false,
            buffer: [],
            lastX: 0,
            lastY: 0,
            hasPosition: false,
            buttons: 0,
            nextInjectedId: INJECTED_ID_START,
            pendingInjected: new Set(),
            inputTail: Promise.resolve(),
            viewportW: DEFAULT_VIEWPORT_W,
            viewportH: DEFAULT_VIEWPORT_H,
            hasViewport: false,
            lastWasChar: false,
          } satisfies WsData,
        });
        if (!ok) return new Response("WebSocket upgrade failed", { status: 400 });
        return undefined;
      }
      return proxyHttp(req);
    },
    websocket: {
      data: {} as WsData,
      idleTimeout: 0,
      maxPayloadLength: 64 * 1024 * 1024,
      open(ws) {
        clients.add(ws);
        connectTarget(ws);
      },
      message(ws, message) {
        const raw =
          typeof message === "string" ? message : new TextDecoder().decode(message);
        handleClientMessage(ws, raw);
      },
      close(ws) {
        clients.delete(ws);
        const target = ws.data.target;
        if (target && target.readyState === WebSocket.OPEN) target.close();
        ws.data.target = null;
      },
    },
  });

  return server;
}
