// project-sight: 画布图片实体辅助
//
// 把项目里的图片（png/jpg/jpeg/gif/webp/svg/ico/bmp…）在画布上直接渲染出来，
// 并支持点击放大查看详情。核心两件事：
//   1) 拿到图片在磁盘上的绝对路径 —— 扫描写入的 config 只带相对路径(filePath)，
//      绝对路径 = 当前分析的 projectRoot + filePath；
//   2) 把绝对路径转成 webview 可加载的 asset:// URL（Tauri 资产协议，
//      tauri.conf.json 的 assetProtocol.scope 已含 $HOME/**，项目目录在范围内）。
//
// 设计要点：projectRoot 通过 useProjectRoot() 响应式取得并模块级缓存，
// 跨分析切换只查一次；画布节点 memo 化，图片渲染器各自订阅 activeAnalysisId，
// root 落库后仅图片渲染器局部重渲染，不波及其余实体（守住画布性能铁律）。

import { useEffect, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useSceneStore } from "../../store/sceneStore";
import { analysisApi } from "../../services/tauri";
import { extOf } from "./fileKind";

// 图片扩展名/判定统一走 fileKind（零依赖单一事实源，同步布局与单测也用它）；
// 这里只做转出，保证既有 import 路径不变，杜绝两份扩展名表漂移（此前本文件那份漏了 .heic）。
export { IMAGE_EXTENSIONS, isImageFile } from "./fileKind";

/** 模块级缓存：scene/analysisId → projectRoot（跨组件/跨渲染复用，避免重复查库）。 */
const rootCache = new Map<string, string>();

/**
 * 图片绝对路径依赖「当前激活分析的 projectRoot」。
 *
 * 关键坑（此前 read_file_bytes 通用方案仍加载失败的根因）：应用打开已存在分析时，
 * 只 `setActiveScene(id)`（`MenuContent`/`AppNavbar`），**从不** `setActiveAnalysis`；
 * 而旧实现从 `useProjectStore.activeAnalysisId` 取 root，该值在「打开」流程里几乎恒为
 * null → `imageAbsPath(cfg, null)` 拼不出绝对路径 → `absPath` 空串 → 图片/资源全部报
 * 「路径缺失」。scene === analysis（id 相同），故统一改读 `useSceneStore.activeSceneId`。
 */
function resolveProjectRootSync(sid: string | null | undefined): string | null {
  if (!sid) return null;
  const scene = useSceneStore.getState().scenes.find((s) => s.id === sid);
  const r = (scene?.projectRoot ?? "").trim();
  return r || null;
}

/** 当前激活分析的 projectRoot（同步读：优先场景内存，其次模块缓存）。供非组件上下文使用。 */
export function getCachedProjectRoot(): string | null {
  const sid = useSceneStore.getState().activeSceneId;
  const sync = resolveProjectRootSync(sid);
  if (sync) return sync;
  if (sid) return rootCache.get(sid) ?? null;
  return null;
}

/** 响应式取当前分析的 projectRoot（切换场景时自动刷新）。 */
export function useProjectRoot(): string | null {
  const activeSceneId = useSceneStore((s) => s.activeSceneId);
  const [root, setRoot] = useState<string | null>(() => getCachedProjectRoot());

  useEffect(() => {
    let cancelled = false;
    if (!activeSceneId) {
      setRoot(null);
      return;
    }
    const sync = resolveProjectRootSync(activeSceneId);
    if (sync) {
      rootCache.set(activeSceneId, sync);
      setRoot(sync);
      return;
    }
    const cached = rootCache.get(activeSceneId);
    if (cached) {
      setRoot(cached);
      return;
    }
    analysisApi
      .get(activeSceneId)
      .then((a) => {
        if (cancelled) return;
        const r = (a?.projectRoot ?? "").trim();
        if (r) rootCache.set(activeSceneId, r);
        setRoot(r || null);
      })
      .catch(() => {
        if (!cancelled) setRoot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSceneId]);

  return root;
}

/** 由实体 config（相对路径 + 当前 projectRoot）拼出磁盘绝对路径；已是绝对路径则原样返回。 */
export function imageAbsPath(config: Record<string, unknown> | undefined, projectRoot: string | null): string {
  if (!config) return "";
  const abs = typeof config.absPath === "string" ? config.absPath : "";
  if (abs && (abs.startsWith("/") || /^[A-Za-z]:[\\/]/.test(abs))) return abs;
  const rel = typeof config.filePath === "string" ? config.filePath : "";
  if (!rel) return abs;
  if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel)) return rel;
  if (!projectRoot) return "";
  return `${projectRoot.replace(/\/$/, "")}/${rel.replace(/^\//, "")}`;
}

