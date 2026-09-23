// sight-folio: 实体画像卡
// 对选中实体进行详细介绍与解释，让用户理解实体的作用。
// 画像全部数据驱动：依赖关系图为 SVG 动态渲染，架构分层条随 layers 配置动态生成。
import { Fragment, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Collapse from "@mui/material/Collapse";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Button from "@mui/material/Button";
import LinkIcon from "@mui/icons-material/Link";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import LayersIcon from "@mui/icons-material/Layers";
import RuleIcon from "@mui/icons-material/Rule";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import SubdirectoryArrowRightIcon from "@mui/icons-material/SubdirectoryArrowRight";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CodeIcon from "@mui/icons-material/Code";
import ImageIcon from "@mui/icons-material/Image";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import FontDownloadIcon from "@mui/icons-material/FontDownload";
import MovieIcon from "@mui/icons-material/Movie";
import AutoAwesomeMosaicIcon from "@mui/icons-material/AutoAwesomeMosaic";
import ArchiveIcon from "@mui/icons-material/Archive";
import DescriptionIcon from "@mui/icons-material/Description";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import GridViewIcon from "@mui/icons-material/GridView";
import CoronavirusIcon from "@mui/icons-material/Coronavirus";
import { useProjectStore } from "../../store/projectStore";
import { useToastStore } from "../../store/toastStore";
import { useEditorStore } from "../../store/editorStore";
import type { ProjectFile } from "../../services/tauri";
import { EntityRendererPreview } from "../components/EntityRendererPreview";
import { navigateToSource, navigateToSourceByPath, readLineFromMetadata } from "../utils/sourceNavigate";
import { projectScanApi } from "../../services/tauri";
import { openDirectorySubtree, runImpactPortraitFor } from "../utils/portraits";
import { useSceneStore } from "../../store/sceneStore";
import { assetFormatLabel, assetKindOf, type AssetKind } from "../utils/fileKind";
import { t, resolveFragments } from "../../i18n";
import { languageColor } from "../../utils/languageMeta";
import { PATTERN_CATEGORY_COLORS, PATTERN_CATEGORY_LABEL_KEY, patternLabel, QUADRANT_META, QUADRANT_HINT, QUADRANT_HINT_RISK, QUADRANT_HINT_DUP, QUADRANT_HINT_SIZE, type RiskQuadrant } from "../utils/fileInsights";
import { triggerDiagnosis } from "../../ai/triggerDiagnosis";
import {
  buildImagePreviewData,
  formatImageSize,
  imageFormatLabel,
  measureImageDimensions,
  formatDimensions,
  useAssetImage,
  type ImageDimensions,
  useProjectRoot,
} from "../utils/imageAsset";

const TYPE_LABELS: Record<string, string> = {
  file: "file",
  image: "image",
  asset: "asset",
  folder: "folder",
  module: "module",
  class: "class",
  function: "function",
  interface: "interface",
  "dependency-edge": "dependencyEdge",
  "layer-marker": "layerMarker",
  "annotation-text": "annotationText",
  "code-preview": "codePreview",
};
/** 实体类型名（跟随 UI 语言；未知回退原始 type） */
function typeLabel(type: string): string {
  const key = TYPE_LABELS[type] ?? type;
  if (TYPE_LABELS[type] === undefined) return type;
  const v = t(`portrait.type.${key}`);
  return v && !v.startsWith("portrait.type.") ? v : type;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#E24B4A",
  warning: "#EF9F27",
  info: "#378ADD",
};
const SEVERITY_LABELS: Record<string, string> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};
/** 严重度名（跟随 UI 语言；未知回退原始值） */
function severityLabel(sev: string): string {
  const v = t(`portrait.sev.${sev}`);
  return v && !v.startsWith("portrait.sev.") ? v : sev;
}

function strVal(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

/** 复杂度/热度等级 → i18n 文本 */
function levelText(lv: string): string {
  const map: Record<string, string> = {
    low: "portrait.metric.levelLow",
    medium: "portrait.metric.levelMedium",
    high: "portrait.metric.levelHigh",
    extreme: "portrait.metric.levelExtreme",
  };
  const k = map[lv];
  return k ? t(k) : lv;
}

/** 从实体 config 抽取对终端用户有意义的精选指标（过滤内部键，避免暴露 accentColor/portraitMode 等） */
function buildMetricRows(cfg: Record<string, unknown>): [string, string][] {
  const rows: [string, string][] = [];
  const push = (labelKey: string, val: unknown, suffix?: string) => {
    if (val === undefined || val === null || val === "") return;
    if (typeof val === "number" && (Number.isNaN(val) || val === 0)) return;
    rows.push([t(labelKey), strVal(val) + (suffix ?? "")]);
  };
  push("portrait.metric.symbolCount", cfg.symbolCount);
  if (cfg.patternNames) {
    const pn = cfg.patternNames;
    const s = Array.isArray(pn) ? pn.join("、") : strVal(pn);
    if (s) rows.push([t("portrait.metric.patternNames"), s]);
  }
  push("portrait.metric.refCount", cfg.refCount);
  if (cfg.complexity != null && cfg.complexity !== 0) {
    const lv = strVal(cfg.complexityLevel);
    rows.push([t("portrait.metric.complexity"), strVal(cfg.complexity) + (lv ? `（${levelText(lv)}）` : "")]);
  }
  if (cfg.complexityEngine) {
    const e = strVal(cfg.complexityEngine);
    rows.push([t("portrait.metric.engine"), e === "ast" ? t("portrait.metric.engineAst") : e === "heuristic" ? t("portrait.metric.engineHeuristic") : e]);
  }
  push("portrait.metric.syntaxError", cfg.syntaxErrorCount);
  push("portrait.metric.techDebt", cfg.techDebtCount);
  if (cfg.churnScore != null && cfg.churnScore !== 0) {
    const lv = strVal(cfg.churnLevel);
    rows.push([t("portrait.metric.churn"), strVal(cfg.churnScore) + (lv ? `（${levelText(lv)}）` : "")]);
  }
  push("portrait.metric.commit", cfg.commitCount);
  push("portrait.metric.author", cfg.authorCount);
  push("portrait.metric.callIn", cfg.callIn);
  push("portrait.metric.callOut", cfg.callOut);
  push("portrait.metric.dead", cfg.deadCount);
  return rows;
}

/** 依赖边类型 → 配色（与图例一致） */
const DEP_COLORS: Record<string, { stroke: string; fill: string; border: string }> = {
  import: { stroke: "#60A5FA", fill: "#B5D4F4", border: "#185FA5" },
  extends: { stroke: "#A78BFA", fill: "#DDD6FE", border: "#6D28D9" },
  implements: { stroke: "#34D399", fill: "#A7F3D0", border: "#047857" },
  calls: { stroke: "#F59E0B", fill: "#FDE68A", border: "#B45309" },
};
const DEFAULT_DEP = { stroke: "#888780", fill: "#D1D5DB", border: "#6B7280" };
function depColor(kind?: string): { stroke: string; fill: string; border: string } {
  return DEP_COLORS[kind ?? ""] ?? DEFAULT_DEP;
}
function depTypeLabel(kind?: string): string {
  const k = (kind ?? "") as "import" | "extends" | "implements" | "calls" | "other";
  if (k === "import" || k === "extends" || k === "implements" || k === "calls") return t(`portrait.depType.${k}`);
  return t("portrait.depType.other");
}

/**
 * 外部依赖归组（v2.11）：`external:xxx` 条目（第三方包 import）对理解项目内部
 * 依赖是噪音——一屏几十条 @mui/material/xxx 子路径，用户直呼「什么都没有显示」。
 * 规则：内部条目（项目文件）逐条保留；外部条目按包名聚合：
 *   external:@mui/material/List → 包 @mui/material
 *   external:react → react
 *   external:../../../x → 未解析引用（相对路径未命中项目文件）
 */
function splitExternalDeps(items: DepEntry[]): { internal: DepEntry[]; external: { pkg: string; count: number }[] } {
  const internal: DepEntry[] = [];
  const extCount = new Map<string, number>();
  for (const d of items) {
    if (d.name.startsWith("external:")) {
      const rest = d.name.slice("external:".length);
      let pkg: string;
      if (rest.startsWith("@")) pkg = rest.split("/").slice(0, 2).join("/"); // scoped 包前两段
      else if (rest.startsWith(".")) pkg = "…";
      else pkg = rest.split("/")[0];
      extCount.set(pkg, (extCount.get(pkg) ?? 0) + 1);
    } else {
      internal.push(d);
    }
  }
  return {
    internal,
    external: Array.from(extCount.entries())
      .map(([pkg, count]) => ({ pkg, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** 依赖图：中心实体 + 入/出依赖节点（v2.10 分栏列表式：不重叠、名称完整、外部依赖归组） */
function DependencyGraph({
  centerName,
  inDeps,
  outDeps,
  onNodeClick,
}: {
  centerName: string;
  inDeps: DepEntry[];
  outDeps: DepEntry[];
  onNodeClick?: (id: string, name: string) => void;
}) {
  // v2.10 重写：半圆 SVG 布局节点挤在一起、文字截断（externa…），用户明确
  // 要求「节点不能叠在一起 + 必须显示正确名称」。改为左右分栏列表式：
  // 每行一个独立节点（天然不重叠），名称用 HTML 文本完整显示（超长省略 +
  // tooltip 全名），方向语义保留（左=被依赖 ← · 右=依赖 →）。
  if (inDeps.length === 0 && outDeps.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 2.5, color: "text.secondary" }}>
        <LinkIcon sx={{ fontSize: 32, opacity: 0.2, mb: 0.5 }} />
        <Typography variant="caption" sx={{ display: "block" }}>
          {t("portrait.noDeps")}
        </Typography>
      </Box>
    );
  }
  const maxShow = 12;
  const clickable = !!onNodeClick;

  const renderSide = (title: string, color: string, items: DepEntry[], emptyText: string) => {
    // v2.11 外部依赖归组：内部文件逐条，外部包聚合为一条「{pkg} ×N」
    const { internal, external } = splitExternalDeps(items);
    const shown = internal.slice(0, maxShow);
    const more = internal.length - shown.length;
    const totalShown = shown.length + external.length;
    return (
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 700, color, display: "block", mb: 0.25 }}>
          {title}{" "}
          <span style={{ color: "text.disabled", fontWeight: 400 }}>
            {t("portrait.depCountSplit", { internal: internal.length, external: external.length })}
          </span>
        </Typography>
        {totalShown === 0 ? (
          <Typography variant="caption" sx={{ fontSize: 10, color: "text.disabled" }}>
            {emptyText}
          </Typography>
        ) : (
          <>
            {shown.map((d, i) => {
              const c = depColor(d.depKind);
              return (
                <Box
                  key={`${d.id}-${i}`}
                  title={`${d.name}${d.path ? ` · ${d.path}` : ""} · ${depTypeLabel(d.depKind)}${clickable ? ` · ${t("portrait.depClickHint")}` : ""}`}
                  onClick={clickable ? () => onNodeClick!(d.id, d.name) : undefined}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    px: 0.75,
                    py: 0.45,
                    borderRadius: 0.75,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.default",
                    cursor: clickable ? "pointer" : "default",
                    "&:hover": { bgcolor: "action.hover" },
                    minWidth: 0,
                  }}
                >
                  <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: c.border, flexShrink: 0 }} />
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{ fontSize: 10, fontFamily: "monospace", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
                    title={d.name}
                  >
                    {d.name}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: 8.5, color: "text.disabled", flexShrink: 0 }}>
                    {depTypeLabel(d.depKind)}
                  </Typography>
                </Box>
              );
            })}
            {more > 0 && (
              <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled", px: 0.5 }}>
                {t("portrait.depMore", { n: more })}
              </Typography>
            )}
            {/* 外部依赖归组条目（v2.11）：第三方包一行，不再刷屏 */}
            {external.map((e) => (
              <Box
                key={`ext-${e.pkg}`}
                title={t("portrait.externalTip")}
                onClick={() => useToastStore.getState().showToast(t("portrait.externalTip"), "info")}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  px: 0.75,
                  py: 0.4,
                  borderRadius: 0.75,
                  border: "1px dashed",
                  borderColor: "divider",
                  cursor: "help",
                  "&:hover": { bgcolor: "action.hover" },
                  minWidth: 0,
                }}
              >
                <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "#94A3B8", flexShrink: 0 }} />
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ fontSize: 9.5, fontFamily: "monospace", color: "text.secondary", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
                  title={e.pkg}
                >
                  {e.pkg}
                </Typography>
                <Typography variant="caption" sx={{ fontSize: 8.5, color: "text.disabled", flexShrink: 0 }}>
                  {t("portrait.externalCount", { n: e.count })}
                </Typography>
              </Box>
            ))}
          </>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
      {renderSide(t("portrait.depInList"), "#185FA5", inDeps, t("portrait.depNone"))}
      {/* 中心实体 + 方向指示（v2.10：名称完整，不再截断成 7 字符） */}
      <Box sx={{ width: 96, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 0.25, alignSelf: "center" }}>
        <Box
          sx={{
            width: "100%",
            px: 0.75,
            py: 1,
            borderRadius: 1,
            bgcolor: "#EEEDFE",
            border: "1px solid #534AB7",
            textAlign: "center",
          }}
        >
          <Typography
            variant="caption"
            noWrap
            sx={{ fontSize: 10, fontWeight: 600, color: "#26215C", display: "block", overflow: "hidden", textOverflow: "ellipsis" }}
            title={centerName}
          >
            {centerName}
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ fontSize: 8.5, color: "text.disabled", textAlign: "center" }}>
          ← {t("portrait.depInList")} · {t("portrait.depOutList")} →
        </Typography>
      </Box>
      {renderSide(t("portrait.depOutList"), "#3B6D11", outDeps, t("portrait.depNone"))}
    </Box>
  );
}

