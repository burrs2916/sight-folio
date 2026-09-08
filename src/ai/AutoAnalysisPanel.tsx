/**
 * AutoAnalysisPanel —— 自动分析规则配置 + 运行轨迹。
 *
 * 解决的问题：扫描把数据准备得再好，如果每次都要人点一下「开始分析」，绝大多数
 * 数据更新最终无人解读。这里让用户声明一次「以后扫描完自动让谁分析」，之后分析
 * 随数据自动发生。
 *
 * 两个设计取舍：
 *   · **Agent 只能从已配置列表里选**，面板不提供任何默认值——自动化最怕的就是
 *     用户不知道背后在用哪个模型烧 token。
 *   · **跳过也要展示原因**。冷却中 / 内容没变 / Agent 少了工具，这些都会写进运行
 *     轨迹。没有这块，用户面对「怎么没自动跑」只能猜，自动化就成了黑箱。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import BoltIcon from "@mui/icons-material/Bolt";
import HistoryIcon from "@mui/icons-material/History";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import { useAgentStore } from "../store/agentStore";
import { aiContextRegistry } from "./contextRegistry";
import { CONTEXT_TOOL_ID } from "./analysisRunner";
import { PRESET_ROTATE, TRIGGER_ON_ANY, TRIGGER_ON_FULL } from "./autoAnalysisOrchestrator";
import { getSchedulerStatus, tickAnalysisScheduler } from "./analysisScheduler";
import {
  buildAnalysisCoverage,
  pickNextPreset,
  summarizeCoverage,
  type AnalysisCoverageRow,
  type AnalysisCoverageState,
} from "./analysisCoverage";
import { aiContextApi } from "../services/tauri";
import type { AiAutoAnalysisRule, AiAutoAnalysisRun } from "../services/tauri";
import { logger } from "../utils/logger";
import { t, pickLang } from "../i18n";

interface Props {
  /** 供给模块 id —— 面板本身模块无关，未来别的模块直接复用 */
  moduleId: string;
  /** 当前作用域（扫描 = analysisId），用于「仅本分析」选项 */
  scopeId?: string;
  compact?: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  triggered: "#22c55e",
  skipped: "#94a3b8",
  failed: "#ef4444",
};

/**
 * 一轮分析发起之后的归宿。
 *
 * 「已发起」不等于「已分析」：消息发出去之后模型可能报错、连接可能断、
 * Agent 也可能兜一圈一条结论都没留下。只显示 triggered 的绿点，
 * 用户会以为这一轮好好跑过了 —— 这正是自动化最容易骗人的地方。
 */
const OUTCOME_LABEL: Record<string, { text: string; color: string }> = {
  pending: { text: t("aiPanel.outcome.pending"), color: "#38bdf8" },
  completed: { text: t("aiPanel.outcome.completed"), color: "#22c55e" },
  "no-output": { text: t("aiPanel.outcome.noOutput"), color: "#f59e0b" },
  error: { text: t("aiPanel.outcome.error"), color: "#ef4444" },
  // 与「对话失败」分开显示：效力相同（都不算覆盖、都要退回派单），但死法不同。
  // 合成一个值，用户会为一次「关了窗口」去排查模型和密钥。
  interrupted: { text: t("aiPanel.outcome.interrupted"), color: "#f97316" },
};

/**
 * 一轮分析「为什么会发起 / 为什么被跳过」的短标签。
 *
 * detail 那句中文已经说明了情况，但它是自由文本，扫一眼十几条轨迹时读不过来；
 * 更要命的是**数据没变却仍然发起**的那几种（补维度、补文件、补欠账）——
 * 用户看到的只是「又跑了一轮、又烧了一次 token」，不给出机器原因，
 * 自动化就成了黑箱，用户唯一的自保手段就是把它关掉。
 *
 * 配色分三档：绿=正常按数据变化触发；紫=数据没变但主动补齐（本来最需要解释）；
 * 灰=跳过；红=没跑成。
 */
