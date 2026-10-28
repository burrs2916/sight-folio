// AcpHostPanel — UI surface for the in-app ACP host.
//
// Two modes:
//  - In-process: same-app agents / self-test, zero backend (InProcessTransport).
//  - WebSocket: start the backend WS bridge so an EXTERNAL ACP agent (claw /
//    OpenClaw coding-agent) connects and drives this workbench as its editor.
//
// This is what moves the host from "renderable" to "useful": an out-of-process
// agent can actually connect and read/write the project through the ACP protocol.

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import HubIcon from "@mui/icons-material/Hub";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import { useAcpHostStore, getAcpHost } from "./acpHostStore";
import type { AcpMessage, AcpActivity, AcpAgentPreset, AcpSession, AcpPresetPolicy } from "./types";
import { ACP_RESOURCES } from "./resources";
import { ACP_TOOLS } from "./tools";
import { toolStatusColor, toolStatusLabel } from "../../utils/toolCallDisplay";
import type { ToolCallEvent } from "../../services/tauri";
import { t } from "../../i18n";

/**
 * One row in the live activity feed. Reuses the in-house agent's `toolCallDisplay`
 * status label/color helpers (same "running"/"done"/"error"/"denied" vocabulary),
 * so the ACP Host panel stays visually consistent with the rest of the app.
 */