/** 依赖条目（v2.8：带 path 区分同名文件） */
export interface DepEntry {
  id: string;
  name: string;
  /** 完整相对路径（文件实体才有；模块实体的 name 已是目录名） */
  path?: string;
  type: string;
  depKind?: string;
}

/** 架构分层定位条（layers 动态生成） */
function LayerBar({ layers, activeLayerId, onLayerClick }: { layers: any[]; activeLayerId?: string | null; onLayerClick?: (layerId: string) => void }) {
  if (layers.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
        {t("portrait.noLayers")}
      </Typography>
    );
  }
  return (
    <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
      {layers.map((l) => {
        const active = l.id === activeLayerId;
        const color = l.color || "#94A3B8";
        return (
          <Box
            key={l.id}
            onClick={onLayerClick ? () => onLayerClick(l.id) : undefined}
            title={onLayerClick ? t("portrait.layer.clickHint") : undefined}
            sx={{
              px: 1,
              py: 0.5,
              borderRadius: 1,
              border: "1.5px solid",
              borderColor: active ? color : "divider",
              bgcolor: active ? `${color}18` : "transparent",
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              cursor: onLayerClick ? "pointer" : "default",
              "&:hover": onLayerClick ? { bgcolor: `${color}22` } : undefined,
            }}
          >
            <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
            <Typography variant="caption" sx={{ fontSize: 10, fontWeight: active ? 600 : 400 }}>
              {resolveFragments(l.name)}
            </Typography>
            {active && (
              <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary" }}>
                {t("portrait.thisEntity")}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * 代码级深度联动：接入 symbols / metrics / callEdges / deadSymbols（projectStore 已暴露）。
 * 按实体类型适配：
 *  - file / class：列其下符号（按 kind 分组）+ 文件度量摘要 + 死代码候选数
 *  - function：调 callEdges 显示调用方 / 被调用方（按 filePath + 名称匹配，实体 config 无 symbolId）
 * 无数据时返回 null（不渲染空卡）。
 */
function CodeInsights({
  entity,
  matchedFile,
  cfg,
}: {
  entity: PortraitEntity | null;
  matchedFile: ProjectFile | null;
  cfg: Record<string, unknown>;
}) {
  const symbols = useProjectStore((s) => s.symbols);
  const metrics = useProjectStore((s) => s.metrics);
  const callEdges = useProjectStore((s) => s.callEdges);
  const deadSymbols = useProjectStore((s) => s.deadSymbols);

  if (!entity) return null;

  // ── file / class：符号 + 文件度量 + 死代码 ──
  if (entity.type === "file" || entity.type === "class") {
    const fileId = matchedFile?.id;
    if (!fileId) return null;
    const fileSymbols = symbols.filter((s) => s.fileId === fileId);
    const metric = metrics.find((m) => m.fileId === fileId);
    const dead = deadSymbols.filter((d) => d.fileId === fileId);
    if (fileSymbols.length === 0 && !metric && dead.length === 0) return null;

    const byKind = new Map<string, number>();
    for (const s of fileSymbols) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
    const kindChips = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
    const top = [...fileSymbols].sort((a, b) => a.lineStart - b.lineStart).slice(0, 8);

    return (
      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
        <SectionTitle icon={<CodeIcon sx={{ fontSize: 13, color: "primary.main" }} />}>{t("portrait.code.title")}</SectionTitle>
        {kindChips.length > 0 && (
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: top.length > 0 ? 0.75 : 0 }}>
            {kindChips.map(([k, n]) => (
              <Chip key={k} label={t("portrait.code.kindChip", { kind: k, n })} size="small" sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.75 } }} />
            ))}
          </Box>
        )}
        {metric && (
          <Typography variant="caption" sx={{ display: "block", fontSize: 10, color: "text.secondary", lineHeight: 1.6 }}>
            {t("portrait.code.metric", {
              cc: metric.cyclomaticComplexity,
              level: levelText(metric.complexityLevel),
              engine: metric.engine === "ast" ? t("portrait.metric.engineAst") : t("portrait.metric.engineHeuristic"),
              fn: metric.functionCount,
            })}
            {metric.hotFunction ? ` · ${t("portrait.code.hot", { name: metric.hotFunction, cc: metric.maxFunctionCc })}` : ""}
          </Typography>
        )}
        {dead.length > 0 && (
          <>
            <Typography variant="caption" sx={{ display: "block", fontSize: 10, color: "warning.main", lineHeight: 1.6 }}>
              {t("portrait.code.dead", { n: dead.length })}
            </Typography>
            {/* v2.7 死数据打通：死代码符号可点列表 → 定位源码；v2.10 加路径副行（同名可区分） */}
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4, mt: 0.5 }}>
              {dead.slice(0, 8).map((d) => (
                <Box
                  key={d.symbolId}
                  title={`${d.name} · ${d.filePath}`}
                  sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer", borderRadius: 0.75, px: 0.75, py: 0.5, "&:hover": { bgcolor: "action.hover" } }}
                  onClick={() => navigateToSource(d.fileId, d.lineStart, t("portrait.code.openAt", { name: d.name, line: d.lineStart }))}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="caption" noWrap sx={{ fontSize: 10, fontFamily: "monospace", fontWeight: 600, display: "block" }}>
                      {d.name}
                    </Typography>
                    {d.filePath && (
                      <Typography variant="caption" noWrap sx={{ fontSize: 8.5, color: "text.disabled", display: "block" }}>
                        {d.filePath}
                      </Typography>
                    )}
                  </Box>
                  <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary", flexShrink: 0 }}>
                    {`L${d.lineStart}`}
                  </Typography>
                </Box>
              ))}
            </Box>
          </>
        )}
        {top.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, mt: 0.5 }}>
            {top.map((s) => (
              <Box
                key={s.id}
                sx={{ display: "flex", justifyContent: "space-between", gap: 1, cursor: "pointer", borderRadius: 0.5, px: 0.5, "&:hover": { bgcolor: "action.hover" } }}
                onClick={() => navigateToSource(s.fileId, s.lineStart, t("portrait.code.openAt", { name: s.name, line: s.lineStart }))}
              >
                <Typography variant="caption" noWrap sx={{ fontSize: 10, fontFamily: "monospace", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.name}
                </Typography>
                <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary", flexShrink: 0 }}>
                  {`L${s.lineStart}`}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Paper>
    );
  }

  // ── function：调用方 / 被调用方 ──
  if (entity.type === "function") {
    const fp = strVal(cfg.filePath);
    const name = entity.name;
    if (!fp) return null;
    const callers = callEdges.filter((e) => e.calleeFilePath === fp && e.calleeName === name);
    const callees = callEdges.filter((e) => e.callerFilePath === fp && e.callerName === name);
    if (callers.length === 0 && callees.length === 0) return null;

    const renderEdge = (e: { callerFileId: string; callerName: string; callerFilePath: string; calleeFileId: string; calleeName: string; calleeFilePath: string; lineNo: number }, dir: "caller" | "callee") => {
      const fid = dir === "caller" ? e.callerFileId : e.calleeFileId;
      const nm = dir === "caller" ? e.callerName : e.calleeName;
      const fpath = dir === "caller" ? e.callerFilePath : e.calleeFilePath;
      // v2.10 同名函数可区分：主行完整名称 + 副行完整路径（此前只显示文件名最后一段）
      return (
        <Box
          key={`${dir}-${fid}-${nm}-${e.lineNo}`}
          title={`${nm} · ${fpath}`}
          sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer", borderRadius: 0.75, px: 0.75, py: 0.5, "&:hover": { bgcolor: "action.hover" } }}
          onClick={() => navigateToSource(fid, e.lineNo, t("portrait.code.openAt", { name: nm, line: e.lineNo }))}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" noWrap sx={{ fontSize: 10, fontFamily: "monospace", fontWeight: 600, display: "block" }}>
              {nm}
            </Typography>
            {fpath && (
              <Typography variant="caption" noWrap sx={{ fontSize: 8.5, color: "text.disabled", display: "block" }}>
                {fpath}
              </Typography>
            )}
          </Box>
          <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary", flexShrink: 0 }}>
            {`L${e.lineNo}`}
          </Typography>
        </Box>
      );
    };

    return (
      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
        <SectionTitle icon={<CodeIcon sx={{ fontSize: 13, color: "primary.main" }} />}>{t("portrait.code.title")}</SectionTitle>
        <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, color: "text.secondary", display: "block", mb: 0.25 }}>
          {t("portrait.code.callers", { n: callers.length })}
        </Typography>
        {callers.length === 0 ? (
          <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled", display: "block", mb: 0.5 }}>{t("portrait.code.noCallers")}</Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, mb: 0.75 }}>{callers.map((e) => renderEdge(e, "caller"))}</Box>
        )}
        <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, color: "text.secondary", display: "block", mb: 0.25 }}>
          {t("portrait.code.callees", { n: callees.length })}
        </Typography>
        {callees.length === 0 ? (
          <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled", display: "block" }}>{t("portrait.code.noCallees")}</Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>{callees.map((e) => renderEdge(e, "callee"))}</Box>
        )}
      </Paper>
    );
  }

  return null;
}

