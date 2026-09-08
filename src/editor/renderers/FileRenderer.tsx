// project-sight: 文件实体渲染器（画布上数量最多的实体，性能敏感）
//
// R37 重写为「零 Emotion」实现：原版是 18 个 <Box sx> + 4 个 <Typography sx> +
// 4 个 <Tooltip>，单实体 26 个 emotion styled 组件。画布同步几百个文件后，
// 光是挂载就要几百毫秒，平移触发的虚拟化重挂载每轮同样量级 —— 这是用户反复
// 反馈「非常卡顿」的第一大头。
//
// 现在改成纯 <div>/<span> + inline style，主题色走 MUI 已经输出的 CSS 变量
// （见 canvasTheme.ts），明暗切换照常生效；悬浮说明用原生 title 属性替代
// MUI Tooltip（画布上同时存在几百个 Tooltip 实例是纯粹的浪费）。
// 视觉与信息量与原版一致。
import { FileGlyph } from "./glyphs";
import {
  COMPLEXITY_COLORS,
  DUPLICATION_COLORS,
  DUPLICATION_LABELS,
  duplicationLevelOf,
  QUADRANT_META,
  QUADRANT_HINT,
  QUADRANT_HINT_RISK,
  QUADRANT_HINT_DUP,
  QUADRANT_HINT_SIZE,
  type RiskQuadrant,
} from "../utils/fileInsights";
import { useProjectStore } from "../../store/projectStore";
import { selectFileMark, useInsightOverlayStore } from "../../store/insightOverlayStore";
import { useVerifyOverlayStore, selectVerifyMark } from "../../store/verifyOverlayStore";
import { useImpactOverlayStore, selectImpactMark } from "../../store/impactOverlayStore";
import { SEVERITY_COLOR, severityLabel } from "../../ai/insightOverlay";
import { VERIFY_COLOR, verifyTooltip, verifyBadgeGlyph } from "../../ai/verifyOverlay";
import type { CanvasLod } from "../utils/lod";
import { t, resolveFragments } from "../../i18n";
import { triggerDiagnosis } from "../../ai/triggerDiagnosis";
import {
  BODY_STYLE,
  CV,
  ICON_STYLE,
  META_ROW_STYLE,
  TITLE_ROW_STYLE,
  TITLE_STYLE,
  badgeStyle,
  dotStyle,
  insightBadgeStyle,
  metaStyle,
  shellStyle,
  stripeStyle,
  tintGradient,
} from "./canvasTheme";
import { ShapeDecorations } from "./shapeDecorations";
import { languageColor } from "../../utils/languageMeta";

// 语言→颜色映射（取自 GitHub linguist 配色；key 统一小写，
// 语言配色统一走 languageMeta（短码/别名/全名自动适配）

// 复杂度等级中文名
const COMPLEXITY_LABELS: Record<string, string> = {
  low: "canvasTip.cxLow",
  medium: "canvasTip.cxMid",
  high: "canvasTip.cxHigh",
  extreme: "canvasTip.cxExtreme",
};

// git 变更热度等级 → 颜色 / 中文名
const CHURN_COLORS: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  extreme: "#ef4444",
};
const CHURN_LABELS: Record<string, string> = {
  low: "canvasTip.cxLow",
  medium: "canvasTip.cxMid",
  high: "canvasTip.cxHigh",
  extreme: "canvasTip.cxExtreme",
};

/**
 * 从相对路径取目录部分（不含文件名）。根级文件返回 null。
 * R38：用户要求「每个图形标注清楚是哪个目录哪个文件」——
 * 画布上几百个文件只写文件名时，同目录的同名文件（如 index.ts）
 * 根本分不清谁是谁。config 里 filePath 一直带着完整 relPath，
 * 只是渲染器一直没消费。
 */
export function dirPathOf(filePath?: string): string | null {
  if (!filePath) return null;
  const i = filePath.lastIndexOf("/");
  if (i <= 0) return null; // 根级文件（i === -1）或 "/x"（i === 0）
  return filePath.slice(0, i);
}

