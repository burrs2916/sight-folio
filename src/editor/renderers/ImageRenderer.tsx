// project-sight: 图片实体渲染器（画布轻量实体，零 Emotion）
//
// 图片是项目资源，没有代码结构 / 依赖 / 复杂度画像，故不挂任何代码洞察叠层
// （复杂度角标、克隆、死代码、AI 透视…全部跳过）。此前只画「专属配色 + ImageIcon
// + 文件名 / 体积」，等于把图片当普通文件卡片呈现 —— 没发挥出画布「直接展示图片」
// 的能力。现在：能拿到磁盘绝对路径就在卡片里直接渲染图片缩略图（full 满铺、compact
// 小图），点击放大走 ImagePreviewDialog（见 SceneEditor.openSource 的 image 分支）。
//
// 三级 LOD：
//   block   → 纯色块（全览时几百张图也只是色点，不参与悬浮）
//   compact → 小缩略图 + 文件名
//   full    → 图片满铺 + 底部渐变信息条（文件名 / 「图片」徽标 / 体积）
// 取不到绝对路径或图片加载失败时，整体回退到「图标 + 文件名」布局，绝不红框/空白。
import ImageIcon from "@mui/icons-material/Image";
import ZoomOutMapIcon from "@mui/icons-material/ZoomOutMap";
import { useEffect, useState, type SyntheticEvent } from "react";
import { languageColor } from "../../utils/languageMeta";
import { t } from "../../i18n";
import {
  BODY_STYLE,
  CV,
  ICON_STYLE,
  META_ROW_STYLE,
  TITLE_STYLE,
  badgeStyle,
  metaStyle,
  shellStyle,
  stripeStyle,
} from "./canvasTheme";
import type { CanvasLod } from "../utils/lod";
import {
  buildImagePreviewData,
  formatImageSize,
  imageAbsPath,
  imageFormatLabel,
  isVectorImage,
  measureImageDimensions,
  formatDimensions,
  useAssetImage,
  type ImageDimensions,
  useProjectRoot,
} from "../utils/imageAsset";
import { useEditorStore } from "../../store/editorStore";

/**
 * 格式感知小方块：图片无法在 webview 原生渲染（HEIC / TIFF / AVIF 等）时，
 * 用图片专属配色 + 格式缩写（HEIC→HEIC、TIFF→TIFF、AVIF→AVIF、PNG→PNG…）替代
 * 误导性通用图标，让「这张图是什么格式」一眼可辨 —— 这正是用户说的「准确画像」。
 */
function FormatGlyph({ label, accent, size }: { label: string; accent: string; size: number }) {
  const text = label.length > (size <= 16 ? 2 : 4) ? label.slice(0, size <= 16 ? 2 : 4) : label;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 3,
        background: accent,
        color: "#fff",
        fontSize: size <= 16 ? 7 : 9,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        letterSpacing: "-0.3px",
        flex: "0 0 auto",
        lineHeight: 1,
      }}
    >
      {text}
    </div>
  );
}

interface ImageRendererProps {
  config?: {
    fileName?: string;
    /** 相对路径（syncLayout 写入的 f.relPath） */
    filePath?: string;
    /** 绝对路径（优先；缺则按 projectRoot + filePath 拼） */
    absPath?: string;
    language?: string;
    fileSize?: number;
    lineCount?: number;
    [key: string]: unknown;
  };
  /** 画布 LOD 档位（block / compact / full）；缺省按 full */
  lod?: CanvasLod;
}

