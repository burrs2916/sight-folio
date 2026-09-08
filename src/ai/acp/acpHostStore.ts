// ACP host store — owns the single AcpHost instance and exposes a React hook.
//
// Two transport modes:
//  - "in-process": same-app agents / self-test, zero backend (InProcessTransport).
//  - "ws": external ACP agents connect over ws://127.0.0.1:{port} via the backend
//    WS bridge (WsBridgeTransport). This is what makes the host useful to a real
//    out-of-process agent (claw / OpenClaw coding-agent).
//
// The analysis-id provider is injected once at app start from useProjectStore,
// so the host always resolves the *active* analysis when an agent reads a
// resource or calls a tool.

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AcpHost } from "./host";
import { InProcessTransport } from "./transport";
import { WsBridgeTransport } from "./wsBridge";
import { resetAlwaysAllow } from "./permission";
import type {
  AcpActivity,
  AcpAgentPreset,
  AcpApprovalRequest,
  AcpApprovalDecision,
  AcpSession,
  AcpSessionLogEntry,
} from "./types";
import { useProjectStore } from "../../store/projectStore";

/** Max activity entries retained in the live feed (oldest dropped). */
const ACTIVITY_CAP = 100;
/** Max persisted session-history entries retained across restarts. */
const SESSION_LOG_CAP = 50;
const LS_PRESETS = "acp-host-presets";
const LS_SESSION_LOG = "acp-host-session-log";

/** Default presets seeded on first run (no stored presets yet). */
const DEFAULT_PRESETS: AcpAgentPreset[] = [
  {
    id: "readonly",
    name: "Read-only Coder",
    description: "Navigate & understand only. Writes are denied (no prompt).",
    allowedTools: [
      "file_list",
      "file_read",
      "context_get_section",
      "symbol_search",
      "code_search",
      "symbol_refs",
      "call_graph",
      "dependencies",
      "design_patterns",
      "tech_debt",
      "git_churn",
      "review_findings",
      "file_metrics",
    ],
    defaultPolicy: "deny",
  },
  {
    id: "autofixer",
    name: "Auto-fixer",
    description: "Pre-granted write; other risky tools still prompt.",
    allowedTools: [
      "file_list",
      "file_read",
      "context_get_section",
      "symbol_search",
      "code_search",
      "symbol_refs",
      "call_graph",
      "dependencies",
      "design_patterns",
      "tech_debt",
      "git_churn",
      "review_findings",
      "file_metrics",
      "file_write",
    ],
    defaultPolicy: "ask",
  },
];

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode / quota) — degrade silently.
  }
}

function toLogEntry(s: AcpSession): AcpSessionLogEntry {
  return {
    sessionId: s.sessionId,
    analysisId: s.analysisId ?? null,
    permissionProfile: s.runtimeOptions?.permissionProfile ?? null,
    createdAt: s.createdAt,
    lastTouchedAt: s.lastTouchedAt,
  };
}

let host: AcpHost | null = null;
let connUnlisten: UnlistenFn | null = null;
/** Resolver for the in-flight approval promise (set when an approval is raised). */
let approvalResolver: ((d: AcpApprovalDecision) => void) | null = null;

function makeProvider(): () => string | null {
  return () => useProjectStore.getState().activeAnalysisId ?? null;
}

const DEFAULT_WS_PORT = 18765;

interface AcpHostState {
  enabled: boolean;
  mode: "in-process" | "ws";
  wsPort: number;
  wsListening: boolean;
  wsConnections: number;
  startedAt: number | null;
  error: string | null;
  sessionCount: number;
  lastTest: string | null;
  /** A risky-tool approval currently awaiting the user's decision (or null). */
  pendingApproval: AcpApprovalRequest | null;
  /** Live activity feed (sessions + tool calls), newest last; capped at ACTIVITY_CAP. */
  activity: AcpActivity[];
  /** Clear the live activity feed. */
  clearActivity: () => void;
  /** Agent presets (P1 multi-agent presets). Persisted to localStorage. */
  presets: AcpAgentPreset[];
  /** Add or replace a preset (matched by id). */
  upsertPreset: (preset: AcpAgentPreset) => void;
  /** Remove a preset by id. */
  removePreset: (id: string) => void;
  /** Persisted session-history log (P2 session persistence). Survives host stop/restart. */
  sessionLog: AcpSessionLogEntry[];
  startInProcess: () => void;
  startWs: (port?: number) => Promise<void>;
  stop: () => Promise<void>;
  refresh: () => void;
  setLastTest: (msg: string | null) => void;
  /** Resolve the pending approval with the user's decision. */
  resolveApproval: (decision: AcpApprovalDecision) => void;
}