const REASON_LABEL: Record<string, { text: string; color: string }> = {
  ok: { text: t("aiPanel.reason.ok"), color: "#22c55e" },
  auto: { text: t("aiPanel.reason.auto"), color: "#22c55e" },
  manual: { text: t("aiPanel.reason.manual"), color: "#38bdf8" },
  "rotate-gap": { text: t("aiPanel.reason.rotateGap"), color: "#a78bfa" },
  "focus-gap": { text: t("aiPanel.reason.focusGap"), color: "#a78bfa" },
  // 追责单独给一个偏暖的紫：它与其它补齐类的关键差别是**过期就没了**。
  // 用户在轨迹里看到它，含义是「这一轮花的钱买的是一次追不回来的机会」，
  // 而不是「反正下轮还能补」——两者对是否该保留这条规则的判断完全不同。
  "regression-gap": { text: t("aiPanel.reason.regressionGap"), color: "#c084fc" },
  "recheck-gap": { text: t("aiPanel.reason.recheckGap"), color: "#a78bfa" },
  "gap-backlog": { text: t("aiPanel.reason.gapBacklog"), color: "#a78bfa" },
  unchanged: { text: t("aiPanel.reason.unchanged"), color: "#94a3b8" },
  cooling: { text: t("aiPanel.reason.cooling"), color: "#94a3b8" },
  busy: { text: t("aiPanel.reason.busy"), color: "#94a3b8" },
  disabled: { text: t("aiPanel.reason.disabled"), color: "#94a3b8" },
  "trigger-mismatch": { text: t("aiPanel.reason.triggerMismatch"), color: "#94a3b8" },
  "module-mismatch": { text: t("aiPanel.reason.moduleMismatch"), color: "#94a3b8" },
  "scope-mismatch": { text: t("aiPanel.reason.scopeMismatch"), color: "#94a3b8" },
  "agent-missing": { text: t("aiPanel.reason.agentMissing"), color: "#ef4444" },
  "agent-no-tool": { text: t("aiPanel.reason.agentNoTool"), color: "#ef4444" },
  "no-provider": { text: t("aiPanel.reason.noProvider"), color: "#ef4444" },
  "no-data": { text: t("aiPanel.reason.noData"), color: "#ef4444" },
  "no-preset": { text: t("aiPanel.reason.noPreset"), color: "#ef4444" },
  "build-failed": { text: t("aiPanel.reason.buildFailed"), color: "#ef4444" },
};

/**
 * 覆盖状态的配色与短标签。
 *
 * 「从未分析」用最强的红：它不是「有点旧」，而是这个方面**压根没人看过**——
 * 数据再全，没被解读过的维度对用户毫无价值，这正是台账要暴露的第一件事。
 */
const COVERAGE_STYLE: Record<AnalysisCoverageState, { color: string; label: string }> = {
  never: { color: "#ef4444", label: t("aiPanel.coverage.never") },
  "stale-data": { color: "#f59e0b", label: t("aiPanel.coverage.staleData") },
  "stale-time": { color: "#3b82f6", label: t("aiPanel.coverage.staleTime") },
  fresh: { color: "#22c55e", label: t("aiPanel.coverage.fresh") },
};

