// project-sight: 文件种类 → 画布实体类型的单一事实源（零依赖，可在纯函数/单测中使用）
//
// 为什么必须独立成模块：上一轮已经注册了 `image` 实体类型、写好了 ImageRenderer 与
// 图片详情弹窗，但**没有任何一处产出 type="image" 的实体** —— 同步到画布 / 目录结构画像 /
// 模块下钻三条路径一律硬编码 `type: "file"`。结果整条图片链路是死代码，画布上的 png/svg/ico
// 仍然被当成代码文件画成文字卡片（用户说的「目录树上有些元素没有被准确的画像」正是这个）。
//
// 硬编码类型是这类缺陷的根源：类型判定散落在四个产出点，补一个漏三个。这里收敛为一个
// 纯函数 `entityTypeForFile`，四个产出点全部改为调用它；新增资源类型（未来的字体/媒体）
// 只改这一处。
//
// 本模块刻意不 import 任何 Tauri / store / React —— syncLayout 这类纯布局函数要在
// vitest 里直接跑，一旦拉进 @tauri-apps/api 就得整套 mock。imageAsset.ts 复用本模块的
// 判定（不再自己维护第二份扩展名表）。

/** 图片扩展名（小写，含点）。与后端 project_scan.rs 的 detect_language 图片分支保持一致。 */
export const IMAGE_EXTENSIONS = new Set([
  // 位图
  ".png",
  ".jpg",
  ".jpeg",
  ".jfif", // JPEG 直出变体（相机/网页常见）
  ".jpe", // .jpeg 短别名
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".avif",
  ".jxl", // JPEG XL
  ".heic",
  ".heif",
  // 动图
  ".apng", // 动画 PNG
  // 矢量
  ".svg",
  // 图标 / 光标（用户明确点名「icon」一类）
  ".ico",
  ".icns", // macOS 图标集
  ".cur", // Windows 光标（图标同源）
]);

/** 资源文件扩展名（字体/媒体/压缩/其它二进制，小写，含点）。
 *  与后端 project_scan.rs 的 detect_language asset 分支保持一致 —— 前端兜底判定
 *  必须能覆盖旧分析库（后端加 asset 分支前扫描的数据 language 为空）。 */
export const ASSET_EXTENSIONS = new Set([
  // 字体
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
  // 音视频
  ".mp4",
  ".webm",
  ".mov",
  ".avi",
  ".mkv",
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".aac",
  ".m4a",
  ".mid",
  ".midi",
  // 压缩包
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  // 其它二进制
  ".pdf",
  ".wasm",
  ".bin",
  ".dat",
  ".dll",
  ".so",
  ".dylib",
  ".exe",
  ".o",
  ".a",
  ".class",
  ".jar",
  ".pak",
  ".cadbin",
]);

/** 判断路径是否图片资源（相对/绝对路径均可）。 */
export function isImageFile(path: string | null | undefined): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(lower.slice(dot));
}

/** 判断路径是否资源文件（字体/媒体/压缩/其它二进制）。 */
export function isAssetFile(path: string | null | undefined): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return ASSET_EXTENSIONS.has(lower.slice(dot));
}

/** 资源文件友好格式标签（TTF / WOFF / PDF / ZIP …，即扩展名大写；无扩展名返回空串）。 */
export function assetFormatLabel(pathOrName: string | null | undefined): string {
  const ext = extOf(pathOrName);
  return ext ? ext.toUpperCase() : "";
}

/** 资源子类：字体 / 媒体 / 压缩 / 其它二进制（决定画布图标与画像语义色，仍是同一个 asset 实体类型）。 */
export type AssetKind = "font" | "media" | "archive" | "other";

const FONT_EXTS = new Set(["ttf", "otf", "woff", "woff2", "eot"]);
const MEDIA_EXTS = new Set([
  "mp4", "webm", "mov", "avi", "mkv",
  "mp3", "wav", "flac", "ogg", "aac", "m4a", "mid", "midi",
]);
const ARCHIVE_EXTS = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar"]);

/** 按扩展名归类资源子类（与画布 AssetRenderer 同源，单一事实源避免两份表漂移）。 */
export function assetKindOf(nameOrPath?: string | null): AssetKind {
  const ext = extOf(nameOrPath);
  if (!ext) return "other";
  if (FONT_EXTS.has(ext)) return "font";
  if (MEDIA_EXTS.has(ext)) return "media";
  if (ARCHIVE_EXTS.has(ext)) return "archive";
  return "other";
}

/** 取扩展名（不含点，小写）；无扩展名返回空串。 */
export function extOf(pathOrName: string | null | undefined): string {
  if (!pathOrName) return "";
  const base = pathOrName.slice(pathOrName.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return ""; // 无点 或 dotfile（.gitignore 的 "gitignore" 不是扩展名）
  return base.slice(dot + 1).toLowerCase();
}

/** 画布实体类型（当前项目实体里与「文件」同族的三种） */
export type FileEntityType = "file" | "image" | "asset";

/**
 * 文件 → 画布实体类型。
 *
 * 判定顺序：先信后端 language（扫描层已把图片统一标成 "image"、资源标成 "asset"，
 * 是最权威的事实），language 缺失/为空时按扩展名兜底（旧分析库、增量补写、手工造的
 * 实体都可能没有 language）。
 */
export function entityTypeForFile(f: {
  language?: string | null;
  relPath?: string | null;
  name?: string | null;
}): FileEntityType {
  const lang = (f.language ?? "").trim().toLowerCase();
  if (lang === "image") return "image";
  if (lang === "asset") return "asset";
  if (isImageFile(f.relPath) || isImageFile(f.name)) return "image";
  if (isAssetFile(f.relPath) || isAssetFile(f.name)) return "asset";
  return "file";
}

// ─── 画布节点尺寸 ───
// 图片实体要「直观地直接在画布上展示出图片」，用文件卡的 180×66 只能挤出一条细缝。
// 给图片单独一档更接近正方的尺寸（缩略图可读、又不至于把树形布局撑散）。

/** 文件实体默认尺寸 */
export const FILE_NODE_W = 180;
export const FILE_NODE_H = 66;
/** 图片实体默认尺寸（高度加倍，缩略图才看得清） */
export const IMAGE_NODE_W = 180;
export const IMAGE_NODE_H = 132;

/** 按文件种类取画布节点尺寸（同步布局 / 树形布局 / 下钻共用同一口径）。 */
export function fileNodeSize(f: {
  language?: string | null;
  relPath?: string | null;
  name?: string | null;
}): { width: number; height: number } {
  return entityTypeForFile(f) === "image"
    ? { width: IMAGE_NODE_W, height: IMAGE_NODE_H }
    : { width: FILE_NODE_W, height: FILE_NODE_H };
}