/** 绝对路径 → webview 可加载的 URL（data:/http 原样、其余走 convertFileSrc）。 */
export function imageAssetUrl(absPath: string): string {
  if (!absPath) return "";
  if (absPath.startsWith("data:") || absPath.startsWith("http")) return absPath;
  try {
    // 保留 convertFileSrc 路径供外部/旧调用使用；组件内统一走 loadImageObjectUrl
    // （invoke read_file_bytes → blob URL，任何项目路径可用，不受 asset 协议 scope 限制）。
    return convertFileSrc(absPath);
  } catch {
    return absPath;
  }
}

// ─── 通用文件读取：invoke read_file_bytes → blob URL（跨平台、任意路径）─────────
// asset 协议 scope 只放行 $HOME/$APPDATA/$RESOURCE，项目在外置卷/其它盘时图片全部
// 加载失败。改为后端 read_file_bytes 命令读原始字节 → object URL，任何操作系统、
// 任何项目路径都可用。缓存按绝对路径复用，避免重复读盘。

const objectUrlCache = new Map<string, string>();
const objectUrlPending = new Map<string, Promise<string | null>>();

/** 扩展名 → MIME（svg 必须 image/svg+xml，否则浏览器拒绝渲染）。 */
function mimeFromPath(path: string): string {
  const e = extOf(path);
  switch (e) {
    case "png": return "image/png";
    case "jpg": case "jpeg": case "jfif": case "jpe": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "svg": return "image/svg+xml";
    case "ico": return "image/x-icon";
    case "icns": return "image/icns";
    case "cur": return "image/x-icon";
    case "tif": case "tiff": return "image/tiff";
    case "avif": return "image/avif";
    case "heic": return "image/heic";
    case "heif": return "image/heif";
    case "apng": return "image/apng";
    case "jxl": return "image/jxl";
    default: return "application/octet-stream";
  }
}

/** 读取磁盘图片 → blob object URL（带缓存；失败返回 null）。 */
export function loadImageObjectUrl(absPath: string): Promise<string | null> {
  if (!absPath) return Promise.resolve(null);
  const cached = objectUrlCache.get(absPath);
  if (cached) return Promise.resolve(cached);
  const pending = objectUrlPending.get(absPath);
  if (pending) return pending;
  const p = (async () => {
    try {
      const buf = await invoke<ArrayBuffer>("read_file_bytes", { path: absPath });
      const blob = new Blob([buf], { type: mimeFromPath(absPath) });
      const url = URL.createObjectURL(blob);
      objectUrlCache.set(absPath, url);
      return url;
    } catch {
      return null;
    } finally {
      objectUrlPending.delete(absPath);
    }
  })();
  objectUrlPending.set(absPath, p);
  return p;
}

/** 组件内加载图片的 hook：返回 { url, errored }，路径变化自动重新加载。 */
export function useAssetImage(absPath: string | null | undefined): { url: string | null; errored: boolean } {
  const [state, setState] = useState<{ url: string | null; errored: boolean }>({ url: null, errored: false });
  useEffect(() => {
    let cancelled = false;
    const p = absPath ?? "";
    if (!p) {
      setState({ url: null, errored: false });
      return;
    }
    setState({ url: null, errored: false });
    loadImageObjectUrl(p).then((url) => {
      if (cancelled) return;
      setState({ url, errored: !url });
    });
    return () => {
      cancelled = true;
    };
  }, [absPath]);
  return state;
}

