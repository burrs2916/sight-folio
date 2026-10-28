// ACP WebSocket bridge transport — frontend side.
//
// Bridges the in-app AcpHost to external ACP agents over the backend WS server.
// Supports MULTIPLE concurrent agent connections: each inbound message carries
// its connId; responses are routed back to the connection that sent the matching
// request (tracked here), while host-initiated events broadcast to all.
//
//   external agent ──ws──► backend relay ──Tauri event `acp-ws-in`{connId,message}──► this transport ─► AcpHost
//   AcpHost ──send()──► invoke(send_acp_ws,{connId?,message}) ──► backend relay ──ws──► agent

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AcpMessage } from "./types";
import type { AcpTransport } from "./transport";

const WS_IN_EVENT = "acp-ws-in";

interface WsInPayload {
  connId: string;
  message: string;
}

export class WsBridgeTransport implements AcpTransport {
  private handlers = new Set<(m: AcpMessage) => void>();
  private unlisten: UnlistenFn | null = null;
  /** request id → originating connection id (so responses route back correctly). */
  private pendingReq = new Map<string, string>();

  async start(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await listen<WsInPayload>(WS_IN_EVENT, (e) => {
      const { connId, message } = e.payload;
      let msg: AcpMessage;
      try {
        msg = JSON.parse(message) as AcpMessage;
      } catch (err) {
        console.error("[acp:ws] inbound parse error", err);
        return;
      }
      if (msg.type === "request") this.pendingReq.set(msg.id, connId);
      for (const h of [...this.handlers]) {
        try {
          h(msg);
        } catch (err) {
          console.error("[acp:ws] handler error", err);
        }
      }
    });
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.handlers.clear();
    this.pendingReq.clear();
  }

  send(msg: AcpMessage): void {
    // Responses route to the connection that sent the matching request; events broadcast.
    let connId: string | null = null;
    if (msg.type === "response") {
      connId = this.pendingReq.get(msg.id) ?? null;
      this.pendingReq.delete(msg.id);
    }
    invoke("send_acp_ws", { connId, message: JSON.stringify(msg) }).catch((e) =>
      console.error("[acp:ws] send failed", e),
    );
  }

  onMessage(handler: (m: AcpMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Resolve the connection id that sent a given request (for approval display). */
  connIdOf(requestId: string): string | null {
    return this.pendingReq.get(requestId) ?? null;
  }
}