/** 区块标题 */
// ─── v2.5 符号画像组件 ───

/** 符号级信息（EntityPortraitPanel 计算好传入） */
export interface SymbolInfo {
  symbolId: string | null;
  kind: string;
  signature: string | null;
  filePath: string | null;
  fileId: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  span: number;
  refCount: number;
  hub: boolean;
  inCycle: boolean;
  godClass: boolean;
}

/** 符号概览卡：信号徽标 + 统计 + 继承 + 操作按钮（打开源码 / 查看影响面） */
function SymbolOverviewSection({ sym, parents }: { sym: SymbolInfo; parents: { name: string; kind: string }[] }) {
  const showToast = useToastStore((s) => s.showToast);
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
      <SectionTitle icon={<SubdirectoryArrowRightIcon sx={{ fontSize: 13, color: "primary.main" }} />}>
        {t("portrait.symbol.title")}
      </SectionTitle>
      {/* 信号徽标 */}
      {(sym.hub || sym.godClass || sym.inCycle) && (
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 0.75 }}>
          {sym.hub && (
            <Chip size="small" label={t("portrait.symbol.hub")} sx={{ height: 18, fontSize: 9, bgcolor: "#f59e0b18", color: "#b45309", fontWeight: 700 }} />
          )}
          {sym.godClass && (
            <Chip size="small" label={t("portrait.symbol.godClass")} sx={{ height: 18, fontSize: 9, bgcolor: "#ef444418", color: "#dc2626", fontWeight: 700 }} />
          )}
          {sym.inCycle && (
            <Chip size="small" label={t("portrait.symbol.cycle")} sx={{ height: 18, fontSize: 9, bgcolor: "#ef444418", color: "#dc2626", fontWeight: 700 }} />
          )}
        </Box>
      )}
      {/* 签名 */}
      {sym.signature && (
        <Typography
          variant="caption"
          sx={{ fontSize: 10, fontFamily: "monospace", color: "text.secondary", display: "block", mb: 0.75, wordBreak: "break-all", lineHeight: 1.5 }}
        >
          {sym.signature}
        </Typography>
      )}
      {/* 统计 */}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center", mb: 0.75 }}>
        <StatItem label={t("portrait.symbol.kind")} value={sym.kind} />
        <StatItem label={t("portrait.symbol.refs")} value={String(sym.refCount)} />
        <StatItem label={t("portrait.symbol.span")} value={sym.span > 0 ? `${sym.span} ${t("portrait.symbol.linesUnit")}` : "—"} />
        {sym.lineStart !== null && (
          <StatItem label={t("portrait.symbol.definedAt")} value={`${sym.lineStart}`} />
        )}
      </Box>
      {/* 继承关系 */}
      {parents.length > 0 && (
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 0.75 }}>
          <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
            {t("portrait.symbol.inherits")}
          </Typography>
          {parents.map((p, i) => (
            <Chip
              key={i}
              size="small"
              label={`${p.kind === "implements" ? "implements" : "extends"} ${p.name}`}
              sx={{ height: 18, fontSize: 9, bgcolor: "#8b5cf618", color: "#7c3aed", fontWeight: 600 }}
            />
          ))}
        </Box>
      )}
      {/* 操作 */}
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
        {sym.fileId && (
          <Button
            size="small"
            variant="contained"
            startIcon={<CodeIcon sx={{ fontSize: 13 }} />}
            onClick={() => navigateToSource(sym.fileId as string, sym.lineStart, t("portrait.symbol.openTitle", { name: t("portrait.symbol.self", {}) }))}
            sx={{ textTransform: "none", fontSize: 10, lineHeight: 1, minWidth: 0, px: 1.25 }}
          >
            {t("portrait.openSource")}
          </Button>
        )}
        {sym.symbolId && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<CallSplitIcon sx={{ fontSize: 13 }} />}
            onClick={() => {
              const analysisId = useSceneStore.getState().activeSceneId;
              if (analysisId) {
                void runImpactPortraitFor(analysisId, { rootSymbolId: sym.symbolId as string, maxDepth: 3 }).then(
                  (res) => showToast(res.message, res.severity)
                );
              }
            }}
            sx={{ textTransform: "none", fontSize: 10, lineHeight: 1, minWidth: 0, px: 1.25 }}
          >
            {t("portrait.symbol.impact")}
          </Button>
        )}
      </Box>
    </Paper>
  );
}

/** v2.20 设计模式实体画像卡：把「死节点」变成可行动实体。
 *  回答用户四连问：这是什么模式 / 在哪（符号+文件:行）/ 多可信（置信度环）/ 凭什么（证据链）；
 *  并提供「跳源码」与「AI 诊断此模式」两个行动入口，与 symbols/dependency 同款行动力。 */
interface PatternInfo {
  patternId: string;
  patternName: string;
  category: string;
  confidence: number;
  line: number | null;
  fileId: string | null;
  filePath: string | null;
  symbolId: string | null;
  symbolName: string;
  evidence: string;
  signals: string[];
}

