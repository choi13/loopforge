import { useEffect, useRef, useState } from "react";
import type { ServerMessage } from "./types";

/**
 * Maintains a WebSocket connection to the given URL, reconnecting with
 * exponential backoff (1s doubling, capped at 10s). Returns the current
 * connection state. The message handler is kept in a ref so callers can pass
 * a fresh closure every render without tearing the socket down.
 */
export function useWebSocket(
  url: string,
  onMessage: (msg: ServerMessage) => void
): boolean {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let delay = 1000;
    let disposed = false;

    const connect = () => {
      ws = new WebSocket(url);

      ws.onopen = () => {
        delay = 1000;
        setConnected(true);
      };

      ws.onmessage = (ev: MessageEvent) => {
        let msg: unknown;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return; // malformed frame — ignore
        }
        if (msg && typeof msg === "object" && "type" in msg) {
          handlerRef.current(msg as ServerMessage);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!disposed) {
          timer = window.setTimeout(connect, delay);
          delay = Math.min(delay * 2, 10_000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }, [url]);

  return connected;
}