function ActivityRow({ a }: { a: AcpActivity }) {
  const status = a.status as ToolCallEvent["status"];
  const conn = a.connId ? `#${a.connId.slice(0, 4)}` : "local";
  return (
    <Box
      sx={{
        display: "flex",
        gap: 0.75,
        alignItems: "flex-start",
        py: 0.4,
        borderBottom: "1px solid",
        borderColor: "divider",
        "&:last-child": { borderBottom: 0 },
      }}
    >
      <Chip
        label={toolStatusLabel(status)}
        size="small"
        color={toolStatusColor(status)}
        sx={{ fontSize: 10, height: 18, minWidth: 46, fontWeight: 700 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{ fontSize: 11, fontFamily: "monospace", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {a.label}
          <Typography component="span" sx={{ fontSize: 10, color: "text.secondary", fontWeight: 400 }}>
            {" "}
            {conn}
          </Typography>
        </Typography>
        {a.detail ? (
          <Typography
            sx={{
              fontSize: 10,
              color: "text.secondary",
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {a.detail}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

/**
 * Inline editor for an agent preset (P1 multi-agent presets). `initial` carries the
 * preset being edited (or null when adding a new one). The parent owns persistence
 * via `onSave` (which calls `upsertPreset`).
 */
function PresetEditor({
  initial,
  tools,
  onSave,
  onCancel,
}: {
  initial: AcpAgentPreset | null;
  tools: string[];
  onSave: (p: AcpAgentPreset) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [policy, setPolicy] = useState<AcpPresetPolicy>(initial?.defaultPolicy ?? "ask");
  const [allowed, setAllowed] = useState<Set<string>>(
    new Set(initial?.allowedTools ?? []),
  );

  const toggleTool = (tool: string) =>
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      return next;
    });

  const save = () => {
    const id = initial?.id && initial.id.length > 0
      ? initial.id
      : `preset_${Date.now().toString(36)}`;
    onSave({
      id,
      name: name.trim() || id,
      description: description.trim() || undefined,
      allowedTools: [...allowed],
      defaultPolicy: policy,
    });
  };

  return (
    <Box
      sx={{
        p: 1,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1.5,
        mb: 1,
        bgcolor: "background.default",
      }}
    >
      <TextField
        label={t("acp.presetName")}
        size="small"
        fullWidth
        value={name}
        onChange={(e) => setName(e.target.value)}
        sx={{ mb: 0.75, "& .MuiInputBase-input": { fontSize: 12 } }}
      />
      <TextField
        label={t("acp.presetDesc")}
        size="small"
        fullWidth
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        sx={{ mb: 0.75, "& .MuiInputBase-input": { fontSize: 12 } }}
      />
      <Typography sx={{ fontSize: 11, color: "text.secondary", mb: 0.25 }}>
        {t("acp.presetPolicy")}
      </Typography>
      <Box sx={{ display: "flex", gap: 0.5, mb: 0.75 }}>
        <Button
          size="small"
          variant={policy === "ask" ? "contained" : "outlined"}
          onClick={() => setPolicy("ask")}
          sx={{ textTransform: "none", fontSize: 11, borderRadius: 2 }}
        >
          {t("acp.policyAsk")}
        </Button>
        <Button
          size="small"
          variant={policy === "deny" ? "contained" : "outlined"}
          color="error"
          onClick={() => setPolicy("deny")}
          sx={{ textTransform: "none", fontSize: 11, borderRadius: 2 }}
        >
          {t("acp.policyDeny")}
        </Button>
      </Box>
      <Typography sx={{ fontSize: 11, color: "text.secondary", mb: 0.25 }}>
        {t("acp.allowedTools")}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 0.75 }}>
        {tools.map((tool) => {
          const on = allowed.has(tool);
          return (
            <Chip
              key={tool}
              label={tool}
              size="small"
              clickable
              color={on ? "primary" : "default"}
              variant={on ? "filled" : "outlined"}
              onClick={() => toggleTool(tool)}
              sx={{ fontSize: 10 }}
            />
          );
        })}
      </Box>
      <Box sx={{ display: "flex", gap: 0.75 }}>
        <Button
          size="small"
          variant="contained"
          onClick={save}
          sx={{ textTransform: "none", fontSize: 11, borderRadius: 2 }}
        >
          {t("acp.save")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={onCancel}
          sx={{ textTransform: "none", fontSize: 11, borderRadius: 2 }}
        >
          {t("acp.cancel")}
        </Button>
      </Box>
    </Box>
  );
}

export function AcpHostPanel() {
  const {
    enabled,
    mode,
    wsPort,
    wsListening,
    wsConnections,
    startedAt,
    error,
    lastTest,
    pendingApproval,
    resolveApproval,
    activity,
    clearActivity,
    presets,
    sessionLog,
    upsertPreset,
    removePreset,
    startInProcess,
    startWs,
    stop,
    setLastTest,
  } = useAcpHostStore();
  const [testing, setTesting] = useState(false);
  const [portInput, setPortInput] = useState<number>(wsPort);
  const [liveSessions, setLiveSessions] = useState<AcpSession[]>([]);
  // Preset editor: null = closed; a preset object = editing it; empty new = adding.
  const [editing, setEditing] = useState<AcpAgentPreset | null>(null);

  // One-line, human-readable summary of a tool's arguments for the approval card.
  const summarizeArgs = (args: Record<string, unknown>): string => {
    if (args.fileId) return `fileId: ${String(args.fileId)}`;
    if (args.query) return `query: "${String(args.query)}"`;
    if (args.uri) return `uri: ${String(args.uri)}`;
    if (args.sectionKey) return `sectionKey: ${String(args.sectionKey)}`;
    const rest = Object.entries(args)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(", ");
    return rest.length > 80 ? `${rest.slice(0, 80)}…` : rest;
  };

  // Keep session count fresh while enabled.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const h = getAcpHost();
      if (h) useAcpHostStore.setState({ sessionCount: h.sessionCount });
    }, 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  // Poll live sessions for the Sessions section while enabled.
  useEffect(() => {
    if (!enabled) {
      setLiveSessions([]);
      return;
    }
    const poll = () => {
      const h = getAcpHost();
      setLiveSessions(h ? h.listSessions() : []);
    };
    poll();
    const id = window.setInterval(poll, 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  /** Resolve a preset id to its display name (falls back to the id itself). */
  const presetName = (id?: string | null): string =>
    id ? presets.find((p) => p.id === id)?.name ?? id : "—";

  const runSelfTest = () => {
    const h = getAcpHost();
    if (!h || !h.isStarted) {
      setLastTest("host not started — start in-process mode first");
      return;
    }
    setTesting(true);
    setLastTest(null);

    const results: Record<string, unknown> = {};
    const pending = new Set<string>(["t-session", "t-tools", "t-resources"]);
    let unsub: (() => void) | null = null;

    const finish = () => {
      unsub?.();
      const sid = results["t-session"] as { sessionId?: string } | undefined;
      const tools = (results["t-tools"] as unknown[]) ?? [];
      const resources = (results["t-resources"] as unknown[]) ?? [];
      if (sid?.sessionId && tools.length && resources.length) {
        setLastTest(
          `OK · session ${sid.sessionId.slice(0, 8)}… · ${tools.length} tools · ${resources.length} resources`,
        );
      } else {
        setLastTest("self-test incomplete — check console");
      }
      setTesting(false);
    };

    unsub = h.subscribe((m: AcpMessage) => {
      if (m.type !== "response") return;
      if (m.error) {
        setLastTest(`self-test error: ${m.error.message}`);
        unsub?.();
        setTesting(false);
        return;
      }
      if (m.id === "t-session") results["t-session"] = m.result;
      if (m.id === "t-tools") results["t-tools"] = m.result;
      if (m.id === "t-resources") results["t-resources"] = m.result;
      pending.delete(m.id);
      if (pending.size === 0) finish();
    });

    h.deliver({ type: "request", id: "t-session", method: "session/new" });
    h.deliver({ type: "request", id: "t-tools", method: "tools/list" });
    h.deliver({ type: "request", id: "t-resources", method: "resources/list" });

    window.setTimeout(() => {
      if (pending.size > 0) {
        setLastTest("self-test timed out");
        unsub?.();
        setTesting(false);
      }
    }, 5000);
  };

  const wsUrl = `ws://127.0.0.1:${wsPort}`;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, borderRadius: 2, borderColor: enabled ? "primary.main" : "divider" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
        <HubIcon sx={{ fontSize: 20, color: enabled ? "primary.main" : "text.secondary" }} />
        <Typography sx={{ fontSize: 14, fontWeight: 700, flex: 1 }}>
          ACP Host
        </Typography>
        {enabled && (
          <Chip
            label={mode === "ws" ? "WebSocket" : "In-process"}
            size="small"
            color={mode === "ws" ? "secondary" : "default"}
            sx={{ fontSize: 11 }}
          />
        )}
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, lineHeight: 1.6, mb: 1.5 }}>
        Let an ACP-compliant agent (claw / OpenClaw coding-agent / in-house) drive this
        workbench as its editor. Exposes project context, scan records, files, and
        insight tools over the Agent Client Protocol.
      </Typography>

      {error && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1, color: "error.main" }}>
          <ErrorIcon fontSize="small" />
          <Typography sx={{ fontSize: 12 }}>{error}</Typography>
        </Box>
      )}

      {!enabled && (
        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
            External agent mode (recommended): starts a local WebSocket server.
          </Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 0.75, mb: 1 }}>
            <TextField
              label="WS port"
              type="number"
              size="small"
              value={portInput}
              onChange={(e) => setPortInput(Number(e.target.value) || wsPort)}
              sx={{ width: 120, "& .MuiInputBase-input": { fontSize: 12 } }}
            />
          </Box>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => startInProcess()}
              sx={{ textTransform: "none", fontSize: 12, borderRadius: 2 }}
            >
              Start (in-process)
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => startWs(portInput)}
              sx={{ textTransform: "none", fontSize: 12, borderRadius: 2 }}
            >
              Start (WebSocket)
            </Button>
          </Box>
        </Box>
      )}

      {enabled && (
        <>
          <Box sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
              Status: {mode} · started {startedAt ? new Date(startedAt).toLocaleTimeString() : "—"}
              {mode === "ws" && wsListening ? ` · listening ${wsUrl}` : ""}
            </Typography>
          </Box>

          {pendingApproval && (
            <Box
              sx={{
                mb: 1.5,
                p: 1.25,
                borderRadius: 1.5,
                border: "1px solid",
                borderColor: "warning.main",
                bgcolor: "warning.light",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}>
                <WarningAmberIcon fontSize="small" sx={{ color: "warning.main" }} />
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: "warning.main" }}>
                  Agent requests tool: {pendingApproval.tool}
                </Typography>
              </Box>
              <Typography
                sx={{ fontSize: 11, color: "text.secondary", mb: 0.75, fontFamily: "monospace", wordBreak: "break-all" }}
              >
                {summarizeArgs(pendingApproval.args)}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  onClick={() => resolveApproval("allow_once")}
                  sx={{ textTransform: "none", fontSize: 11, borderRadius: 2 }}
                >
                  Allow once
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="success"
                  onClick={() => resolveApproval("always_allow")}
                  sx={{ textTransform: "none", fontSize: 11, borderRadius: 2 }}
                >
                  Always allow
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={() => resolveApproval("deny")}
                  sx={{ textTransform: "none", fontSize: 11, borderRadius: 2 }}
                >
                  Deny
                </Button>
              </Box>
            </Box>
          )}

          {mode === "ws" && (
            <Box
              sx={{
                mb: 1.5,
                p: 1,
                borderRadius: 1.5,
                bgcolor: "action.hover",
                border: "1px dashed",
                borderColor: "divider",
              }}
            >
              <Typography sx={{ fontSize: 11, color: "text.secondary", mb: 0.5 }}>
                Connect your ACP agent to:
              </Typography>
              <Typography
                sx={{ fontSize: 12, fontFamily: "monospace", fontWeight: 600, color: "secondary.main" }}
              >
                {wsUrl}
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.75 }}>
                <Chip
                  label={wsConnections > 0 ? `${wsConnections} agent${wsConnections > 1 ? "s" : ""} connected` : "no agents connected"}
                  size="small"
                  color={wsConnections > 0 ? "success" : "default"}
                  sx={{ fontSize: 11, height: 22 }}
                />
                <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                  parallel sessions supported
                </Typography>
              </Box>
            </Box>
          )}

          <Box sx={{ mb: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                Activity feed
              </Typography>
              <Button
                size="small"
                onClick={clearActivity}
                disabled={activity.length === 0}
                sx={{ fontSize: 10, textTransform: "none", minWidth: 0, px: 0.5, py: 0.25 }}
              >
                clear
              </Button>
            </Box>
            <Box
              sx={{
                maxHeight: 210,
                overflowY: "auto",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1.5,
                p: 0.75,
                bgcolor: "background.default",
              }}
            >
              {activity.length === 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                  No agent activity yet — connect an ACP agent and call a tool.
                </Typography>
              ) : (
                activity
                  .slice()
                  .reverse()
                  .map((a) => <ActivityRow key={a.id} a={a} />)
              )}
            </Box>
          </Box>

          {/* ─── Agent Presets (P1 multi-agent presets) ─── */}
          <Box sx={{ mb: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{t("acp.presets")}</Typography>
              {!editing && (
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() =>
                    setEditing({ id: "", name: "", description: "", allowedTools: [], defaultPolicy: "ask" })
                  }
                  sx={{ fontSize: 10, textTransform: "none", minWidth: 0, px: 0.5, py: 0.25 }}
                >
                  {t("acp.addPreset")}
                </Button>
              )}
            </Box>
            {editing ? (
              <PresetEditor
                initial={editing.id ? editing : null}
                tools={ACP_TOOLS.map((x) => x.name)}
                onSave={(p) => {
                  upsertPreset(p);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : presets.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                {t("acp.noPresets")}
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                {presets.map((p) => (
                  <Box
                    key={p.id}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      p: 0.5,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 11, fontWeight: 600 }}>{p.name}</Typography>
                      <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                        <Chip
                          label={p.defaultPolicy === "deny" ? t("acp.policyDeny") : t("acp.policyAsk")}
                          size="small"
                          color={p.defaultPolicy === "deny" ? "error" : "default"}
                          sx={{ fontSize: 9, height: 16 }}
                        />
                        <Typography sx={{ fontSize: 10, color: "text.secondary" }}>
                          {p.allowedTools.length} {t("acp.allowedToolsCount")}
                        </Typography>
                      </Box>
                    </Box>
                    <IconButton size="small" onClick={() => setEditing(p)} aria-label={t("acp.editPreset")}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => removePreset(p.id)} aria-label={t("acp.deletePreset")}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          {/* ─── Sessions (P2 context mounting + persistence) ─── */}
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>{t("acp.sessions")}</Typography>
            {liveSessions.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                {t("acp.noActiveSessions")}
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4, mb: 0.5 }}>
                {liveSessions.map((s) => (
                  <Box
                    key={s.sessionId}
                    sx={{ p: 0.5, border: "1px solid", borderColor: "divider", borderRadius: 1 }}
                  >
                    <Typography sx={{ fontSize: 11, fontFamily: "monospace" }}>
                      {s.sessionId.slice(0, 8)}
                    </Typography>
                    <Typography sx={{ fontSize: 10, color: "text.secondary" }}>
                      {t("acp.mountedAnalysis")}: {s.analysisId ? s.analysisId.slice(0, 8) : "—"} ·{" "}
                      {t("acp.preset")}: {presetName(s.runtimeOptions?.permissionProfile)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
            {sessionLog.length > 0 && (
              <Box>
                <Typography sx={{ fontSize: 11, fontWeight: 600, mb: 0.25 }}>
                  {t("acp.pastSessions")}
                </Typography>
                <Box sx={{ maxHeight: 120, overflowY: "auto" }}>
                  {sessionLog
                    .slice()
                    .reverse()
                    .map((e) => (
                      <Box
                        key={e.sessionId}
                        sx={{
                          display: "flex",
                          gap: 0.5,
                          py: 0.25,
                          borderBottom: "1px solid",
                          borderColor: "divider",
                        }}
                      >
                        <Typography sx={{ fontSize: 10, fontFamily: "monospace", color: "text.secondary" }}>
                          {e.sessionId.slice(0, 8)}
                        </Typography>
                        <Typography sx={{ fontSize: 10, color: "text.secondary" }}>
                          {e.analysisId ? e.analysisId.slice(0, 8) : "—"} · {presetName(e.permissionProfile)}
                        </Typography>
                      </Box>
                    ))}
                </Box>
              </Box>
            )}
          </Box>

          <Button
            size="small"
            variant="outlined"
            color="inherit"
            onClick={() => stop()}
            sx={{ textTransform: "none", fontSize: 12, borderRadius: 2, mb: 1 }}
          >
            Stop host
          </Button>
        </>
      )}

      <Divider sx={{ my: 1.5 }} />

      <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.75 }}>
        Exposed resources ({ACP_RESOURCES.length})
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1.5 }}>
        {ACP_RESOURCES.map((r) => (
          <Chip key={r.uri} label={r.name} size="small" variant="outlined" sx={{ fontSize: 11 }} />
        ))}
      </Box>

      <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.75 }}>
        Exposed tools ({ACP_TOOLS.length})
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1.5 }}>
        {ACP_TOOLS.map((t) => (
          <Chip key={t.name} label={t.name} size="small" color="primary" variant="outlined" sx={{ fontSize: 11 }} />
        ))}
      </Box>

      <Divider sx={{ my: 1.5 }} />

      {mode === "in-process" ? (
        <>
          <Button
            size="small"
            variant="outlined"
            onClick={runSelfTest}
            disabled={testing || !enabled}
            startIcon={testing ? undefined : <CheckCircleIcon />}
            sx={{ textTransform: "none", fontSize: 12, borderRadius: 2 }}
          >
            {testing ? "Testing…" : "Self-test wiring"}
          </Button>
          {lastTest && (
            <Typography
              variant="caption"
              sx={{
                display: "block",
                mt: 1,
                fontSize: 11,
                color: lastTest.startsWith("OK") ? "success.main" : "text.secondary",
                fontFamily: "monospace",
              }}
            >
              {lastTest}
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
          External agent drives the host over WebSocket — no in-app self-test. Start your ACP
          agent and point it at the URL above.
        </Typography>
      )}
    </Paper>
  );
}