function PatternPortraitSection({ info }: { info: PatternInfo }) {
  const showToast = useToastStore((s) => s.showToast);
  const catColor = PATTERN_CATEGORY_COLORS[info.category] ?? "#8b5cf6";
  const catLabel = t(PATTERN_CATEGORY_LABEL_KEY[info.category] ?? "entityProj.cat.behavioral");
  const pct = Math.round(info.confidence * 100);
  const tier =
    info.confidence >= 0.85
      ? { label: t("entityProj.conf.high"), color: "#22c55e" }
      : info.confidence >= 0.7
        ? { label: t("entityProj.conf.medium"), color: "#eab308" }
        : { label: t("entityProj.conf.low"), color: "#f97316" };
  const location = info.filePath ? `${info.filePath}${info.line && info.line > 0 ? ":" + info.line : ""}` : null;

  const handleOpen = () => {
    const reason = t("portrait.pattern.openTitle", { name: info.symbolName || info.patternName });
    if (info.fileId) {
      const r = navigateToSource(info.fileId, info.line, reason);
      showToast(r.message, r.opened ? "success" : "warning");
    } else if (info.filePath) {
      const r = navigateToSourceByPath(info.filePath, info.line, reason);
      showToast(r.message, r.opened ? "success" : "warning");
    } else {
      showToast(t("editor.patternNoFile"), "warning");
    }
  };

  const handleDiagnose = () => {
    if (!info.filePath) {
      showToast(t("editor.patternNoFile"), "warning");
      return;
    }
    triggerDiagnosis({
      filePath: info.filePath,
      kind: "generic",
      title: t("portrait.pattern.aiDiagnoseTitle", { pattern: info.patternName, symbol: info.symbolName }),
      detail: t("portrait.pattern.aiDiagnoseDetail", {
        pattern: info.patternName,
        category: catLabel,
        confidence: pct,
        symbol: info.symbolName,
        location: location ?? "?",
      }),
    });
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
      <SectionTitle icon={<AutoAwesomeMosaicIcon sx={{ fontSize: 13, color: "#38bdf8" }} />}>
        {t("portrait.pattern.title")}
      </SectionTitle>
      {/* 模式名 + 分类 + 置信度 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75, flexWrap: "wrap" }}>
        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 13 }}>
          {info.patternName}
        </Typography>
        <Chip size="small" label={catLabel} sx={{ height: 16, fontSize: 9, fontWeight: 700, bgcolor: `${catColor}22`, color: catColor }} />
        <Chip size="small" label={`${pct}% · ${tier.label}`} sx={{ height: 16, fontSize: 9, fontWeight: 700, bgcolor: `${tier.color}22`, color: tier.color }} />
      </Box>
      {/* 命中符号 + 位置 */}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 0.75 }}>
        {info.symbolName && <StatItem label={t("portrait.pattern.symbol")} value={info.symbolName} />}
        {location && <StatItem label={t("portrait.pattern.location")} value={location} />}
      </Box>
      {/* 证据 / 判定依据 */}
      {(info.signals.length > 0 || info.evidence) && (
        <Box sx={{ mb: 0.75 }}>
          <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary", display: "block", mb: 0.25 }}>
            {t("portrait.pattern.evidence")}
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            {info.evidence && (
              <Typography variant="caption" sx={{ fontSize: 9.5, color: "text.secondary", lineHeight: 1.45, wordBreak: "break-all" }}>
                {info.evidence}
              </Typography>
            )}
            {info.signals.map((s, i) => (
              <Typography key={i} variant="caption" sx={{ fontSize: 9.5, color: "text.secondary", lineHeight: 1.45, wordBreak: "break-all" }}>
                • {s}
              </Typography>
            ))}
          </Box>
        </Box>
      )}
      {/* 操作 */}
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
        <Button
          size="small"
          variant="contained"
          startIcon={<CodeIcon sx={{ fontSize: 13 }} />}
          onClick={handleOpen}
          sx={{ textTransform: "none", fontSize: 10, lineHeight: 1, minWidth: 0, px: 1.25 }}
        >
          {t("portrait.pattern.openSource")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AutoFixHighIcon sx={{ fontSize: 13 }} />}
          onClick={handleDiagnose}
          sx={{ textTransform: "none", fontSize: 10, lineHeight: 1, minWidth: 0, px: 1.25 }}
        >
          {t("portrait.pattern.aiDiagnose")}
        </Button>
      </Box>
    </Paper>
  );
}

/** v2.36 重构四象限区块：象限实体专属概览（归属 + 行动建议 + 三维指标 + 跳源码 + AI 诊断） */
interface QuadrantInfo {
  name: string;
  quadrant: RiskQuadrant;
  complexity: number;
  complexityProxy: boolean;
  churnScore: number;
  riskScore: number;
  duplicationRatio: number;
  lineCount: number;
  quadrantXAxis: "churn" | "risk" | "duplication" | "size";
  fileId: string | null;
  filePath: string | null;
  lineStart: number | null;
}

function QuadrantPortraitSection({ info }: { info: QuadrantInfo }) {
  const showToast = useToastStore((s) => s.showToast);
  const meta = QUADRANT_META[info.quadrant];
  const zoneLabel = meta ? t(meta.label) : info.quadrant;
  const zoneColor = meta?.color ?? "#94a3b8";
  // 横轴数据源：与 runQuadrantPortrait 同口径——优先 churn，其次 risk，再 duplication，最后 size。
  // 直接复用节点落库的 quadrantXAxis（画像端已按信号优先级定了全局轴），保证面板与画布完全一致。
  const xAxis: "churn" | "risk" | "duplication" | "size" = info.quadrantXAxis;
  const hintKey =
    xAxis === "risk"
      ? QUADRANT_HINT_RISK[info.quadrant]
      : xAxis === "duplication"
        ? QUADRANT_HINT_DUP[info.quadrant]
        : xAxis === "size"
          ? QUADRANT_HINT_SIZE[info.quadrant]
          : QUADRANT_HINT[info.quadrant];
  const hintText = hintKey ? t(hintKey) : "";
  const axisName =
    xAxis === "churn"
      ? t("portrait.quadrant.churnLabel")
      : xAxis === "risk"
        ? t("portrait.quadrant.riskLabel")
        : xAxis === "duplication"
          ? t("portrait.quadrant.dupLabel")
          : t("portrait.quadrant.sizeLabel");
  const axisVal =
    xAxis === "churn"
      ? String(info.churnScore)
      : xAxis === "risk"
        ? String(info.riskScore)
        : xAxis === "duplication"
          ? `${Math.round(info.duplicationRatio * 100)}%`
          : `${info.lineCount}`;

  const handleOpen = () => {
    const reason = t("portrait.quadrant.openTitle", { name: info.name });
    if (info.fileId) {
      const r = navigateToSource(info.fileId, info.lineStart, reason);
      showToast(r.message, r.opened ? "success" : "warning");
    } else if (info.filePath) {
      const r = navigateToSourceByPath(info.filePath, info.lineStart, reason);
      showToast(r.message, r.opened ? "success" : "warning");
    } else {
      showToast(t("editor.patternNoFile"), "warning");
    }
  };

  const handleDiagnose = () => {
    if (!info.filePath) {
      showToast(t("editor.patternNoFile"), "warning");
      return;
    }
    triggerDiagnosis({
      filePath: info.filePath,
      kind: "generic",
      title: t("portrait.quadrant.aiDiagnoseTitle", { name: info.filePath }),
      detail: t("portrait.quadrant.aiDiagnoseDetail", {
        zone: zoneLabel,
        hint: hintText,
        complexity: info.complexity,
        proxy: info.complexityProxy ? t("portrait.quadrant.proxyNote") : "",
        axisName,
        axisVal,
        risk: info.riskScore,
      }),
    });
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
      <SectionTitle icon={<GridViewIcon sx={{ fontSize: 13, color: "#d946ef" }} />}>
        {t("portrait.quadrant.title")}
      </SectionTitle>
      {/* 象限归属 + 行动建议 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5, flexWrap: "wrap" }}>
        <Chip size="small" label={zoneLabel} sx={{ height: 16, fontSize: 9, fontWeight: 700, bgcolor: `${zoneColor}22`, color: zoneColor }} />
      </Box>
      <Typography variant="caption" sx={{ fontSize: 9.5, color: "text.secondary", lineHeight: 1.45, display: "block", mb: 0.75 }}>
        {hintText}
      </Typography>
      {/* 三维指标：复杂度（纵轴）/ 横轴数据源（随轴切换）/ 审查风险（有则附） */}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 0.75 }}>
        <StatItem
          label={t("portrait.quadrant.complexityLabel")}
          value={`${info.complexity}${info.complexityProxy ? t("portrait.quadrant.proxyNote") : ""}`}
        />
        <StatItem label={axisName} value={axisVal} />
        {info.riskScore > 0 && <StatItem label={t("portrait.quadrant.riskLabel")} value={String(info.riskScore)} />}
      </Box>
      {/* 操作：打开源码 + AI 诊断（与 PatternPortraitSection 同源，落实「画像可行动」） */}
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
        <Button
          size="small"
          variant="contained"
          startIcon={<CodeIcon sx={{ fontSize: 13 }} />}
          onClick={handleOpen}
          sx={{ textTransform: "none", fontSize: 10, lineHeight: 1, minWidth: 0, px: 1.25 }}
        >
          {t("portrait.quadrant.openSource")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AutoFixHighIcon sx={{ fontSize: 13 }} />}
          onClick={handleDiagnose}
          sx={{ textTransform: "none", fontSize: 10, lineHeight: 1, minWidth: 0, px: 1.25 }}
        >
          {t("portrait.quadrant.aiDiagnose")}
        </Button>
      </Box>
    </Paper>
  );
}

/** v2.25 污点传播节点画像卡：回答「这条链上我到底在看什么」。
 *  污点画像的节点如果只是「画出来」，用户拿到一张红图既不知道为什么红、也不知道该改哪 ——
 *  那就是死节点。这里按 PatternPortraitSection 同款四连问组织：
 *  这是什么角色 / 命中了哪条规则 / 污染的是哪个形参 / 在哪一行；
 *  并提供「打开源码」与「AI 诊断此链路」两个行动入口。 */
interface TaintInfo {
  role: string;
  endKind: string | null;
  severity: number;
  rule: string | null;
  tainted: string[];
  name: string;
  fileId: string | null;
  filePath: string | null;
  lineStart: number | null;
}

