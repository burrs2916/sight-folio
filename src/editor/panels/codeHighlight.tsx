// project-sight: 聊天区代码块语法高亮（对标 VS Code Copilot Chat 的代码块观感）
//
// 设计取舍（与 aiMarkdown.tsx 同源约束）：
// - 为什么不用 react-markdown / react-syntax-highlighter / highlight.js？工作台侧栏要保持轻量，
//   且这些库要么走 dangerouslySetInnerHTML 有 XSS 面，要么拖一大包进侧栏 bundle。
//   这里手写 tokenizer，全部输出 React 元素（<span style>），绝不 innerHTML。
// - 为什么不用 Monaco colorize？它要先把 monaco 实例拉起来，且返回 HTML 字符串需 innerHTML 渲染；
//   我们只在侧栏读展示，自包含 tokenizer 更稳、零额外加载、零 XSS 面。
// - 着色目标不是「编译器级精确」，而是「一眼读成 IDE 代码块」：关键字/字符串/注释/数字/类型/
//   函数/内置 七类着色，足够消除「纯等宽文本=聊天机器人」的违和感。
// - 主题感知：暗/亮两套 VS Code 风调色板，跟随当前主题。

import React from "react";

type TokCls =
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "type"
  | "function"
  | "builtin"
  | "plain";

interface Tok {
  text: string;
  cls: TokCls;
}

// `#` 行注释只在这些语言启用；其余语言（JS/TS/Rust/Go/C#/Java）的 `#` 是属性/预处理/私有字段，不当注释。
const HASH_COMMENT_LANGS = new Set([
  "python", "py", "ruby", "rb", "shell", "sh", "bash", "zsh", "yaml", "yml",
  "toml", "dockerfile", "perl", "pl", "r", "makefile", "nim", "ssh-config", "conf",
]);

// 跨语言通用关键字（JS/TS/Python/Rust/Go/Java/C#/Swift 的高频交集），够用即可。
const KEYWORDS = new Set([
  "if", "else", "elif", "for", "while", "return", "function", "def", "class", "const",
  "let", "var", "new", "await", "async", "import", "export", "from", "as", "of", "in",
  "typeof", "instanceof", "throw", "try", "catch", "finally", "switch", "case", "break",
  "continue", "default", "do", "void", "yield", "this", "super", "extends", "implements",
  "interface", "enum", "namespace", "public", "private", "protected", "static", "readonly",
  "abstract", "final", "struct", "trait", "impl", "where", "match", "with", "module",
  "package", "using", "go", "defer", "fn", "mut", "pub", "use", "mod", "select", "when",
  "fun", "val", "type", "record", "data", "then", "end", "begin", "crate", "dyn", "ref",
  "move", "unsafe", "chan", "map", "range", "loop",
]);

// 常见内置/标准库符号（着色为「内置」一档，区别于普通类型）。
const BUILTINS = new Set([
  "console", "print", "println", "fmt", "vec", "String", "Number", "Boolean", "Array",
  "Object", "Promise", "Result", "Option", "HashMap", "HashSet", "Vec", "str", "int",
  "float", "bool", "string", "list", "dict", "set", "tuple", "Math", "JSON", "require",
  "process", "window", "document", "fs", "os", "sys", "std", "stdin", "stdout", "stderr",
  "None", "True", "False", "null", "true", "false", "undefined", "nil", "self", "Self",
]);

const COLORS = {
  dark: {
    keyword: "#569CD6",
    string: "#CE9178",
    comment: "#6A9955",
    number: "#B5CEA8",
    type: "#4EC9B0",
    builtin: "#4FC1FF",
    function: "#DCDCAA",
  },
  light: {
    keyword: "#0000FF",
    string: "#A31515",
    comment: "#008000",
    number: "#098658",
    type: "#267F99",
    builtin: "#0070C1",
    function: "#795E26",
  },
};

function buildRe(lang: string): RegExp {
  const hashComment = HASH_COMMENT_LANGS.has(lang.toLowerCase()) ? "|(#[^\\n]*)" : "";
  // 各组顺序即优先级：块注释 > 行注释 // > 行注释 # > 字符串 > 数字 > 标识符 > 空白 > 其他
  const src = [
    "(\\/\\*[\\s\\S]*?\\*\\/)", // 1 块注释
    "(\\/\\/[^\\n]*)", // 2 行注释 //
    hashComment, // 3 行注释 #（条件）
    "(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`)", // 4 字符串
    "(\\b0x[0-9a-fA-F]+\\b|\\b\\d+\\.?\\d*(?:[eE][+-]?\\d+)?\\b)", // 5 数字
    "([A-Za-z_$][A-Za-z0-9_$]*)", // 6 标识符
    "(\\s+)", // 7 空白
    "([\\s\\S])", // 8 其他（标点等）
  ]
    .filter(Boolean)
    .join("|");
  return new RegExp(src, "g");
}

function tokenize(code: string, lang: string): Tok[] {
  const re = buildRe(lang);
  const toks: Tok[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const full = m[0];
    const block = m[1];
    const line = m[2];
    const hash = m[3];
    const str = m[4];
    const num = m[5];
    const ident = m[6];
    const ws = m[7];
    const other = m[8];
    if (ws !== undefined) {
      toks.push({ text: ws, cls: "plain" });
    } else if (block !== undefined) {
      toks.push({ text: block, cls: "comment" });
    } else if (line !== undefined) {
      toks.push({ text: line, cls: "comment" });
    } else if (hash !== undefined) {
      toks.push({ text: hash, cls: "comment" });
    } else if (str !== undefined) {
      toks.push({ text: str, cls: "string" });
    } else if (num !== undefined) {
      toks.push({ text: num, cls: "number" });
    } else if (ident !== undefined) {
      let cls: TokCls = "plain";
      if (KEYWORDS.has(ident)) cls = "keyword";
      else if (BUILTINS.has(ident)) cls = "builtin";
      else if (/^[A-Z]/.test(ident)) cls = "type";
      // 函数调用：紧随其后的非空白字符是 `(` → 着函数为色（定义/调用一并着色，VS Code 同款）
      const after = code.slice(re.lastIndex);
      if (/^\s*\(/.test(after)) cls = "function";
      toks.push({ text: ident, cls });
    } else if (other !== undefined) {
      toks.push({ text: other, cls: "plain" });
    } else {
      toks.push({ text: full, cls: "plain" });
    }
    // 安全兜底：正则吞不掉时推进，避免死循环
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return toks;
}

/**
 * 把代码着色为 React 节点数组，供 <pre> 内联渲染。
 * 无 innerHTML、无依赖；空白与换行原样保留（依赖外层 <pre> 的 white-space:pre）。
 */
export function highlightCode(code: string, lang: string, dark: boolean): React.ReactNode {
  const toks = tokenize(code, lang);
  const palette = dark ? COLORS.dark : COLORS.light;
  return toks.map((t, i) =>
    t.cls === "plain" ? (
      <React.Fragment key={i}>{t.text}</React.Fragment>
    ) : (
      <span key={i} style={{ color: palette[t.cls] }}>
        {t.text}
      </span>
    )
  );
}
