// AcpHost — the in-app ACP server.
//
// Speaks the ACP request/response/event envelope over a pluggable transport.
// Today it runs on the InProcessTransport (same-app agents + local testing, zero
// backend change). A future WebSocket bridge forwards frames to this same host,
// so an out-of-process ACP agent (e.g. `claw`) can drive sight-folio as its
// editor/host surface. Methods follow acp-core's session / resource / tool shape.

import { InProcessTransport, type AcpTransport } from "./transport";
import type {
  AcpExecutionContext,
  AcpMessage,
  AcpSession,
  AcpSessionRuntimeOptions,
} from "./types";
import { acpError } from "./types";
import { ACP_RESOURCES, readResource } from "./resources";
import { ACP_TOOLS, callTool } from "./tools";
import {
  alwaysAllowSet,
  classifyRisk,
  evaluateToolPermission,
  type ApprovalHandler,
} from "./permission";
import { formatToolArguments } from "../../utils/toolCallDisplay";
import type {
  AcpActivity,
  AcpAgentPreset,
  AcpApprovalDecision,
  AcpApprovalRequest,
  ResolvedPreset,
} from "./types";


export class AcpHost {
  private transport: AcpTransport;
  private sessions = new Map<string, AcpSession>();
  /** Connection id (or null for in-process) → the session most recently created on it. */
  private sessionByConn = new Map<string | null, AcpSession>();
  private analysisIdProvider: () => string | null;
  /** Resolves a preset id to its definition (P1). Injected from the store's registry. */
  private presetProvider: (id: string) => AcpAgentPreset | undefined;
  private unsub: (() => void) | null = null;
  private started = false;
  /** Approval gate for risky tools. Set by the store; null → fail-closed (deny). */
  private approvalHandler: ApprovalHandler | null = null;
  /** Live-activity sink (session/tool calls) pushed to the UI feed. Set by the store. */
  private activitySink: ((a: AcpActivity) => void) | null = null;
  /** Session-lifecycle sink (creation/update) pushed to the store for persistence. */
  private sessionSink: ((s: AcpSession) => void) | null = null;

  constructor(
    analysisIdProvider: () => string | null,
    transport?: AcpTransport,
  ) {
    this.analysisIdProvider = analysisIdProvider;
    this.presetProvider = () => undefined;
    this.transport = transport ?? new InProcessTransport();
  }

  /** Wire the approval gate (called by acpHostStore with a UI-backed handler). */
  setApprovalHandler(fn: ApprovalHandler): void {
    this.approvalHandler = fn;
  }

  /** Wire the preset registry lookup (called by acpHostStore with a live registry reader). */
  setPresetProvider(fn: (id: string) => AcpAgentPreset | undefined): void {
    this.presetProvider = fn;
  }

  /** Wire the live-activity sink (called by acpHostStore; renders the feed). */
  setActivitySink(fn: (a: AcpActivity) => void): void {
    this.activitySink = fn;
  }

  /** Wire the session-lifecycle sink (called by acpHostStore; persists the session). */
  setSessionSink(fn: (s: AcpSession) => void): void {
    this.sessionSink = fn;
  }

