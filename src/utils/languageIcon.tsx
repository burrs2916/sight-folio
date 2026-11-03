// sight-folio: 语言图标（轻量缩写徽标，零依赖）
//
// 统一的逐语言视觉标识：语言缩写（TS/JS/PY/RS/GO…）+ languageColor 配色块。
// 覆盖所有语言（短码/别名/全名自动识别），替代各处不统一的通用文件图标 / 局部 MUI 图标。
import Box from "@mui/material/Box";
import { languageColor, normalizeLanguage } from "./languageMeta";

/** canonical id → 缩写（部分语言特例优先于归一化，如 vue/svelte） */
const LANG_ABBR: Record<string, string> = {
  typescript: "TS",
  javascript: "JS",
  tsx: "TSX",
  jsx: "JSX",
  rust: "RS",
  python: "PY",
  py: "PY",
  ruby: "RB",
  go: "GO",
  java: "JV",
  kotlin: "KT",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  swift: "SW",
  "objective-c": "OBJC",
  php: "PHP",
  html: "HTML",
  vue: "VUE",
  svelte: "SVE",
  sql: "SQL",
  shell: "SH",
  json: "JSON",
  css: "CSS",
  scss: "SCSS",
  less: "LESS",
  markdown: "MD",
  yaml: "YAML",
  toml: "TOML",
  ini: "INI",
  xml: "XML",
  svg: "SVG",
  lua: "LUA",
  r: "R",
  scala: "SC",
  groovy: "GR",
  graphql: "GQL",
  dockerfile: "DKR",
  makefile: "MK",
  latex: "TEX",
  perl: "PL",
  dart: "DT",
};

function langAbbr(lang?: string | null): string {
  const l = (lang || "").trim().toLowerCase();
  if (LANG_ABBR[l]) return LANG_ABBR[l];
  const id = normalizeLanguage(lang);
  if (LANG_ABBR[id]) return LANG_ABBR[id];
  return l ? l.slice(0, 3).toUpperCase() : "?";
}

/** 按背景亮度选前景色，保证缩写可读 */
function contrastText(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return "#ffffff";
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0f172a" : "#ffffff";
}

/** 统一语言图标：缩写 + 配色块 */
export function LanguageIcon({ lang, size = 14 }: { lang?: string | null; size?: number }) {
  const bg = languageColor(lang);
  const fg = contrastText(bg);
  const abbr = langAbbr(lang);
  return (
    <Box
      component="span"
      aria-label={lang || "unknown"}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        minWidth: size,
        // 圆角例外（第 32 轮逐处拍板）：这是 size×size（默认 14px）的语言缩写徽章，
        // 4px ≈ 边长的 28%，是**随尺寸走的几何值**；跟「圆角风格」档会在 large(12)/round(20)
        // 档把 14px 的小方块撑成圆形，两字母缩写直接糊掉。与 writingPanes 的「条高一半」
        // 三处、胶囊 chip 的「高度一半」十二处同属一类，已登记进推进记录例外清单。
        borderRadius: "4px",
        bgcolor: bg,
        color: fg,
        fontSize: Math.round(size * 0.46),
        fontWeight: 700,
        lineHeight: 1,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {abbr}
    </Box>
  );
}