function fmtTime(sec: number): string {
  if (!sec) return t("aiPanel.timeNever");
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AutoAnalysisPanel({ moduleId, scopeId, compact = false }: Props) {
  const agents = useAgentStore((s) => s.agents);
  const isStreaming = useAgentStore((s) => s.isStreaming);

  const provider = aiContextRegistry.get(moduleId);
  const presets = useMemo(() => provider?.presets ?? [], [provider]);

  const [expanded, setExpanded] = useState(false);
  const [rules, setRules] = useState<AiAutoAnalysisRule[]>([]);
  const [runs, setRuns] = useState<AiAutoAnalysisRun[]>([]);
  const [showRuns, setShowRuns] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<AnalysisCoverageRow[]>([]);
  const [showCoverage, setShowCoverage] = useState(true);
  const [checking, setChecking] = useState(false);

  // 新建表单（Agent 无默认值：必须由用户显式选择）
  const [formAgentId, setFormAgentId] = useState("");
  // 预设默认「轮转」而不是第一个维度：默认值决定了绝大多数用户的最终配置，
  // 锁死单一维度会让其余方面永远无人分析——这正是覆盖台账要根治的问题。
  const [formPreset, setFormPreset] = useState<string>(PRESET_ROTATE);
  const [formScopeAll, setFormScopeAll] = useState(true);
  const [formTrigger, setFormTrigger] = useState(TRIGGER_ON_FULL);
  const [formCooldown, setFormCooldown] = useState(30);
  const [formSkipUnchanged, setFormSkipUnchanged] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [r, h] = await Promise.all([
        aiContextApi.listAutoAnalysisRules(moduleId),
        aiContextApi.listAutoAnalysisRuns(20),
      ]);
      setRules(r);
      setRuns(h);
    } catch (e: any) {
      logger.error("AutoAnalysisPanel", "load failed", { error: e });
    }
  }, [moduleId]);

  /**
   * 覆盖台账单独取数：它按 (module, scope, preset) 在 SQL 里分组取最新，
   * 不能从上面那 20 条运行轨迹里筛——久没跑过的维度会被挤出窗口，
   * 于是「三个月前分析过」被错报成「从未分析」，红灯全是假的。
   *
   * 当前指纹取自库里已落库的上下文包：这样即便用户刚开应用还没重扫，
   * 也能立刻判断历史结论是否还对得上现在的数据。
   */
  const reloadCoverage = useCallback(async () => {
    if (!scopeId || presets.length === 0) {
      setCoverage([]);
      return;
    }
    try {
      const [runsForScope, packs] = await Promise.all([
        aiContextApi.listAnalysisCoverage(moduleId, scopeId),
        aiContextApi.listAiContextPacks(scopeId),
      ]);
      const currentDigest = packs.find((p) => p.moduleId === moduleId)?.digest ?? "";
      setCoverage(buildAnalysisCoverage(presets, runsForScope, { currentDigest }));
    } catch (e: any) {
      logger.error("AutoAnalysisPanel", "coverage load failed", { error: e });
      setCoverage([]);
    }
  }, [moduleId, scopeId, presets]);

  /**
   * 手动催一次调度心跳。
   *
   * 心跳本身几分钟一拍已经够用，但「我改完配置想立刻看到它动起来」是很自然的诉求；
   * 没有这个按钮，用户只能盯着面板等，很容易误以为自动化根本没工作。
   * 没有欠账时它什么也不做，点多少次都不会重复烧 token。
   */
  const handleCheckNow = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      const triggered = await tickAnalysisScheduler();
      if (triggered === 0) setError(t("aiPanel.auto.checkNone"));
      await reload();
      if (expanded) await reloadCoverage();
    } catch (e: any) {
      setError(t("aiPanel.auto.checkFailed", { msg: e?.message ?? String(e) }));
    } finally {
      setChecking(false);
    }
  }, [checking, reload, reloadCoverage, expanded]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 展开时才拉台账：折叠状态下它是纯粹的额外查询
  useEffect(() => {
    if (expanded) void reloadCoverage();
  }, [expanded, reloadCoverage]);

  // Agent 回答结束后刷新：自动触发多半发生在这个时刻附近，轨迹要跟着更新
  useEffect(() => {
    if (!isStreaming) {
      void reload();
      if (expanded) void reloadCoverage();
    }
  }, [isStreaming, expanded, reload, reloadCoverage]);

  useEffect(() => {
    if (!formPreset && presets.length) setFormPreset(presets[0].key);
  }, [presets, formPreset]);

  const fs = (n: number) => (compact ? n - 1 : n);

  const handleCreate = async () => {
    setError(null);
    if (!formAgentId) {
      setError(t("aiPanel.auto.errSelectAgent"));
      return;
    }
    const agent = agents.find((a) => a.id === formAgentId);
    if (agent && !agent.toolIds?.includes(CONTEXT_TOOL_ID)) {
      setError(t("aiPanel.auto.errNoTool", { name: agent.name, tool: CONTEXT_TOOL_ID }));
      return;
    }
    try {
      await aiContextApi.saveAutoAnalysisRule({
        id: `arule_${Date.now().toString(36)}`,
        enabled: true,
        moduleId,
        scopeId: formScopeAll ? null : (scopeId ?? null),
        agentId: formAgentId,
        presetKey: formPreset,
        triggerOn: formTrigger,
        cooldownMinutes: formCooldown,
        skipIfUnchanged: formSkipUnchanged,
      });
      setCreating(false);
      await reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const handleToggle = async (rule: AiAutoAnalysisRule, enabled: boolean) => {
    try {
      await aiContextApi.saveAutoAnalysisRule({
        id: rule.id,
        enabled,
        moduleId: rule.moduleId,
        scopeId: rule.scopeId,
        agentId: rule.agentId,
        presetKey: rule.presetKey,
        triggerOn: rule.triggerOn,
        cooldownMinutes: rule.cooldownMinutes,
        skipIfUnchanged: rule.skipIfUnchanged,
      });
      await reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await aiContextApi.deleteAutoAnalysisRule(id);
      await reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const activeCount = rules.filter((r) => r.enabled).length;
  const coverageSummary = useMemo(() => summarizeCoverage(coverage), [coverage]);
  const nextGap = useMemo(() => pickNextPreset(coverage), [coverage]);

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, overflow: "hidden" }}>
      {/* 折叠头 */}
      <Box
        onClick={() => setExpanded((v) => !v)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1,
          py: 0.75,
          cursor: "pointer",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <BoltIcon sx={{ fontSize: 16, color: activeCount > 0 ? "#f59e0b" : "text.disabled" }} />
        <Typography sx={{ fontSize: fs(12), fontWeight: 600, flex: 1 }}>
          {t("aiPanel.auto.title")}
        </Typography>
        {activeCount > 0 && (
          <Chip
            size="small"
            label={t("aiPanel.auto.activeCount", { n: activeCount })}
            sx={{ height: 18, fontSize: fs(10), bgcolor: "rgba(245,158,11,0.12)", color: "#b45309" }}
          />
        )}
        {expanded ? (
          <ExpandLessIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        ) : (
          <ExpandMoreIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        )}
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ px: 1, pb: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
          <Typography sx={{ fontSize: fs(10), color: "text.secondary", lineHeight: 1.5 }}>
            {t("aiPanel.auto.desc")}
          </Typography>

          {/* 规则列表 */}
          {rules.length === 0 && !creating && (
            <Typography sx={{ fontSize: fs(10), color: "text.disabled" }}>
              {t("aiPanel.auto.noRules")}
            </Typography>
          )}
          {rules.map((r) => {
            const agent = agents.find((a) => a.id === r.agentId);
            const rotating = r.presetKey === PRESET_ROTATE;
            const preset = presets.find((p) => p.key === r.presetKey);
            const presetLabel = rotating
              ? `${t("aiPanel.auto.rotateBase")}${nextGap ? t("aiPanel.auto.rotateNext", { title: nextGap.title }) : ""}`
              : (preset ? pickLang(preset.title) : r.presetKey);
            return (
              <Box
                key={r.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  p: 0.75,
                  borderRadius: 1,
                  border: 1,
                  borderColor: r.enabled ? "rgba(245,158,11,0.35)" : "divider",
                  bgcolor: r.enabled ? "rgba(245,158,11,0.05)" : "transparent",
                }}
              >
                <Switch
                  size="small"
                  checked={r.enabled}
                  onChange={(e) => handleToggle(r, e.target.checked)}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: fs(11), fontWeight: 600 }} noWrap>
                    {agent?.name ?? t("aiPanel.auto.agentDeleted", { id: r.agentId })} · {presetLabel}
                  </Typography>
                  <Typography sx={{ fontSize: fs(9.5), color: "text.secondary" }} noWrap>
                    {r.triggerOn === TRIGGER_ON_ANY ? t("aiPanel.auto.triggerAny") : t("aiPanel.auto.triggerOnlyFull")} ·{" "}
                    {t("aiPanel.auto.cooldown", { n: r.cooldownMinutes })} ·{" "}
                    {r.skipIfUnchanged ? t("aiPanel.auto.skip") : t("aiPanel.auto.noDedup")} ·{" "}
                    {r.scopeId ? t("aiPanel.auto.scopeThis") : t("aiPanel.auto.scopeAllAnalysis")} ·{" "}
                    {t("aiPanel.auto.lastRun", { time: fmtTime(r.lastRunAt) })}
                  </Typography>
                </Box>
                <Tooltip title={t("aiPanel.auto.deleteRule")}>
                  <IconButton size="small" onClick={() => handleDelete(r.id)}>
                    <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })}

          {/* 新建表单 */}
          {creating ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 0.75,
                p: 0.75,
                borderRadius: 1,
                border: 1,
                borderColor: "primary.main",
              }}
            >
              <FormControl size="small" fullWidth>
                <InputLabel sx={{ fontSize: fs(11) }}>{t("aiPanel.auto.agentLabel")}</InputLabel>
                <Select
                  value={formAgentId}
                  label={t("aiPanel.auto.agentLabel")}
                  onChange={(e) => setFormAgentId(e.target.value)}
                  sx={{ fontSize: fs(11) }}
                >
                  {agents.map((a) => (
                    <MenuItem key={a.id} value={a.id} sx={{ fontSize: fs(11) }}>
                      {a.name}
                      {!a.toolIds?.includes(CONTEXT_TOOL_ID) && t("aiPanel.auto.noContextTool")}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" fullWidth>
                <InputLabel sx={{ fontSize: fs(11) }}>{t("aiPanel.auto.presetLabel")}</InputLabel>
                <Select
                  value={formPreset}
                  label={t("aiPanel.auto.presetLabel")}
                  onChange={(e) => setFormPreset(e.target.value)}
                  sx={{ fontSize: fs(11) }}
                >
                  {/* 轮转排在最前：一条规则覆盖所有维度，好过让用户手工建 N 条 */}
                  <MenuItem value={PRESET_ROTATE} sx={{ fontSize: fs(11) }}>
                    {t("aiPanel.auto.rotateOption")}
                  </MenuItem>
                  {presets.map((p) => (
                    <MenuItem key={p.key} value={p.key} sx={{ fontSize: fs(11) }}>
                      {pickLang(p.title)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {formPreset === PRESET_ROTATE && (
                <Typography sx={{ fontSize: fs(9.5), color: "text.secondary", lineHeight: 1.5 }}>
                  {t("aiPanel.auto.rotateTip")}
                </Typography>
              )}

              <Box sx={{ display: "flex", gap: 0.75 }}>
                <FormControl size="small" sx={{ flex: 1 }}>
                  <InputLabel sx={{ fontSize: fs(11) }}>{t("aiPanel.auto.triggerLabel")}</InputLabel>
                  <Select
                    value={formTrigger}
                    label={t("aiPanel.auto.triggerLabel")}
                    onChange={(e) => setFormTrigger(e.target.value)}
                    sx={{ fontSize: fs(11) }}
                  >
                    <MenuItem value={TRIGGER_ON_FULL} sx={{ fontSize: fs(11) }}>
                      {t("aiPanel.auto.triggerFull")}
                    </MenuItem>
                    <MenuItem value={TRIGGER_ON_ANY} sx={{ fontSize: fs(11) }}>
                      {t("aiPanel.auto.triggerIncremental")}
                    </MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  type="number"
                  label={t("aiPanel.auto.cooldownLabel")}
                  value={formCooldown}
                  onChange={(e) => setFormCooldown(Math.max(0, Number(e.target.value) || 0))}
                  sx={{ width: 90, "& input": { fontSize: fs(11) }, "& label": { fontSize: fs(11) } }}
                />
              </Box>

              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={formSkipUnchanged}
                      onChange={(e) => setFormSkipUnchanged(e.target.checked)}
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: fs(10.5) }}>{t("aiPanel.auto.skipUnchanged")}</Typography>
                  }
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={formScopeAll}
                      onChange={(e) => setFormScopeAll(e.target.checked)}
                    />
                  }
                  label={<Typography sx={{ fontSize: fs(10.5) }}>{t("aiPanel.auto.scopeAll")}</Typography>}
                />
              </Box>

              <Box sx={{ display: "flex", gap: 0.75 }}>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleCreate}
                  sx={{ fontSize: fs(11), textTransform: "none", flex: 1 }}
                >
                  {t("aiPanel.auto.saveRule")}
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setCreating(false);
                    setError(null);
                  }}
                  sx={{ fontSize: fs(11), textTransform: "none" }}
                >
                  {t("ui.cancel")}
                </Button>
              </Box>
            </Box>
          ) : (
            <Button
              size="small"
              startIcon={<AddIcon sx={{ fontSize: 15 }} />}
              onClick={() => setCreating(true)}
              disabled={agents.length === 0}
              sx={{ fontSize: fs(11), textTransform: "none", alignSelf: "flex-start" }}
            >
              {t("aiPanel.auto.newRule")}
            </Button>
          )}

          {error && (
            <Alert severity="error" sx={{ fontSize: fs(10), py: 0 }}>
              {error}
            </Alert>
          )}

          {/* ── 分析维度覆盖台账 ──
              数据完整 ≠ 被解读过。没有这块，用户永远不知道「架构健康度从来没人跑过」。 */}
          {scopeId && coverage.length > 0 && (
            <>
              <Box
                onClick={() => setShowCoverage((v) => !v)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  cursor: "pointer",
                  color: "text.secondary",
                  mt: 0.25,
                }}
              >
                <FactCheckOutlinedIcon sx={{ fontSize: 14 }} />
                <Typography sx={{ fontSize: fs(10.5), flex: 1 }}>
                  {t("aiPanel.auto.coverageHeader", {
                    fresh: coverageSummary.fresh,
                    total: coverageSummary.total,
                    never:
                      coverageSummary.never > 0
                        ? t("aiPanel.auto.coverageHeaderNever", { never: coverageSummary.never })
                        : "",
                  })}
                </Typography>
                {showCoverage ? (
                  <ExpandLessIcon sx={{ fontSize: 15 }} />
                ) : (
                  <ExpandMoreIcon sx={{ fontSize: 15 }} />
                )}
              </Box>
              <Collapse in={showCoverage}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}>
                  {coverage.map((row) => {
                    const style = COVERAGE_STYLE[row.state];
                    return (
                      <Tooltip key={row.presetKey} title={row.description ?? ""} placement="left">
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <Box
                            sx={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              flexShrink: 0,
                              bgcolor: style.color,
                            }}
                          />
                          <Typography sx={{ fontSize: fs(10), fontWeight: 600, flexShrink: 0 }}>
                            {row.title}
                          </Typography>
                          <Typography
                            sx={{ fontSize: fs(9.5), color: "text.secondary", flex: 1 }}
                            noWrap
                          >
                            {row.detail}
                          </Typography>
                          <Chip
                            size="small"
                            label={style.label}
                            sx={{
                              height: 15,
                              fontSize: fs(9),
                              flexShrink: 0,
                              bgcolor: `${style.color}1f`,
                              color: style.color,
                            }}
                          />
                        </Box>
                      </Tooltip>
                    );
                  })}
                  <Typography sx={{ fontSize: fs(9.5), color: "text.secondary", mt: 0.25 }}>
                    {nextGap
                      ? t("aiPanel.auto.nextGap", { title: nextGap.title })
                      : t("aiPanel.auto.coverageAllFresh")}
                  </Typography>
                </Box>
              </Collapse>
            </>
          )}

          {/* 运行轨迹 */}
          <Box
            onClick={() => setShowRuns((v) => !v)}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              cursor: "pointer",
              color: "text.secondary",
              mt: 0.25,
            }}
          >
            <HistoryIcon sx={{ fontSize: 14 }} />
            <Typography sx={{ fontSize: fs(10.5), flex: 1 }}>
              {t("aiPanel.auto.runsTitle", { n: runs.length })}
            </Typography>
            <Box
              component="span"
              onClick={(e) => {
                e.stopPropagation();
                void handleCheckNow();
              }}
              sx={{
                fontSize: fs(9.5),
                px: 0.6,
                mr: 0.4,
                borderRadius: 0.5,
                border: "1px solid",
                borderColor: "divider",
                color: checking ? "text.disabled" : "primary.main",
                cursor: checking ? "default" : "pointer",
                "&:hover": { borderColor: checking ? "divider" : "primary.main" },
              }}
              title={t("aiPanel.auto.checkNowTip")}
            >
              {checking ? t("aiPanel.auto.checking") : t("aiPanel.auto.checkNow")}
            </Box>
            {showRuns ? (
              <ExpandLessIcon sx={{ fontSize: 15 }} />
            ) : (
              <ExpandMoreIcon sx={{ fontSize: 15 }} />
            )}
          </Box>
          <Collapse in={showRuns}>
            {runs.length === 0 ? (
              <Typography sx={{ fontSize: fs(10), color: "text.disabled" }}>
                {t("aiPanel.auto.runsEmpty", { n: Math.round(getSchedulerStatus().intervalMs / 60000) })}
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4, maxHeight: 180, overflowY: "auto" }}>
                {runs.map((run) => (
                  <Box key={run.id} sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        mt: 0.6,
                        flexShrink: 0,
                        bgcolor: STATUS_COLOR[run.status] ?? "#94a3b8",
                      }}
                    />
                    <Typography sx={{ fontSize: fs(9.5), color: "text.secondary", lineHeight: 1.5 }}>
                      <b>{fmtTime(run.createdAt)}</b> · {run.triggerKind}
                      {run.reason && REASON_LABEL[run.reason] ? (
                        <Box
                          component="span"
                          title={t("aiPanel.auto.reasonTitle", { reason: run.reason })}
                          sx={{
                            ml: 0.4,
                            px: 0.5,
                            borderRadius: 0.5,
                            fontSize: fs(8.5),
                            color: REASON_LABEL[run.reason].color,
                            border: `1px solid ${REASON_LABEL[run.reason].color}55`,
                          }}
                        >
                          {REASON_LABEL[run.reason].text}
                        </Box>
                      ) : null}
                      {run.outcome && OUTCOME_LABEL[run.outcome] ? (
                        <Box
                          component="span"
                          sx={{
                            mx: 0.4,
                            px: 0.5,
                            borderRadius: 0.5,
                            fontSize: fs(8.5),
                            color: OUTCOME_LABEL[run.outcome].color,
                            border: `1px solid ${OUTCOME_LABEL[run.outcome].color}55`,
                          }}
                        >
                          {OUTCOME_LABEL[run.outcome].text}
                        </Box>
                      ) : null}
                      {" · "}
                      {run.detail}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Collapse>
        </Box>
      </Collapse>
    </Box>
  );
}