const TAINT_KIND_COLOR: Record<string, string> = {
  rce: "#dc2626",
  sql: "#ef4444",
  deser: "#f97316",
  xss: "#f59e0b",
  path: "#eab308",
  ssrf: "#a855f7",
  sideEffect: "#64748b",
  sanitized: "#10b981",
};

function TaintPortraitSection({ info }: { info: TaintInfo }) {
  const showToast = useToastStore((s) => s.showToast);
  const isSink = info.role === "sink";
  const kindColor = info.endKind ? TAINT_KIND_COLOR[info.endKind] ?? "#ef4444" : "#3b82f6";
  const roleLabel = t(`taint.role.${info.role}`);
  const kindLabel = info.endKind ? t(`taint.kind.${info.endKind}`) : null;
  const hint = t(`taint.hint.${info.role}`);
  const location = info.filePath
    ? `${info.filePath}${info.lineStart && info.lineStart > 0 ? ":" + info.lineStart : ""}`
    : null;

  const handleOpen = () => {
    const reason = t("portrait.taint.openTitle", { name: info.name });
    if (info.fileId) {
      const r = navigateToSource(info.fileId, info.lineStart, reason);
      showToast(r.message, r.opened ? "success" : "warning");
    } else if (info.filePath) {
      const r = navigateToSourceByPath(info.filePath, info.lineStart, reason);
      showToast(r.message, r.opened ? "success" : "warning");
    } else {
      showToast(t("editor.patternNoFile"), "warning");
    }
  };

  const handleDiagnose = () => {
    if (!info.filePath) {
      showToast(t("editor.patternNoFile"), "warning");
      return;
    }
    triggerDiagnosis({
      filePath: info.filePath,
      kind: "generic",
      title: t("portrait.taint.aiDiagnoseTitle", { name: info.name }),
      detail: t("portrait.taint.aiDiagnoseDetail", {
        role: roleLabel,
        kind: kindLabel ?? t("taint.kind.sideEffect"),
        rule: info.rule ?? "—",
        params: info.tainted.length > 0 ? info.tainted.join("、") : "—",
        location: location ?? "?",
      }),
    });
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
      <SectionTitle icon={<CoronavirusIcon sx={{ fontSize: 13, color: kindColor }} />}>
        {t("portrait.taint.title")}
      </SectionTitle>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75, flexWrap: "wrap" }}>
        <Chip
          size="small"
          label={roleLabel}
          sx={{ height: 16, fontSize: 9, fontWeight: 700, bgcolor: `${kindColor}22`, color: kindColor }}
        />
        {kindLabel && (
          <Chip
            size="small"
            label={kindLabel}
            sx={{ height: 16, fontSize: 9, fontWeight: 700, bgcolor: `${kindColor}22`, color: kindColor }}
          />
        )}
        {isSink && info.severity > 0 && (
          <Chip
            size="small"
            label={t("portrait.taint.severity", { n: info.severity })}
            sx={{ height: 16, fontSize: 9, fontWeight: 700, bgcolor: "#ef444422", color: "#ef4444" }}
          />
        )}
      </Box>
      <Typography variant="caption" sx={{ fontSize: 9.5, color: "text.secondary", lineHeight: 1.45, display: "block", mb: 0.75 }}>
        {hint}
      </Typography>
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 0.75 }}>
        {info.rule && <StatItem label={t("canvasTip.taintRule")} value={info.rule} />}
        {info.tainted.length > 0 && (
          <StatItem label={t("canvasTip.taintParams")} value={info.tainted.join("、")} />
        )}
        {location && <StatItem label={t("portrait.taint.location")} value={location} />}
      </Box>
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
        <Button
          size="small"
          variant="contained"
          startIcon={<CodeIcon sx={{ fontSize: 13 }} />}
          onClick={handleOpen}
          sx={{ textTransform: "none", fontSize: 10, lineHeight: 1, minWidth: 0, px: 1.25 }}
        >
          {t("portrait.taint.openSource")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AutoFixHighIcon sx={{ fontSize: 13 }} />}
          onClick={handleDiagnose}
          sx={{ textTransform: "none", fontSize: 10, lineHeight: 1, minWidth: 0, px: 1.25 }}
        >
          {t("portrait.taint.aiDiagnose")}
        </Button>
      </Box>
    </Paper>
  );
}


/** 符号级调用关系卡：谁调用它（callers）↑ / 它调用谁（callees）↓，点击打开源码 */
/** 区块标题 */
function SectionTitle({ icon, children, action }: { icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.75 }}>
      {icon}
      <Typography
        variant="caption"
        sx={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: "text.secondary",
          flex: 1,
        }}
      >
        {children}
      </Typography>
      {action}
    </Box>
  );
}

/** 关键事实：按实体类型输出的结构化事实卡片（替代叙述式作用介绍） */
function KeyFacts({
  entity,
  cfg,
  matchedFile,
  matchedModule,
  inDeps,
  outDeps,
}: {
  entity: PortraitEntity;
  cfg: Record<string, unknown>;
  matchedFile: ProjectFile | null;
  matchedModule: { fileCount: number; depCount: number; beDepCount: number } | null;
  inDeps: { id: string; name: string; type: string; depKind?: string }[];
  outDeps: { id: string; name: string; type: string; depKind?: string }[];
}) {
  const facts: { label: string; value: string }[] = [];
  const lang = strVal(cfg.language) || matchedFile?.language || "";

  const pushStr = (labelKey: string, val: unknown) => {
    if (val === undefined || val === null || val === "") return;
    facts.push({ label: t(labelKey), value: strVal(val) });
  };
  const pushNum = (labelKey: string, val: unknown) => {
    if (val === undefined || val === null || val === "") return;
    const n = Number(val);
    if (Number.isNaN(n) || n === 0) return;
    facts.push({ label: t(labelKey), value: strVal(val) });
  };

  if (entity.type === "function") {
    if (cfg.complexity != null && cfg.complexity !== "") {
      const lv = strVal(cfg.complexityLevel);
      pushStr("portrait.facts.complexity", `${strVal(cfg.complexity)}${lv ? `（${levelText(lv)}）` : ""}`);
    }
    pushNum("portrait.facts.maxNesting", cfg.maxNesting);
    pushStr("portrait.facts.riskLevel", cfg.riskLevel ? levelText(strVal(cfg.riskLevel)) : null);
    pushNum("portrait.facts.lines", cfg.lineCount);
    pushStr("portrait.facts.language", lang);
  } else if (entity.type === "module") {
    if (matchedModule) {
      pushNum("portrait.facts.fileCount", matchedModule.fileCount);
      pushNum("portrait.facts.depCount", matchedModule.depCount);
      pushNum("portrait.facts.beDepCount", matchedModule.beDepCount);
    }
    pushStr("portrait.facts.avgComplexity", cfg.avgComplexity != null && cfg.avgComplexity !== "" ? cfg.avgComplexity : null);
    pushStr("portrait.facts.riskLevel", cfg.riskLevel ? levelText(strVal(cfg.riskLevel)) : null);
  } else {
    // file / class / interface 等
    pushStr("portrait.facts.language", lang);
    pushNum("portrait.facts.lines", matchedFile?.lineCount ?? cfg.lineCount);
    pushStr("portrait.facts.path", matchedFile?.relPath || cfg.filePath);
    pushNum("portrait.facts.depOut", outDeps.length);
    pushNum("portrait.facts.depIn", inDeps.length);
    if (entity.type === "class") pushNum("portrait.facts.methods", cfg.methodCount);
  }

  if (facts.length === 0) return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
      <SectionTitle icon={<InfoOutlinedIcon sx={{ fontSize: 13, color: "info.main" }} />}>{t("portrait.facts.title")}</SectionTitle>
      <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 1.5, rowGap: 0.5, alignItems: "baseline" }}>
        {facts.map((f) => (
          <Fragment key={f.label}>
            <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", whiteSpace: "nowrap" }}>
              {f.label}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: 10, textAlign: "right", wordBreak: "break-all" }}>
              {f.value}
            </Typography>
          </Fragment>
        ))}
      </Box>
    </Paper>
  );
}

export interface PortraitEntity {
  id: string;
  type: string;
  name: string;
  description?: string;
  config?: Record<string, unknown>;
}

/**
 * 图片实体专属画像（替换代码类 tab）。
 * 图片不是代码，没有依赖/复杂度/审查 —— 用户选中图片实体时，此前画像面板四个 tab 全空。
 * 这里给一张可点击放大的预览 + 格式/尺寸/体积/路径信息卡，「查看大图」复用与画布双击
 * 同一个 ImagePreviewDialog（经 editorStore.openImagePreview 触发）。
 */
