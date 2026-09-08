// project-sight: 语言元数据单一真实源（归一化 / 配色 / 可读名）
//
// 此前各视图（文件树、画布、目录、详情面板…）各自维护一份 languageColor / LANG_COLORS，
// 且大多只认全名、漏掉大量短码（ts/js/py…）→ 短码语言图标/配色落灰、与编辑器高亮不一致。
// 本模块统一：短码/别名/全名 → canonical id（对齐 Monaco 内置语言 id），再据 id 取配色与可读名。
// Monaco 高亮映射 monacoLanguageOf 也复用本归一化，保证「识别 → 高亮 → 配色」三处一致。

/** 短码 / 别名 / 全名 → canonical id（与 Monaco 内置语言 id 一致） */
const LANG_ALIAS: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "typescript",
  js: "javascript",
  javascript: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  rust: "rust",
  py: "python",
  python: "python",
  py3: "python",
  rb: "ruby",
  ruby: "ruby",
  go: "go",
  golang: "go",
  java: "java",
  kt: "kotlin",
  kotlin: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  "c/c++": "cpp",
  cs: "csharp",
  csharp: "csharp",
  "c#": "csharp",
  swift: "swift",
  objc: "objective-c",
  "objective-c": "objective-c",
  objectivec: "objective-c",
  php: "php",
  vue: "html", // Monaco 无 vue 内建，回退 html 兜底（含 svelte）
  svelte: "html",
  sql: "sql",
  sh: "shell",
  shell: "shell",
  bash: "shell",
  zsh: "shell",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  xml: "xml",
  xhtml: "html",
  svg: "xml",
  lua: "lua",
  dart: "dart",
  pl: "perl",
  perl: "perl",
  r: "r",
  scala: "scala",
  groovy: "groovy",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  makefile: "makefile",
  tex: "latex",
};

/** 归一化语言 → canonical id（未知返回 "plaintext"，上层据此回退默认） */
export function normalizeLanguage(lang: string | null | undefined): string {
  const l = (lang || "").trim().toLowerCase();
  return LANG_ALIAS[l] ?? (l || "plaintext");
}

/** Monaco 高亮语言 id（复用归一化，保证与配色/识别一致） */
export function monacoLanguageOf(lang: string | null | undefined): string {
  const id = normalizeLanguage(lang);
  return id === "plaintext" ? "plaintext" : id;
}

/** canonical id → 配色（覆盖 Monaco 内置的全部语言；未知回退中性灰） */
const LANG_COLORS: Record<string, string> = {
  typescript: "#3178c6",
  javascript: "#f1db4f",
  rust: "#dea584",
  python: "#3776ab",
  go: "#00add8",
  java: "#ea2d2e",
  kotlin: "#7f52ff",
  c: "#00599c",
  cpp: "#659ad2",
  csharp: "#178600",
  swift: "#fa7343",
  "objective-c": "#438eff",
  ruby: "#cc342d",
  php: "#777bb4",
  html: "#e34c26", // vue / svelte 回退 html
  sql: "#e38c00",
  shell: "#89e051",
  json: "#cbcb41",
  css: "#563d7c",
  scss: "#cf649a",
  less: "#1d365d",
  markdown: "#083fa1",
  yaml: "#cb171e",
  ini: "#6d8086", // toml / ini / conf
  xml: "#0060ac", // xml / svg
  lua: "#000080",
  r: "#276dc3",
  scala: "#c22d40",
  groovy: "#4298b4",
  graphql: "#e10098",
  dockerfile: "#0db7ed",
  makefile: "#6d8086",
  latex: "#008080",
  image: "#14b8a6", // 图片资源专属配色（青色，与 interface 的粉、function 的绿区分）
  asset: "#ea580c", // 资源文件专属配色（暖橙，字体/媒体/压缩/二进制；与 image 青色区分）
};

const DEFAULT_LANG_COLOR = "#64748b";

/** 语言 → 着色（统一入口，自动识别短码/全名/别名） */
export function languageColor(lang?: string | null): string {
  return LANG_COLORS[normalizeLanguage(lang)] ?? DEFAULT_LANG_COLOR;
}

/** canonical id → 可读中文名（供标签/tooltip 使用） */
const LANG_LABEL: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  rust: "Rust",
  python: "Python",
  go: "Go",
  java: "Java",
  kotlin: "Kotlin",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  swift: "Swift",
  "objective-c": "Objective-C",
  ruby: "Ruby",
  php: "PHP",
  html: "HTML",
  sql: "SQL",
  shell: "Shell",
  json: "JSON",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  markdown: "Markdown",
  yaml: "YAML",
  ini: "INI/TOML",
  xml: "XML",
  lua: "Lua",
  r: "R",
  scala: "Scala",
  groovy: "Groovy",
  graphql: "GraphQL",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  latex: "LaTeX",
  image: "Image", // 图片资源（png/jpg/svg/ico…）
  asset: "Asset", // 资源文件（字体/媒体/压缩/二进制）
};

/** 语言 → 可读名（未知回退原串首字母大写） */
export function languageLabel(lang?: string | null): string {
  const id = normalizeLanguage(lang);
  if (LANG_LABEL[id]) return LANG_LABEL[id];
  const raw = (lang || "").trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Unknown";
}
