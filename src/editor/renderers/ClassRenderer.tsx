// sight-folio: 类实体渲染器（精确画像）
// 类卡片：类名 + 方法数/复杂度，紫色系（与插件注册 color #8B5CF6 一致）
//
// R37 改为零 Emotion（纯 div/span + inline style）并接入 LOD，理由见 canvasTheme.ts。
import { ClassGlyph } from "./glyphs";
import type { CanvasLod } from "../utils/lod";
import { BODY_STYLE, CV, ICON_STYLE, META_ROW_STYLE, TITLE_BOLD_STYLE, metaStyle, shellStyle, stripeStyle, tintGradient } from "./canvasTheme";
import { lodStub } from "./lodStub";
import { dirPathOf } from "./FileRenderer";
import { ShapeDecorations } from "./shapeDecorations";
import { t } from "../../i18n";

const CLASS_PURPLE = "#8B5CF6";

interface ClassRendererProps {
  config?: {
    name?: string;
    /** 相对路径（R39：compact 档显示所属目录） */
    filePath?: string;
    methods?: number;
    complexity?: number;
    /** 被引用次数（代码结构画像：跨文件引用计数，>0 时显示绿色徽标） */
    refCount?: number;
    [key: string]: unknown;
  };
  /** 画布 LOD 档位（见 utils/lod.ts）；缺省按 full */
  lod?: CanvasLod;
}

export function ClassRenderer(props: ClassRendererProps) {
  const _config = props?.config;
  const lod = props?.lod ?? "full";
  const config = _config ?? {};
  const methods = config.methods;
  const complexity = config.complexity;
  const refCount = config.refCount;
  const inCycle = config.inCycle === true;
  const hub = config.hub === true;
  const name = config.name || "unnamed";
  // 代码结构画像：按外部引用数着色的承重左边框（引用越多越红 = 结构关键节点）
  const centralityColor =
    config.portraitMode === "symbols" && typeof config.centralityColor === "string"
      ? (config.centralityColor as string)
      : null;
  // 复杂度超 15 的类是重构候选，缩小档位下用红点保住这个信号
  const risky = complexity !== undefined && complexity > 15;
  // ─── 上帝类判定（v2.2，纯前端启发式）───
  // 后端是正则级结构解析，没有可靠的方法数；用「类行跨度 × 被引用数」代理：
  // >100 行且被 ≥5 处引用 = 体量过大又人人依赖的承重墙，最典型的拆分候选。
  // lineStart/lineEnd 由画像 place() 写入（符号定义行范围）。
  const lineStart = typeof config.lineStart === "number" ? (config.lineStart as number) : 0;
  const lineEnd = typeof config.lineEnd === "number" ? (config.lineEnd as number) : 0;
  const span = Math.max(0, lineEnd - lineStart);
  const godClass = span > 100 && (refCount ?? 0) >= 5;

  const stub = lodStub(lod, {
    name,
    accent: CLASS_PURPLE,
    background: tintGradient(CLASS_PURPLE),
    title: `${name}${methods !== undefined ? ` · ${t("canvasTip.classMethods", { n: methods })}` : ""}${risky ? ` · ${t("canvasTip.classComplexity", { n: complexity })}` : ""}`,
    subtitle: dirPathOf(config.filePath) || undefined,
    riskColor: risky ? CV.error : null,
  });
  if (stub) return stub;

  return (
    <div
      style={{
        ...shellStyle({
          background: tintGradient(CLASS_PURPLE),
          // 上帝类实线红（重量感）> 环上虚线红 > 常规
          borderColor: godClass || inCycle ? "#ef4444" : `${CLASS_PURPLE}99`,
          borderWidth: godClass || inCycle ? 2 : 1,
          borderStyle: godClass ? "solid" : inCycle ? "dashed" : "solid",
          shape: "class",
        }),
        ...(centralityColor ? { borderLeft: `3px solid ${centralityColor}` } : {}),
      }}
    >
      <ShapeDecorations shape="class" color={CLASS_PURPLE} />
      <div style={stripeStyle(CLASS_PURPLE, 0.95)} />
      <div style={ICON_STYLE}>
        <ClassGlyph color={CLASS_PURPLE} size={15} />
      </div>
      <div style={BODY_STYLE}>
        <div style={{ ...TITLE_BOLD_STYLE, display: "flex", alignItems: "center", gap: 4 }}>{name}
          {hub && (
            <span title={t("canvasTip.hubTip")} style={{ fontSize: 8, fontWeight: 700, color: "#f59e0b", marginLeft: 4, flexShrink: 0 }}>
              {t("canvasTip.hubBadge")}
            </span>
          )}
          {godClass && (
            <span
              title={t("canvasTip.godClassTip", { lines: span, refs: refCount ?? 0 })}
              style={{ fontSize: 8, fontWeight: 700, color: "#ef4444", marginLeft: 4, flexShrink: 0 }}
            >
              {t("canvasTip.godClassBadge")}
            </span>
          )}
          {inCycle && (
            <span title={t("canvasTip.cycleTip")} style={{ fontSize: 8, fontWeight: 700, color: "#ef4444", marginLeft: 4, flexShrink: 0 }}>
              ⚠
            </span>
          )}
        </div>
        <div style={META_ROW_STYLE}>
          {methods !== undefined && <span style={metaStyle(CV.text2)}>{t("canvasTip.classMethods", { n: methods })}</span>}
          {complexity !== undefined && complexity > 0 && (
            <span style={metaStyle(risky ? CV.error : CV.text3)}>{t("canvasTip.classComplexity", { n: complexity })}</span>
          )}
          {refCount !== undefined && refCount > 0 && <span style={metaStyle("#10b981", 600)}>· 引用 {refCount}</span>}
        </div>
        {config.portraitMode === "symbols" && typeof config.signature === "string" && config.signature && (
          <div style={{ fontSize: 9.5, lineHeight: 1.3, color: CV.text3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {config.signature}
          </div>
        )}
      </div>
    </div>
  );
}