export function ImageRenderer(props: ImageRendererProps) {
  const config = props?.config ?? {};
  const lod = props?.lod ?? "full";
  // 图片专属配色（languageMeta 里的 "image" → 青色）
  const accent = languageColor("image");
  const fileName =
    config.fileName || (config.filePath ? config.filePath.split("/").pop() : "") || "untitled";
  const sizeText = formatImageSize(config.fileSize);

  // 绝对路径 + 可加载 URL（invoke read_file_bytes → blob，任意项目路径可用，不受 asset 协议 scope 限制）
  const projectRoot = useProjectRoot();
  const absPath = imageAbsPath(config as Record<string, unknown>, projectRoot);
  // 仅非 block 档加载图片字节：全览（block）下成百上千张图若各自 invoke read_file_bytes
  // 读整文件，会瞬间压垮 IPC 与内存、造成画布卡顿；block 只画色点，无需真图。
  const shouldLoadImage = lod !== "block";
  const { url, errored: loadErrored } = useAssetImage(shouldLoadImage ? absPath : null);
  // 加载失败 / 无路径 → 回退到图标布局（url 变化时重置失败标记与尺寸）
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setErrored(false);
    setDims(null);
  }, [url]);
  // 尺寸画像：位图用渲染 <img> 的 naturalWidth/Height（浏览器已缓存，零额外请求）；
  // SVG 无固有宽高 → 走 measureImageDimensions 解析 viewBox（与详情框/画像卡同源）。
  // 仅 full 档消费，避免几百张缩略图全去量尺寸拖慢画布。
  const [dims, setDims] = useState<ImageDimensions | null>(null);
  const onImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setDims({ width: img.naturalWidth, height: img.naturalHeight, vector: false });
    } else if (isVectorImage(config.fileName || config.filePath)) {
      measureImageDimensions(absPath).then((d) => setDims(d));
    }
  };
  const showImage = !!url && !errored && !loadErrored;
  // 格式标签（PNG / SVG / JPG …）：画布信息条与目录树画像同源，让「图片是哪类」一眼可见
  const formatLabel = imageFormatLabel(config.fileName || config.filePath);
  // 点击放大查看详情：与画布双击 / 目录树双击 / 画像面板「查看大图」同一入口（ImagePreviewDialog）。
  // 用独立按钮而非整卡 onClick，避免与画布选择/拖拽冲突；单点即可打开，满足「点击图片弹出图片框」。
  const openPreview = () => {
    useEditorStore.getState().openImagePreview(buildImagePreviewData(config as Record<string, unknown>, projectRoot));
  };

  // ─── block 档：纯色块（全览时几百张图也只是色点）───
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

  // ─── 图标兜底布局（无路径 / 加载失败 / compact 无图时）───
  // 即便画布无法原生渲染该格式（HEIC/TIFF/AVIF），也用格式感知方块 + 格式徽标
  // 给出准确画像，而非误导性的通用 ImageIcon。
  const renderIconLayout = () => (
    <>
      {!isCompact && <div style={stripeStyle(accent, 0.9, 3)} />}
      <div style={ICON_STYLE}>
        {formatLabel ? (
          <FormatGlyph label={formatLabel} accent={accent} size={isCompact ? 16 : 22} />
        ) : (
          <ImageIcon sx={{ fontSize: isCompact ? 16 : 18, color: accent }} />
        )}
      </div>
      <div style={BODY_STYLE}>
        <div style={{ ...TITLE_STYLE, fontSize: isCompact ? 11 : 12 }}>{fileName}</div>
        {!isCompact && (
          <div style={META_ROW_STYLE}>
            <span style={badgeStyle(accent, "#fff")}>{t("entityProj.image.name")}</span>
            {formatLabel && <span style={badgeStyle(accent, "#fff")}>{formatLabel}</span>}
            <span style={metaStyle(CV.text2)}>{sizeText}</span>
          </div>
        )}
        {isCompact && formatLabel && (
          <div style={META_ROW_STYLE}>
            <span style={{ ...badgeStyle(accent, "#fff"), fontSize: 8 }}>{formatLabel}</span>
            <span style={metaStyle(CV.text2)}>{sizeText}</span>
          </div>
        )}
      </div>
    </>
  );

  // ─── compact 档：小缩略图 + 文件名 ───
  if (isCompact) {
    return (
      <div
        title={[config.filePath || null, formatLabel || null, sizeText].filter(Boolean).join("\n")}
        style={shellStyle({
          background: `linear-gradient(135deg, ${accent}1F 0%, ${accent}0D 60%, transparent 100%), ${CV.paper}`,
          borderColor: `${accent}59`,
          borderWidth: 1,
          shape: "image",
        })}
      >
        {showImage ? (
          <div
            style={{
              width: 30,
              height: 30,
              marginRight: 6,
              borderRadius: 3,
              overflow: "hidden",
              flex: "0 0 auto",
              background: `${accent}22`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src={url}
              alt={fileName}
              onError={() => setErrored(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </div>
        ) : formatLabel ? (
          <FormatGlyph label={formatLabel} accent={accent} size={30} />
        ) : (
          <div style={ICON_STYLE}>
            <ImageIcon sx={{ fontSize: 16, color: accent }} />
          </div>
        )}
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

  // ─── full 档：图片满铺 + 底部渐变信息条 ───
  return (
    <div
      title={[config.filePath || null, formatLabel || null, sizeText].filter(Boolean).join("\n")}
      style={{
        ...shellStyle({
          background: `${CV.paper}`,
          borderColor: `${accent}59`,
          borderWidth: 1,
          shape: "image",
        }),
        overflow: "hidden",
        position: "relative",
      }}
    >
      {!showImage ? (
        renderIconLayout()
      ) : (
        <>
          {/* 透明底棋盘格：PNG/SVG 带 alpha 时，深色主题下直接铺在纸面会发黑，
              垫一层棋盘格让透明区域一眼可辨（仅透明处透出，不透明图无视觉变化）。 */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              backgroundImage:
                "linear-gradient(45deg,#cbd5e1 25%,transparent 25%),linear-gradient(-45deg,#cbd5e1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#cbd5e1 75%),linear-gradient(-45deg,transparent 75%,#cbd5e1 75%)",
              backgroundSize: "12px 12px",
              backgroundPosition: "0 0,0 6px,6px -6px,-6px 0",
              backgroundColor: "#f1f5f9",
            }}
          />
          <img
            src={url}
            alt={fileName}
            onError={() => setErrored(true)}
            onLoad={onImageLoad}
            draggable={false}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              pointerEvents: "none",
            }}
          />
          {/* 底部渐变信息条：保证任意底色图片上文件名都可读 */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              padding: "10px 8px 6px",
              background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.32) 55%, rgba(0,0,0,0) 100%)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                ...TITLE_STYLE,
                fontSize: 12,
                color: "#fff",
                textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {fileName}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={badgeStyle(accent, "#fff")}>{t("entityProj.image.name")}</span>
              {formatLabel && <span style={badgeStyle(accent, "#fff")}>{formatLabel}</span>}
              {dims && (
                <span style={{ ...metaStyle("#fff"), textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                  {formatDimensions(dims)}
                  {dims.vector ? ` · ${t("imagePreview.vectorShort")}` : ""}
                </span>
              )}
              <span style={{ ...metaStyle("#fff"), textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>{sizeText}</span>
            </div>
          </div>
        </>
      )}
      {/* 放大按钮：单点即可打开图片详情弹窗（格式/尺寸/体积/路径），满足「点击图片弹出图片框」 */}
      <button
        type="button"
        title={t("imagePreview.title")}
        onClick={(e) => {
          e.stopPropagation();
          openPreview();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          zIndex: 2,
          width: 22,
          height: 22,
          borderRadius: 4,
          border: "none",
          cursor: "pointer",
          background: "rgba(0,0,0,0.45)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
      >
        <ZoomOutMapIcon sx={{ fontSize: 14 }} />
      </button>
    </div>
  );
}
