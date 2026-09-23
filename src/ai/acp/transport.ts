// ACP transport abstraction.
//
// The host lives inside the React frontend and speaks ACP over a pluggable
// transport. Two transports ship today:
//   - InProcessTransport: an in-app message bus (used for same-app agents and
//     for tests / local dev). Zero backend changes, fully verifiable.
// A WebSocket bridge to external agents is the documented P0.1 increment: a thin
// Rust-side WS server forwards frames to this bus via Tauri events, so an
// out-of-process ACP agent (e.g. `claw`) can connect to sight-folio.

import type { AcpMessage } from "./types";

export interface AcpTransport {
  /** Start the transport. May be async (e.g. WS bridge awaits event listener). */
  start(): void | Promise<void>;
  stop(): void;
  /** Deliver a message (request/response/event) to the peer. */
  send(msg: AcpMessage): void;
  /** Subscribe to inbound messages. Returns an unsubscribe fn. */
  onMessage(handler: (msg: AcpMessage) => void): () => void;
  /**
   * Resolve the originating connection id for a request id, if the transport
   * tracks per-connection routing (WS bridge does; in-process returns null).
   * Optional — callers must null-check.
   */
  connIdOf?(requestId: string): string | null;
}

/** In-process bus: host and a single local client share the same handler set. */
export class InProcessTransport implements AcpTransport {
  private handlers = new Set<(m: AcpMessage) => void>();

  start(): void {
    // No external listener required for in-process use.
  }

  stop(): void {
    this.handlers.clear();
  }

  send(msg: AcpMessage): void {
    // Fan out to all subscribers (the host installs exactly one).
    for (const h of [...this.handlers]) {
      try {
        h(msg);
      } catch (err) {
        // A misbehaving subscriber must not break the bus.
        console.error("[acp:transport] handler error", err);
      }
    }
  }

  onMessage(handler: (msg: AcpMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