interface FileRendererProps {
  config?: {
    fileName?: string;
    /** 相对路径（syncLayout 写入的 f.relPath；R38 起卡片上显示目录部分） */
    filePath?: string;
    language?: string;
    fileSize?: number;
    lineCount?: number;
    /** 文件内符号数量（画布画像数据） */
    symbolCount?: number;
    /** 命中设计模式中文名列表（画布画像数据） */
    patternNames?: string[];
    /** 被引用次数（画布画像数据） */
    refCount?: number;
    /** 圈复杂度（画布画像数据） */
    complexity?: number;
    /** 复杂度等级 low|medium|high|extreme */
    complexityLevel?: "low" | "medium" | "high" | "extreme";
    /** 复杂度度量引擎（R44）：ast=tree-sitter 精确 / heuristic=行级估算，估算值用虚线+角标区分 */
    complexityEngine?: "ast" | "heuristic";
    /** 语法错误行数（R46） */
    syntaxErrorCount?: number;
    /** 语法错误所在行号（1 起，供 tooltip/定位） */
    syntaxErrorLines?: number[];
    /** 技术债标记数（TODO/FIXME/HACK 等，画布画像数据） */
    techDebtCount?: number;
    /** 调用出度：本文件内函数调用了多少个不同目标（画布画像数据） */
    callOut?: number;
    /** 调用入度：本文件内函数被多少处调用（高 fan-in = 改动影响面大，画布画像数据） */
    callIn?: number;
    /** git 变更热度分数（画布画像数据） */
    churnScore?: number;
    /** 变更热度等级 low|medium|high|extreme */
    churnLevel?: string;
    /** 零引用符号数（死代码画像数据） */
    deadCount?: number;
    /** 重复代码块数（克隆检测画像数据） */
    cloneCount?: number;
    /** Type-2 参数化克隆块数（变量/函数名重命名后的近重复，画布画像数据） */
    cloneType2Count?: number;
    /** 被重复覆盖的代码行数（去重后） */
    duplicatedLines?: number;
    /** 重复率 0~1 */
    duplicationRatio?: number;
    /** churn × complexity 四象限：refactorFirst|legacyStable|activeSimple|healthy */
    quadrant?: string;
    /** 新画像通用着色/标注字段：accentColor 优先于复杂度色条，metricBadge/Title 在卡上展示 */
    accentColor?: string;
    metricBadge?: string;
    metricTitle?: string;
    [key: string]: unknown;
  };
  /** 画布 LOD 档位（缩小到一定程度后省略徽标/文字，见 utils/lod.ts）；缺省按 full */
  lod?: CanvasLod;
}

