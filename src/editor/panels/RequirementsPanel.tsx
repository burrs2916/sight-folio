// sight-folio: 需求分析业务面板（独立于 AI 面板，不与 AI 的交互模式混在一起）
//
// 设计立场（用户拍板）：AI 面板的模式下拉只管「怎么跟 AI 对话」（ask / edit / agent），
// 绝不再承载业务功能。需求分析是项目级「上帝视角引擎」的一级业务功能，应有自己的
// 独立入口与界面。本面板就是该入口：人在这里陈述 / 管理需求基线，AI 在诊断 / 分析时
// 经既有的 requirements-spec 供给者 *读取* 这份基线（数据流向，不是入口），并对照代码
// 反推的 requirements 语义面给出缺口——入口与消费彻底分离。
//
// 与 AI 面板的唯一耦合：本面板的「AI 协助梳理」芯片点击后，通过 onAssist 回调让
// 代码工作台 dock 切到 AI 标签页并预填提示词（单向业务 → AI 触发），AI 面板本身不因此
// 变成需求分析功能的容器。

import { useState, useEffect, useMemo, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import SaveIcon from "@mui/icons-material/Save";
import ListAltIcon from "@mui/icons-material/ListAlt";
import EditIcon from "@mui/icons-material/Edit";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";

import { t } from "../../i18n";
import { L } from "../../ai/aiLang";
import { useProjectStore } from "../../store/projectStore";
import { useRequirementsStore } from "../../store/requirementsStore";
import { useToastStore } from "../../store/toastStore";
import { persistModuleContext } from "../../ai/contextPersist";
import { requirementsSpecProvider } from "../../ai/providers/requirementsSpecProvider";

/** 需求陈述引导起步 Chip：把软件工程基本功拆成可点选动作，让客户从需求起步而非先扔代码。 */
const REQUIREMENTS_STARTER_PROMPTS = [
  { key: "essence", labelKey: "workbench.reqStarter.essence", prompt: L("定义这个项目的本质与愿景：它到底是什么、解决谁的什么问题", "Define this project's essence and vision: what it is and whose problem it solves") },
  { key: "users", labelKey: "workbench.reqStarter.users", prompt: L("锁定目标用户与典型使用场景", "Lock down target users and typical usage scenarios") },
  { key: "functional", labelKey: "workbench.reqStarter.functional", prompt: L("拆解功能需求：用用例 / 用户故事列出核心能力", "Decompose functional requirements: list core capabilities as use cases / user stories") },
  { key: "nonfunctional", labelKey: "workbench.reqStarter.nonfunctional", prompt: L("列出非功能需求：性能 / 安全 / 兼容性等约束", "List non-functional requirements: performance / security / compatibility constraints") },
  { key: "boundary", labelKey: "workbench.reqStarter.boundary", prompt: L("划清范围边界：明确做什么、不做什么", "Draw the scope boundary: what is in and what is out") },
  { key: "acceptance", labelKey: "workbench.reqStarter.acceptance", prompt: L("写出可验收的标准：每条需求如何验证算通过", "Write verifiable acceptance criteria: how each requirement is confirmed done") },
];

export interface RequirementsPanelProps {
  /** 点击「AI 协助」芯片时，由代码工作台 dock 接管：切到 AI 标签页并预填提示词。 */
  onAssist?: (prompt: string) => void;
}

export function RequirementsPanel({ onAssist }: RequirementsPanelProps) {
  const activeAnalysisId = useProjectStore((s) => s.activeAnalysisId);
  const baseline = useRequirementsStore((s) => (activeAnalysisId ? s.getBaseline(activeAnalysisId) : undefined));
  const hasBaseline = useRequirementsStore((s) => (activeAnalysisId ? s.hasBaseline(activeAnalysisId) : false));

  const [baselineOpen, setBaselineOpen] = useState(false);
  const [baselineDraft, setBaselineDraft] = useState("");
  const [baselineSaving, setBaselineSaving] = useState(false);

  // 切换分析时水合需求基线（库 → 内存），保证自动编排扫描也能把它带进上下文包。
  useEffect(() => {
    if (activeAnalysisId) {
      void useRequirementsStore.getState().loadBaseline(activeAnalysisId);
    }
  }, [activeAnalysisId]);

  // 当前基线摘要（字数 / 更新时间 / 首行预览），用于面板常驻展示。
  const summary = useMemo(() => {
    if (!baseline) return null;
    const content = baseline.content;
    const firstLine = content.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
    return {
      length: content.length,
      updatedAt: baseline.updatedAt,
      preview: firstLine.slice(0, 120),
    };
  }, [baseline]);

  const openBaselineDialog = useCallback(() => {
    const existing = activeAnalysisId
      ? useRequirementsStore.getState().getBaseline(activeAnalysisId)?.content
      : "";
    setBaselineDraft(existing && existing.trim() ? existing : "");
    setBaselineOpen(true);
  }, [activeAnalysisId]);

  const saveBaseline = useCallback(async () => {
    if (!activeAnalysisId) {
      useToastStore.getState().error(t("workbench.reqBaseline.noAnalysis"));
      return;
    }
    const content = baselineDraft.trim();
    if (!content) {
      useToastStore.getState().warning(t("workbench.reqBaseline.empty"));
      return;
    }
    setBaselineSaving(true);
    try {
      // 先写内存态（草稿不丢），再经项目既有上下文持久化通道整包落库。
      useRequirementsStore.getState().setBaseline(activeAnalysisId, content);
      await persistModuleContext(requirementsSpecProvider, activeAnalysisId);
      useToastStore.getState().success(t("workbench.reqBaseline.saved"));
      setBaselineOpen(false);
    } catch (err) {
      console.error("[requirements] 保存需求基线失败", err);
      useToastStore.getState().error(t("workbench.reqBaseline.saveFailed"));
      // 草稿已在内存储存，不丢；用户可重试。
    } finally {
      setBaselineSaving(false);
    }
  }, [activeAnalysisId, baselineDraft]);

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        width: "100%",
        bgcolor: "background.paper",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* 头部：标题 + 保存基线按钮 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
        <ListAltIcon sx={{ fontSize: 16, color: "primary.main", flexShrink: 0 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, display: "block", lineHeight: 1.2 }}>{t("workbench.requirements.title")}</Typography>
          <Typography variant="caption" sx={{ display: "block", fontSize: 9.5, color: "text.secondary", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("workbench.requirements.subtitle")}</Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t("workbench.reqBaseline.saveTip")}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<SaveIcon sx={{ fontSize: 13 }} />}
            onClick={openBaselineDialog}
            sx={{ fontSize: 10, height: 22 }}
          >
            {t("workbench.reqBaseline.save")}
          </Button>
        </Tooltip>
      </Box>

      {/* 可滚动内容区 */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1, py: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        {/* 当前基线卡片 */}
        <Box sx={{ border: 1, borderColor: hasBaseline ? "primary.main" : "divider", borderRadius: 1, p: 1, bgcolor: hasBaseline ? "action.hover" : "transparent" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
            <AutoAwesomeIcon sx={{ fontSize: 13, color: hasBaseline ? "primary.main" : "text.disabled" }} />
            <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11 }}>{t("workbench.requirements.current")}</Typography>
            <Box sx={{ flex: 1 }} />
            {hasBaseline && (
              <Button size="small" startIcon={<EditIcon sx={{ fontSize: 12 }} />} onClick={openBaselineDialog} sx={{ fontSize: 9.5, height: 20, minWidth: 0, px: 0.75 }}>
                {t("workbench.requirements.edit")}
              </Button>
            )}
          </Box>
          {summary ? (
            <>
              <Typography variant="caption" sx={{ display: "block", fontSize: 10, color: "text.secondary", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {summary.preview || summary.length > 0 ? summary.preview : ""}
              </Typography>
              <Typography variant="caption" sx={{ display: "block", fontSize: 9, color: "text.secondary", mt: 0.25 }}>
                {t("workbench.requirements.meta", { words: summary.length, time: new Date(summary.updatedAt).toLocaleString() })}
              </Typography>
            </>
          ) : (
            <Typography variant="caption" sx={{ display: "block", fontSize: 10, color: "text.secondary" }}>
              {t("workbench.requirements.emptyHint")}
            </Typography>
          )}
        </Box>

        {/* AI 协助梳理：把方法论拆成可点选动作，点击后由 dock 切到 AI 标签页并预填。 */}
        <Box>
          <Typography variant="caption" sx={{ display: "block", fontWeight: 700, fontSize: 11, mb: 0.5 }}>{t("workbench.requirements.assistTitle")}</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {REQUIREMENTS_STARTER_PROMPTS.map((s) => (
              <Chip
                key={s.key}
                size="small"
                clickable
                icon={<SmartToyIcon sx={{ fontSize: 13 }} />}
                color="primary"
                variant="outlined"
                label={t(s.labelKey)}
                onClick={() => onAssist?.(s.prompt)}
                sx={{ fontSize: 10, height: 22 }}
              />
            ))}
          </Box>
        </Box>

        <Divider sx={{ my: 0.25 }} />

        {/* 说明：AI 如何在分析时消费这份基线 */}
        <Typography variant="caption" sx={{ display: "block", fontSize: 9.5, color: "text.secondary", lineHeight: 1.6 }}>
          {t("workbench.requirements.consumeHint")}
        </Typography>
      </Box>

      {/* 需求基线保存对话框：把结构化需求文档存为项目基线（requirements-spec）。
          正文即落库内容；保存走项目既有上下文持久化通道（整包写，不裁剪）。 */}
      <Dialog open={baselineOpen} onClose={() => !baselineSaving && setBaselineOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 14 }}>{t("workbench.reqBaseline.dialogTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {t("workbench.reqBaseline.dialogHint")}
          </Typography>
          <TextField
            multiline
            minRows={12}
            fullWidth
            value={baselineDraft}
            onChange={(e) => setBaselineDraft(e.target.value)}
            placeholder={t("workbench.reqBaseline.placeholder")}
            disabled={baselineSaving}
            sx={{ fontSize: 13 }}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setBaselineOpen(false)} disabled={baselineSaving}>
            {t("workbench.reqBaseline.cancel")}
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={() => void saveBaseline()}
            disabled={baselineSaving}
            startIcon={baselineSaving ? <CircularProgress size={14} /> : <SaveIcon sx={{ fontSize: 14 }} />}
          >
            {t("workbench.reqBaseline.save")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