/** 字节 → 人类可读体积（B/KB/MB/GB）。 */
export function formatImageSize(bytes?: number): string {
  const b = bytes ?? 0;
  if (b <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** 取扩展名（不含点，小写）；无则空串。委托 fileKind.extOf，口径与实体类型判定一致。 */
export function imageExt(fileName?: string): string {
  return extOf(fileName);
}

/**
 * 由实体 config（fileName/filePath/fileSize + 当前 projectRoot）构造图片预览弹窗的数据。
 * 画布双击 / 目录树双击 / 画像面板「查看大图」三处共用，避免各自拼字段导致口径漂移。
 * absPath 拼不出（无 root）时仍返回对象（absPath 为空串），调用方交给弹窗显示「未找到」。
 */
export function buildImagePreviewData(
  config: Record<string, unknown> | undefined,
  projectRoot: string | null
): { absPath: string; name?: string; relPath?: string; fileSize?: number } {
  const cfg = config ?? {};
  const abs = imageAbsPath(cfg, projectRoot);
  const fileName =
    typeof cfg.fileName === "string"
      ? cfg.fileName
      : typeof cfg.filePath === "string"
        ? cfg.filePath.split("/").pop()!
        : "image";
  const relPath = typeof cfg.filePath === "string" ? cfg.filePath : undefined;
  const fileSize = typeof cfg.fileSize === "number" ? cfg.fileSize : undefined;
  return { absPath: abs, name: fileName, relPath, fileSize };
}

/** SVG 等矢量格式判断（按扩展名；webp/avif 等仍按位图处理）。 */
export function isVectorImage(fileName?: string): boolean {
  return imageExt(fileName) === "svg";
}

/** 友好的格式标签（PNG / JPG / SVG / ICO …）；无法识别时回退扩展名大写或 "IMG"。 */
const FRIENDLY_FORMAT: Record<string, string> = {
  png: "PNG",
  jpg: "JPG",
  jpeg: "JPG",
  jfif: "JPEG",
  jpe: "JPEG",
  gif: "GIF",
  webp: "WEBP",
  avif: "AVIF",
  jxl: "JXL",
  heic: "HEIC",
  heif: "HEIF",
  apng: "APNG",
  svg: "SVG",
  ico: "ICO",
  icns: "ICNS",
  cur: "CUR",
  bmp: "BMP",
  tif: "TIFF",
  tiff: "TIFF",
};
export function imageFormatLabel(fileName?: string): string {
  const e = imageExt(fileName);
  if (!e) return "IMG";
  return FRIENDLY_FORMAT[e] ?? e.toUpperCase();
}

/** 图片尺寸测量结果；vector=true 表示尺寸取自 SVG viewBox（非固有像素）。 */
export interface ImageDimensions {
  width: number;
  height: number;
  vector: boolean;
}

/**
 * 精确测量图片尺寸，覆盖「位图按 naturalWidth/Height」与「SVG 无固有宽高」两类。
 *
 * 为什么需要它：`<img>.naturalWidth` 对**没有 width/height 属性、只有 viewBox** 的 SVG
 * 会返回 0 —— 此前画布详情 / 画像面板对 SVG 一律显示「0×0」，正是用户说的
 * 「图片信息不准确」。这里对 SVG 走 fetch + 解析 viewBox/width/height，位图仍走 Image()。
 *
 * 纯前端、无新后端命令；在 webview 内 fetch asset:// URL 即可拿到文件文本。
 */
export function measureImageDimensions(absPath: string): Promise<ImageDimensions | null> {
  if (!absPath) return Promise.resolve(null);
  // 走统一的 blob object URL（invoke 读文件），与预览加载同源；
  // asset:// 协议在 $HOME 外的项目路径会被 scope 拒绝，不能再作为测量数据源。
  return loadImageObjectUrl(absPath).then((url) => {
    if (!url) return null;

    if (isVectorImage(absPath)) {
      return fetch(url)
        .then((res) => (res.ok ? res.text() : Promise.reject(new Error("fetch failed"))))
        .then((text) => parseSvgSize(text))
        .catch(() => null);
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          resolve({ width: img.naturalWidth, height: img.naturalHeight, vector: false });
        } else {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  });
}

/** 从 SVG 文本解析尺寸：优先 width/height 数值，其次 viewBox，最后回退 100×100 并标 vector。 */
function parseSvgSize(text: string): ImageDimensions | null {
  // 容错：去掉注释与多余空白，避免在 <style> 里的 width 误命中
  const clean = text.replace(/<!--[\s\S]*?-->/g, " ").replace(/\s+/g, " ");
  const svgTag = /<svg[\s>][\s\S]*?>/i.exec(clean);
  if (!svgTag) return { width: 100, height: 100, vector: true };
  const tag = svgTag[0];
  const num = (attr: string): number | null => {
    const m = new RegExp(`\\b${attr}\\s*=\\s*["']?\\s*([\\d.]+)`).exec(tag);
    return m ? parseFloat(m[1]) : null;
  };
  const w = num("width");
  const h = num("height");
  if (w && h) return { width: Math.round(w), height: Math.round(h), vector: true };
  const vb = /viewBox\s*=\s*["']\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*["']/i.exec(tag);
  if (vb) return { width: Math.round(parseFloat(vb[3])), height: Math.round(parseFloat(vb[4])), vector: true };
  if (w) return { width: Math.round(w), height: Math.round(w), vector: true };
  if (h) return { width: Math.round(h), height: Math.round(h), vector: true };
  return { width: 100, height: 100, vector: true };
}

/** 尺寸 → 展示文本（如 "1920×1080"）；vector 时附带提示。 */
export function formatDimensions(d: ImageDimensions | null): string {
  if (!d) return "—";
  return `${d.width}×${d.height}`;
}
