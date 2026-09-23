// sight-folio: 实体自绘 SVG 图标集合（glyphs）
// 全部为手写矢量 path —— 不引用任何 Material 图标/图片资源。
// 每个图标贴合实体实际含义：
//   file     → 文档折角
//   folder   → 文件夹
//   module   → 聚合方块（三个错落块）
//   class    → UML 类图三段框（类名/属性/方法）
//   function → ƒ 函数曲线
//   interface→ UML lollipop 接口符号（圆点 + 引出线）

interface GlyphProps {
  color?: string;
  size?: number;
}

/** 文件：文档折角 */
export function FileGlyph({ color = "currentColor", size = 16 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2.5h8l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M14 2.5V8h5.5" />
    </svg>
  );
}

/** 文件夹 */
export function FolderGlyph({ color = "currentColor", size = 16 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9.5v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17.5V7z" />
    </svg>
  );
}

/** 模块：聚合方块 */
export function ModuleGlyph({ color = "currentColor", size = 16 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="8" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

/** 类：UML 类图三段框（类名/属性/方法） */
export function ClassGlyph({ color = "currentColor", size = 16 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3" width="17" height="18" rx="1.5" />
      <line x1="3.5" y1="8.5" x2="20.5" y2="8.5" />
      <line x1="3.5" y1="14.5" x2="20.5" y2="14.5" />
      <line x1="7" y1="5.8" x2="12" y2="5.8" />
      <line x1="7" y1="11.5" x2="13.5" y2="11.5" />
      <line x1="7" y1="17.5" x2="12.5" y2="17.5" />
    </svg>
  );
}

/** 函数：ƒ 曲线 */
export function FunctionGlyph({ color = "currentColor", size = 16 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 4.5c-2 0-3.2 1.2-3.2 3v3.6H7.8v2h4.5v5c0 2 1.3 3.4 3.4 3.4 1.5 0 2.6-.9 2.6-2.1 0-.8-.6-1.4-1.4-1.4-.6 0-1 .3-1 .8 0 .4.3.6.5.6.2 0 .3-.1.3-.2 0-.1-.2-.2-.4-.2-.9 0-1.6-.9-1.6-2.9v-5h4.4v-2h-4.4V7.5c0-1.3.9-2.2 2.2-2.2h1.2v-2.8h-1.6z" />
    </svg>
  );
}

/** 接口：UML lollipop（圆点 + 引出线） */
export function InterfaceGlyph({ color = "currentColor", size = 16 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="10" y2="12" />
      <circle cx="14" cy="12" r="4" />
    </svg>
  );
}
