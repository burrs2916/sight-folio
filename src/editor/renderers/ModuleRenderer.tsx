// sight-folio: 模块实体渲染器（架构画像与主序图的主角）
//
// R37 与 FileRenderer 一起改为「零 Emotion」：原本 12 个 <Box sx> + 9 个
// <Typography sx>，架构画像一屏几十上百个模块，emotion 序列化的开销是实打实的。
// 现在纯 <div>/<span> + inline style，主题色走 MUI 输出的 CSS 变量
// （见 canvasTheme.ts），明暗切换照常生效。
import { ModuleGlyph } from "./glyphs";
import type { CanvasLod } from "../utils/lod";
import { BODY_STYLE, CV, ICON_STYLE, META_ROW_STYLE, TITLE_BOLD_STYLE, metaStyle, shellStyle, stripeStyle, tintGradient } from "./canvasTheme";
import { lodStub } from "./lodStub";
import { dirPathOf } from "./FileRenderer";
import { ShapeDecorations } from "./shapeDecorations";
import { t } from "../../i18n";

/** 复杂度等级 → 热力色（与 FileRenderer / 报告生成器保持一致） */
const COMPLEXITY_COLORS: Record<string, string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#f97316",
  extreme: "#ef4444",
};

/** 主序区域 → 颜色（与 architectureMetrics.ZONE_COLOR 保持一致） */
const ZONE_COLORS: Record<string, string> = {
  painful: "#ef4444",
  useless: "#a855f7",
  mainSequence: "#22c55e",
};

/** 模块卡的常规蓝（与插件注册色一致），未命中热力/主序时的兜底 */
const MODULE_BLUE = "#3B82F6";

interface ModuleRendererProps {
  config?: {
    name?: string;
    /** 相对路径（R39：compact 档显示所属目录） */
    filePath?: string;
    fileCount?: number;
    depCount?: number;
    lineCount?: number;
    /** 模块内文件平均圈复杂度 */
    avgComplexity?: number;
    /** 模块内文件最大圈复杂度 */
    maxComplexity?: number;
    /** 平均复杂度等级：low | medium | high | extreme */
    complexityLevel?: string;
    /** 模块内技术债标记数 */
    techDebtCount?: number;
    /** ── 主序图画像专用（存在 zone 时切换展示形态）── */
    zone?: string;
    zoneLabel?: string;
    /** 不稳定性 I = Ce/(Ca+Ce) */
    instability?: number;
    /** 抽象度 A = 抽象符号占比 */
    abstractness?: number;
    /** 主序距离 D = |A + I - 1| */
    distance?: number;
    /** 传入耦合（谁依赖我） */
    ca?: number;
    /** 传出耦合（我依赖谁） */
    ce?: number;
    /** 是否落在循环依赖环上 */
    inCycle?: boolean;
    [key: string]: unknown;
  };
  /** 画布 LOD 档位（见 utils/lod.ts）；缺省按 full */
  lod?: CanvasLod;
}

