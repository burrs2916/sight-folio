// ACP (Agent Client Protocol) host-side contract types.
// Adapted from openclaw/packages/acp-core (MIT). sight-folio reuses the same
// session / runtime-option / resource / tool shape so any ACP-compliant agent
// (claw, OpenClaw coding-agent, or a future in-house agent) can drive this
// workbench as its editor/host surface.

export type AcpSessionId = string;

/** Per-turn runtime options — mirrors acp-core AcpSessionRuntimeOptions. */
export interface AcpSessionRuntimeOptions {
  /** ACP runtime mode, e.g. "plan" | "normal" | "auto". */
  runtimeMode?: string;
  /** Model id (resolved dynamically to endpoint+provider at call time). */
  model?: string;
  /** Thinking / reasoning effort. */
  thinking?: string;
  /** Working directory override for the session turn. */
  cwd?: string;
  /** Permission profile id (reuses sight-folio's existing permission model). */
  permissionProfile?: string;
  /** Per-turn timeout in seconds. */
  timeoutSeconds?: number;
  /** Backend-specific option bag. */
  backendExtras?: Record<string, string>;
}

export interface AcpSession {
  sessionId: AcpSessionId;
  sessionKey: string;
  cwd: string;
  createdAt: number;
  lastTouchedAt: number;
  runtimeOptions: AcpSessionRuntimeOptions;
  /**
   * Project analysis mounted into this session (P2 / context mounting). The host
   * records the active analysis at session creation so the agent (and the UI) can
   * see which project context this session is bound to. Resources/tools still
   * resolve the live active analysis at call time; this is the displayed binding.
   */
  analysisId?: string | null;
  /**
   * Preset resolved from `runtimeOptions.permissionProfile` (P1). null when the
   * session declared no preset or an unknown id — the gate then falls back to the
   * host-wide always-allow set + the approval prompt.
   */
  resolvedPreset?: ResolvedPreset | null;
}

/** A contextual resource the host exposes to the agent (read-only context). */
export interface AcpResource {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

/** A callable tool the host exposes (filesystem / scan-context actions). */
export interface AcpTool {
  name: string;
  description: string;
  /** JSON-schema-ish input descriptor. */
  inputSchema: Record<string, unknown>;
}

/** Lightweight JSON-RPC-style envelope used over the transport. */
export type AcpMessage =
  | { type: "request"; id: string; method: string; params?: unknown }
  | { type: "response"; id: string; result?: unknown; error?: AcpError }
  | { type: "event"; id: string; event: string; params?: unknown };

export interface AcpError {
  code: string;
  message: string;
}

export function acpError(code: string, message: string): AcpError {
  return { code, message };
}

/**
 * A pending tool-execution approval the host raises *before* running a risky
 * tool (write/danger). Surfaced to the user via AcpHostPanel; the user's
 * decision flows back through `AcpApprovalDecision`.
 *
 * Note: sight-folio's in-house agent has a backend `agent-tool-approval`
 * channel, but that flow is coupled to the backend run loop (it holds the
 * pending execution and waits on `resolve_tool_approval`). The ACP host holds
 * its own pending execution on the frontend, so it uses this ACP-native gate
 * instead — same UX/semantics, zero backend changes, no coupling.
 */
export interface AcpApprovalRequest {
  /** Originating connection id (multi-agent), or null for in-process. */
  connId: string | null;
  /** Agent-supplied session id, if any. */
  sessionId: string | null;
  /** Tool name about to be called. */
  tool: string;
  /** Tool arguments (summary shown to the user). */
  args: Record<string, unknown>;
  /** Correlation id for this approval (== the ACP request id). */
  requestId: string;
}

export type AcpApprovalDecision = "allow_once" | "always_allow" | "deny";

/**
 * A named, configurable agent preset (P1 / multi-agent presets).
 *
 * An external agent declares which preset it wants by setting
 * `runtimeOptions.permissionProfile` (= the preset id) on `session/new` or
 * `session/set_runtime_options`. The host resolves the id to a preset and
 * enforces its `allowedTools` + `defaultPolicy` in the permission gate — so a
 * "read-only coder" preset can never call `file_write` without an explicit ask,
 * while an "auto-fixer" preset can be pre-granted write.
 *
 * This is the concrete object the long-unused `permissionProfile` field
 * (AcpSessionRuntimeOptions) was always meant to point at.
 */
export type AcpPresetPolicy = "ask" | "deny";

export interface AcpAgentPreset {
  /** Stable id, referenced by runtimeOptions.permissionProfile. */
  id: string;
  name: string;
  description?: string;
  /** Tool names this preset explicitly grants (auto-allow, skip user prompt). */
  allowedTools: string[];
  /**
   * What to do for tools NOT in `allowedTools`:
   *  - "ask"   : raise the ACP approval prompt (Phase 5 UX) — user decides.
   *  - "deny"  : block immediately, no prompt.
   */
  defaultPolicy: AcpPresetPolicy;
}

/** Preset reduced to what the gate needs at call time (decoupled from the registry). */
export interface ResolvedPreset {
  allowedTools: string[];
  defaultPolicy: AcpPresetPolicy;
}

/** A persisted, lightweight snapshot of a past session (P2 session persistence). */
export interface AcpSessionLogEntry {
  sessionId: string;
  analysisId?: string | null;
  permissionProfile?: string | null;
  createdAt: number;
  lastTouchedAt: number;
}

/**
 * Live activity feed status — shares the same vocabulary as the in-house agent's
 * `ToolCallEvent` ("running" | "done" | "error" | "denied") so the ACP Host
 * panel can reuse `toolCallDisplay`'s status label/color helpers directly.
 */
export type AcpActivityStatus = "running" | "done" | "error" | "denied";

/**
 * A single live activity entry surfaced in the ACP Host panel. Covers the two
 * meaningful agent actions: opening a session and calling a tool. A tool call
 * emits a `running` entry followed by a terminal `done`/`error`/`denied` entry
 * that merges into the same card (keyed by `corrId` == the ACP request id).
 */
export interface AcpActivity {
  /** Unique entry id (React key / dedupe). */
  id: string;
  /** Correlation id — groups a running call with its terminal event (= ACP request id, or session id for sessions). */
  corrId: string;
  kind: "session" | "tool";
  /** Display label: tool name, or `session <short-id>`. */
  label: string;
  /** ACP method, e.g. "tools/call", "session/new". */
  method: string;
  status: AcpActivityStatus;
  /** Human-readable args/result summary (already truncated by the host). */
  detail?: string;
  /** Originating connection id (multi-agent), or null for in-process. */
  connId?: string | null;
  ts: number;
}

/**
 * Per-dispatch context resolved by the host from the live app state.
 * The agent never supplies `analysisId` directly — it is injected from the
 * active project analysis so a connected agent can only ever touch the
 * analysis the user is currently looking at.
 */
export interface AcpExecutionContext {
  analysisId: string;
}
