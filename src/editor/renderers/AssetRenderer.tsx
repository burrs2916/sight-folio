// project-sight: 资源文件实体渲染器（画布轻量实体，零 Emotion）
//
// 资源文件（字体 ttf/otf/woff…、音视频 mp4/mp3…、压缩包 zip/tar…、其它二进制 pdf/wasm…）
// 没有代码结构 / 依赖 / 复杂度画像，与图片同属「资源」一族：不挂任何代码洞察叠层，
// 画像核心是「这是什么格式 + 多大」——用专属暖橙色 + 格式感知徽标（TTF/PDF/ZIP…）让
// 「这个文件是什么」一眼可辨，这正是用户说的「准确画像」。
//
// 三级 LOD：
//   block   → 纯色块（全览时几百个资源也只是色点）
//   compact → 色条 + 文件名 + 格式/体积
//   full    → 专属图标（按字体/媒体/压缩/其它分类）+ 文件名 + 目录 + 格式徽标 + 体积
// 点选/拖拽行为由画布统一处理，本渲染器不挂点击。
import FontDownloadIcon from "@mui/icons-material/FontDownload";
import MovieIcon from "@mui/icons-material/Movie";
import ArchiveIcon from "@mui/icons-material/Archive";
import DescriptionIcon from "@mui/icons-material/Description";
import { languageColor } from "../../utils/languageMeta";
import { assetFormatLabel, assetKindOf, type AssetKind } from "../utils/fileKind";
import { t } from "../../i18n";
import {
  BODY_STYLE,
  CV,
  ICON_STYLE,
  META_ROW_STYLE,
  TITLE_ROW_STYLE,
  TITLE_STYLE,
  badgeStyle,
  metaStyle,
  shellStyle,
  stripeStyle,
  tintGradient,
} from "./canvasTheme";
import type { CanvasLod } from "../utils/lod";

/** 资源子类：字体 / 媒体 / 压缩 / 其它二进制（决定图标与语义色，仍是同一个 asset 实体类型）。
 *  分类表与判定已上移到 fileKind.assetKindOf（单一事实源），本渲染器只消费。 */
export type { AssetKind } from "../utils/fileKind";

interface AssetRendererProps {
  config?: {
    fileName?: string;
    /** 相对路径（syncLayout 写入的 f.relPath） */
    filePath?: string;
    language?: string;
    fileSize?: number;
    extension?: string;
    [key: string]: unknown;
  };
  /** 画布 LOD 档位（block / compact / full）；缺省按 full */
  lod?: CanvasLod;
}

export function AssetRenderer(props: AssetRendererProps) {
  const config = props?.config ?? {};
  const lod = props?.lod ?? "full";
  // 资源专属配色（languageMeta 里的 "asset" → 暖橙）
  const accent = languageColor("asset");
  const fileName =
    config.fileName || (config.filePath ? config.filePath.split("/").pop() : "") || "untitled";
  const sizeText =
    config.fileSize !== undefined && config.fileSize > 0
      ? config.fileSize >= 1024 * 1024
        ? `${(config.fileSize / 1024 / 1024).toFixed(1)} MB`
        : `${(config.fileSize / 1024).toFixed(1)} KB`
      : "";
  const formatLabel = assetFormatLabel(config.fileName || config.filePath) || (config.extension || "").toUpperCase();
  const kind = assetKindOf(config.fileName || config.filePath);
  const kindIcon =
    kind === "font" ? <FontDownloadIcon sx={{ fontSize: "inherit" }} /> :
    kind === "media" ? <MovieIcon sx={{ fontSize: "inherit" }} /> :
    kind === "archive" ? <ArchiveIcon sx={{ fontSize: "inherit" }} /> :
    <DescriptionIcon sx={{ fontSize: "inherit" }} />;

  // ─── block 档：纯色块（全览时资源也只是色点）───
  if (lod === "block") {
    return (
      <div
        title={config.filePath || fileName}
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          borderRadius: 2,
          background: `${accent}66`,
          border: `1px solid ${accent}`,
        }}
      />
    );
  }

  const isCompact = lod === "compact";
  const tooltip = [config.filePath || null, formatLabel ? `${t("imagePreview.format")} ${formatLabel}` : null, sizeText]
    .filter(Boolean)
    .join("\n");

  // ─── compact 档：色条 + 图标 + 文件名 + 格式/体积 ───
  if (isCompact) {
    return (
      <div
        title={tooltip}
        style={shellStyle({
          background: tintGradient(accent, 0x1f, 0x08),
          borderColor: `${accent}59`,
          borderWidth: 1,
          shape: "file",
        })}
      >
        <div style={stripeStyle(accent, 1, 4)} />
        <div style={ICON_STYLE}>
          <span style={{ fontSize: 15, color: accent, display: "inline-flex" }}>{kindIcon}</span>
        </div>
        <div style={{ ...BODY_STYLE, minWidth: 0 }}>
          <div style={{ ...TITLE_STYLE, fontSize: 11 }}>{fileName}</div>
          <div style={META_ROW_STYLE}>
            {formatLabel && (
              <span
                style={{
                  fontSize: 8,
                  lineHeight: "13px",
                  padding: "0 3px",
                  borderRadius: 3,
                  fontWeight: 700,
                  color: "#fff",
                  backgroundColor: accent,
                  marginRight: 3,
                }}
              >
                {formatLabel}
              </span>
            )}
            <span style={metaStyle(CV.text2)}>{sizeText}</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── full 档：专属图标 + 文件名 + 目录 + 格式/体积画像 ───
  const dirPath = config.filePath ? config.filePath.slice(0, config.filePath.lastIndexOf("/")) : null;
  return (
    <div
      title={tooltip}
      style={shellStyle({
        background: tintGradient(accent, 0x1f, 0x08),
        borderColor: `${accent}59`,
        borderWidth: 1,
        shape: "file",
      })}
    >
      <div style={stripeStyle(accent, 1, 4)} />
      <div style={ICON_STYLE}>
        <span style={{ fontSize: 16, color: accent, display: "inline-flex" }}>{kindIcon}</span>
      </div>
      <div style={BODY_STYLE}>
        <div style={{ ...TITLE_ROW_STYLE, fontWeight: 650 }}>{fileName}</div>
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
          <span style={badgeStyle(accent, "#fff")}>{t("entityProj.asset.name")}</span>
          {formatLabel && <span style={badgeStyle(accent, "#fff")}>{formatLabel}</span>}
          {sizeText && <span style={metaStyle()}>· {sizeText}</span>}
        </div>
      </div>
    </div>
  );
}
