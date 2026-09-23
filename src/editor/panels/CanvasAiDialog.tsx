// 画布 AI 助手对话框（H3）：指令 → AI 出操作方案 → 用户预览 → 应用/撤销。
//
// 交互铁律（平台不擅自改用户的作品）：
//   - 生成方案后**不自动应用**，必须用户点「应用到画布」；
//   - 应用前自动快照，对话框内随时「撤销本次」一步回到应用前；
//   - AI 返回的操作逐条展示人话摘要，用户看得出每一刀改在哪。
import { useEffect, useMemo, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import UndoIcon from "@mui/icons-material/Undo";
import { useAgentStore } from "../../store/agentStore";
import { useEditorStore } from "../../store/editorStore";
import { useDirtyStore } from "../../store/editorStore";
import {
  runCanvasAssistantTask,
  applyCanvasOps,
  type CanvasAiOp,
  type CanvasApplyResult,
} from "../../ai/canvasAssistant";
import { useToastStore } from "../../store/toastStore";
import { t } from "../../i18n";

/** 把一条 op 翻译成人话（预览列表用） */
function describeOp(op: CanvasAiOp, nameOf: (id: string) => string): string {
  switch (op.op) {
    case "move":
      return t("studio.canvasAi.opMove", { name: nameOf(op.id), x: Math.round(op.x), y: Math.round(op.y) });
    case "resize":
      return t("studio.canvasAi.opResize", { name: nameOf(op.id), w: Math.round(op.width), h: Math.round(op.height) });
    case "rename":
      return t("studio.canvasAi.opRename", { name: nameOf(op.id), newName: op.name });
    case "set_text":
      return t("studio.canvasAi.opSetText", { name: nameOf(op.id) });
    case "remove":
      return t("studio.canvasAi.opRemove", { name: nameOf(op.id) });
    case "add":
      return t("studio.canvasAi.opAdd", { type: op.type, name: op.name });
    case "arrange_grid":
      return t("studio.canvasAi.opGrid", { n: op.ids.length, cols: op.columns ?? 4 });
    default:
      return String((op as { op?: string }).op ?? "");
  }
}

export function CanvasAiDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const showToast = useToastStore((s) => s.showToast);

  const [agentId, setAgentId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [running, setRunning] = useState(false);
  const [ops, setOps] = useState<CanvasAiOp[] | null>(null);
  const [dropped, setDropped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<CanvasApplyResult | null>(null);
  /** 应用前的画布快照（撤销用）：views/globalComponents/activeViewId */
  const [undoSnapshot, setUndoSnapshot] = useState<{
    views: unknown[];
    globalComponents: unknown[];
    activeViewId: string;
  } | null>(null);

  useEffect(() => {
    if (open) void loadAgents().catch(() => {});
  }, [open, loadAgents]);

  // 每次打开重置流程
  useEffect(() => {
    if (open) {
      setOps(null);
      setError(null);
      setApplied(null);
      setUndoSnapshot(null);
      setDropped(0);
    }
  }, [open]);

  const nameOf = useMemo(() => {
    const comps = useEditorStore.getState().components;
    const map = new Map(comps.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? id.slice(0, 8);
  }, [ops]);

  const handleRun = async () => {
    if (!agentId || !instruction.trim()) return;
    setRunning(true);
    setError(null);
    setOps(null);
    setApplied(null);
    setUndoSnapshot(null);
    try {
      const res = await runCanvasAssistantTask({ agentId, instruction: instruction.trim() });
      setOps(res.ops);
      setDropped(res.dropped);
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleApply = () => {
    if (!ops || ops.length === 0) return;
    const ed = useEditorStore.getState();
    // 应用前快照（一步撤销的底牌）
    setUndoSnapshot(ed.exportSceneWithViews() as { views: unknown[]; globalComponents: unknown[]; activeViewId: string });
    const res = applyCanvasOps(ops);
    setApplied(res);
    useDirtyStore.getState().markDirty();
    showToast(t("studio.canvasAi.applied", { applied: res.applied, skipped: res.skipped }), "success");
  };

  const handleUndo = () => {
    if (!undoSnapshot) return;
    const ed = useEditorStore.getState();
    ed.loadSceneWithViews(
      undoSnapshot.views as never,
      undoSnapshot.globalComponents as never,
      undoSnapshot.activeViewId,
    );
    useDirtyStore.getState().markDirty();
    setUndoSnapshot(null);
    setApplied(null);
    showToast(t("studio.canvasAi.undone"), "success");
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, pb: 1 }}>{t("studio.canvasAi.title")}</DialogTitle>
      <DialogContent sx={{ pt: 1, display: "flex", flexDirection: "column", gap: 1.5 }}>
        {/* Agent 选择：与写作页同约定 —— 用户选，本页绝不推断 */}
        <TextField
          select
          size="small"
          label={t("studio.canvasAi.agent")}
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          fullWidth
        >
          {agents.length === 0 && <MenuItem value="">{t("studio.canvasAi.noAgent")}</MenuItem>}
          {agents.map((a) => (
            <MenuItem key={a.id} value={a.id}>
              {a.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          multiline
          minRows={2}
          maxRows={5}
          label={t("studio.canvasAi.instruction")}
          placeholder={t("studio.canvasAi.placeholder")}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          fullWidth
        />
        {error && <Alert severity="error" variant="outlined">{error}</Alert>}
        {ops && ops.length > 0 && (
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
              {t("studio.canvasAi.planTitle", { n: ops.length })}
              {dropped > 0 ? ` · ${t("studio.canvasAi.dropped", { n: dropped })}` : ""}
            </Typography>
            <Box sx={{ mt: 0.5, maxHeight: 200, overflowY: "auto" }}>
              {ops.map((op, i) => (
                <Typography key={i} variant="body2" sx={{ fontSize: 12, py: 0.15 }}>
                  • {describeOp(op, nameOf)}
                </Typography>
              ))}
            </Box>
          </Box>
        )}
        {applied && (
          <Alert severity="success" variant="outlined">
            {t("studio.canvasAi.applied", { applied: applied.applied, skipped: applied.skipped })}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 1.5, gap: 0.5 }}>
        {undoSnapshot && (
          <Button size="small" color="warning" startIcon={<UndoIcon sx={{ fontSize: 15 }} />} onClick={handleUndo}>
            {t("studio.canvasAi.undo")}
          </Button>
        )}
        <Button size="small" onClick={onClose}>
          {t("nav.cancel")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={running || !agentId || !instruction.trim()}
          startIcon={running ? <CircularProgress size={13} color="inherit" /> : <AutoFixHighIcon sx={{ fontSize: 15 }} />}
          onClick={() => void handleRun()}
        >
          {t("studio.canvasAi.run")}
        </Button>
        <Button size="small" variant="contained" disabled={!ops || ops.length === 0} onClick={handleApply}>
          {t("studio.canvasAi.apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
