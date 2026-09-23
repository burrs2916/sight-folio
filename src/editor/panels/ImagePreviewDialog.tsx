// sight-folio: 图片详情弹窗（画布图片实体双击 → 放大查看）
//
// 与 SourceViewerDialog 同族（MUI Dialog），但面向图片资源：大图预览 + 详细
// 信息（格式 / 尺寸 / 体积 / 路径）+ 缩放 + 复制路径 / 新窗口打开。
// 信息全部来自实体 config + 图片自然尺寸，零后端新命令（走已接入的 asset 协议）。
import { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import CloseIcon from "@mui/icons-material/Close";
import ImageIcon from "@mui/icons-material/Image";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { t } from "../../i18n";
import {
  useAssetImage,
  formatImageSize,
  imageFormatLabel,
  measureImageDimensions,
  formatDimensions,
  type ImageDimensions,
} from "../utils/imageAsset";

export interface ImagePreviewData {
  /** 磁盘绝对路径（已 join projectRoot） */
  absPath: string;
  /** 展示名 */
  name?: string;
  /** 相对路径（用于信息行展示） */
  relPath?: string;
  /** 体积（字节） */
  fileSize?: number;
}

interface ImagePreviewDialogProps {
  open: boolean;
  data: ImagePreviewData | null;
  onClose: () => void;
}

export function ImagePreviewDialog({ open, data, onClose }: ImagePreviewDialogProps) {
  const [zoom, setZoom] = useState(1);
  const [dims, setDims] = useState<ImageDimensions | null>(null);
  const [copied, setCopied] = useState(false);
  // 路径存在但浏览器无法解码该格式（HEIC/TIFF/AVIF…）时为真 → 显示「无法预览」而非破图。
  const [loadFailed, setLoadFailed] = useState(false);

  // 精确测量尺寸：SVG 无固有宽高时按 viewBox 解析，避免显示「0×0」（用户反馈的图片信息不准）。
  useEffect(() => {
    let cancelled = false;
    setDims(null);
    setLoadFailed(false);
    if (data?.absPath) {
      measureImageDimensions(data.absPath).then((d) => {
        if (!cancelled) setDims(d);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [data?.absPath]);

  const { url: src, errored: srcFailed } = useAssetImage(data?.absPath || null);
  const formatLabel = imageFormatLabel(data?.name || data?.relPath);
  const sizeText = formatImageSize(data?.fileSize);

  const handleCopy = () => {
    if (!data?.absPath) return;
    navigator.clipboard?.writeText(data.absPath).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => undefined
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2 } } }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 6 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" noWrap title={data?.name}>
            {data?.name || t("imagePreview.title")}
          </Typography>
          {data?.relPath && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }} title={data.relPath}>
              {data.relPath}
            </Typography>
          )}
        </Box>
        <Tooltip title={t("imagePreview.close")}>
          <IconButton size="small" onClick={onClose} aria-label={t("imagePreview.close")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0, backgroundColor: "action.hover" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 320,
            maxHeight: "62vh",
            overflow: "auto",
            p: 2,
          }}
        >
          {srcFailed || !src ? (
            <Typography variant="body2" color="text.secondary">
              {t("imagePreview.notFound")}
            </Typography>
          ) : loadFailed ? (
            <Box sx={{ textAlign: "center", color: "text.secondary" }}>
              <ImageIcon sx={{ fontSize: 44, opacity: 0.22, mb: 1 }} />
              <Typography variant="body2" color="text.secondary">
                {t("imagePreview.previewUnavailable")}
              </Typography>
            </Box>
          ) : (
            <img
              src={src}
              alt={data?.name}
              onError={() => setLoadFailed(true)}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center",
                maxWidth: "100%",
                maxHeight: "60vh",
                objectFit: "contain",
                borderRadius: 1,
                boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                background: "#fff",
                display: "block",
              }}
            />
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ display: "flex", justifyContent: "space-between", px: 2 }}>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", color: "text.secondary" }}>
          {formatLabel && (
            <Typography variant="caption">
              {t("imagePreview.format")}: <b>{formatLabel}</b>
            </Typography>
          )}
          {dims && (
            <Typography variant="caption">
              {t("imagePreview.dimensions")}: <b>{formatDimensions(dims)}</b>
            </Typography>
          )}
          {dims?.vector && (
            <Typography variant="caption" color="text.secondary">
              {t("imagePreview.vector")}
            </Typography>
          )}
          {sizeText !== "—" && (
            <Typography variant="caption">
              {t("imagePreview.size")}: <b>{sizeText}</b>
            </Typography>
          )}
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Tooltip title={t("imagePreview.zoomOut")}>
            <IconButton size="small" onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))} disabled={zoom <= 0.25}>
              <ZoomOutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("imagePreview.zoomIn")}>
            <IconButton size="small" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} disabled={zoom >= 4}>
              <ZoomInIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("imagePreview.copyPath")}>
            <Button size="small" startIcon={<ContentCopyIcon />} onClick={handleCopy}>
              {copied ? t("imagePreview.copied") : t("imagePreview.copyPath")}
            </Button>
          </Tooltip>
          {src && (
            <Tooltip title={t("imagePreview.openOriginal")}>
              <IconButton size="small" onClick={() => window.open(src, "_blank")} aria-label={t("imagePreview.openOriginal")}>
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </DialogActions>
    </Dialog>
  );
}
