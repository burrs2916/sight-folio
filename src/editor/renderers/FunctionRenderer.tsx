// sight-folio: 函数实体渲染器（精确画像）
//
// 两种数据来源共用这一张卡片，靠 config 字段自适应：
// 1. 代码结构画像（symbols）：函数名 + 形参数 + 被引用次数，恒定绿色；
// 2. 函数热点画像（hotspotFunctions，R31）：额外带 level/maxNesting/lines/risk，
//    卡片按风险等级换色（绿→黄→橙→红），并把「嵌套 N 层」这类关键信号直接印在卡上。
//
// 为什么要在卡片上换色：热点画像一屏可能有上百个函数，如果全是绿色，
// 用户还得逐个点开看数字 —— 那这张图就白画了。颜色是这张图唯一的导航手段。
//
// R37 改为零 Emotion：原实现每张卡片外还套一个 MUI <Tooltip>（含 useId /
// 四个定时器 / Popper 占位 / 一整套事件绑定），热点画像一屏上百个函数就是
// 上百个 Tooltip 实例。现在换成原生 title 属性 —— 同样是悬浮多行说明，
// 代价接近于零。
import { FunctionGlyph } from "./glyphs";
import type { CanvasLod } from "../utils/lod";
import { BODY_STYLE, CV, ICON_STYLE, META_ROW_STYLE, TITLE_BOLD_STYLE, metaStyle, shellStyle, stripeStyle, tintGradient } from "./canvasTheme";
import { lodStub } from "./lodStub";
import { dirPathOf } from "./FileRenderer";
import { ShapeDecorations } from "./shapeDecorations";
import { t } from "../../i18n";

/** 风险等级配色（与 functionHotspots.HOTSPOT_COLORS 同源，此处内联避免渲染器依赖布局引擎） */
const LEVEL_COLORS: Record<string, string> = {
  low: "#10B981",
  medium: "#f59e0b",
  high: "#f97316",
  extreme: "#ef4444",
};

const DEFAULT_COLOR = "#10B981";

/**
 * 卡片上显示的短路径：保留末尾若干段（**文件名必须可见**，否则等于没告诉用户在哪个文件）。
 * 注意不能用 CSS text-overflow:ellipsis 直接截断整条路径 —— 那会把末尾的文件名截掉，
 * 只留下 `src-tauri/src/interface/com…`，用户照样找不到。
 */
function shortPath(p: string, keepSegs = 2): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length <= keepSegs + 1) return parts.join("/");
  return "…/" + parts.slice(-(keepSegs + 1)).join("/");
}

interface FunctionRendererProps {
  config?: {
    name?: string;
    /** 相对路径（R39：compact 档显示所属目录；full 档卡片底部显示短路径定位） */
    filePath?: string;
    /** 定义行号（与 filePath 一起构成「哪个文件的哪个函数」） */
    lineStart?: number | null;
    params?: number;
    complexity?: number;
    /** 被引用次数（代码结构画像：跨文件引用计数，>0 时显示绿色徽标） */
    refCount?: number;
    /** 风险等级（函数热点画像：low/medium/high/extreme → 卡片配色） */
    level?: string;
    /** 等级中文标签（急需重构 / 偏危险 / 关注 / 健康） */
    levelLabel?: string;
    /** 最大控制流嵌套深度（AST） */
    maxNesting?: number;
    /** 函数行数（AST） */
    lines?: number;
    /** 综合风险分 */
    risk?: number;
    /** 上榜理由（人话，hover 展示） */
    reasons?: string[];
    [key: string]: unknown;
  };
  /** 画布 LOD 档位（见 utils/lod.ts）；缺省按 full */
  lod?: CanvasLod;
}