  /** Push a live-activity entry to the UI feed (no-op if no sink wired). */
  private emitActivity(entry: Omit<AcpActivity, "id" | "ts">): void {
    this.activitySink?.({
      ...entry,
      id: `${entry.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
    });
  }

  start(): void {
    if (this.started) return;
    this.transport.start();
    this.unsub = this.transport.onMessage((m) => this.onMessage(m));
    this.started = true;
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this.transport.stop();
    this.sessions.clear();
    this.sessionByConn.clear();
    this.started = false;
  }

  // ─── external agent bridge (WebSocket bridge / self-test) ───
  /**
   * Deliver an inbound message into the host (agent → host). The future WS
   * bridge forwards frames here; the in-process self-test uses it to prove wiring.
   */
  deliver(msg: AcpMessage): void {
    this.transport.send(msg);
  }

  /** Subscribe to host → agent messages (responses/events). Returns unsubscribe. */
  subscribe(handler: (m: AcpMessage) => void): () => void {
    return this.transport.onMessage(handler);
  }

  // ─── introspection (used by UI / tests) ───
  get isStarted(): boolean {
    return this.started;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  listSessions(): AcpSession[] {
    return [...this.sessions.values()];
  }

  // ─── dispatch core ───
  private execCtx(): AcpExecutionContext {
    const analysisId = this.analysisIdProvider();
    if (!analysisId) {
      throw new Error(
        "no active analysis: open or select a project analysis before using the ACP host",
      );
    }
    return { analysisId };
  }

  private onMessage(msg: AcpMessage): void {
    if (msg.type !== "request") return;
    const req = msg as Extract<AcpMessage, { type: "request" }>;
    Promise.resolve()
      .then(() => this.dispatch(req))
      .then((result) => {
        this.transport.send({
          type: "response",
          id: req.id,
          result,
        });
      })
      .catch((err: unknown) => {
        this.transport.send({
          type: "response",
          id: req.id,
          error: acpError("internal", err instanceof Error ? err.message : String(err)),
        });
      });
  }

  private async dispatch(
    req: Extract<AcpMessage, { type: "request" }>,
  ): Promise<unknown> {
    const { method, params } = req;
    const p = (params ?? {}) as Record<string, unknown>;
    const connId = this.transport.connIdOf
      ? this.transport.connIdOf(req.id) ?? null
      : null;
    switch (method) {
      case "session/new": {
        const sid =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const session: AcpSession = {
          sessionId: sid,
          sessionKey: sid,
          cwd: (p.cwd as string) ?? "",
          createdAt: Date.now(),
          lastTouchedAt: Date.now(),
          runtimeOptions: {},
          analysisId: this.analysisIdProvider() ?? null,
        };
        // Resolve a preset if the agent declared one (P1).
        const declaredProfile = (p.permissionProfile as string | undefined) ??
          (p.runtimeOptions as { permissionProfile?: string } | undefined)?.permissionProfile;
        session.resolvedPreset = declaredProfile
          ? this.resolvePreset(declaredProfile)
          : null;
        if (declaredProfile) {
          session.runtimeOptions = {
            ...session.runtimeOptions,
            permissionProfile: declaredProfile,
          };
        }
        this.sessions.set(sid, session);
        if (connId !== null) this.sessionByConn.set(connId, session);
        else this.sessionByConn.set(null, session);
        this.sessionSink?.(session);
        this.emitActivity({
          corrId: sid,
          kind: "session",
          label: `session ${sid.slice(0, 8)}`,
          method: "session/new",
          status: "done",
          detail: this.sessionDetail(session),
          connId,
        });
        return session;
      }

      case "session/set_runtime_options": {
        const sid = p.sessionId as string;
        const session = this.sessions.get(sid);
        if (!session) throw new Error(`no such session: ${sid}`);
        const opts = (p.options ?? {}) as AcpSessionRuntimeOptions;
        session.runtimeOptions = { ...session.runtimeOptions, ...opts };
        // Re-resolve the preset if the agent changed its permission profile.
        if (opts.permissionProfile) {
          session.resolvedPreset = this.resolvePreset(opts.permissionProfile);
        }
        session.lastTouchedAt = Date.now();
        if (connId !== null) this.sessionByConn.set(connId, session);
        else this.sessionByConn.set(null, session);
        this.sessionSink?.(session);
        return session;
      }

      case "resources/list": {
        const list = [...ACP_RESOURCES];
        const aid = this.analysisIdProvider();
        if (aid) {
          // Templated, analysis-scoped URI (P2 context mounting — explicit per-analysis pin).
          list.push({
            uri: `ps://project/${aid}/context`,
            name: "Project Context Pack (this analysis)",
            description:
              "Same 19-section context pack as ps://project/context, but pinned to the active analysis id so an agent that knows its session's analysisId can fetch scoped context directly.",
            mimeType: "application/json",
          });
        }
        return list;
      }

      case "resources/read": {
        const ctx = this.execCtx();
        const uri = p.uri as string;
        if (!uri) throw new Error("resources/read requires uri");
        return readResource(uri, ctx);
      }

      case "tools/list":
        return ACP_TOOLS;

      case "tools/call": {
        const ctx = this.execCtx();
        const name = p.name as string;
        if (!name) throw new Error("tools/call requires name");
        const args = (p.args ?? {}) as Record<string, unknown>;
        // Emit a "running" card; the terminal event (done/error/denied) merges into it.
        this.emitActivity({
          corrId: req.id,
          kind: "tool",
          label: name,
          method: "tools/call",
          status: "running",
          detail: truncate(formatToolArguments(args), 240),
          connId,
        });
        // ── permission gate (Phase 5 + P1 multi-agent presets) ──
        // Resolve the session for this connection so the agent's preset applies.
        const session =
          connId !== null
            ? this.sessionByConn.get(connId)
            : this.sessionByConn.get(null);
        const preset = session?.resolvedPreset ?? null;
        const verdict = evaluateToolPermission(
          name,
          preset,
          alwaysAllowSet.has(name),
        );
        const risk = classifyRisk(name);
        const presetGrant = !!preset && preset.allowedTools.includes(name);
        let approvalNote = "";
        if (verdict === "deny") {
          this.emitActivity({
            corrId: req.id,
            kind: "tool",
            label: name,
            method: "tools/call",
            status: "denied",
            detail: "preset denies this tool",
            connId,
          });
          throw new Error(`tool "${name}" denied by preset policy`);
        }
        if (verdict === "allow") {
          // Reason-precise note so the activity feed is not misleading.
          approvalNote = risk === "safe" ? "" : presetGrant ? " · preset allows" : " · always allow";
        } else {
          // "ask" → raise the Phase 5 approval prompt.
          const decision = await this.requestApproval(req, name, args);
          if (decision === "deny") {
            this.emitActivity({
              corrId: req.id,
              kind: "tool",
              label: name,
              method: "tools/call",
              status: "denied",
              detail: "denied by user",
              connId,
            });
            throw new Error(`tool "${name}" denied by user`);
          }
          if (decision === "always_allow") {
            alwaysAllowSet.add(name);
            approvalNote = " · always allow";
          } else {
            approvalNote = " · allowed once";
          }
        }
        try {
          const result = await callTool(name, args, ctx);
          this.emitActivity({
            corrId: req.id,
            kind: "tool",
            label: name,
            method: "tools/call",
            status: "done",
            detail: `${summarizeOutcome(result)}${approvalNote}`,
            connId,
          });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.emitActivity({
            corrId: req.id,
            kind: "tool",
            label: name,
            method: "tools/call",
            status: "error",
            detail: msg,
            connId,
          });
          throw e;
        }
      }

      default:
        throw new Error(`unknown method: ${method}`);
    }
  }

  /** Resolve a preset id to its gate-relevant shape, or null if unknown. */
  private resolvePreset(id: string): ResolvedPreset | null {
    const preset = this.presetProvider(id);
    if (!preset) return null;
    return { allowedTools: preset.allowedTools, defaultPolicy: preset.defaultPolicy };
  }

  /** Human-readable one-liner for a session (preset + mounted analysis). */
  private sessionDetail(s: AcpSession): string | undefined {
    const parts: string[] = [];
    if (s.runtimeOptions?.permissionProfile) {
      parts.push(`preset: ${s.runtimeOptions.permissionProfile}`);
    }
    if (s.analysisId) parts.push(`analysis: ${s.analysisId.slice(0, 8)}`);
    if (s.cwd) parts.push(s.cwd);
    return parts.join(" · ") || undefined;
  }

  /**
   * Raise an approval request for a risky tool. Returns the user's decision.
   * Fail-closed: if no handler is wired, the tool is denied.
   */
  private async requestApproval(
    req: Extract<AcpMessage, { type: "request" }>,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<AcpApprovalDecision> {
    if (!this.approvalHandler) return "deny";
    const connId = this.transport.connIdOf
      ? this.transport.connIdOf(req.id) ?? null
      : null;
    const approval: AcpApprovalRequest = {
      connId,
      sessionId: (req.params as Record<string, unknown>)?.sessionId as string | null ?? null,
      tool,
      args,
      requestId: req.id,
    };
    return this.approvalHandler(approval);
  }
}

/** Cap a detail string so the feed doesn't bloat with huge JSON payloads. */
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Short, human-readable outcome for a completed tool call (item count / fields). */
function summarizeOutcome(result: unknown): string {
  if (Array.isArray(result)) return `${result.length} items`;
  if (result === null || result === undefined) return "done";
  if (typeof result === "object") {
    const keys = Object.keys(result as Record<string, unknown>);
    return keys.length ? `done (${keys.length} fields)` : "done";
  }
  return "done";
}
