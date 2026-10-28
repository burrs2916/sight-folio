/**
 * ScanAnalysisLauncher —— 「项目扫描 → 已配置 AI Agent → 深度分析」入口。
 *
 * 这是用户意图落地的最后一块拼图：
 *   扫描完成（数据已持久化为 AiContextPack）→ 用户在这里选择「已配置的 Agent」+ 一个分析预设
 *   → 前端构建（按预设裁剪分节，省 token）→ 落库 → 用该 Agent 发起一次对话，消息中指示 Agent
 *     通过 project_context 工具按需取回上下文。
 *
 * 关键约束（来自用户）：
 *   - 绝不写死 Agent / 模型 / prompt —— 用哪个 Agent 完全由用户在 UI 选择（从 agentStore.agents 取）；
 *   - 上下文不塞进消息体，而是落库后让 Agent 用 project_context 工具按 section 取，省 token；
 *   - 只动项目扫描这一条链路，不牵扯其他模块。
 */
import { useState, useEffect, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import PsychologyIcon from "@mui/icons-material/Psychology";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SettingsIcon from "@mui/icons-material/Settings";
import { useAgentStore } from "../store/agentStore";
import { useProjectStore } from "../store/projectStore";
import { useSceneStore } from "../store/sceneStore";
import { aiContextRegistry } from "./contextRegistry";
import {
  launchModuleAnalysis,
  CONTEXT_TOOL_ID,
  INSIGHT_TOOL_ID,
  RECORDS_TOOL_ID,
} from "./analysisRunner";
import { AutoAnalysisPanel } from "./AutoAnalysisPanel";
import { ContextQualityPanel } from "./ContextQualityPanel";
import { FocusReportPanel } from "./FocusReportPanel";
import { TrendPanel } from "./TrendPanel";
import { navigateToSourceByPath } from "../editor/utils/sourceNavigate";
import { logger } from "../utils/logger";
import { t, pickLang } from "../i18n";

const MODULE_ID = "project-scan";

/** 预设分组顺序与标题键：UI 据此把同类预设归到同一区块，需求分析不会被埋在问题诊断里 */
const PRESET_GROUPS: Array<{ key: string; labelKey: string }> = [
  { key: "diagnose", labelKey: "aiPanel.launcher.groupDiagnose" },
  { key: "requirements", labelKey: "aiPanel.launcher.groupRequirements" },
];

interface Props {
  /** 面板（右侧栏）模式：更紧凑的间距与字号 */
  compact?: boolean;
  /** 点击「去启用工具」时回调（如打开 AI 配置弹窗）；不传则只显示提示 */
  onOpenAgentConfig?: () => void;
}

export function ScanAnalysisLauncher({ compact = false, onOpenAgentConfig }: Props) {
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  const scenes = useSceneStore((s) => s.scenes);
  const activeAnalysisId = useProjectStore((s) => s.activeAnalysisId);
  const scanFreshness = useProjectStore((s) => s.scanFreshness);
  const scan = useProjectStore((s) => s.scan);

  const provider = aiContextRegistry.get(MODULE_ID);
  const presets = useMemo(() => provider?.presets ?? [], [provider]);

  const [analysisId, setAnalysisId] = useState<string>(activeAnalysisId ?? "");
  const [presetKey, setPresetKey] = useState<string>(presets[0]?.key ?? "");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 若尚未选择分析且当前已有激活分析，默认跟随
  useEffect(() => {
    if (!analysisId && activeAnalysisId) setAnalysisId(activeAnalysisId);
  }, [activeAnalysisId, analysisId]);

  // 切换分析对象时体检新鲜度（数据是否过时 → 启动 AI 前警告）
  useEffect(() => {
    if (analysisId) useProjectStore.getState().checkFreshness(analysisId);
  }, [analysisId]);

  // 从启动器内直接触发重新扫描（沿用该分析的排除配置）
  const handleRescan = async () => {
    const scene = scenes.find((s) => s.id === analysisId);
    if (!scene?.projectRoot) return;
    const meta = (scene.metadata ?? {}) as Record<string, unknown>;
    const excludeDirs = Array.isArray(meta.scanExcludes)
      ? (meta.scanExcludes as string[])
      : [];
    const excludeResources = meta.excludeResources !== false;
    await scan(analysisId, scene.projectRoot, { excludeDirs, excludeResources });
  };

  const analysisOptions = useMemo(
    () => scenes.map((s) => ({ id: s.id, name: s.name })),
    [scenes],
  );

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const preset = presets.find((p) => p.key === presetKey) ?? presets[0];

  // 该 Agent 是否启用了 project_context 工具（深度分析靠它按需取上下文）——硬依赖
  const agentHasContextTool = !!selectedAgent?.toolIds?.includes(CONTEXT_TOOL_ID);
  // context_insight 用于把结论回写进分析（人可见、下次可增量）——软依赖，缺了只是不沉淀
  const agentHasInsightTool = !!selectedAgent?.toolIds?.includes(INSIGHT_TOOL_ID);
  // scan_records 用于下钻原始记录（分节只给 Top-N）——软依赖，缺了只是结论不能声称全局口径
  const agentHasRecordsTool = !!selectedAgent?.toolIds?.includes(RECORDS_TOOL_ID);

  const canLaunch = !!analysisId && !!selectedAgentId && !!preset && !launching;
  const showConfigWarning =
    !!selectedAgentId && !!selectedAgent && !agentHasContextTool;

  const sp = compact ? 1 : 1.5;
  const fs = (n: number) => (compact ? n - 1 : n);

  const handleLaunch = async () => {
    if (!canLaunch || !preset) return;
    setError(null);
    setLaunching(true);
    try {
      const ps = useProjectStore.getState();
      // 确保目标分析已载入内存：provider 从 projectStore 快照取全量扫描数据
      if (ps.activeAnalysisId !== analysisId) {
        await ps.loadAll(analysisId);
        ps.setActiveAnalysis(analysisId);
      }
      // 构建 → 落库 → 建会话 → 发取数指令，全部走共享执行器：
      // 与自动编排共用同一份实现，避免两条路径的 prompt 各自漂移。
      await launchModuleAnalysis({
        moduleId: MODULE_ID,
        scopeId: analysisId,
        agentId: selectedAgentId!,
        presetKey: preset.key,
        focusConversation: true,
      });
    } catch (e: any) {
      setError(e?.message || String(e));
      logger.error("ScanAnalysisLauncher", "launch failed", { error: e });
    } finally {
      setLaunching(false);
    }
  };

  // 无 Agent 时引导去配置
  if (agents.length === 0) {
    return (
      <Box sx={{ p: sp, textAlign: "center" }}>
        <PsychologyIcon sx={{ fontSize: compact ? 28 : 36, opacity: 0.18, mb: 0.5 }} />
        <Typography sx={{ fontSize: fs(12), color: "text.secondary", mb: 0.5 }}>
          {t("aiPanel.launcher.needAgent")}
        </Typography>
        {onOpenAgentConfig && (
          <Button
            size="small"
            startIcon={<SettingsIcon />}
            onClick={onOpenAgentConfig}
            sx={{ fontSize: fs(11), textTransform: "none" }}
          >
            {t("aiPanel.launcher.openConfig")}
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ p: sp, display: "flex", flexDirection: "column", gap: sp }}>
      {/* 标题 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box
          sx={{
            width: compact ? 24 : 30,
            height: compact ? 24 : 30,
            borderRadius: 1.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "rgba(99,102,241,0.1)",
            flexShrink: 0,
          }}
        >
          <AutoAwesomeIcon sx={{ fontSize: compact ? 16 : 18, color: "primary.main" }} />
        </Box>
        <Box>
          <Typography sx={{ fontSize: fs(13), fontWeight: 700, lineHeight: 1.2 }}>
            {t("aiPanel.launcher.title")}
          </Typography>
          <Typography sx={{ fontSize: fs(10), color: "text.secondary" }}>
            {t("aiPanel.launcher.subtitle")}
          </Typography>
        </Box>
      </Box>

      {/* Agent 选择（从已配置列表中选，不写死） */}
      <FormControl size="small" fullWidth>
        <InputLabel sx={{ fontSize: fs(12) }}>{t("aiPanel.launcher.agentLabel")}</InputLabel>
        <Select
          value={selectedAgentId || ""}
          label={t("aiPanel.launcher.agentLabel")}
          onChange={(e) => selectAgent(e.target.value || null)}
          sx={{ fontSize: fs(12) }}
        >
          {agents.map((a) => (
            <MenuItem key={a.id} value={a.id} sx={{ fontSize: fs(12) }}>
              {a.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* 分析选择 */}
      <FormControl size="small" fullWidth disabled={analysisOptions.length === 0}>
        <InputLabel sx={{ fontSize: fs(12) }}>{t("aiPanel.launcher.analysisLabel")}</InputLabel>
        <Select
          value={analysisId}
          label={t("aiPanel.launcher.analysisLabel")}
          onChange={(e) => setAnalysisId(e.target.value)}
          sx={{ fontSize: fs(12) }}
        >
          {analysisOptions.length === 0 && (
            <MenuItem value="" sx={{ fontSize: fs(12) }}>
              {t("aiPanel.launcher.noAnalysis")}
            </MenuItem>
          )}
          {analysisOptions.map((o) => (
            <MenuItem key={o.id} value={o.id} sx={{ fontSize: fs(12) }}>
              {o.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* 数据可信度体检：让人在发起分析之前就知道这次扫描的盲区在哪，
          否则 Agent 说「架构健康」时，用户没有依据去质疑这句话的来源 */}
      <ContextQualityPanel moduleId={MODULE_ID} scopeId={analysisId || undefined} compact={compact} />

      {/* 多维共振：扫描给出的「该从哪下手」直接给人看，与 AI 看到的 riskMatrix 同源同口径。
          点文件直接跳源码，人和 Agent 看到的是同一份结论，不再各自为政。 */}
      <FocusReportPanel
        moduleId={MODULE_ID}
        scopeId={analysisId || undefined}
        compact={compact}
        onSelectFile={(path) => navigateToSourceByPath(path)}
      />

      {/* 指标走势：与 trend 分节同源同口径。人必须能自己验证 Agent 说的
          「技术债密度上升 18%」，否则那句话就是不可查证的断言。 */}
      <TrendPanel moduleId={MODULE_ID} scopeId={analysisId || undefined} compact={compact} />

      {/* 预设选择（可点选的分析任务） */}
      <Box>
        <Typography sx={{ fontSize: fs(11), color: "text.secondary", mb: 0.5 }}>
          {t("aiPanel.launcher.presetTitle")}
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {PRESET_GROUPS.map((g) => {
            const groupPresets = presets.filter((p) => (p.group ?? "diagnose") === g.key);
            if (groupPresets.length === 0) return null;
            return (
              <Box key={g.key}>
                <Typography
                  sx={{
                    fontSize: fs(9.5),
                    color: "text.disabled",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    mb: 0.5,
                  }}
                >
                  {t(g.labelKey)}
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  {groupPresets.map((p) => {
                    const active = p.key === preset?.key;
                    return (
                      <Box
                        key={p.key}
                        onClick={() => setPresetKey(p.key)}
                        sx={{
                          p: 1,
                          borderRadius: 1.5,
                          cursor: "pointer",
                          border: 1,
                          borderColor: active ? "primary.main" : "divider",
                          bgcolor: active ? "rgba(99,102,241,0.06)" : "transparent",
                          transition: "all 0.15s",
                          "&:hover": { borderColor: "primary.main" },
                        }}
                      >
                        <Typography sx={{ fontSize: fs(12), fontWeight: active ? 600 : 500 }}>
                          {pickLang(p.title)}
                        </Typography>
                        <Typography
                          sx={{
                            fontSize: fs(10),
                            color: "text.secondary",
                            mt: 0.25,
                            lineHeight: 1.4,
                          }}
                        >
                          {pickLang(p.description)}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Agent 未启用 project_context 工具的提示 */}
      {showConfigWarning && (
        <Alert
          severity="warning"
          icon={<WarningAmberIcon fontSize="small" />}
          sx={{ fontSize: fs(11), py: 0, "& .MuiAlert-message": { py: 0.5 } }}
          action={
            onOpenAgentConfig ? (
              <Button
                size="small"
                color="warning"
                startIcon={<SettingsIcon />}
                onClick={onOpenAgentConfig}
                sx={{ fontSize: fs(10), textTransform: "none" }}
              >
                {t("aiPanel.launcher.enableBtn")}
              </Button>
            ) : undefined
          }
        >
          {t("aiPanel.launcher.warnNoTool", { name: selectedAgent?.name ?? "", tool: "project_context" })}
        </Alert>
      )}

      {/* 软提示：没开 context_insight 只是结论不落库，不阻断分析 */}
      {!!selectedAgentId && agentHasContextTool && !agentHasInsightTool && (
        <Typography sx={{ fontSize: fs(10), color: "text.disabled", lineHeight: 1.4 }}>
          {t("aiPanel.launcher.tipInsight")}
        </Typography>
      )}

      {/* 新鲜度守卫：扫描数据过时 → 明确警告 AI 将基于过时快照作答，引导先重扫 */}
      {scanFreshness?.stale && (
        <Alert
          severity="warning"
          icon={<WarningAmberIcon fontSize="small" />}
          sx={{ fontSize: fs(11), py: 0, "& .MuiAlert-message": { py: 0.5 } }}
          action={
            <Button
              size="small"
              color="warning"
              startIcon={<AutoAwesomeIcon />}
              onClick={handleRescan}
              sx={{ fontSize: fs(10), textTransform: "none" }}
            >
              {t("aiPanel.launcher.rescanBtn")}
            </Button>
          }
        >
          {t("aiPanel.launcher.warnStaleData", {
            last: scanFreshness.lastScannedAt
              ? new Date(scanFreshness.lastScannedAt * 1000).toLocaleString()
              : t("editorPage.freshness.unknown"),
            added: scanFreshness.addedCount,
            removed: scanFreshness.removedCount,
            modified: scanFreshness.modifiedCount,
          })}
        </Alert>
      )}

      {/* 软提示：没开 scan_records，Agent 只能看到每个维度的 Top-N，无法核实全量口径 */}
      {!!selectedAgentId && agentHasContextTool && !agentHasRecordsTool && (
        <Typography sx={{ fontSize: fs(10), color: "text.disabled", lineHeight: 1.4 }}>
          {t("aiPanel.launcher.tipRecords")}
        </Typography>
      )}

      {/* 启动按钮 */}
      <Button
        fullWidth
        variant="contained"
        disabled={!canLaunch || showConfigWarning}
        onClick={handleLaunch}
        startIcon={
          launching ? (
            <CircularProgress size={16} color="inherit" />
          ) : (
            <PsychologyIcon />
          )
        }
        sx={{
          textTransform: "none",
          fontSize: fs(13),
          fontWeight: 600,
          py: 1,
          borderRadius: 2,
          boxShadow: "0 2px 8px rgba(99,102,241,0.2)",
        }}
      >
        {launching ? t("aiPanel.launcher.launching") : t("aiPanel.launcher.launch")}
      </Button>

      {!analysisId && (
        <Typography sx={{ fontSize: fs(10), color: "text.disabled", textAlign: "center" }}>
          {t("aiPanel.launcher.noScanHint")}
        </Typography>
      )}

      {/* 自动化：把「每次手点」升级为「扫描完自动分析」，规则里的 Agent 同样由用户选定 */}
      <AutoAnalysisPanel moduleId={MODULE_ID} scopeId={analysisId || undefined} compact={compact} />


      {error && (
        <Alert severity="error" sx={{ fontSize: fs(11) }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