export function FileRenderer(props: FileRendererProps) {
  const _config = props?.config;
  const lod = props?.lod ?? "full";
  const config = _config ?? {};
  const lang = (config.language || "unknown").toLowerCase();
  const langColor = languageColor(lang);
  const lineCount = config.lineCount;

  // ─── 语言焦点联动（插件切换 → 非焦点语言文件淡化）───
  const focusLanguage = useProjectStore((s) => s.focusLanguage);
  const isFocusedOut =
    !!focusLanguage &&
    !(
      lang === focusLanguage ||
      (focusLanguage === "typescript" && (lang === "javascript" || lang === "typescript"))
    );
  const focusDim = isFocusedOut ? 0.28 : 1;

  // ─── AI 洞察投射（扫描 → Agent 分析 → 结论回到视图的最后一段）───────────
  // Agent 把结论写回 ai_insights 后，这里按文件路径 O(1) 查表拿到该文件命中的
  // 最高严重度。关掉画布标注或该文件没被点名时取到 undefined，
  // Object.is 相等 → 几百个文件实体一个都不会重渲染（见 insightOverlayStore）。
  const insightMark = useInsightOverlayStore(selectFileMark(config.filePath));
  const insightColor = insightMark ? SEVERITY_COLOR[insightMark.severity] : null;
  const insightTitle = insightMark
    ? [
        t("canvasTip.aiFile", { n: insightMark.count, sev: severityLabel(insightMark.severity) }),
        ...insightMark.titles.map((t) => `· ${t}`),
      ].join("\n")
    : null;

  // ─── 验证结论投射（AI 改动即时效应 → 画布热力图）────────────────────
  // 与洞察投射同源：O(1) 查表，无标记时取到 undefined（Object.is 相等 → 不重渲染）。
  // 数据来自面板实时结算并经 Tauri 全局事件跨窗口广播（不落库，属会话级即时效应）。
  const verifyMark = useVerifyOverlayStore(selectVerifyMark(config.filePath));
  const verifyColor = verifyMark ? VERIFY_COLOR[verifyMark.verdict] : null;
  const verifyTitle = verifyMark ? verifyTooltip(verifyMark) : null;

  // ─── 影响面（爆炸半径）投射（R18）─────────────────────────────────────
  // 与洞察/验证同源：O(1) 查表，非波及文件取到 false（Object.is 相等 → 不重渲染）。
  // 数据来自面板按调用图反向闭包算出的「改此焦点会波及哪些文件」，经 Tauri 全局事件
  // 跨窗口广播（不落库，属当前焦点的即时认知）。靛蓝是这块独有的"关联/波及"语义色，
  // 与洞察严重度色、验证绿/红、调用枢纽琥珀都不冲突。
  const impactMark = useImpactOverlayStore(selectImpactMark(config.filePath));
  const IMPACT_COLOR = "#6366f1";
  const impactTitle = impactMark
    ? t("workbench.aiImpact.canvasTip", { path: config.filePath || config.fileName || "untitled" })
    : null;

  // ─── 画布画像数据 ───
  const symbolCount = config.symbolCount ?? 0;
  const patternNames = config.patternNames ?? [];
  const refCount = config.refCount ?? 0;
  const complexity = config.complexity ?? 0;
  const complexityLevel = config.complexityLevel ?? "low";
  const syntaxErrorCount = config.syntaxErrorCount ?? 0;
  const syntaxErrorLines = config.syntaxErrorLines ?? [];
  const techDebtCount = config.techDebtCount ?? 0;
  const churnScore = config.churnScore ?? 0;
  const churnLevel = config.churnLevel ?? "low";
  const deadCount = config.deadCount ?? 0;
  const cloneCount = config.cloneCount ?? 0;
  const cloneType2Count = config.cloneType2Count ?? 0;
  const duplicatedLines = config.duplicatedLines ?? 0;
  const duplicationRatio = config.duplicationRatio ?? 0;
  const duplicationLevel = duplicationLevelOf(duplicationRatio);
  const dupColor = DUPLICATION_COLORS[duplicationLevel];
  const showDup = cloneCount > 0;
  const quadrant = (config.quadrant as RiskQuadrant) ?? "healthy";
  const callOut = config.callOut ?? 0;
  const callIn = config.callIn ?? 0;
  // 调用入度 ≥ 8：高 fan-in 文件，改它影响面大 → 标为「调度枢纽」
  const isCallHub = callIn >= 8;
  const heatColor = COMPLEXITY_COLORS[complexityLevel] || "#22c55e";
  const churnColor = CHURN_COLORS[churnLevel] || "#22c55e";
  // 新画像通用着色：accentColor 优先于复杂度色条（从 config 读取，已是 string | undefined）
  const accent = config.accentColor;
  const hasInsight =
    symbolCount > 0 ||
    patternNames.length > 0 ||
    refCount > 0 ||
    techDebtCount > 0 ||
    churnScore > 0 ||
    deadCount > 0 ||
    callIn > 0 ||
    callOut > 0 ||
    cloneCount > 0;

  // 复杂度热力：左侧色条 + 右上角热力角标
  const showHeat = complexity > 0;
  // 复杂度度量引擎（R44 审计修复）：heuristic 是行级估算，不是 AST 精确值——
  // 用虚线边框 + 角标「估」区分，避免估算值被当成事实。
  const complexityEngine = config.complexityEngine;
  const isEstimatedComplexity = showHeat && complexityEngine === "heuristic";
  // git 变更热度：与复杂度正交的另一条风险轴（右下角角标）
  const showChurn = churnScore > 0;
  // churn × complexity 四象限：refactorFirst = 高复杂 × 高变更，应优先重构
  const isRefactorFirst = quadrant === "refactorFirst";
  // v2.45：全局重构优先级序号（仅重构象限散点节点携带 config.rank）；徽标着色随象限，
  // 让「先重构谁」在全览档也一眼可读，直接落实 renderable≠useful。
  const rank = typeof config.rank === "number" ? config.rank : null;
  const QUAD_RANK_COLORS: Record<string, string> = {
    refactorFirst: "#ef4444",
    legacyStable: "#a855f7",
    activeSimple: "#f59e0b",
    healthy: "#22c55e",
  };
  const rankColor = quadrant ? (QUAD_RANK_COLORS[quadrant] ?? "#64748b") : null;
  const showRankBadge = rank != null && !!quadrant && !config.quadrantRail;

  // v2.46 重构象限散点 hover 显「象限归属 + 优先级 + 行动建议」：悬停即懂点为何落此、
  // 多紧急、该干什么（renderable≠useful——此前 hover 仅给通用指标，难把「点位置」对应到
  // 「重构决策」）。仅对重构象限节点（config.portraitMode==="quadrant"）生效，其余画像
  // file 节点 tooltip 不变（零回归）。行动建议口径随节点横轴维度自适应（churn/risk/dup/size），
  // 与画布区域标签、画像面板同一套措辞。
  const isQuadNode = config.portraitMode === "quadrant" && !!quadrant;
  const quadHintKey = isQuadNode
    ? config.quadrantXAxis === "risk"
      ? QUADRANT_HINT_RISK[quadrant]
      : config.quadrantXAxis === "duplication"
        ? QUADRANT_HINT_DUP[quadrant]
        : config.quadrantXAxis === "size"
          ? QUADRANT_HINT_SIZE[quadrant]
          : QUADRANT_HINT[quadrant]
    : null;
  const quadContextLine = isQuadNode
    ? `${t("portrait.quadrant.title")} · #${rank ?? "?"} · ${t(QUADRANT_META[quadrant].label)}\n${t(quadHintKey!)}`
    : null;

  // v2.17 依赖画像环内节点（config.depInCycle）：红虚线边框 —— 循环依赖是最
  // 需要人看的架构坏味道，优先级高于调度枢纽（琥珀），与重构（红）同级。
  // 边框优先级：优先重构（红）> 依赖环（红虚线） > 调度枢纽（琥珀） > 语言色半透明
  // （R38：替代灰 divider，让文件卡轮廓带上语言身份，全览时扫一眼就能按语言分群）> 常规
  const depInCycle = config.depInCycle === true;
  const borderColor = isRefactorFirst
    ? "#ef4444"
    : depInCycle
      ? "#dc2626"
      : isCallHub
        ? "#f59e0b"
        : `${langColor}59`;
  const borderWidth = isRefactorFirst || depInCycle || isCallHub ? 2 : 1;
  const borderStyle = depInCycle && !isRefactorFirst ? "dashed" : "solid";
  // v2.17 依赖画像焦点子图：焦点文件节点描一圈品牌琥珀金外环 + 发光，并在卡片上加
  // 「焦点」药丸，让用户在「树↔画布」联动后一眼知道画布当前在展示哪个文件的局部依赖网。
  // 颜色取品牌主色 #EF9F27，与调用枢纽(#f59e0b 边框)/依赖环(#dc2626 红虚线)/影响面(#6366f1 靛蓝)都不同，
  // 仅靠外环不发光的形态也和它者区分开。
  const isFocusNode = config.isFocus === true;
  const FOCUS_COLOR = "#EF9F27";

  // ─── block 档提前返回（在拼 tooltip 之前）─────────────────────────────
  // 这个顺序是刻意的：下面那段 14 项的说明文本要走 map/filter/join + 多次模板
  // 字符串插值，全览时 500 个实体就是 500 次白拼 —— 而 block 档的卡片只有
  // 10px 高，精确悬浮到它上面本就不是真实操作路径。这里只给文件名，
  // 用户想看细节自然会先放大（放大即升档，完整说明立刻回来）。
  if (lod === "block") {
    // 10px 高的色块画不下药丸，但「AI 说这里有严重问题」恰恰是全览档最该保留的
    // 一条信息 —— 换成整圈描边，缩到最小仍然能扫出红色的那几块。
    return (
      <div
        title={
          insightTitle
            ? `${config.filePath || config.fileName || "untitled"}\n${insightTitle}`
            : config.filePath || config.fileName || "untitled"
        }
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          borderRadius: 2,
          border: insightColor
            ? `2px solid ${insightColor}`
            : impactMark
              ? `2px solid ${IMPACT_COLOR}`
              : `${borderWidth}px ${isEstimatedComplexity || depInCycle ? "dashed" : "solid"} ${borderColor}`,
          background: accent ? `${accent}66` : showHeat ? `${heatColor}66` : langColor + "55",
          opacity: focusDim,
          boxShadow: isFocusNode ? `0 0 0 2px ${FOCUS_COLOR}` : undefined,
        }}
      />
    );
  }

  // R38：目录路径（画布上几百个实体时靠它区分「哪个目录哪个文件」）
  const dirPath = dirPathOf(config.filePath);
  // 有 heat 时底色走复杂度色，否则走语言色 —— 都比纯白卡有辨识度
  const cardBackground = accent
    ? `linear-gradient(90deg, ${accent}1F 0%, ${accent}0D 60%, transparent 100%), ${CV.paper}`
    : showHeat
    ? `linear-gradient(90deg, ${heatColor}1F 0%, ${heatColor}0D 60%, transparent 100%), ${CV.paper}`
    : tintGradient(langColor, 0x1f, 0x08);

  const tooltipTitle = [
    config.filePath || null,
    t("canvasTip.fileLang", { lang }),
    lineCount ? t("canvasTip.fileLines", { n: lineCount }) : null,
    symbolCount > 0 ? t("canvasTip.fileSymbols", { n: symbolCount }) : null,
    patternNames.length > 0 ? t("canvasTip.filePatterns", { names: patternNames.join("、") }) : null,
    refCount > 0 ? t("canvasTip.fileRefs", { n: refCount }) : null,
    callOut > 0 ? t("canvasTip.fileCallOut", { n: callOut }) : null,
    callIn > 0
      ? t("canvasTip.fileCallIn", { n: callIn, hub: isCallHub ? t("canvasTip.callHub") : "" })
      : null,
    syntaxErrorCount > 0 ? t("canvasTip.fileSyntax", { n: syntaxErrorCount, lines: syntaxErrorLines.join(", ") }) : null,
    showHeat ? t("canvasTip.fileComplexity", { n: complexity, lv: resolveFragments(COMPLEXITY_LABELS[complexityLevel]) ?? complexityLevel }) + (isEstimatedComplexity ? t("canvasTip.estimatedSuffix") : "") : null,
    techDebtCount > 0 ? t("canvasTip.fileTechDebt", { n: techDebtCount }) : null,
    showChurn ? t("canvasTip.fileChurn", { n: churnScore, lv: resolveFragments(CHURN_LABELS[churnLevel]) ?? churnLevel }) : null,
    deadCount > 0 ? t("canvasTip.fileDead", { n: deadCount }) : null,
    showDup
      ? t("canvasTip.fileClone", {
          n: cloneCount,
          lines: duplicatedLines,
          pct: (duplicationRatio * 100).toFixed(1),
          lv: resolveFragments(DUPLICATION_LABELS[duplicationLevel]),
          type2: cloneType2Count > 0 ? t("canvasTip.cloneType2", { n: cloneType2Count }) : "",
        })
      : null,
    // v2.46 重构象限节点：用「象限归属 + 优先级 + 行动建议」整块替换原先单行的 refactorFirst 标
    // （非象限节点 isQuadNode=false → quadContextLine=null，与原先恒 null 行为一致，零回归）。
    quadContextLine,
    config.metricTitle ? config.metricTitle : null,
    isFocusedOut ? t("canvasTip.focusOut", { lang: focusLanguage }) : null,
    // AI 结论排在最后、单独空一行：它与上面那些扫描算出来的客观指标性质不同，
    // 视觉上分开才不会让人误以为也是量化数值。
    insightTitle ? `\n${insightTitle}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // ─── LOD：缩小到看不清字时不画字（见 utils/lod.ts）───────────────────
  // compact 档：色条 + 文件名 + 路径行 + 单个最高优先级风险角标。
  // R39：路径行是「哪个目录哪个文件」的最低可读形态 —— 全览（fit 后
  // scale 常在 0.3~0.6）大多数时候落在这档，没有路径行就回到上一轮的
  // 「同名文件分不清」状态。风险优先级与完整档一致（复杂度热力 > 重复 >
  // 变更热度），保证缩放时「最该注意的那个点」不会因为换档而消失。
  if (lod === "compact") {
    const riskColor = showHeat ? heatColor : showDup ? dupColor : showChurn ? churnColor : null;
    return (
      <div
        title={tooltipTitle}
        style={shellStyle({
          background: cardBackground,
          borderColor,
          borderWidth,
          borderStyle: isEstimatedComplexity || isFocusedOut || depInCycle ? "dashed" : "solid",
          shape: "file",
          opacity: focusDim,
          extra: isFocusNode
            ? {
                boxShadow: impactMark
                  ? `0 0 0 2px ${IMPACT_COLOR}, 0 0 4px ${IMPACT_COLOR}66, 0 0 0 5px ${FOCUS_COLOR}`
                  : `0 0 0 3px ${FOCUS_COLOR}`,
              }
            : impactMark
              ? { boxShadow: `0 0 0 2px ${IMPACT_COLOR}, 0 0 8px ${IMPACT_COLOR}66` }
              : undefined,
        })}
      >
        <div style={stripeStyle(accent || (showHeat ? heatColor : langColor), 1)} />
        <div style={BODY_STYLE}>
          <div style={TITLE_ROW_STYLE}>
            {showRankBadge && (
              <span
                title={t("portrait.quadrant.rankTitle", { n: rank! })}
                style={{
                  fontSize: 9,
                  lineHeight: "14px",
                  minWidth: 14,
                  height: 14,
                  padding: "0 3px",
                  borderRadius: 7,
                  fontWeight: 800,
                  color: "#fff",
                  backgroundColor: rankColor ?? "#64748b",
                  flex: "0 0 auto",
                }}
              >
                {rank}
              </span>
            )}
            {isFocusNode && (
              <span
                title={t("editor.depFocusActive")}
                style={{
                  fontSize: 8.5,
                  lineHeight: "13px",
                  padding: "0 4px",
                  borderRadius: 4,
                  fontWeight: 700,
                  color: "#fff",
                  backgroundColor: FOCUS_COLOR,
                }}
              >
                {t("editor.depFocusActive")}
              </span>
            )}
            {insightColor && (
              <span style={insightBadgeStyle(insightColor)}>
                AI{insightMark && insightMark.count > 1 ? ` ${insightMark.count}` : ""}
              </span>
            )}
            {impactMark && (
              <span style={insightBadgeStyle(IMPACT_COLOR)} title={impactTitle ?? undefined}>
                {t("workbench.aiImpact.canvasBadge")}
              </span>
            )}
            <div style={TITLE_STYLE}>{config.fileName || "untitled"}</div>
          </div>
          {dirPath && (
            <div
              style={{
                fontSize: 9,
                lineHeight: 1.3,
                color: CV.text2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                marginTop: 1,
              }}
            >
              {dirPath}
            </div>
          )}
        </div>
        {riskColor && <div style={dotStyle(riskColor, { top: 3, right: 3 })} />}
      </div>
    );
  }

  return (
    <div
      title={tooltipTitle}
      style={shellStyle({
        background: cardBackground,
        borderColor,
        borderWidth,
        borderStyle: isEstimatedComplexity || isFocusedOut || depInCycle ? "dashed" : "solid",
        shape: "file",
        opacity: focusDim,
        extra: {
          transition: "opacity 0.2s",
          boxShadow: isFocusNode
            ? impactMark
              ? `0 0 0 2px ${IMPACT_COLOR}, 0 0 6px ${IMPACT_COLOR}66, 0 0 0 5px ${FOCUS_COLOR}`
              : `0 0 0 3px ${FOCUS_COLOR}`
            : impactMark
              ? `0 0 0 2px ${IMPACT_COLOR}, 0 0 10px ${IMPACT_COLOR}66`
              : undefined,
        },
      })}
    >
      <ShapeDecorations shape="file" color={langColor} />
      {/* 左侧语言色条（R38：4px、全饱和 —— 暗淡感很大程度来自色条只有 0.7 透明度） */}
      <div style={stripeStyle(accent || (showHeat ? heatColor : langColor), 1, 4)} />
      <div style={ICON_STYLE}>
        <FileGlyph color={langColor !== "#94A3B8" ? langColor : "#94A3B8"} size={15} />
      </div>
      <div style={BODY_STYLE}>
        <div style={TITLE_ROW_STYLE}>
          {showRankBadge && (
            <span
              title={t("portrait.quadrant.rankTitle", { n: rank! })}
              style={{
                fontSize: 9,
                lineHeight: "14px",
                minWidth: 14,
                height: 14,
                padding: "0 3px",
                borderRadius: 7,
                fontWeight: 800,
                color: "#fff",
                backgroundColor: rankColor ?? "#64748b",
                flex: "0 0 auto",
              }}
            >
              {rank}
            </span>
          )}
          {/* 依赖画像焦点子图：焦点文件药丸（品牌琥珀金），与 AI/验证/影响面药丸同形但语义独立 */}
          {isFocusNode && (
            <span
              title={t("editor.depFocusActive")}
              style={{
                fontSize: 8.5,
                lineHeight: "13px",
                padding: "0 4px",
                borderRadius: 4,
                fontWeight: 700,
                color: "#fff",
                backgroundColor: FOCUS_COLOR,
              }}
            >
              {t("editor.depFocusActive")}
            </span>
          )}
          {/* AI 洞察药丸：Agent 点名过这个文件。数字是命中条数，颜色是最高严重度 */}
          {insightColor && (
            <span style={insightBadgeStyle(insightColor)} title={insightTitle ?? undefined}>
              AI{insightMark && insightMark.count > 1 ? ` ${insightMark.count}` : ""}
            </span>
          )}
          {/* 验证结论药丸：AI 本次改动让该文件变好(AI✓绿)/变坏(AI!红)。与洞察药丸同形，
              靠「✓ / !」与绿/红区分——这是 VS Code 没有的「AI 改完即时验证」可视化收口。 */}
          {verifyColor && (
            <span style={insightBadgeStyle(verifyColor)} title={verifyTitle ?? undefined}>
              {verifyBadgeGlyph(verifyMark!.verdict)}
            </span>
          )}
          {/* 影响面药丸（R18）：该文件在「当前焦点的爆炸半径」内——改焦点会波及它。
              靛蓝药丸 + "波及/Impact" 字样，与洞察(AI)/验证(AI✓/AI!)药丸同形但语义独立。 */}
          {impactMark && (
            <span style={insightBadgeStyle(IMPACT_COLOR)} title={impactTitle ?? undefined}>
              {t("workbench.aiImpact.canvasBadge")}
            </span>
          )}
          <div style={{ ...TITLE_STYLE, fontWeight: 650 }}>{config.fileName || "untitled"}</div>
        </div>
        {/* 目录路径（R38 新增；R39 加大到 9.5px、text2 —— 8.5px + text3 全览时看不清） */}
        {dirPath && (
          <div
            style={{
              fontSize: 9.5,
              lineHeight: 1.3,
              color: CV.text2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 1,
            }}
          >
            {dirPath}
          </div>
        )}
        <div style={META_ROW_STYLE}>
          {/* R38：语言徽标改实底圆角 —— 语言是「实体本来的样子」最重要的身份标识 */}
          <span
            style={{
              fontSize: 8.5,
              lineHeight: "13px",
              padding: "0 4px",
              borderRadius: 4,
              fontWeight: 700,
              color: "#fff",
              backgroundColor: langColor,
            }}
          >
            {lang}
          </span>
          {lineCount !== undefined && lineCount > 0 && (
            <span style={metaStyle()}>
              · {t("canvasTip.linesShort", { n: lineCount < 1000 ? `${lineCount}` : `${(lineCount / 1000).toFixed(1)}k` })}
            </span>
          )}
          {config.fileSize !== undefined && config.fileSize > 0 && lang === "unknown" && (
            <span style={metaStyle()}>· {(config.fileSize / 1024).toFixed(1)} KB</span>
          )}
          {/* ─── 画像徽标：符号 / 设计模式 / 被引用 ─── */}
          {hasInsight && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 2 }}>
              {symbolCount > 0 && <span style={badgeStyle(CV.primary, CV.onPrimary)}>{symbolCount}</span>}
              {patternNames.map((p) => (
                <span key={p} title={t("canvasTip.badgePattern", { name: p })} style={badgeStyle(CV.success, CV.onSuccess)}>
                  {p}
                </span>
              ))}
              {refCount > 0 && (
                <span title={t("canvasTip.badgeRefs", { n: refCount })} style={badgeStyle(CV.info, CV.onInfo)}>
                  ↩{refCount}
                </span>
              )}
              {/* 调用出度：本文件函数调出目标数 */}
              {callOut > 0 && (
                <span title={t("canvasTip.badgeCallOut", { n: callOut })} style={badgeStyle("#3b82f6")}>
                  ↑{callOut}
                </span>
              )}
              {/* 调用入度：被多少处调用（高 fan-in = 改动影响面大） */}
              {callIn > 0 && (
                <span
                  title={t("canvasTip.badgeCallIn", { n: callIn, hub: isCallHub ? t("canvasTip.callHubTip") : "" })}
                  style={badgeStyle(isCallHub ? "#f59e0b" : "#ef4444")}
                >
                  ↓{callIn}
                </span>
              )}
              {/* 语法错误徽标（R46 IDE 基础层）：tree-sitter ERROR/MISSING 行数，
                  红色、最高优先级——语法错误会让文件无法正确解析，其余指标都可能失真。
                  点击 → 把这组语法错误（含精确行号）交给 AI 诊断，结论落库后自动投射画布。 */}
              {syntaxErrorCount > 0 && config.filePath && (
                <span
                  title={`${t("canvasTip.badgeSyntax", { n: syntaxErrorCount, lines: syntaxErrorLines.join(",") })} · ${t("canvasTip.diagnoseHint")}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerDiagnosis({
                      filePath: config.filePath!,
                      kind: "syntax",
                      title: t("canvasTip.badgeSyntaxTitle", { n: syntaxErrorCount }),
                      lineRange: syntaxErrorLines.length
                        ? [syntaxErrorLines[0], syntaxErrorLines[syntaxErrorLines.length - 1]]
                        : undefined,
                    });
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{ ...badgeStyle(CV.error, CV.white), cursor: "pointer" }}
                >
                  ✕{syntaxErrorCount}
                </span>
              )}
              {/* 技术债徽标：TODO/FIXME 等标记数 */}
              {techDebtCount > 0 && (
                <span
                  title={t("canvasTip.badgeTechDebt", { n: techDebtCount })}
                  style={badgeStyle(CV.warning, CV.onWarning)}
                >
                  ⚠{techDebtCount}
                </span>
              )}
              {/* 变更热度徽标：git 变更分数（与复杂度正交） */}
              {showChurn && (
                <span
                  title={t("canvasTip.badgeChurn", { n: churnScore, lv: resolveFragments(CHURN_LABELS[churnLevel]) ?? churnLevel })}
                  style={badgeStyle(churnColor)}
                >
                  {t("canvasTip.churnBadge", { n: churnScore })}
                </span>
              )}
              {/* 死代码徽标：零引用符号数 */}
              {deadCount > 0 && (
                <span title={t("canvasTip.badgeDead", { n: deadCount })} style={badgeStyle(CV.grey500)}>
                  ⊘{deadCount}
                </span>
              )}
              {/* 重复代码徽标：克隆块数（颜色按重复率分级） */}
              {showDup && (
                <span
                  title={t("canvasTip.badgeClone", { n: cloneCount, lines: duplicatedLines, pct: (duplicationRatio * 100).toFixed(1) })}
                  style={badgeStyle(dupColor)}
                >
                  ⧉{cloneCount}
                </span>
              )}
              {/* 新画像通用徽标：accentColor 决定底色，metricBadge 是主指标 */}
              {accent && config.metricBadge && (
                <span title={config.metricTitle ?? undefined} style={badgeStyle(accent)}>
                  {config.metricBadge}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* 右上角复杂度热力角标：点击 → 把该复杂度热点交给 AI 诊断（定位到具体函数靠 Agent 读 dossier） */}
      {showHeat && config.filePath && (
        <div
          title={`${t("canvasTip.badgeComplexity", { n: complexity, lv: resolveFragments(COMPLEXITY_LABELS[complexityLevel]) ?? complexityLevel })} · ${t("canvasTip.diagnoseHint")}`}
          onClick={(e) => {
            e.stopPropagation();
            triggerDiagnosis({
              filePath: config.filePath!,
              kind: "complexity",
              title: t("canvasTip.badgeComplexityTitle", { n: complexity }),
            });
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ ...dotStyle(heatColor, { top: 3, right: 3 }), cursor: "pointer" }}
        />
      )}
      {/* 左下角重复代码角标：重复率达到中度以上才画，避免 3% 的噪声铺满画布 */}
      {showDup && duplicationLevel !== "none" && duplicationLevel !== "low" && (
        <div
          title={t("canvasTip.badgeDupRatio", {
            pct: (duplicationRatio * 100).toFixed(1),
            lv: DUPLICATION_LABELS[duplicationLevel],
            lines: duplicatedLines,
            n: cloneCount,
          })}
          style={dotStyle(dupColor, { bottom: 3, left: 6 }, true)}
        />
      )}
      {/* 右下角 git 变更热度角标（与左上复杂度热力正交） */}
      {showChurn && (
        <div
          title={t("canvasTip.badgeChurn", { n: churnScore, lv: resolveFragments(CHURN_LABELS[churnLevel]) ?? churnLevel })}
          style={dotStyle(churnColor, { bottom: 3, right: 3 })}
        />
      )}
    </div>
  );
}