export function FunctionRenderer(props: FunctionRendererProps) {
  const _config = props?.config;
  const lod = props?.lod ?? "full";
  const config = _config ?? {};
  const params = config.params;
  const complexity = config.complexity;
  const refCount = config.refCount;
  const callIn = typeof config.callIn === "number" ? config.callIn : undefined;
  const churnScore = typeof config.churnScore === "number" ? config.churnScore : undefined;
  const maxNesting = config.maxNesting;
  const lines = config.lines;
  const level = typeof config.level === "string" ? config.level : null;
  const color = (level && LEVEL_COLORS[level]) || DEFAULT_COLOR;
  const isHotspot = !!level;
  const inCycle = config.inCycle === true;
  const hub = config.hub === true;
  const isEntry = config.isEntry === true;
  // 执行流画像：入口分层（T0 应用入口 / T1 后端命令边界入口 / T2 前端事件处理器）
  // 取代原先「入度 0 即入口」——实测该规则把 web-craft 64% 节点误标为入口，标记失去意义。
  const entryTier = typeof config.entryTier === "string" ? (config.entryTier as string) : null;
  const entryReach = typeof config.entryReach === "number" ? (config.entryReach as number) : null;
  const ENTRY_TIER_COLOR: Record<string, string> = { T0: "#22c55e", T1: "#f59e0b", T2: "#3b82f6" };
  const entryColor = entryTier ? ENTRY_TIER_COLOR[entryTier] ?? "#22c55e" : "#22c55e";
  // apiTrace：节点按角色上色（前端调用=蓝 / API路由=琥珀 / 后端方法=绿 / 下游=灰）
  const apiRole = typeof config.apiRole === "string" ? (config.apiRole as string) : null;
  // taintFlow：污点在路径上扮演的角色（源=蓝 / 中转=绿 / 汇点=按危险类别着色 / 已净化=绿）
  const taintRole = typeof config.taintRole === "string" ? (config.taintRole as string) : null;
  const taintEndKind = typeof config.taintEndKind === "string" ? (config.taintEndKind as string) : null;
  const taintRule = typeof config.taintRule === "string" ? (config.taintRule as string) : null;
  const taintParams = Array.isArray(config.taintParams)
    ? config.taintParams.filter((p): p is string => typeof p === "string")
    : [];
  const accent = typeof config.accentColor === "string" ? config.accentColor : color;
  const name = config.name || "unnamed";
  const reasons = Array.isArray(config.reasons) ? config.reasons.filter((r) => typeof r === "string") : [];
  // 代码结构画像：按外部引用数着色的承重左边框（引用越多越红 = 结构关键节点）
  const centralityColor =
    config.portraitMode === "symbols" && typeof config.centralityColor === "string"
      ? (config.centralityColor as string)
      : null;

  // hover 说明：热点卡片把「为什么上榜」讲清楚，避免用户只看到一片红却不知所措
  // 等级名不读 config.levelLabel（那是画像引擎落库的 zh 文案，切语言不刷新），
  // 改由渲染层按 level 现算。
  // 「哪个文件的哪个函数」：卡片只画函数名时用户根本无从下手（双击虽能跳转，但先得知道看的是谁）。
  // tooltip 给完整路径 + 行号，卡片底部再给一条短路径，两处互补。
  const filePath = typeof config.filePath === "string" ? config.filePath : "";
  const lineStart = typeof config.lineStart === "number" ? config.lineStart : null;
  const locLine = filePath ? `${filePath}${lineStart != null ? `:${lineStart}` : ""}` : "";
  const tipBase = isHotspot
    ? `${name}()${level ? ` · ${t(`canvasTip.hotspot.${level}`)}` : ""}${
        reasons.length > 0 ? `\n${t("canvasTip.fnReasons", { reasons: reasons.join("、") })}` : ""
      }${config.risk !== undefined ? `\n${t("canvasTip.fnRisk", { risk: config.risk })}` : ""}`
    : `${name}()`;
  // 污点角色说明：光有颜色无法判断「这条链为什么被标红」，必须讲清命中了哪条规则、
  // 污染的是哪个形参 —— 否则用户拿到一张红图却不知道该改哪。
  const taintTip = taintRole
    ? [
        t(`taint.role.${taintRole}`),
        taintEndKind ? `${t("canvasTip.taintKind")}：${t(`taint.kind.${taintEndKind}`)}` : "",
        taintRule ? `${t("canvasTip.taintRule")}：${taintRule}` : "",
        taintParams.length > 0 ? `${t("canvasTip.taintParams")}：${taintParams.join("、")}` : "",
        t(`taint.hint.${taintRole}`),
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const tip = [tipBase, taintTip || locLine, taintTip ? locLine : "", t("canvasTip.fnDblClick")]
    .filter(Boolean)
    .join("\n");

  // ─── LOD 降级 ───
  // 热点画像缩小时最该保住的信号就是「哪个红」，所以风险点直接用卡片主色。
  const stub = lodStub(lod, {
    name,
    accent,
    background: isHotspot ? tintGradient(color, 0x2e, 0x10) : tintGradient(accent, 0x22, 0x0c),
    borderColor: accent,
    title: tip,
    subtitle: dirPathOf(config.filePath) || undefined,
    riskColor: isHotspot && (level === "extreme" || level === "high") ? color : null,
  });
  if (stub) return stub;

  return (
    <div
      title={tip}
      style={{
        ...shellStyle({
          background: isHotspot ? tintGradient(color, 0x2e, 0x10) : tintGradient(accent, 0x22, 0x0c),
          borderColor: inCycle ? "#ef4444" : isEntry ? entryColor : `${accent}99`,
          borderStyle: inCycle ? "dashed" : "solid",
          shape: "function",
        }),
        ...(centralityColor ? { borderLeft: `3px solid ${centralityColor}` } : {}),
      }}
    >
      <ShapeDecorations shape="function" color={accent} />
      <div style={stripeStyle(accent, 0.95)} />
      <div style={ICON_STYLE}>
        <FunctionGlyph color={accent} size={15} />
      </div>
      <div style={{ ...BODY_STYLE, display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 0, overflow: "hidden" }}>
        <div style={{ ...TITLE_BOLD_STYLE, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>{name}
          {hub && (
            <span title={t("canvasTip.hubTip")} style={{ fontSize: 8, fontWeight: 700, color: "#f59e0b", marginLeft: 4, flexShrink: 0 }}>
              {t("canvasTip.hubBadge")}
            </span>
          )}
          {inCycle && (
            <span title={t("canvasTip.cycleTip")} style={{ fontSize: 8, fontWeight: 700, color: "#ef4444", marginLeft: 4, flexShrink: 0 }}>
              ⚠
            </span>
          )}
          {isEntry && (
            <span
              title={entryTier ? t(`canvasTip.entryTier.${entryTier}.tip`) : t("canvasTip.entryTip")}
              style={{ fontSize: 8, fontWeight: 700, color: entryColor, marginLeft: 4, flexShrink: 0 }}
            >
              {entryTier ? t(`canvasTip.entryTier.${entryTier}.badge`) : t("canvasTip.entryBadge")}
            </span>
          )}
          {isEntry && entryReach != null && (
            <span
              title={t("canvasTip.entryReachTip")}
              style={{ fontSize: 8, fontWeight: 700, color: entryColor, marginLeft: 3, flexShrink: 0, opacity: 0.85 }}
            >
              {t("canvasTip.entryReach", { n: entryReach })}
            </span>
          )}
          {apiRole && (
            <span title={t(`canvasTip.apiRole.${apiRole}`)} style={{ fontSize: 8, fontWeight: 700, color: accent, marginLeft: 4, flexShrink: 0 }}>
              {t(`canvasTip.apiRole.${apiRole}`)}
            </span>
          )}
          {taintRole && (
            <span
              title={taintTip}
              style={{
                fontSize: 8,
                fontWeight: 700,
                color: taintRole === "sink" ? "#fecaca" : taintRole === "sanitized" ? "#86efac" : accent,
                marginLeft: 4,
                flexShrink: 0,
                background: taintRole === "sink" ? "#7f1d1d" : "transparent",
                borderRadius: 3,
                padding: taintRole === "sink" ? "0 3px" : 0,
              }}
            >
              {taintRole === "sink" && taintEndKind
                ? `${t(`taint.badge.${taintEndKind}`)}${taintRule ? ` ${taintRule}` : ""}`
                : taintRole === "sanitized"
                  ? `✓ ${taintRule ?? t("taint.badge.sanitized")}`
                  : t(`taint.badge.${taintRole}`)}
            </span>
          )}
        </div>
        <div style={{ ...META_ROW_STYLE, flexWrap: "nowrap", overflow: "hidden", flexShrink: 0 }}>
          {params !== undefined && <span style={metaStyle(CV.text2)}>{t("canvasTip.fnParams", { n: params })}</span>}
          {complexity !== undefined && complexity > 0 && (
            <span style={metaStyle(complexity > 15 ? CV.error : CV.text3)}>· CC {complexity}</span>
          )}
          {/* 嵌套是热点画像的核心信号：CC 相同的两个函数，嵌套深的那个难读得多 */}
          {maxNesting !== undefined && maxNesting > 0 && (
            <span style={metaStyle(maxNesting > 4 ? color : CV.text3, maxNesting > 4 ? 700 : 400)}>
              · {t("canvasTip.fnNesting", { n: maxNesting })}
            </span>
          )}
          {lines !== undefined && lines > 0 && <span style={metaStyle()}>· {lines}L</span>}
          {refCount !== undefined && refCount > 0 && <span style={metaStyle("#10b981", 600)}>· {t("canvasTip.fnRefs", { n: refCount })}</span>}
          {/* 热点画像三维度融合：扇入（枢纽，被依赖广）+ 变更频率（带病演进） */}
          {callIn !== undefined && callIn > 0 && <span style={metaStyle("#8b5cf6", 600)}>· {t("canvasTip.fnCallIn", { n: callIn })}</span>}
          {churnScore !== undefined && churnScore > 0 && <span style={metaStyle("#0ea5e9", 600)}>· {t("canvasTip.fnChurn", { n: Math.round(churnScore) })}</span>}
        </div>
        {/* 定位行：告诉用户「哪个文件的哪个函数」。flexShrink 让它在卡片偏矮时最先被压缩，
            函数名与指标永远不会被挤掉（shellStyle 本身 overflow:hidden，最坏情况只是这行被裁）。 */}
        {filePath && (
          <div
            title={locLine}
            style={{
              fontSize: 9,
              lineHeight: 1.25,
              marginTop: 1,
              color: CV.text3,
              flexShrink: 1,
              minHeight: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {shortPath(filePath)}
            {lineStart != null ? `:${lineStart}` : ""}
          </div>
        )}
        {config.portraitMode === "symbols" && typeof config.signature === "string" && config.signature && (
          <div style={{ fontSize: 9.5, lineHeight: 1.3, color: CV.text3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {config.signature}
          </div>
        )}
      </div>
      {/* 右上角风险角标：一屏上百个函数时，靠它扫出该先看谁 */}
      {isHotspot && (level === "extreme" || level === "high") && (
        <div
          style={{
            position: "absolute",
            top: 2,
            right: 3,
            padding: "0 4px",
            borderRadius: 3,
            backgroundColor: color,
            color: "#fff",
            fontSize: 8,
            fontWeight: 700,
            lineHeight: "12px",
          }}
        >
          {level === "extreme" ? "!!" : "!"}
        </div>
      )}
    </div>
  );
}