function ImagePortraitSection({ data }: { data: { absPath: string; name?: string; relPath?: string; fileSize?: number } }) {
  const { url: src, errored: srcFailed } = useAssetImage(data.absPath || null);
  const formatLabel = imageFormatLabel(data.name || data.relPath);
  const sizeText = formatImageSize(data.fileSize);
  const [dims, setDims] = useState<ImageDimensions | null>(null);

  // SVG 无固有宽高 → 按 viewBox 精确测量，避免「0×0」不准（与画布详情弹窗同源）。
  useEffect(() => {
    let cancelled = false;
    setDims(null);
    if (data.absPath) {
      measureImageDimensions(data.absPath).then((d) => {
        if (!cancelled) setDims(d);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [data.absPath]);

  const rows: [string, string][] = [];
  if (formatLabel) rows.push([t("imagePreview.format"), formatLabel]);
  if (dims) rows.push([t("imagePreview.dimensions"), formatDimensions(dims) + (dims.vector ? ` · ${t("imagePreview.vectorShort")}` : "")]);
  if (sizeText !== "—") rows.push([t("imagePreview.size"), sizeText]);
  if (data.relPath) rows.push([t("portrait.imagePath"), data.relPath]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 1, borderRadius: 1.5, bgcolor: "background.paper", display: "flex", justifyContent: "center" }}>
        {src && !srcFailed ? (
          <img
            src={src}
            alt={data.name}
            onClick={() => useEditorStore.getState().openImagePreview(data)}
            style={{ maxWidth: "100%", maxHeight: 240, objectFit: "contain", borderRadius: 1, cursor: "zoom-in", background: "#fff", display: "block" }}
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            {t("imagePreview.notFound")}
          </Typography>
        )}
      </Paper>
      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
        <SectionTitle icon={<ImageIcon sx={{ fontSize: 13, color: "info.main" }} />}>{t("portrait.imageInfo")}</SectionTitle>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {rows.map(([label, value]) => (
            <Box key={label} sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
              <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", flexShrink: 0 }}>
                {label}
              </Typography>
              <Typography variant="caption" sx={{ fontSize: 10, textAlign: "right", wordBreak: "break-all" }}>
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>
      <Button
        fullWidth
        variant="contained"
        color="primary"
        startIcon={<OpenInFullIcon sx={{ fontSize: 15 }} />}
        onClick={() => useEditorStore.getState().openImagePreview(data)}
        sx={{ textTransform: "none" }}
      >
        {t("portrait.viewImage")}
      </Button>
    </Box>
  );
}

/**
 * 资源文件实体专属画像（替换代码类 tab）。
 * 资源文件（字体/媒体/压缩/二进制）与图片同级：没有源码、没有依赖/复杂度/审查，
 * 画像核心是「这是什么格式 + 多大 + 在哪」。无预览能力（webview 不渲染字体/压缩包），
 * 以大图标 + 信息卡呈现，格式徽标与画布 AssetRenderer 同源。
 */
function AssetPortraitSection({ data }: { data: { name?: string; relPath?: string; fileSize?: number; format?: string } }) {
  const formatLabel = data.format || assetFormatLabel(data.name || data.relPath);
  const sizeText = formatImageSize(data.fileSize);
  // 资源子类（字体/媒体/压缩/其它）与画布 AssetRenderer 同源判定，让画像卡大图标与
  // 「类型」一行跟随真实种类，而不是永远挂个字体图标误导（.mp4 被当成字体）。
  const kind: AssetKind = assetKindOf(data.name || data.relPath);
  const KindIcon =
    kind === "font" ? FontDownloadIcon :
    kind === "media" ? MovieIcon :
    kind === "archive" ? ArchiveIcon :
    DescriptionIcon;

  const rows: [string, string][] = [];
  rows.push([t("portrait.assetKindTitle"), t(`portrait.assetKind.${kind}`)]);
  if (formatLabel) rows.push([t("imagePreview.format"), formatLabel]);
  if (sizeText !== "—") rows.push([t("imagePreview.size"), sizeText]);
  if (data.relPath) rows.push([t("portrait.imagePath"), data.relPath]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "background.paper", display: "flex", flexDirection: "column", alignItems: "center", gap: 0.75 }}>
        <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: `${languageColor("asset")}1a`, display: "flex", alignItems: "center", justifyContent: "center", color: languageColor("asset") }}>
          <KindIcon sx={{ fontSize: 26 }} />
        </Box>
        <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary", textAlign: "center", lineHeight: 1.6 }}>
          {t("portrait.assetHint")}
        </Typography>
      </Paper>
      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
        <SectionTitle icon={<FontDownloadIcon sx={{ fontSize: 13, color: "info.main" }} />}>{t("portrait.assetInfo")}</SectionTitle>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {rows.map(([label, value]) => (
            <Box key={label} sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
              <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", flexShrink: 0 }}>
                {label}
              </Typography>
              <Typography variant="caption" sx={{ fontSize: 10, textAlign: "right", wordBreak: "break-all" }}>
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  );
}

export function EntityPortraitPanel({ entity }: { entity: PortraitEntity | null }) {
  const files = useProjectStore((s) => s.files);
  const deps = useProjectStore((s) => s.dependencies);
  const findings = useProjectStore((s) => s.findings);
  const layers = useProjectStore((s) => s.layers);
  const modules = useProjectStore((s) => s.modules);

  // D4：tab 切换状态（概览 / 依赖 / 代码 / 审查）
  const [tab, setTab] = useState(0);
  // v2.9 依赖 tab 布局重构：符号实体的「所属文件依赖」默认收起（折叠区），
  // 避免与符号级调用卡并列成三张「谁引用我」卡（用户反馈布局混乱）。
  const [showFileDeps, setShowFileDeps] = useState(false);

  // ─── 数据关联：通过 config.filePath/name 匹配扫描结果中的 ProjectFile ───
  const matchedFile = useMemo(() => {
    if (!entity) return null;
    const cfg = entity.config || {};
    const path = strVal(cfg.filePath);
    const name = strVal(cfg.fileName) || entity.name;
    return (
      files.find((f) => !f.isDirectory && (path ? f.relPath === path : f.name === name)) ??
      files.find((f) => !f.isDirectory && f.name === name) ??
      null
    );
  }, [entity, files]);

  // ─── 模块实体关联：通过 config.moduleName/name 匹配 project_modules ───
  const matchedModule = useMemo(() => {
    if (!entity || entity.type !== "module") return null;
    const cfg = entity.config || {};
    const name = strVal(cfg.moduleName) || strVal(cfg.name) || entity.name;
    return modules.find((m) => m.name === name) ?? null;
  }, [entity, modules]);

  // 模块 → 其下文件 id 集合（依赖聚合用）
  const moduleFileIds = useMemo(() => {
    if (!matchedModule) return null;
    const ids = new Set<string>();
    for (const f of files) {
      if (f.isDirectory) continue;
      const top = f.relPath.includes("/") ? f.relPath.split("/")[0] : "root";
      if (top === matchedModule.name) ids.add(f.id);
    }
    return ids;
  }, [matchedModule, files]);

  const fileId = matchedFile?.id ?? null;

  // 入依赖（被谁依赖） / 出依赖（依赖谁）。depKind = 依赖边类型(import/extends/implements/calls)，type = 端点实体类型(file/module)
  const inDeps = useMemo(() => {
    if (matchedModule && moduleFileIds) {
      return deps
        .filter((d) => moduleFileIds.has(d.toId))
        .map((d) => {
          const f = files.find((x) => x.id === d.fromId);
          const top = f ? (f.relPath.includes("/") ? f.relPath.split("/")[0] : "root") : d.fromId;
          return { id: d.fromId, name: top, type: d.fromType, depKind: d.kind };
        })
        .filter((x, i, arr) => arr.findIndex((y) => y.name === x.name) === i);
    }
    if (!fileId) return [];
    return deps
      .filter((d) => d.toId === fileId)
      .map((d) => {
        const f = files.find((x) => x.id === d.fromId);
        // v2.8 依赖条目带完整路径：同名文件（不同目录）可区分，不再「一堆同名」
        return { id: d.fromId, name: f?.name ?? d.fromId, path: f?.relPath, type: d.fromType, depKind: d.kind };
      })
      .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
  }, [deps, fileId, files, matchedModule, moduleFileIds]);

  const outDeps = useMemo(() => {
    if (matchedModule && moduleFileIds) {
      return deps
        .filter((d) => moduleFileIds.has(d.fromId))
        .map((d) => {
          const f = files.find((x) => x.id === d.toId);
          const top = f ? (f.relPath.includes("/") ? f.relPath.split("/")[0] : d.toId) : d.toId;
          return { id: d.toId, name: top, type: d.toType, depKind: d.kind };
        })
        .filter((x, i, arr) => arr.findIndex((y) => y.name === x.name) === i);
    }
    if (!fileId) return [];
    return deps
      .filter((d) => d.fromId === fileId)
      .map((d) => {
        const f = files.find((x) => x.id === d.toId);
        // v2.8 依赖条目带完整路径：同名文件（不同目录）可区分
        return { id: d.toId, name: f?.name ?? d.toId, path: f?.relPath, type: d.toType, depKind: d.kind };
      })
      .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
  }, [deps, fileId, files, matchedModule, moduleFileIds]);

  const entityFindings = useMemo(() => {
    if (matchedModule && moduleFileIds) {
      return findings.filter((f) => moduleFileIds.has(f.targetId));
    }
    if (!fileId) return [];
    return findings.filter((f) => f.targetId === fileId);
  }, [findings, fileId, matchedModule, moduleFileIds]);

  const entityLayer = useMemo(() => {
    if (matchedModule?.layerId) {
      return layers.find((l) => l.id === matchedModule.layerId) ?? null;
    }
    return matchedFile?.layerId ? layers.find((l) => l.id === matchedFile.layerId) : null;
  }, [matchedModule, matchedFile, layers]);

  // ─── 图片实体专属数据 ───
  // 铁律：任何 Hook（useProjectRoot / useMemo）必须位于下方 `if (!entity) return` 早期返回之前，
  // 否则 entity 在渲染间从非空翻转为 null（或反之）时 Hook 数量变化 → React 报
  // "Rendered more hooks than during the previous render"（曾真实踩坑）。
  const imageRoot = useProjectRoot();
  const isImage = !!entity && entity.type === "image";
  // 资源文件（字体/媒体/压缩/二进制）与图片同级：无源码、无代码画像 → 走专属信息卡
  const isAsset = !!entity && entity.type === "asset";
  const isResource = isImage || isAsset;
  const imagePreviewData = useMemo(
    () => (isImage ? buildImagePreviewData((entity?.config || {}) as Record<string, unknown>, imageRoot) : null),
    [isImage, entity, imageRoot]
  );

  // ─── 作用介绍已被 D4 的结构化 KeyFacts 取代（见下方 tab 概览区）───

  // ─── 符号实体专属数据（v2.5）：符号画像 —— 详情面板对符号实体此前只展示
  // 所属文件画像，符号自身（引用/调用/继承/信号）完全没有，是「太弱」的核心。
  // 全部 useMemo 必须在下方 `if (!entity)` 早期返回之前（Hook 数量稳定铁律）。
  // v2.10：符号级调用关系（symCallGraph / SymbolCallsSection）已删除 —— 布局
  // 用户不满意且 CodeInsights 的 function 分支本就提供调用方/被调用方，不丢功能。
  const projectSymbolRefs = useProjectStore((s) => s.symbolRefs);
  const symInfo = useMemo(() => {
    if (!entity) return null;
    const c = (entity.config ?? {}) as Record<string, unknown>;
    // 符号实体判定（v2.8 收紧）：只认代码结构画像写入的 portraitMode="symbols" 实体。
    // 之前还收 type class/function/interface —— 会把热点画像的 function 实体也算进来，
    // 导致 SymbolCallsSection 与 CodeInsights 的 function 调用区重复显示（「乱七八糟」）。
    const isSym = c.portraitMode === "symbols";
    if (!isSym) return null;
    const symbolId = typeof c.symbolId === "string" ? c.symbolId : null;
    const kind = typeof c.symbolKind === "string" ? (c.symbolKind as string) : entity.type;
    const lineStart = typeof c.lineStart === "number" ? (c.lineStart as number) : null;
    const lineEnd = typeof c.lineEnd === "number" ? (c.lineEnd as number) : null;
    const refCount = typeof c.refCount === "number" ? (c.refCount as number) : 0;
    const span = lineStart !== null && lineEnd !== null ? Math.max(0, lineEnd - lineStart) : 0;
    return {
      symbolId,
      kind,
      signature: typeof c.signature === "string" ? (c.signature as string) : null,
      filePath: typeof c.filePath === "string" ? (c.filePath as string) : null,
      fileId: typeof c.fileId === "string" ? (c.fileId as string) : null,
      lineStart,
      lineEnd,
      span,
      refCount,
      hub: c.hub === true,
      inCycle: c.inCycle === true,
      // 上帝类（与 ClassRenderer 同口径）：>100 行且被 ≥5 处引用
      godClass: kind === "class" && span > 100 && refCount >= 5,
    };
  }, [entity]);

  /** 继承关系：symbolRefs kind=extends/implements，fromFilePath+refLine 匹配符号定义行 */
  const symParents = useMemo(() => {
    if (!symInfo?.symbolId || symInfo.lineStart === null) return [];
    return projectSymbolRefs
      .filter(
        (r) =>
          (r.kind === "extends" || r.kind === "implements") &&
          r.fromFilePath === symInfo.filePath &&
          r.refLine === symInfo.lineStart
      )
      .map((r) => ({ name: r.symbolName, kind: r.kind }));
  }, [symInfo, projectSymbolRefs]);

  // ─── 设计模式实体专属数据（v2.20）：把「死节点」变可行动实体 ───
  // 此前 pattern-node 在画像卡里完全无专属信息（只显示泛化 name），用户选中它
  // 也得不到任何关于「这是什么模式 / 在哪 / 多可信 / 证据是什么」的解答。
  // 这里抽取完整画像，配合下方 PatternPortraitSection 给出模式说明 + 证据 + 跳源码 + AI 诊断。
  const patternInfo = useMemo(() => {
    if (!entity || entity.type !== "pattern-node") return null;
    const c = (entity.config ?? {}) as Record<string, unknown>;
    const patternId = typeof c.patternId === "string" ? (c.patternId as string) : "";
    const category = typeof c.patternCategory === "string" ? (c.patternCategory as string) : "behavioral";
    const confidence = typeof c.confidence === "number" ? (c.confidence as number) : 0.5;
    const line = typeof c.line === "number" ? (c.line as number) : null;
    const fileId = typeof c.fileId === "string" ? (c.fileId as string) : null;
    const filePath = typeof c.filePath === "string" ? (c.filePath as string) : null;
    const symbolId = typeof c.symbolId === "string" ? (c.symbolId as string) : null;
    const symbolName = typeof c.symbolName === "string" ? (c.symbolName as string) : "";
    const evidence = typeof c.evidence === "string" ? (c.evidence as string) : "";
    const signals = Array.isArray(c.signals) ? (c.signals as string[]).filter((s) => typeof s === "string") : [];
    return {
      patternId,
      patternName: patternLabel(patternId) || t("entityProj.unknownPattern"),
      category,
      confidence,
      line,
      fileId,
      filePath,
      symbolId,
      symbolName,
      evidence,
      signals,
    };
  }, [entity]);

  // ─── 重构四象限实体专属数据（v2.36）：把「死节点」变可行动实体 ───
  // 此前 quadrant 散点/排行栏节点在画像卡里完全无专属信息（只走泛化 file 概览），用户选中
  // 它既得不到「为什么在这象限 / 该不该重构」的解答，也没有直达诊断入口 —— 即「点了没用」。
  // 这里抽取完整象限画像，配合下方 QuadrantPortraitSection 给出象限归属 + 行动建议 + 三维指标
  // + 跳源码 + AI 诊断，让「重构四象限」从 renderable 真正变 useful（见项目铁律 renderable ≠ useful）。
  const quadInfo = useMemo(() => {
    if (!entity) return null;
    const c = (entity.config ?? {}) as Record<string, unknown>;
    if (c.portraitMode !== "quadrant") return null;
    const quadrant = typeof c.quadrant === "string" ? (c.quadrant as RiskQuadrant) : null;
    if (!quadrant) return null;
    return {
      name: entity.name,
      quadrant,
      complexity: typeof c.complexity === "number" ? (c.complexity as number) : 0,
      complexityProxy: c.complexityProxy === true,
      churnScore: typeof c.churnScore === "number" ? (c.churnScore as number) : 0,
      riskScore: typeof c.riskScore === "number" ? (c.riskScore as number) : 0,
      duplicationRatio: typeof c.duplicationRatio === "number" ? (c.duplicationRatio as number) : 0,
      lineCount: typeof c.lineCount === "number" ? (c.lineCount as number) : 0,
      quadrantXAxis:
        c.quadrantXAxis === "duplication" || c.quadrantXAxis === "size" || c.quadrantXAxis === "risk"
          ? (c.quadrantXAxis as "churn" | "risk" | "duplication" | "size")
          : "churn",
      fileId: typeof c.fileId === "string" ? (c.fileId as string) : null,
      filePath: typeof c.filePath === "string" ? (c.filePath as string) : null,
      lineStart: typeof c.lineStart === "number" ? (c.lineStart as number) : null,
    };
  }, [entity]);

  // ─── 污点传播节点专属数据（v2.25）：把「画出来的红块」变可行动实体 ───
  // 与 patterns / quadrant 同款处理：从 config 抽取角色、命中规则、受污染形参与落点，
  // 交给下方 TaintPortraitSection 给出解释 + 跳源码 + AI 诊断，落实 renderable ≠ useful。
  const taintInfo = useMemo(() => {
    if (!entity) return null;
    const c = (entity.config ?? {}) as Record<string, unknown>;
    if (c.portraitMode !== "taintFlow") return null;
    const role = typeof c.taintRole === "string" ? (c.taintRole as string) : "";
    if (!role) return null;
    return {
      role,
      endKind: typeof c.taintEndKind === "string" ? (c.taintEndKind as string) : null,
      severity: typeof c.taintSeverity === "number" ? (c.taintSeverity as number) : 0,
      rule: typeof c.taintRule === "string" ? (c.taintRule as string) : null,
      tainted: Array.isArray(c.taintParams)
        ? (c.taintParams as unknown[]).filter((p): p is string => typeof p === "string")
        : [],
      name: typeof c.name === "string" ? (c.name as string) : entity.name || "",
      fileId: typeof c.fileId === "string" ? (c.fileId as string) : null,
      filePath: typeof c.filePath === "string" ? (c.filePath as string) : null,
      lineStart: typeof c.lineStart === "number" ? (c.lineStart as number) : null,
    };
  }, [entity]);

  if (!entity) {
    return (
      <Box sx={{ p: 2, textAlign: "center", color: "text.secondary" }}>
        <InfoOutlinedIcon sx={{ fontSize: 36, opacity: 0.2, mb: 1 }} />
        <Typography variant="caption" sx={{ display: "block" }}>
          {t("portrait.emptyHint")}
        </Typography>
      </Box>
    );
  }

  const cfg = entity.config || {};
  const typeLabelText = typeLabel(entity.type);
  const lang = strVal(cfg.language) || matchedFile?.language || "";
  const lineCount = matchedFile?.lineCount ?? (Number(strVal(cfg.lineCount)) || undefined);
  const size = matchedFile?.size ?? (Number(strVal(cfg.fileSize)) || undefined);
  const metricRows = buildMetricRows(cfg);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ① 身份区（始终锚定，跨 tab 可见） */}
      <Paper
        variant="outlined"
        sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper", flexShrink: 0 }}
      >
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.25 }}>
          <EntityRendererPreview
            type={entity.type}
            config={cfg}
            width={150}
            height={82}
            scale={0.95}
            borderRadius={10}
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>
              {entity.name}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.5, flexWrap: "wrap" }}>
              <Chip label={typeLabelText} size="small" sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.75 } }} />
              {lang && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: languageColor(lang) }} />
                  <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary" }}>
                    {lang}
                  </Typography>
                </Box>
              )}
              {entityLayer && (
                <Chip
                  label={entityLayer.name}
                  size="small"
                  sx={{
                    height: 16,
                    fontSize: 9,
                    "& .MuiChip-label": { px: 0.75 },
                    bgcolor: `${entityLayer.color || "#94A3B8"}18`,
                    color: "text.primary",
                  }}
                />
              )}
            </Box>
          </Box>
        </Box>
        {(size !== undefined || lineCount !== undefined) && (
          <Box sx={{ display: "flex", gap: 1.5, mt: 1, pt: 1, borderTop: 1, borderColor: "divider", alignItems: "center" }}>
            {size !== undefined && (
              <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
                {t("portrait.size", { size: size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB` })}
              </Typography>
            )}
            {lineCount !== undefined && (
              <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
                {t("portrait.lines", { n: lineCount })}
              </Typography>
            )}
            <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
              {t("portrait.refs", { n: inDeps.length, m: outDeps.length })}
            </Typography>
            <Box sx={{ flex: 1 }} />
            {/* 业务联动：文件实体可直接打开源码（定位到问题行） */}
            {entity.type === "file" && matchedFile && (
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<CodeIcon sx={{ fontSize: 13 }} />}
                onClick={() => navigateToSource(matchedFile.id, null, t("portrait.openSourceTitle", { path: matchedFile.relPath }))}
                sx={{ textTransform: "none", fontSize: 10, lineHeight: 1, minWidth: 0, px: 1.25, whiteSpace: "nowrap" }}
              >
                {t("portrait.openSource")}
              </Button>
            )}
            {/* 图片实体无源码，改为「查看大图」打开详情弹窗（与画布双击一致） */}
            {isImage && imagePreviewData && (
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<OpenInFullIcon sx={{ fontSize: 13 }} />}
                onClick={() => useEditorStore.getState().openImagePreview(imagePreviewData)}
                sx={{ textTransform: "none", fontSize: 10, lineHeight: 1, minWidth: 0, px: 1.25, whiteSpace: "nowrap" }}
              >
                {t("portrait.viewImage")}
              </Button>
            )}
          </Box>
        )}
      </Paper>

      {/* tab 切换：概览 / 依赖 / 代码 / 审查（图片/资源实体无代码结构画像，改用专属信息卡，不渲染 tab） */}
      {!isResource && (
        <Box sx={{ flexShrink: 0, px: 0.5, borderBottom: 1, borderColor: "divider" }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="fullWidth"
            sx={{ minHeight: 30, "& .MuiTab-root": { minHeight: 30, fontSize: 11, textTransform: "none", py: 0.25 } }}
          >
            <Tab label={t("portrait.tabs.overview")} />
            <Tab label={t("portrait.tabs.deps")} />
            <Tab label={t("portrait.tabs.code")} />
            <Tab label={t("portrait.tabs.review")} />
          </Tabs>
        </Box>
      )}

      {/* tab 内容区（独立滚动） */}
      <Box sx={{ flex: 1, overflow: "auto", p: 1.25, display: "flex", flexDirection: "column", gap: 1.25 }}>
        {/* 图片实体：专属信息卡（预览 + 格式/尺寸/体积/路径），不渲染代码类 tab */}
        {isImage && imagePreviewData && <ImagePortraitSection data={imagePreviewData} />}
        {/* 资源文件实体：专属信息卡（格式/体积/路径），不渲染代码类 tab */}
        {isAsset && (
          <AssetPortraitSection
            data={{
              name: entity.name,
              relPath: strVal(cfg.filePath) || matchedFile?.relPath,
              fileSize: matchedFile?.size ?? (Number(strVal(cfg.fileSize)) || undefined),
              format: strVal(cfg.extension) || undefined,
            }}
          />
        )}
        {tab === 0 && (
          <>
            {/* v2.5 符号画像：符号实体专属概览（信号/统计/继承/操作） */}
            {symInfo && <SymbolOverviewSection sym={symInfo} parents={symParents} />}
            {/* v2.20 设计模式画像：模式实体专属概览（说明/置信度/证据/跳源码/AI 诊断） */}
            {patternInfo && <PatternPortraitSection info={patternInfo} />}
            {/* v2.36 重构四象限：象限实体专属概览（归属/建议/三维指标/跳源码/AI 诊断），让散点节点从 renderable 变 useful */}
            {quadInfo && <QuadrantPortraitSection info={quadInfo} />}
            {/* v2.25 污点传播节点：角色/命中规则/受污染形参/落点 + 跳源码 + AI 诊断 */}
            {taintInfo && <TaintPortraitSection info={taintInfo} />}
            <KeyFacts entity={entity} cfg={cfg} matchedFile={matchedFile} matchedModule={matchedModule} inDeps={inDeps} outDeps={outDeps} />
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
              <SectionTitle icon={<InfoOutlinedIcon sx={{ fontSize: 13, color: "text.secondary" }} />}>{t("portrait.metaTitle")}</SectionTitle>
              {metricRows.length === 0 ? (
                <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
                  {t("portrait.metric.empty")}
                </Typography>
              ) : (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  {metricRows.map(([label, value]) => (
                    <Box key={label} sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                      <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", flexShrink: 0 }}>
                        {label}
                      </Typography>
                      <Typography variant="caption" sx={{ fontSize: 10, textAlign: "right", wordBreak: "break-all" }}>
                        {value}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>
          </>
        )}

        {!isResource && tab === 1 && (
          <>
            {/* 文件级依赖（图 + 全量列表）：符号实体默认折叠，文件/模块实体直接展示（v2.9 布局重构） */}
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
              <SectionTitle
                icon={<AccountTreeIcon sx={{ fontSize: 13, color: "primary.main" }} />}
                action={
                  symInfo ? (
                    <Button
                      size="small"
                      onClick={() => setShowFileDeps((v) => !v)}
                      sx={{ textTransform: "none", fontSize: 10, lineHeight: 1, minWidth: 0, px: 0.75, py: 0.25 }}
                    >
                      {showFileDeps ? t("portrait.depsHide") : t("portrait.depsShow")}
                    </Button>
                  ) : undefined
                }
              >
                {symInfo ? t("portrait.depsFileTitle") : t("portrait.depsTitle")}
              </SectionTitle>
              <Collapse in={!symInfo || showFileDeps}>
                <DependencyGraph
                  centerName={entity.name}
                  inDeps={inDeps}
                  outDeps={outDeps}
                  onNodeClick={(id, name) => {
                    // v2.7 死数据打通：模块实体的依赖条目是顶层目录名 → 点击下钻该目录子树；
                    // 文件实体的依赖条目是文件名 → 点击打开源码
                    if (matchedModule) {
                      const analysisId = useSceneStore.getState().activeSceneId;
                      if (analysisId) {
                        void openDirectorySubtree(name, analysisId).then((res) =>
                          useToastStore.getState().showToast(res.message, res.severity)
                        );
                      }
                    } else {
                      navigateToSource(id, null, t("portrait.depNavTitle", { name }));
                    }
                  }}
                />
              </Collapse>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
              <SectionTitle icon={<LayersIcon sx={{ fontSize: 13, color: "primary.main" }} />}>{t("portrait.layerTitle")}</SectionTitle>
              <LayerBar
                layers={layers}
                activeLayerId={matchedFile?.layerId}
                onLayerClick={(layerId) => {
                  // v2.7 死数据打通：点击图层 → 画布选中该层全部实体并框入视野
                  const est = useEditorStore.getState();
                  const ids = est.components
                    .filter((c) => (c.config as Record<string, unknown>)?.projectLayerId === layerId)
                    .map((c) => c.id);
                  if (ids.length > 0) {
                    est.selectComponents(ids);
                    est.requestFit(ids);
                  } else {
                    useToastStore.getState().showToast(t("portrait.layer.noEntity"), "info");
                  }
                }}
              />
            </Paper>
          </>
        )}

        {!isResource && tab === 2 && <CodeInsights entity={entity} matchedFile={matchedFile} cfg={cfg} />}

        {!isResource && tab === 3 && (
          <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "background.paper" }}>
            <SectionTitle icon={<RuleIcon sx={{ fontSize: 13, color: "warning.main" }} />}>
              {entityFindings.length > 0 ? t("portrait.findingsTitle", { n: entityFindings.length }) : t("portrait.findingsTitlePlain")}
            </SectionTitle>
            {entityFindings.length === 0 ? (
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
                {t("portrait.noFindings")}
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                {entityFindings.map((f) => (
                  <Box
                    key={f.id}
                    title={t("portrait.findings.clickHint")}
                    onClick={() => {
                      // v2.7 死数据打通：审查发现点击 → 定位源码行（metadata 解析行号）
                      const line = readLineFromMetadata(f.metadata);
                      navigateToSource(f.targetId, line, t("portrait.findings.openAt", { line: line ?? "?" }));
                    }}
                    sx={{ display: "flex", gap: 0.75, alignItems: "flex-start", cursor: "pointer", borderRadius: 0.75, p: 0.5, "&:hover": { bgcolor: "action.hover" } }}
                  >
                    <Box
                      sx={{
                        mt: 0.35,
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        flexShrink: 0,
                        bgcolor: SEVERITY_COLORS[f.severity] ?? "#94A3B8",
                      }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="caption" sx={{ fontSize: 10, lineHeight: 1.5, display: "block" }}>
                        {f.message}
                      </Typography>
                      {f.suggestion && (
                        <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary", display: "block" }}>
                          {t("portrait.suggestion", { s: f.suggestion })}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Paper>
        )}
      </Box>
    </Box>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled" }}>
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, fontFamily: "monospace" }}>
        {value}
      </Typography>
    </Box>
  );
}
