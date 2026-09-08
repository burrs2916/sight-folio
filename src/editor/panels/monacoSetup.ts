// project-sight: Monaco 装配（懒加载，独立分包）
//
// 这是 monaco-editor 与 @monaco-editor/react 的唯一入口：
// - 把 monaco + worker + loader.config 集中在这里，让 vite 把整个编辑器内核
//   打成独立 chunk，只有 `ensureMonaco()` 被调用时才加载（不伤 1.5s 首屏）。
// - 本模块被 MonacoCodeEditor 的 React.lazy 间接引用，天然懒加载。

import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
// monaco-editor 0.52+ ESM-only：package.json exports 把 `./*` 映射到 esm/vs/*.js，
// worker 入口写 `monaco-editor/editor/...`（exports 自动补 esm/vs 前缀）。
// `?worker` query 让 vite 按 worker 打包。
import EditorWorker from "monaco-editor/editor/editor.worker.start?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

// Rust Monarch 语法（覆盖内置）：defaultToken 置空，未知 token 不着色（不标红）。
// 覆盖现代 Rust 主要构造：注释 / 属性 `#[..]` / 原始·字节·普通字符串 / 字符字面量 /
// 生命周期 `'a` / 数字（含 0x/0o/0b/浮点·后缀）/ 标识符·关键字·宏 `foo!` / 运算符·括号。
const rustGrammar: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".rs",
  brackets: [
    { open: "{", close: "}", token: "@brackets" },
    { open: "[", close: "]", token: "@brackets" },
    { open: "(", close: ")", token: "@brackets" },
  ],
  keywords: [
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum",
    "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move",
    "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true",
    "try", "type", "unsafe", "use", "where", "while", "union", "abstract", "become", "box", "do",
    "final", "macro", "macro_rules", "override", "priv", "typeof", "unsized", "virtual", "yield",
  ],
  typeKeywords: [
    "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize",
    "f32", "f64", "bool", "char", "str", "String", "Vec", "Option", "Result", "Box", "Rc", "Arc",
  ],
  operators: [
    "=", ">", "<", "!", "~", "?", "::", ":", "==", "<=", ">=", "!=", "&&", "||", "++", "--",
    "+", "-", "*", "/", "&", "|", "^", "%", "<<", ">>", "+=", "-=", "*=", "/=", "&=", "|=",
    "^=", "%=", "<<=", ">>=", "->", "=>", "..", "...", "..=",
  ],
  symbols: /[=><!~?:&|+\-*/^%.]+/,
  escapes: /\\(?:[abfnrtv0\\"']|x[0-9A-Fa-f]{1,2}|u\{[0-9A-Fa-f]+\}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  tokenizer: {
    root: [
      // 属性：#[derive(..)] / #![allow(..)]
      [/#!?\[/, "annotation"],
      // 注释
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"],
      // 原始字符串 r".." / r#".."# / r##".."##
      [/r#*"/, "string", "@rawstring"],
      // 字节原始字符串 br".." / br#".."#
      [/br#*"/, "string", "@rawstring"],
      // 普通 / 字节字符串
      [/b?"/, "string", "@string"],
      // 字节字符字面量 b'x'
      [/b'(\\.|[^'\\])'/, "string"],
      // 字符字面量 'x'
      [/'(\\.|[^'\\])'/, "string"],
      // 生命周期 'a / 'static / '_
      [/'[a-zA-Z_]\w*/, "type"],
      // 数字（含进制 / 浮点 / 后缀）
      { include: "@numbers" },
      // 标识符 / 关键字 / 宏 foo!
      [
        /[a-zA-Z_]\w*!?/,
        {
          cases: {
            "@keywords": "keyword",
            "@typeKeywords": "keyword.type",
            "@default": "identifier",
          },
        },
      ],
      // 分隔符与括号
      [/[{}()\[\]<>]/, "@brackets"],
      [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
      // 空白
      [/\s+/, "white"],
    ],
    comment: [
      [/[^\/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, "string", "@pop"],
    ],
    rawstring: [
      [/[^\"]+/, "string"],
      [/"/, "string", "@pop"],
    ],
    numbers: [
      [/(0x[0-9A-Fa-f_]+)([uif](?:8|16|32|64|128|size))?/, "number.hex"],
      [/(0o[0-7_]+)([uif](?:8|16|32|64|128|size))?/, "number.octal"],
      [/(0b[01_]+)([uif](?:8|16|32|64|128|size))?/, "number.binary"],
      [/\d[\d_]*(\.\d[\d_]*)?(?:[eE][-+]?\d[\d_]*)?(?:[fF](?:32|64))?/, "number.float"],
      [/\d[\d_]*(?:[uif](?:8|16|32|64|128|size))?/, "number"],
    ],
  },
};


// ─── 自定义语言语法（Monaco 无内置 grammar 的语言）───
// monaco 内置 basic-languages 已覆盖 ts/js/py/go/rust/java/kotlin/dart/objc/graphql/... 等，
// 但 groovy / latex / makefile 不在其列 → 归一到 plaintext 无高亮。此处补 Monarch 语法。
// 注意：monacoLanguageOf 已把 tex→latex、groovy→groovy、makefile→makefile，与下列 id 对应。
//
// ★ Rust 特例（v2.27 修复「编译正常但代码爆红」）：
// Monaco 内置 rust 语法把 `defaultToken` 写死成 "invalid"，凡是它没匹配到的合法 Rust
// 构造（属性 `#[...]`、生命周期 `'a`、turbofish `::<T>`、`?` 运算符、宏 `foo!`、原始字符串等）
// 都会被染成红色 —— 而 Rust 编译明明通过。本项目编辑器零 `setModelMarkers` 调用，
// 故「爆红」纯属着色误判。此处 force 覆盖内置 rust 语法，并把 defaultToken 置空：
// 未匹配的 token 一律不着色（而非标红），从根本上消除误报红。
function registerCustomLanguages(m: typeof monaco) {
  const registered = new Set(m.languages.getLanguages().map((l) => l.id));
  const add = (id: string, monarch: monaco.languages.IMonarchLanguage, force = false) => {
    if (registered.has(id) && !force) return;
    if (!registered.has(id)) m.languages.register({ id });
    m.languages.setMonarchTokensProvider(id, monarch);
    registered.add(id);
  };

  // Rust（覆盖内置粗糙语法）：defaultToken 置空，未匹配 token 不着色而非标红
  add("rust", rustGrammar, true);

  // Makefile：目标 / 变量 / 指令 / 注释 / recipe（tab 缩进行）
  add("makefile", {
    defaultToken: "",
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/\$\(\s*[\w.\-\/]+\s*\)/, "variable"],
        [/\$\{[\w.\-\/]+\}/, "variable"],
        [
          /\b(ifdef|ifndef|ifeq|ifneq|else|endif|include|sinclude|-include|define|endef|export|unexport|override|vpath)\b/,
          "keyword",
        ],
        [/^\s*[\w.\-\/]+\s*(\+|:|\?)?=/, "variable"],
        [/^[ \t]*[\w.\-\/%]+:(\s|$)/, "type"],
        [/^\t.*$/, "string"],
      ],
    },
  });

  // LaTeX：注释 / 命令 / 环境 / 数学
  add("latex", {
    defaultToken: "",
    tokenizer: {
      root: [
        [/%.*$/, "comment"],
        [/\\begin\{[^}]*\}/, "keyword"],
        [/\\end\{[^}]*\}/, "keyword"],
        [/\\[a-zA-Z]+/, "keyword"],
        [/\\./, "keyword"],
        [/\$\$/, "string", "@math"],
        [/\$[^$]*\$/, "string"],
      ],
      math: [
        [/\$\$/, "string", "@pop"],
        [/./, "string"],
      ],
    },
  });

  // Groovy：类 Java 语法（关键字 / 字符串 / 数字 / 注释 / 注解）
  add("groovy", {
    defaultToken: "",
    keywords: [
      "abstract", "as", "assert", "boolean", "break", "byte", "case", "catch", "char", "class",
      "const", "continue", "def", "default", "do", "double", "else", "enum", "extends", "false",
      "final", "finally", "float", "for", "if", "implements", "import", "in", "int", "interface",
      "long", "native", "new", "null", "package", "private", "protected", "public", "return",
      "short", "static", "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
      "transient", "true", "try", "void", "volatile", "while",
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/@[A-Za-z_]\w*/, "annotation"],
        [/"""/, "string", "@triple"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'(\\.|[^'\\])*'/, "string"],
        [/\b\d+(\.\d+)?([fFdDlLgGsSbB])?\b/, "number"],
        [
          /[a-zA-Z_$][\w$]*/,
          { cases: { "@keywords": "keyword", "@default": "identifier" } },
        ],
        [/[{()\[\].;,:?+\-*/%=&|<>!~^]/, "delimiter"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
      triple: [
        [/"""/, "string", "@pop"],
        [/./, "string"],
      ],
    },
  });
}

registerCustomLanguages(monaco);

export { monaco };
export { loader };
