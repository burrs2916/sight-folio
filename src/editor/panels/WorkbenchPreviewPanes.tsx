// sight-folio: 工作台非文本文件预览（对标 Zed ImageViewer / SvgPreviewView / MarkdownPreviewView）
//
// 设计取舍（与 Zed 一致，但按我们「renderable AND useful」铁律落地）：
// - 图片 / SVG：读取原始字节 → Blob URL → <img> 渲染，支持滚轮缩放、拖拽平移、适应窗口、100% 重置，
//   并在底部信息栏显示 文件名 · 大小 · 像素尺寸（对标 Zed ImageViewer 的 dimensions / file-info）。
//   SVG 额外提供「查看源码」开关（读取文本行），因为 SVG 本质是文本、开发者常需对照源码。
// - Markdown：复用现有零依赖、XSS 安全的 MarkdownView（aiMarkdown.tsx），提供「预览 / 源码」切换，
//   内容随 tab.content 更新（外部/AI 改盘后自动刷新，对标 Zed MarkdownPreview 的 Follow 模式）。
// - 字节读取复用既有 projectScanApi.readFileBytes（绝对路径来自 ProjectFile.path），零新后端依赖。
// - 全部用户可见文案走 i18n（workbench.preview*）。

import React, { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import CodeIcon from "@mui/icons-material/Code";
import { t } from "../../i18n";
import { projectScanApi } from "../../services/tauri";
import { useProjectStore } from "../../store/projectStore";
import type { WorkbenchTab, WorkbenchTabKind } from "../../store/codeWorkbenchStore";
import { MarkdownView } from "./aiMarkdown";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  ico: "image/x-icon",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
};

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function formatSize(bytes: number | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ───────────────────────── 图片 / SVG 预览 ─────────────────────────

interface MediaPreviewProps {
  fileId: string;
  name: string;
  kind: Extract<WorkbenchTabKind, "image" | "svg">;
  themeMode: "light" | "dark";
}

export function WorkbenchMediaPreview({ fileId, name, kind, themeMode }: MediaPreviewProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [sourceText, setSourceText] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  // 读取字节 → Blob URL（图片 / SVG 均以 <img> 渲染：安全、可缩放、可平移）
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSrc(null);
    setNat(null);
    void (async () => {
      try {
        const path = useProjectStore.getState().files.find((f) => f.id === fileId)?.path;
        if (!path) throw new Error("file path not found");
        const buf = await projectScanApi.readFileBytes(path);
        if (cancelled) return;
        const mime = MIME[extOf(name)] ?? "application/octet-stream";
        const blob = new Blob([buf], { type: mime });
        url = URL.createObjectURL(blob);
        setSrc(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId, name]);

  const applyFit = useCallback(() => {
    const c = containerRef.current;
    if (!c || !nat) return;
    const pad = 32;
    const sx = (c.clientWidth - pad) / nat.w;
    const sy = (c.clientHeight - pad) / nat.h;
    setScale(Math.max(0.05, Math.min(sx, sy, 1)));
  }, [nat]);

  useEffect(() => {
    if (fit && nat) applyFit();
  }, [fit, nat, applyFit, loading]);

  // 滚轮缩放：用原生非被动监听，确保 preventDefault 生效（阻止容器滚动与缩放同时发生）
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setFit(false);
      setScale((s) => Math.min(Math.max(s * delta, 0.05), 16));
    };
    c.addEventListener("wheel", handler, { passive: false });
    return () => c.removeEventListener("wheel", handler);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    const c = containerRef.current;
    if (!c) return;
    pan.current = { x: e.clientX, y: e.clientY, sl: c.scrollLeft, st: c.scrollTop };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!pan.current || !containerRef.current) return;
    const c = containerRef.current;
    c.scrollLeft = pan.current.sl - (e.clientX - pan.current.x);
    c.scrollTop = pan.current.st - (e.clientY - pan.current.y);
  };
  const onMouseUp = () => {
    pan.current = null;
  };

  const toggleSource = async () => {
    if (!showSource && sourceText === null) {
      try {
        const content = await projectScanApi.readSourceFile(fileId);
        setSourceText(content.lines.join("\n"));
      } catch (e) {
        setSourceText(`<!-- ${e instanceof Error ? e.message : String(e)} -->`);
      }
    }
    setShowSource((v) => !v);
  };

  const sizeBytes = useProjectStore.getState().files.find((f) => f.id === fileId)?.size;
  const display = nat
    ? { w: Math.round(nat.w * scale), h: Math.round(nat.h * scale) }
    : { w: 240, h: 160 };

  const bg = themeMode === "dark" ? "#010409" : "#f3f4f6";

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", bgcolor: bg }}>
      {/* 工具栏：缩放 / 适应 / 重置 /（SVG）源码 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          height: 36,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Tooltip title={t("workbench.previewZoomOut")}>
          <IconButton size="small" onClick={() => { setFit(false); setScale((s) => Math.max(s / 1.2, 0.05)); }} aria-label={t("workbench.previewZoomOut")}>
            <ZoomOutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography variant="caption" sx={{ minWidth: 44, textAlign: "center", fontFamily: "monospace", userSelect: "none" }}>
          {Math.round(scale * 100)}%
        </Typography>
        <Tooltip title={t("workbench.previewZoomIn")}>
          <IconButton size="small" onClick={() => { setFit(false); setScale((s) => Math.min(s * 1.2, 16)); }} aria-label={t("workbench.previewZoomIn")}>
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.previewReset")}>
          <IconButton size="small" onClick={() => { setFit(false); setScale(1); }} aria-label={t("workbench.previewReset")}>
            <RestartAltIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.previewFit")}>
          <IconButton size="small" color={fit ? "primary" : "default"} onClick={() => setFit((v) => !v)} aria-label={t("workbench.previewFit")}>
            <FitScreenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {kind === "svg" && (
          <Tooltip title={showSource ? t("workbench.previewViewPreview") : t("workbench.previewViewSource")}>
            <IconButton size="small" color={showSource ? "primary" : "default"} onClick={toggleSource} aria-label={showSource ? t("workbench.previewViewPreview") : t("workbench.previewViewSource")}>
              <CodeIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: "text.secondary", userSelect: "none" }}>
          {name}
        </Typography>
      </Box>

      {/* 主体 */}
      {loading ? (
        <LinearProgress sx={{ flexShrink: 0 }} />
      ) : error ? (
        <Box sx={{ p: 2 }}>
          <Alert severity="error">{t("workbench.previewLoadError", { msg: error })}</Alert>
        </Box>
      ) : showSource && kind === "svg" ? (
        <Box
          component="pre"
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            m: 0,
            p: 2,
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: "monospace",
            whiteSpace: "pre",
            color: themeMode === "dark" ? "#c9d1d9" : "#24292f",
          }}
        >
          {sourceText}
        </Box>
      ) : (
        <Box
          ref={containerRef}
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            position: "relative",
            display: "flex",
            cursor: pan.current ? "grabbing" : "grab",
            userSelect: "none",
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <Box
            sx={{
              margin: "auto",
              width: display.w,
              height: display.h,
              flexShrink: 0,
              boxShadow: themeMode === "dark" ? "0 0 0 1px rgba(255,255,255,0.1)" : "0 1px 6px rgba(0,0,0,0.25)",
              bgcolor: "#fff",
            }}
          >
            {src && (
              <img
                ref={imgRef}
                src={src}
                alt={name}
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setNat({ w: img.naturalWidth, h: img.naturalHeight });
                }}
                style={{ width: "100%", height: "100%", display: "block", objectFit: "fill", pointerEvents: "none" }}
              />
            )}
          </Box>
        </Box>
      )}

      {/* 底部信息栏：文件名 · 大小 · 像素尺寸 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          height: 24,
          flexShrink: 0,
          borderTop: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          fontSize: 11,
          color: "text.secondary",
          userSelect: "none",
        }}
      >
        <span>{name}</span>
        {sizeBytes != null && <span>· {formatSize(sizeBytes)}</span>}
        {nat && <span>· {nat.w} × {nat.h} px</span>}
      </Box>
    </Box>
  );
}

// ───────────────────────── Markdown 预览 ─────────────────────────

interface MarkdownPreviewProps {
  fileId: string;
  tab: WorkbenchTab;
  themeMode: "light" | "dark";
}

export function WorkbenchMarkdownPreview({ fileId, tab, themeMode }: MarkdownPreviewProps) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [sourceText, setSourceText] = useState<string | null>(null);

  // 内容随 tab.content 刷新（外部/AI 改盘后自动重渲染，对标 Zed MarkdownPreview Follow 模式）
  useEffect(() => {
    if (tab.content && !tab.content.skippedReason) {
      setText(tab.content.lines.join("\n"));
      setLoading(false);
      return;
    }
    if (tab.content?.skippedReason) {
      setText(null);
      setLoading(false);
      return;
    }
    // 尚未加载（极少触发，openTab 已异步加载）：兜底补读
    let cancelled = false;
    setLoading(true);
    projectScanApi
      .readSourceFile(fileId)
      .then((c) => {
        if (!cancelled) setText(c.lines.join("\n"));
      })
      .catch(() => {
        if (!cancelled) setText(null);
      })
      .finally(() => {
        // 关键：setLoading(false) 必须无条件执行。
        // 旧实现用 `if (!cancelled) setLoading(false)` —— 但 openTab 异步加载完成后
        // tab.content 变更会触发本 effect 重跑，React 先跑上一次 effect 的 cleanup
        // （把 cancelled 置 true），导致「上一次兜底读」的 finally 跳过 setLoading(false)，
        // 进度条永久卡住、正文被遮。cancelled 只应阻止「写入过期正文」，
        // 绝不可阻止「收起加载态」。md 等无画布实体的文件只走此预览组件，故此前必现。
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, tab.content]);

  const toggleSource = async () => {
    if (!showSource && sourceText === null) {
      const c = tab.content ?? (await projectScanApi.readSourceFile(fileId));
      setSourceText((c.lines ?? []).join("\n"));
    }
    setShowSource((v) => !v);
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", bgcolor: themeMode === "dark" ? "#0d1117" : "#ffffff" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          height: 36,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Tooltip title={showSource ? t("workbench.previewViewPreview") : t("workbench.previewViewSource")}>
          <IconButton size="small" color={showSource ? "primary" : "default"} onClick={toggleSource} aria-label={showSource ? t("workbench.previewViewPreview") : t("workbench.previewViewSource")}>
            <CodeIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: "text.secondary", userSelect: "none" }}>
          {tab.name}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: showSource ? 0 : 2.5 }}>
        {loading ? (
          <LinearProgress sx={{ mt: 2 }} />
        ) : showSource ? (
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "monospace",
              whiteSpace: "pre",
              color: themeMode === "dark" ? "#c9d1d9" : "#24292f",
            }}
          >
            {sourceText}
          </Box>
        ) : text !== null ? (
          <Box sx={{ maxWidth: 880, mx: "auto", fontSize: 13, lineHeight: 1.7, color: themeMode === "dark" ? "#c9d1d9" : "#24292f" }}>
            <MarkdownView content={text} />
          </Box>
        ) : (
          <Alert severity="info" sx={{ mt: 2 }}>{t("workbench.previewEmpty")}</Alert>
        )}
      </Box>
    </Box>
  );
}