export const useAcpHostStore = create<AcpHostState>((set, get) => ({
  enabled: false,
  mode: "in-process",
  wsPort: DEFAULT_WS_PORT,
  wsListening: false,
  wsConnections: 0,
  startedAt: null,
  error: null,
  sessionCount: 0,
  lastTest: null,
  pendingApproval: null,
  activity: [],
  presets: loadJSON<AcpAgentPreset[]>(LS_PRESETS, DEFAULT_PRESETS),
  sessionLog: loadJSON<AcpSessionLogEntry[]>(LS_SESSION_LOG, []),

  startInProcess: () => {
    try {
      host = new AcpHost(makeProvider(), new InProcessTransport());
      host.start();
      host.setApprovalHandler(requestApproval);
      host.setActivitySink(recordActivity);
      host.setPresetProvider(makePresetProvider());
      host.setSessionSink(recordSession);
      set({
        enabled: true,
        mode: "in-process",
        wsListening: false,
        wsConnections: 0,
        startedAt: Date.now(),
        error: null,
        sessionCount: host.sessionCount,
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  startWs: async (port) => {
    try {
      const usePort = port ?? get().wsPort;
      const transport = new WsBridgeTransport();
      await transport.start();
      host = new AcpHost(makeProvider(), transport);
      host.start();
      host.setApprovalHandler(requestApproval);
      host.setActivitySink(recordActivity);
      host.setPresetProvider(makePresetProvider());
      host.setSessionSink(recordSession);
      await invoke("start_acp_ws_server", { port: usePort });
      // 跟踪并发连接数（多 Agent 并行）：后端在连接增删时 emit acp-ws-conn。
      connUnlisten?.();
      connUnlisten = await listen<{ connId: string; connected: boolean }>(
        "acp-ws-conn",
        (e) => {
          set((s) => ({
            wsConnections: Math.max(
              0,
              s.wsConnections + (e.payload.connected ? 1 : -1),
            ),
          }));
        },
      );
      set({
        enabled: true,
        mode: "ws",
        wsPort: usePort,
        wsListening: true,
        wsConnections: 0,
        startedAt: Date.now(),
        error: null,
        sessionCount: host.sessionCount,
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  stop: async () => {
    try {
      if (get().mode === "ws") await invoke("stop_acp_ws_server");
    } catch {
      // ignore backend stop errors (server may already be down)
    }
    connUnlisten?.();
    connUnlisten = null;
    approvalResolver = null;
    host?.stop();
    host = null;
    resetAlwaysAllow();
    set({
      enabled: false,
      wsListening: false,
      wsConnections: 0,
      startedAt: null,
      sessionCount: 0,
      pendingApproval: null,
      activity: [],
    });
  },

  refresh: () => set({ sessionCount: host?.sessionCount ?? 0 }),

  setLastTest: (msg) => set({ lastTest: msg }),

  clearActivity: () => set({ activity: [] }),

  upsertPreset: (preset) => {
    set((s) => {
      const next = s.presets.some((p) => p.id === preset.id)
        ? s.presets.map((p) => (p.id === preset.id ? preset : p))
        : [...s.presets, preset];
      saveJSON(LS_PRESETS, next);
      return { presets: next };
    });
  },

  removePreset: (id) => {
    set((s) => {
      const next = s.presets.filter((p) => p.id !== id);
      saveJSON(LS_PRESETS, next);
      return { presets: next };
    });
  },

  resolveApproval: (decision) => {
    const resolver = approvalResolver;
    approvalResolver = null;
    set({ pendingApproval: null });
    resolver?.(decision);
  },
}));

/**
 * Raise an approval request to the UI and return a promise that resolves with the
 * user's decision. The host awaits this before running a risky tool.
 */
function requestApproval(req: AcpApprovalRequest): Promise<AcpApprovalDecision> {
  return new Promise<AcpApprovalDecision>((resolve) => {
    approvalResolver = resolve;
    useAcpHostStore.setState({ pendingApproval: req });
  });
};

/**
 * Merge a live-activity entry into the feed: a terminal event (done/error/denied)
 * updates the in-flight `running` entry with the same `corrId` instead of appending
 * a second card (mirrors `toolCallDisplay`'s running→done merge). Newest last;
 * capped at ACTIVITY_CAP (oldest dropped).
 */
function mergeActivity(list: AcpActivity[], a: AcpActivity): AcpActivity[] {
  if (a.status !== "running") {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].corrId === a.corrId && list[i].status === "running") {
        const next = [...list];
        next[i] = { ...list[i], status: a.status, detail: a.detail, ts: a.ts };
        return next;
      }
    }
  }
  const next = [...list, a];
  return next.length > ACTIVITY_CAP ? next.slice(next.length - ACTIVITY_CAP) : next;
}

/** Sink handed to the host: append/merge into the store's activity feed. */
function recordActivity(a: AcpActivity): void {
  useAcpHostStore.setState((s) => ({ activity: mergeActivity(s.activity, a) }));
}

/** Live preset lookup handed to the host (reads the current store registry). */
function makePresetProvider(): (id: string) => AcpAgentPreset | undefined {
  return (id: string) =>
    useAcpHostStore.getState().presets.find((p) => p.id === id);
}

/** Sink handed to the host: append a session snapshot to the persisted history log. */
function recordSession(s: AcpSession): void {
  useAcpHostStore.setState((state) => {
    const entry = toLogEntry(s);
    const next = [...state.sessionLog.filter((e) => e.sessionId !== entry.sessionId), entry];
    const capped =
      next.length > SESSION_LOG_CAP ? next.slice(next.length - SESSION_LOG_CAP) : next;
    saveJSON(LS_SESSION_LOG, capped);
    return { sessionLog: capped };
  });
}

/** Access the live host instance (e.g. for the self-test button in the panel). */
export function getAcpHost(): AcpHost | null {
  return host;
}
