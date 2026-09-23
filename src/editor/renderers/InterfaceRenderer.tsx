// sight-folio: 接口实体渲染器（精确画像）
// 接口卡片：接口名 + 成员数，粉色系（与插件注册 color #EC4899 一致）
//
// R37 改为零 Emotion（纯 div/span + inline style）并接入 LOD，理由见 canvasTheme.ts。
import { InterfaceGlyph } from "./glyphs";
import type { CanvasLod } from "../utils/lod";
import { BODY_STYLE, CV, ICON_STYLE, META_ROW_STYLE, TITLE_BOLD_STYLE, metaStyle, shellStyle, stripeStyle, tintGradient } from "./canvasTheme";
import { lodStub } from "./lodStub";
import { dirPathOf } from "./FileRenderer";
import { ShapeDecorations } from "./shapeDecorations";
import { t } from "../../i18n";

const INTERFACE_PINK = "#EC4899";

interface InterfaceRendererProps {
  config?: {
    name?: string;
    /** 相对路径（R39：compact 档显示所属目录） */
    filePath?: string;
    members?: number;
    /** 被引用次数（代码结构画像：跨文件引用计数，>0 时显示绿色徽标） */
    refCount?: number;
    [key: string]: unknown;
  };
  /** 画布 LOD 档位（见 utils/lod.ts）；缺省按 full */
  lod?: CanvasLod;
}

export function InterfaceRenderer(props: InterfaceRendererProps) {
  const _config = props?.config;
  const lod = props?.lod ?? "full";
  const config = _config ?? {};
  const members = config.members;
  const refCount = config.refCount;
  const name = config.name || "unnamed";
  // 代码结构画像：按外部引用数着色的承重左边框（引用越多越红 = 结构关键节点）
  const centralityColor =
    config.portraitMode === "symbols" && typeof config.centralityColor === "string"
      ? (config.centralityColor as string)
      : null;

  const stub = lodStub(lod, {
    name,
    accent: INTERFACE_PINK,
    background: tintGradient(INTERFACE_PINK),
    title: `${name} · interface${members !== undefined ? ` · ${t("canvasTip.ifaceMembers", { n: members })}` : ""}`,
    subtitle: dirPathOf(config.filePath) || undefined,
  });
  if (stub) return stub;

  return (
    <div
      style={{
        ...shellStyle({
          background: tintGradient(INTERFACE_PINK),
          borderColor: `${INTERFACE_PINK}99`,
          shape: "interface",
        }),
        ...(centralityColor ? { borderLeft: `3px solid ${centralityColor}` } : {}),
      }}
    >
      <ShapeDecorations shape="interface" color={INTERFACE_PINK} />
      <div style={stripeStyle(INTERFACE_PINK, 0.95)} />
      <div style={ICON_STYLE}>
        <InterfaceGlyph color={INTERFACE_PINK} size={15} />
      </div>
      <div style={BODY_STYLE}>
        <div style={TITLE_BOLD_STYLE}>{name}</div>
        <div style={META_ROW_STYLE}>
          {members !== undefined && <span style={metaStyle(CV.text2)}>{members} 成员</span>}
          <span style={metaStyle()}>interface</span>
          {refCount !== undefined && refCount > 0 && <span style={metaStyle("#10b981", 600)}>· 引用 {refCount}</span>}
        </div>
        {config.portraitMode === "symbols" && typeof config.signature === "string" && config.signature && (
          <div style={{ fontSize: 8.5, lineHeight: 1.25, color: CV.text3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {config.signature}
          </div>
        )}
      </div>
    </div>
  );
}