export function ModuleRenderer(props: ModuleRendererProps) {
  const _config = props?.config;
  const lod = props?.lod ?? "full";
  const config = _config ?? {};
  const fileCount = config.fileCount;
  const depCount = config.depCount;
  const lineCount = config.lineCount;
  const avgComplexity = config.avgComplexity;
  const maxComplexity = config.maxComplexity;
  const complexityLevel = config.complexityLevel;
  const techDebtCount = config.techDebtCount;
  // 代码结构画像：按外部引用数着色的承重左边框（引用越多越红 = 结构关键节点）
  const centralityColor =
    config.portraitMode === "symbols" && typeof config.centralityColor === "string"
      ? (config.centralityColor as string)
      : null;
  // 主序图形态：zone 存在时用区域色替代复杂度热力色，指标行改显 I/A/D
  const zone = typeof config.zone === "string" ? config.zone : null;
  const zoneColor = zone ? ZONE_COLORS[zone] ?? null : null;
  const heatColor = zoneColor ?? COMPLEXITY_COLORS[complexityLevel ?? ""] ?? null;
  const inCycle = config.inCycle === true;
  const hub = config.hub === true;
  const name = config.name || "unnamed";

  const borderColor = inCycle ? "#ef4444" : heatColor ? `${heatColor}99` : CV.info;
  const borderWidth = inCycle ? 2 : 1;
  const accent = heatColor ?? MODULE_BLUE;
  // R38 提亮：有热力数据走主题色渐变，无数据用提亮后的 infoSoft（0.20）
  const cardBackground = heatColor ? tintGradient(heatColor, 0x24, 0x0c) : CV.infoSoft;

  // ─── LOD 降级（缩小后徽标不可读，画了也是噪声）───
  const stub = lodStub(lod, {
    name,
    accent,
    background: cardBackground,
    borderColor,
    borderWidth,
    borderStyle: inCycle ? "dashed" : "solid",
    title: `${name}${fileCount !== undefined ? ` · ${t("canvasTip.moduleFiles", { n: fileCount })}` : ""}${inCycle ? ` · ${t("canvasTip.moduleCycleTip")}` : ""}`,
    subtitle: dirPathOf(config.filePath) || undefined,
    riskColor: inCycle ? "#ef4444" : heatColor,
  });
  if (stub) return stub;

  return (
    <div
      style={{
        ...shellStyle({
          background: cardBackground,
          borderColor,
          borderWidth,
          borderStyle: inCycle ? "dashed" : "solid",
          shape: "module",
        }),
        ...(centralityColor ? { borderLeft: `3px solid ${centralityColor}` } : {}),
      }}
    >
      <ShapeDecorations shape="module" color={accent} />
      <div style={stripeStyle(accent, 0.95)} />
      {/* 复杂度热力角标（右上角三角） */}
      {heatColor && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 0,
            height: 0,
            borderTop: `10px solid ${heatColor}`,
            borderLeft: "10px solid transparent",
            opacity: 0.85,
          }}
        />
      )}
      <div style={ICON_STYLE}>
        <ModuleGlyph color={MODULE_BLUE} size={15} />
      </div>
      <div style={BODY_STYLE}>
        <div style={{ ...TITLE_BOLD_STYLE, display: "flex", alignItems: "center", gap: 4 }}>{name}
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
        </div>
        <div style={META_ROW_STYLE}>
          {fileCount !== undefined && <span style={metaStyle(CV.text2)}>{t("canvasTip.moduleFiles", { n: fileCount })}</span>}
          {zone ? (
            <span style={metaStyle()}>
              · {t("canvasTip.moduleInOut", { ca: config.ca ?? 0, ce: config.ce ?? 0 })}
            </span>
          ) : (
            <>
              {depCount !== undefined && <span style={metaStyle()}>· {t("canvasTip.moduleDeps", { n: depCount })}</span>}
              {lineCount !== undefined && lineCount > 0 && (
                <span style={metaStyle()}>
                  · {t("canvasTip.moduleLines", { n: lineCount < 1000 ? `${lineCount}` : `${(lineCount / 1000).toFixed(1)}k` })}
                </span>
              )}
            </>
          )}
        </div>
        {config.portraitMode === "symbols" && typeof config.signature === "string" && config.signature && (
          <div style={{ fontSize: 9.5, lineHeight: 1.3, color: CV.text3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {config.signature}
          </div>
        )}
        {/* 主序图形态：I / A / D 三个指标 + 区域标签 */}
        {zone && (
          <div style={{ ...META_ROW_STYLE, marginTop: 2 }}>
            <span style={metaStyle(zoneColor ?? CV.text2, 700, 8.5)}>
              {typeof config.zoneLabel === "string" ? config.zoneLabel : ""}
            </span>
            <span style={metaStyle(CV.text3, 400, 8.5)}>
              I {(config.instability ?? 0).toFixed(2)} · A {(config.abstractness ?? 0).toFixed(2)} · D{" "}
              {(config.distance ?? 0).toFixed(2)}
            </span>
            {inCycle && <span style={metaStyle("#ef4444", 700, 8.5)}>{t("canvasTip.moduleCycleBadge")}</span>}
          </div>
        )}
        {!zone && (avgComplexity !== undefined || techDebtCount !== undefined) && (
          <div style={{ ...META_ROW_STYLE, marginTop: 2 }}>
            {heatColor && avgComplexity !== undefined && (
              <span style={metaStyle(heatColor, 600, 8.5)}>
                CC {avgComplexity.toFixed(1)}
                {maxComplexity !== undefined && maxComplexity > 10 ? ` ${t("canvasTip.modulePeak", { n: maxComplexity })}` : ""}
              </span>
            )}
            {typeof techDebtCount === "number" && techDebtCount > 0 && (
              <span style={metaStyle("#f59e0b", 600, 8.5)}>⚠ {techDebtCount}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
