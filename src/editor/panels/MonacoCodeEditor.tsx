// sight-folio: Monaco 代码编辑器（懒加载）
//
// 设计（R46 IDE 基础层）：
// - 默认查看器保持轻量只读视图（零依赖、首屏安全）；
// - 用户点「编辑」时才动态 import Monaco（约 6MB，含 TS/JS 语言服务），
//   获得完整 IDE 能力：语法高亮、错误波浪线、编辑、后续补全/跳转的基础。
// - React.lazy + 独立 monacoSetup 分包：编辑器内核与主包彻底分离，不伤 1.5s 首屏。
//
// 注意：本文件顶部**绝不能静态 import monaco-editor**（会把 6MB 拖进主包）。
// monaco 装配（worker/loader.config）在 monacoSetup.ts，由下面懒加载引用。

import { lazy, Suspense, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { t } from "../../i18n";
import { useToastStore } from "../../store/toastStore";
import type { SourceMark } from "../../store/sourceViewerStore";

/** 复杂度热力区间（函数体整块着色，按圈复杂度等级） */
export interface HeatRange {
  startLine: number;
  endLine: number;
  cc: number;
  level: "low" | "medium" | "high" | "extreme";
  name: string;
}

/** 死代码区间（整行灰显） */
export interface DeadRange {
  startLine: number;
  endLine: number;
  name: string;
  reason?: string;
  confidence: string;
}

/** 代码克隆区间（同组同色整块高亮，区分重复片段） */
export interface CloneRange {
  startLine: number;
  endLine: number;
  groupId: string;
  groupSize: number;
  cloneType: string;
  snippet: string;
}

/** 编辑器选区信息（供「选中代码 → AI 诊断」联动使用） */
export interface EditorSelectionInfo {
  /** 选区原文 */
  text: string;
  /** 起始行（1 起） */
  startLine: number;
  /** 终止行（1 起） */
  endLine: number;
}

// Monaco 语言 id 映射复用统一语言模块（短码 / 别名 / 全名 → monaco 内置 language id）
import { monacoLanguageOf } from "../../utils/languageMeta";
// 实时诊断（VS Code 式「修复此错误」的数据源）：编辑器写入、AI 面板读取，同一 webview 内共享。
import type { EditorDiagnostic } from "../../store/editorDiagnosticsStore";

/** 行内洞察（SourceMark）的视觉样式：沟槽图标 + 整行淡背景 + overview 标尺 */
const SEVERITY_RGB: Record<SourceMark["severity"], string> = {
  error: "#f85149",
  warning: "#d29922",
  info: "#58a6ff",
  debt: "#bc8cff",
  symbol: "#39c5cf",
};

/** 克隆块调色板：同组同色，跨文件一致；与 severity / heat 配色刻意区分 */
const CLONE_RGB = ["#a371f7", "#1f9bcf", "#e3686d", "#5fb37a", "#d99b3c", "#6c8ae0", "#c76bb0", "#4fb0a5"];
/** 由 groupId 稳定取色（同组跨文件恒同色），避免每次渲染抖动 */
function cloneColorIndex(groupId: string): number {
  let h = 0;
  for (let i = 0; i < groupId.length; i++) h = (h * 31 + groupId.charCodeAt(i)) >>> 0;
  return h % CLONE_RGB.length;
}

let _markStylesInjected = false;
function ensureMarkStyles() {
  if (_markStylesInjected || typeof document === "undefined") return;
  _markStylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .ps-line-error { background: rgba(248,81,73,0.10); }
    .ps-line-warning { background: rgba(210,153,34,0.12); }
    .ps-line-info { background: rgba(88,166,255,0.08); }
    .ps-line-debt { background: rgba(188,140,255,0.12); }
    .ps-line-symbol { background: rgba(57,197,207,0.08); }
    .ps-glyph { font-size: 11px; font-weight: 700; line-height: 20px; text-align: center; }
    .ps-glyph-error::before { content: "✕"; color: #f85149; }
    .ps-glyph-warning::before { content: "!"; color: #d29922; }
    .ps-glyph-info::before { content: "i"; color: #58a6ff; }
    .ps-glyph-debt::before { content: "$"; color: #bc8cff; }
    .ps-glyph-symbol::before { content: "#"; color: #39c5cf; }
    .ps-heat-low { box-shadow: inset 3px 0 0 #3fb950; }
    .ps-heat-medium { box-shadow: inset 3px 0 0 #d29922; }
    .ps-heat-high { box-shadow: inset 3px 0 0 #db6d28; }
    .ps-heat-extreme { box-shadow: inset 3px 0 0 #f85149; }
    .ps-dead { background: rgba(139,148,158,0.16) !important; }
    .ps-clone-0 { background: rgba(163,113,247,0.14); }
    .ps-clone-1 { background: rgba(31,155,207,0.14); }
    .ps-clone-2 { background: rgba(227,104,109,0.14); }
    .ps-clone-3 { background: rgba(95,179,122,0.14); }
    .ps-clone-4 { background: rgba(217,155,60,0.14); }
    .ps-clone-5 { background: rgba(108,138,224,0.14); }
    .ps-clone-6 { background: rgba(199,107,176,0.14); }
    .ps-clone-7 { background: rgba(79,176,165,0.14); }
    /* AI 内联改动预览：红删绿加（Copilot Edits / Cursor 式），左条区分新增/删除 */
    .ps-edit-added { background: rgba(63,185,80,0.16); box-shadow: inset 3px 0 0 #3fb950; }
    .ps-edit-removed { background: rgba(248,81,73,0.14); box-shadow: inset 3px 0 0 #f85149; text-decoration: line-through rgba(248,81,73,0.6); }
    .cw-goto-underline { text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; cursor: pointer; }
    /* 编辑器书签：沟槽琥珀金圆点（对标 Zed BookmarkStore gutter 标记；与诊断标记同列但 class 独立） */
    .ps-bookmark-glyph { font-size: 12px; line-height: 20px; text-align: center; cursor: pointer; }
    .ps-bookmark-glyph::before { content: "\\25CF"; color: #EF9F27; }
  `;
  document.head.appendChild(style);
}

// 懒加载 Monaco 编辑器组件：
// 1) 先 import monacoSetup（装配 worker + loader.config）
// 2) 再 import @monaco-editor/react 的 Editor
// 两个 import 同属一个 chunk，编辑器内核只在编辑模式首次打开时加载。
const MonacoEditorLazy = lazy(async () => {
  await import("./monacoSetup");
  const m = await import("@monaco-editor/react");
  return { default: m.Editor };
});

/** 命令式句柄：供工作台 AI 面板的「插入光标」「应用到文件」调用（diff 预览在 WorkbenchAiPanel 内闭环） */
export interface MonacoEditorHandle {
  /** 在光标处插入文本（替换选中区）；可撤销 */
  insertAtCursor: (text: string) => void;
  /** 当前光标行（1 起） */
  getCursorLine: () => number | null;
  /** 当前光标位置（行/列，1 起） */
  getCursorPosition: () => { line: number; column: number } | null;
  /** 当前文档总行数 */
  getLineCount: () => number | null;
  /** 当前文档全文 */
  getValue: () => string;
  /** 滚动并定位到指定行 */
  revealLine: (line: number) => void;
  /** 跳转到指定行:列（用于「转到行」面板），居中并落光标 */
  gotoLineColumn: (line: number, column?: number) => void;
  /** 实时预览高亮某一行（「转到行」面板随输入滚动+高亮，不改动光标） */
  previewLine: (line: number) => void;
  /** 清除「转到行」的预览高亮 */
  clearLinePreview: () => void;
  /** 预览 AI 的内联改动：在当前编辑器内以红/绿差异展示，待用户确认后再真正保留（Copilot Edits / Cursor 式） */
  previewInlineEdit: (spec: { startLine: number; endLine: number; newText: string }) => void;
  /** 确认保留内联改动（删除被替换的旧行，绿行留下）；可撤销 */
  acceptInlineEdit: () => void;
  /** 放弃内联改动（删除插入的绿行，旧行保留）；可撤销 */
  rejectInlineEdit: () => void;
  /** 静默清掉进行中的内联预览（切文件 / 关面板时调用，避免装饰悬空） */
  clearInlineEdit: () => void;
  /** 当前选区的视口坐标（CSS 像素，相对窗口）：用于把内联聊天浮窗锚定到选区上方。无选区返回 null */
  getSelectionAnchor: () => { top: number; left: number; height: number } | null;
  /** 编辑器 DOM 节点的视口矩形：无选区时作为浮窗回退锚点 */
  getEditorRect: () => { top: number; left: number; right: number; bottom: number; width: number; height: number } | null;
  /** 切换行尾符 LF ↔ CRLF（对标 Zed LineEndingIndicator，可撤销，落盘经既有自动保存链路） */
  toggleEol: () => void;
  /** 当前光标处的词（无则 null）：供命令面板「重命名符号」取词 */
  getWordAtCursor: () => string | null;
  /** 在光标上方插入一个光标（多光标编辑，对标 Zed AddSelectionAbove；原生键 Ctrl/Cmd+Alt+↑） */
  addSelectionAbove: () => void;
  /** 在光标下方插入一个光标（多光标编辑，对标 Zed AddSelectionBelow；原生键 Ctrl/Cmd+Alt+↓） */
  addSelectionBelow: () => void;
  /** 选中当前选区文本的全部出现位置（多光标，对标 Zed SelectAllMatches；Ctrl/Cmd+Shift+L） */
  selectAllMatches: () => void;
  /** 增量加入下一个匹配选区（对标 Zed editor::SelectNext；VS Code Ctrl/Cmd+D 逐个添加，区别于 selectAllMatches 一次性全选） */
  addSelectionToNextMatch: () => void;
  /** 增量加入上一个匹配选区（对标 Zed editor::SelectPrevious；VS Code Ctrl/Cmd+Shift+D 反向逐个添加） */
  addSelectionToPreviousMatch: () => void;
  /** 按语法向后扩展选区（对标 Zed SelectLargerSyntaxNode；原生键 Shift+Alt+→）：扩大一级语法节点 */
  expandSelection: () => void;
  /** 按语法向前收缩选区（对标 Zed SelectSmallerSyntaxNode；原生键 Shift+Alt+←）：回退一级语法节点 */
  shrinkSelection: () => void;
  /** 切换列选择模式（对标 Zed ColumnarSelection；开启后按住 Alt 拖拽可选矩形块） */
  toggleColumnSelection: () => void;
  /** 增大编辑器字号（对标 Zed IncreaseBufferFontSize：+1px，钳制 [6,100]，跨会话持久化） */
  increaseFont: () => void;
  /** 减小编辑器字号（对标 Zed DecreaseBufferFontSize：-1px，钳制 [6,100]，跨会话持久化） */
  decreaseFont: () => void;
  /** 重置编辑器字号到应用默认（对标 Zed ResetBufferFontSize：恢复默认 13px） */
  resetFont: () => void;
  /** 跳转到下一个诊断（对标 Zed editor::GoToDiagnostic / f8）：循环遍历 Monaco 标记，选中范围、居中并聚焦 */
  goToNextProblem: () => void;
  /** 跳转到上一个诊断（对标 Zed editor::GoToPrevDiagnostic / shift+f8）：反向循环 */
  goToPrevProblem: () => void;
  /** 切换行注释（对标 Zed ToggleComments；原生键 Ctrl/Cmd+/） */
  toggleLineComment: () => void;
  /** 切换块注释（对标 Zed ToggleBlockComments；原生键 Shift+Alt+A） */
  toggleBlockComment: () => void;
  /** 格式化文档（对标 Zed Format；原生键 Shift+Alt+F；依赖语言格式化器，TS/JS 由 Monaco worker 提供） */
  formatDocument: () => void;
  /** 向下复制行/选区（对标 Zed DuplicateLine；原生键 Shift+Alt+↓） */
  duplicateLine: () => void;
  /** 上移行（对标 Zed MoveLineUp；原生键 Alt+↑） */
  moveLineUp: () => void;
  /** 下移行（对标 Zed MoveLineDown；原生键 Alt+↓） */
  moveLineDown: () => void;
  /** 合并行（对标 Zed JoinLines；原生键 Ctrl/Cmd+J） */
  joinLines: () => void;
  /** 删除当前行 / 选中行（对标 Zed editor::DeleteLine；原生键 Ctrl/Cmd+Shift+K 同源；保留光标列、正确处理行尾换行） */
  deleteLine: () => void;
  /** 在光标上方插入空行（对标 Zed editor::InsertNewlineAbove）：光标留在原行，快速加空行不破坏当前行 */
  insertLineAbove: () => void;
  /** 在光标下方插入空行（对标 Zed editor::InsertNewlineBelow） */
  insertLineBelow: () => void;
  /** 交换光标左右字符（对标 Zed editor::Transpose）：按字符（非 UTF-16 码元）交换，emoji/代理对安全；行尾交换末两字符；多光标逐段；选区非空跳过 */
  transpose: () => void;
  /** 跳到匹配括号（对标 Zed GoToMatchingBracket；原生键 Ctrl/Cmd+Shift+\） */
  goToMatchingBracket: () => void;
  /** 跳到包围光标的最内层括号（对标 Zed MoveToEnclosingBracket；与 goToMatchingBracket 区分：后者仅当光标在括号上时跳其匹配括号，本命令始终移动到包含光标的最近括号对） */
  moveToEnclosingBracket: () => void;
  /** 选中包围光标的最内层括号对（含括号本身；复用 Monaco 内建 selectToBracket，对标编辑器「选中到括号」能力） */
  selectToEnclosingBracket: () => void;
  /** 选区/光标处单词转为大写（对标 Zed ConvertToUpperCase） */
  convertToUpper: () => void;
  /** 转为小写（对标 Zed ConvertToLowerCase） */
  convertToLower: () => void;
  /** 转为 Title Case（对标 Zed ConvertToTitleCase） */
  convertToTitle: () => void;
  /** 转为 snake_case（对标 Zed ConvertToSnakeCase） */
  convertToSnake: () => void;
  /** 转为 kebab-case（对标 Zed ConvertToKebabCase） */
  convertToKebab: () => void;
  /** 转为 PascalCase（对标 Zed ConvertToUpperCamelCase） */
  convertToPascal: () => void;
  /** 转为 camelCase（对标 Zed ConvertToLowerCamelCase） */
  convertToCamel: () => void;
  /** 转为 Sentence case（对标 Zed ConvertToSentenceCase） */
  convertToSentence: () => void;
  /** 程序化滚动到指定比例（0~1，供窗格同步滚动调用）；内部抑制回声，不会反向触发 onScroll */
  setScrollRatio: (ratio: number) => void;
  /** 退出多光标编辑（保留主光标，移除其余辅助光标；原生键 Escape 同源；点击状态栏「多光标」徽标触发） */
  exitMultiCursor: () => void;
  /** 折叠光标处区域（对标 Zed editor::Fold，原生键 Ctrl/Cmd+Shift+[） */
  foldAtCursor: () => void;
  /** 展开光标处区域（对标 Zed editor::UnfoldLines，原生键 Ctrl/Cmd+Shift+]） */
  unfoldAtCursor: () => void;
  /** 切换光标处折叠（对标 Zed editor::ToggleFold，原生键 Ctrl/Cmd+K Ctrl+L） */
  toggleFoldAtCursor: () => void;
  /** 递归折叠光标处（对标 Zed editor::FoldRecursive，原生键 Ctrl/Cmd+K Ctrl+[） */
  foldRecursively: () => void;
  /** 递归展开光标处（对标 Zed editor::UnfoldRecursive，原生键 Ctrl/Cmd+K Ctrl+]） */
  unfoldRecursively: () => void;
  /** 折叠全部（对标 Zed editor::FoldAll，原生键 Ctrl/Cmd+K Ctrl+0） */
  foldAll: () => void;
  /** 展开全部（对标 Zed editor::UnfoldAll，原生键 Ctrl/Cmd+K Ctrl+J） */
  unfoldAll: () => void;
  /** 折叠所选区域（对标 Zed editor::FoldSelectedRanges，原生键 Ctrl/Cmd+K Ctrl+,） */
  foldSelection: () => void;
  /** 折叠到第 N 级（1~7，对标 Zed editor::FoldAtLevel_1..7；Monaco 原生 editor.foldLevel1..7） */
  foldLevel: (level: number) => void;
  /** 切换软换行（对标 Zed editor::ToggleSoftWrap，原生键 Alt+Z） */
  toggleWordWrap: () => void;
  /** 折叠当前文件全部函数/方法/类/结构体等声明体（对标 Zed editor::FoldFunctionBodies，L359） */
  foldFunctionBodies: () => void;
  /** 跳转到光标处符号的定义（复用右键「转到定义」的增强选择器，对标 Zed GoToDefinition；原生键 F12） */
  goToDefinition: () => void;
  /** 查找光标处符号的所有引用（复用右键「查找所有引用」面板，对标 Zed FindAllReferences；原生键 Shift+F12） */
  findReferences: () => void;
  /** 内联 Peek 定义预览（对标 VS Code Peek Definition；Zed 无此能力，我们自建浮层）。Alt+F12 / 右键触发 */
  peekDefinition: () => void;
  /** 跳转到类型定义（原生 Monaco action，对标 Zed GoToTypeDefinition） */
  goToTypeDefinition: () => void;
  /** 跳转到实现（原生 Monaco action，对标 Zed GoToImplementation） */
  goToImplementation: () => void;
  /** 跳转到声明（原生 Monaco action，对标 Zed GoToDeclaration） */
  goToDeclaration: () => void;
  /** 把浏览器 DOM 焦点移交给本编辑器（窗格方向导航后立即可键入，对标 Zed activate_pane_in_direction 末尾 focus 编辑器） */
  focus: () => void;
  /** 切换当前光标行的书签（对标 Zed ToggleBookmark：光标所在行增/删书签，幂等） */
  toggleBookmark: () => void;
  /** 跳到当前文件内下一书签（含回绕，对标 Zed GoToNextBookmark） */
  goToNextBookmark: () => void;
  /** 跳到当前文件内上一书签（含回绕，对标 Zed GoToPreviousBookmark） */
  goToPrevBookmark: () => void;
  /** 排序选中行（忽略大小写，对标 Zed SortLinesCaseInsensitive）：每个连续选区块独立排序；无任何选区时排序整份文件 */
  sortLinesCI: () => void;
  /** 排序选中行（区分大小写，对标 Zed SortLinesCaseSensitive） */
  sortLinesCS: () => void;
  /** 按行长度排序选中行（对标 Zed SortLinesByLength） */
  sortLinesLen: () => void;
  /** 去除重复行（忽略大小写，保留首次出现，对标 Zed UniqueLinesCaseInsensitive） */
  uniqueLinesCI: () => void;
  /** 去除重复行（区分大小写，保留首次出现，对标 Zed UniqueLinesCaseSensitive） */
  uniqueLinesCS: () => void;
  /** 缩进选区/当前行（对标 Zed editor::Indent：按 tab_size 推进一步缩进，保留选区；原生键 Tab） */
  indentSelection: () => void;
  /** 取消缩进选区/当前行（对标 Zed editor::Outdent：回退一步缩进，保留选区；原生键 Shift+Tab） */
  outdentSelection: () => void;
  /** 向上复制行/选区（对标 Zed DuplicateLineUp：复制光标所在行到上方，保留光标） */
  duplicateLineUp: () => void;
  /** 左移一个词（对标 Zed editor::MoveWordLeft / Movement::PreviousWordStart：光标移到前一个词首） */
  moveWordLeft: () => void;
  /** 右移一个词（对标 Zed editor::MoveWordRight / Movement::NextWordEnd：光标移到后一个词尾） */
  moveWordRight: () => void;
  /** 向左扩选一个词（对标 Zed editor::SelectToPreviousWordStart：选区延伸至前一个词首） */
  selectWordLeft: () => void;
  /** 向右扩选一个词（对标 Zed editor::SelectToNextWordEnd：选区延伸至后一个词尾） */
  selectWordRight: () => void;
  /** 向左删除一个词（对标 Zed editor::DeleteWordLeft / DeleteToPreviousWordStart：删除到前一个词首） */
  deleteWordLeft: () => void;
  /** 向右删除一个词（对标 Zed editor::DeleteWordRight / DeleteToNextWordEnd：删除到后一个词尾） */
  deleteWordRight: () => void;
  /** 左移一个子词（对标 Zed editor::MoveToPreviousSubwordStart：camelCase 边界，光标移到前一个子词首） */
  moveSubwordLeft: () => void;
  /** 右移一个子词（对标 Zed editor::MoveToNextSubwordEnd：camelCase 边界，光标移到后一个子词尾） */
  moveSubwordRight: () => void;
  /** 向左扩选一个子词（对标 Zed editor::SelectToPreviousSubwordStart：选区延伸至前一个子词首，camelCase 边界） */
  selectSubwordLeft: () => void;
  /** 向右扩选一个子词（对标 Zed editor::SelectToNextSubwordEnd：选区延伸至后一个子词尾，camelCase 边界） */
  selectSubwordRight: () => void;
  /** 向左删除一个子词（对标 Zed editor::DeleteToPreviousSubwordStart：camelCase 边界删除到前一个子词首） */
  deleteSubwordLeft: () => void;
  /** 向右删除一个子词（对标 Zed editor::DeleteToNextSubwordEnd：camelCase 边界删除到后一个子词尾） */
  deleteSubwordRight: () => void;
  /** 删除到下一个词首（对标 Zed editor::DeleteToNextWordStart：跳过当前词，删除至后一个词起始处） */
  deleteToNextWordStart: () => void;
  /** 删除到上一个词尾（对标 Zed editor::DeleteToPreviousWordEnd：删除至前一个词结束处） */
  deleteToPreviousWordEnd: () => void;
  /** 光标移到行尾（对标 Zed editor::MoveToEndOfLine：stop_at_soft_wraps=false → 真实行尾） */
  moveToEndOfLine: () => void;
  /** 光标移到行首（对标 Zed editor::MoveToStartOfLine：真实行首 column 0） */
  moveToStartOfLine: () => void;
  /** 删除光标到行尾（对标 Zed editor::DeleteToEndOfLine：select_to_end_of_line → delete） */
  deleteToEndOfLine: () => void;
  /** 删除行首到光标（对标 Zed editor::DeleteToStartOfLine：select_to_start_of_line → delete） */
  deleteToStartOfLine: () => void;
  /** 剪切光标到行尾（对标 Zed editor::CutToEndOfLine：select_to_end_of_line → cut 到剪贴板） */
  cutToEndOfLine: () => void;
  /** 剪切行首到光标（对标 Zed editor::CutToStartOfLine：select_to_start_of_line → cut 到剪贴板） */
  cutToStartOfLine: () => void;
}

/** 编辑器光标/选区状态（对标 Zed crates/go_to_line/src/cursor_position.rs 的 UserCaretPosition + SelectionStats）。
 *  - line/column 为 1 起的当前光标位置（与「转到行」口径一致）；
 *  - selections 为选区数量（多光标），selectedLines/selectedChars 为选区统计。 */
export interface CursorStatus {
  /** 当前光标行（1 起） */
  line: number;
  /** 当前光标列（1 起，Monaco UTF-16 列，与「转到行」口径一致） */
  column: number;
  /** 选区数量（多光标） */
  selections: number;
  /** 选区跨越的行数（单点空选区为 0） */
  selectedLines: number;
  /** 选区字符数（UTF-16 code units，与 Monaco 选区 API 一致） */
  selectedChars: number;
}

/** 编辑器诊断计数（状态栏「问题」指示项，对标 Zed 状态栏的 Errors/Warnings 聚合）。
 *  - errors 为 Error 级标记数，warnings 为 Warning 级标记数；
 *  - 仅统计当前模型（活动文件），等价 Zed 状态栏只反映当前缓冲区诊断的口径。 */
export interface MarkerStats {
  /** Error 级标记数量 */
  errors: number;
  /** Warning 级标记数量 */
  warnings: number;
}

/** 编辑器文档信息（状态栏右侧簇：对标 Zed ActiveBufferLanguage / LineEndingIndicator / ActiveBufferEncoding）。
 * 目前暴露行尾符（LF/CRLF），由 Monaco model 的 getEOL() 实时推导；语言/编码由外壳从文件元数据提供。 */
export interface EditorInfo {
  /** 行尾符：LF(\n) 或 CRLF(\r\n) */
  eol: "LF" | "CRLF";
}

export interface MonacoCodeEditorProps {
  /** 源码文本（初始值） */
  value: string;
  /** 语言（前端插件语言，内部映射 monaco id） */
  language?: string | null;
  /** 主题（light/dark） */
  theme: "light" | "dark";
  /** 变更回调 */
  onChange?: (value: string | undefined) => void;
  /** 编辑器滚动比例变化回调（0~1，用户滚动时触发，供窗格同步滚动用）。程序化滚动（setScrollRatio）引发的变化不会触发，避免回声死循环。 */
  onScroll?: (ratio: number) => void;
  /** 只读（查看模式） */
  readOnly?: boolean;
  /** 初始滚动定位行（1 起） */
  revealLine?: number | null;
  /** 初始滚动定位列（1 起，配合 revealLine 实现「:行:列」精确落点） */
  revealColumn?: number | null;
  /** 行内洞察标记（技术债 / 审查发现 / 符号定义），叠加在代码左侧沟槽与整行背景 */
  marks?: SourceMark[];
  /** 复杂度热力区间（函数体整块左侧色条） */
  heatRanges?: HeatRange[];
  /** 死代码区间（整行灰显） */
  deadRanges?: DeadRange[];
  /** 代码克隆区间（同组同色整块高亮） */
  cloneRanges?: CloneRange[];
  /** 选区变化回调（选中文本非空时回调选区信息，否则 null） */
  onSelectionChange?: (sel: EditorSelectionInfo | null) => void;
  /** 跳转到定义（双击符号名时回调，供跨文件符号导航消费） */
  onGoToDefinition?: (info: { word: string; line: number; column: number }) => void;
  /** 在编辑器内查找符号的所有引用（右键菜单触发，供跨文件引用面板消费） */
  onFindReferences?: (word: string) => void;
  /** 内联 Peek 定义预览（右键 / Alt+F12 触发）。回传光标屏幕锚点（取不到则 null，由上层置中渲染），供浮层定位。 */
  onPeekDefinition?: (info: { word: string; line: number; column: number; anchor: { x: number; y: number } | null }) => void;
  /** 右键菜单「AI 诊断此符号」：把光标处符号连同精确行号交给 AI 诊断（差异化增强，对标 Zed 编辑器上下文菜单但接入分析能力） */
  onDiagnoseSymbol?: (info: { word: string; line: number; column: number }) => void;
  /** 重命名符号（右键菜单 / F2 触发，供跨文件引用重写消费）。对标 Zed editor::Rename（LSP 跨文件事务化改写），
   *  我们侧数据无列精度，故以「符号名 + 行号」定位，在每行按词边界重写。 */
  onRenameSymbol?: (info: { word: string; line: number; column: number }) => void;
  /** 可定位的符号名集合（小写，来自已落库 symbols 分片）；按住 Ctrl/⌘ 悬停其上显示下划线 */
  gotoSymbols?: string[];
  /** 实时诊断回调（VS Code 式「修复此错误」数据源）：编辑器内语法/类型错误变化时推送 */
  onDiagnosticsChange?: (diags: EditorDiagnostic[]) => void;
  /** 光标/选区状态回传（供外壳状态栏渲染行:列 + 选区统计，对标 Zed CursorPosition 状态栏项） */
  onCursorStatusChange?: (status: CursorStatus) => void;
  /** 诊断计数回传（供外壳状态栏渲染「问题」指示项：N 错误 · M 警告，对标 Zed 状态栏 Problems；
   *  点击即跳转到下一个诊断，与 F8 同源，避免死节点） */
  onMarkerStatsChange?: (stats: MarkerStats) => void;
  /** 编辑器文档信息回传（行尾符 LF/CRLF，对标 Zed LineEndingIndicator 状态栏项） */
  onEditorInfoChange?: (info: EditorInfo) => void;
  /** 列选择模式状态回传（开启后状态栏显示指示项，对标 Zed ColumnarSelection 视觉反馈；点击即关闭） */
  onColumnSelectionChange?: (on: boolean) => void;
  /** 软换行状态回传（开启后状态栏显示指示项，对标 Zed 软换行视觉反馈；点击即切换） */
  onWordWrapChange?: (on: boolean) => void;
  /** 编辑器字号变化回传（供外壳状态栏渲染字号指示 + 持久化，对标 Zed 字号设置在状态栏/设置可见） */
  onFontSizeChange?: (size: number) => void;
  /** 行内审查发现标记（沟槽图标）点击回调：传回 findingId 与点击的 DOM 元素（锚点），
   *  供外壳聚焦审查面板 + 弹出行级行动浮层（AI 诊断 / 复制消息）。 */
  onMarkClick?: (findingId: string, anchorEl: HTMLElement | null) => void;
  /** 当前文件的书签行号集合（来自外壳 store.bookmarks[fileId]，升序）。编辑器据此在沟槽渲染书签标记。
   *  为空数组时不渲染任何书签装饰（零回归）。 */
  bookmarks?: number[];
  /** 沟槽点击切换书签的回调：传回被点击行号（1 起），由外壳写入/移除 store 书签（对标 Zed 沟槽点击 ToggleBookmark）。 */
  onToggleBookmark?: (line: number) => void;
}

/** 编辑器加载占位 */
function EditorFallback() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 1.5,
        bgcolor: (th) => (th.palette.mode === "dark" ? "#0d1117" : "#fafafa"),
      }}
    >
      <CircularProgress size={22} />
      <Typography variant="body2" color="text.secondary">
        {t("viewer.loadingEditor")}
      </Typography>
    </Box>
  );
}

// —— 编辑器字号缩放（对标 Zed IncreaseBufferFontSize / DecreaseBufferFontSize / ResetBufferFontSize）——
// Zed 语义：步长 ±1px，钳制 [6,100]，Reset 恢复主题默认，persist 写入设置文件（跨会话保留）。
// 我们复刻同口径：步长 ±1、钳制一致、Reset 恢复应用默认 13px；变更经 updateOptions 触发
// onDidChangeConfiguration → emitFontSize 回传外壳，并写入 localStorage（对标 Zed persist 跨会话语义）。
const FONT_SIZE_MIN = 6;
const FONT_SIZE_MAX = 100;
const FONT_SIZE_DEFAULT = 13; // 与 options.fontSize 初始值一致

function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return FONT_SIZE_DEFAULT;
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(size)));
}

function readPersistedFontSize(): number | null {
  try {
    const raw =
      typeof localStorage !== "undefined" ? localStorage.getItem("ps.editor.fontSize") : null;
    if (raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return clampFontSize(n);
  } catch {
    return null;
  }
}

function persistFontSize(size: number): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("ps.editor.fontSize", String(clampFontSize(size)));
    }
  } catch {
    /* 持久化异常时静默忽略 */
  }
}

// cbRef 用结构类型（{ current }）以规避 React 命名空间依赖；与 MutableRefObject 结构兼容。
function applyFontSizeDelta(
  ed: any,
  monaco: any,
  delta: number,
  cbRef?: { current: ((size: number) => void) | undefined },
): void {
  if (!ed || !monaco) return;
  const cur = (ed.getOption(monaco.editor.EditorOption.fontSize) as number) ?? FONT_SIZE_DEFAULT;
  const next = clampFontSize(cur + delta);
  ed.updateOptions({ fontSize: next });
  try {
    cbRef?.current?.(next);
  } catch {
    /* 忽略回传异常 */
  }
  persistFontSize(next);
}

function resetFontSize(
  ed: any,
  monaco: any,
  cbRef?: { current: ((size: number) => void) | undefined },
): void {
  if (!ed || !monaco) return;
  ed.updateOptions({ fontSize: FONT_SIZE_DEFAULT });
  try {
    cbRef?.current?.(FONT_SIZE_DEFAULT);
  } catch {
    /* 忽略回传异常 */
  }
  persistFontSize(FONT_SIZE_DEFAULT);
}

/** 跳转到下一个/上一个诊断（对标 Zed editor::GoToDiagnostic / GoToPrevDiagnostic）。
 *  - 取当前模型全部 Monaco 标记（Monaco TS/JS worker 自动产出 squiggle，JS/TS 文件天然有诊断），
 *    按 (行,列,结束行,结束列) 升序排序，方向 dir=1 向下、dir=-1 向上，到达末尾/开头循环回绕（与 Zed 同）。
 *  - 光标若落在某标记范围内，则视为「当前诊断」：F8 跳到下一个、Shift+F8 跳到上一个（对齐 Zed 在激活诊断上再按一次即移动）。
 *  - 选中诊断范围（start→end）并居中聚焦，使问题代码高亮可见；无标记时返回 0（调用方负责提示）。 */
function goToProblem(ed: any, monaco: any, dir: 1 | -1): number {
  if (!ed || !monaco) return 0;
  const model = ed.getModel();
  if (!model) return 0;
  const all = monaco.editor.getModelMarkers({ resource: model.uri }) as any[];
  // Zed 默认 severity 过滤 = { min: hint, max: error }，即全部严重度都参与；这里同样纳入所有标记。
  const markers = all
    .filter((m) => m.severity >= (monaco.MarkerSeverity?.Hint ?? 1))
    .sort(
      (a: any, b: any) =>
        a.startLineNumber - b.startLineNumber ||
        a.startColumn - b.startColumn ||
        a.endLineNumber - b.endLineNumber ||
        a.endColumn - b.endColumn
    );
  if (markers.length === 0) return 0;
  const pos = ed.getPosition();
  const curLine = pos?.lineNumber ?? 1;
  const curCol = pos?.column ?? 1;
  // 定位「包含光标的诊断」下标（若有），F8 在其基础上移动，免得反复停在同一处。
  let containing = -1;
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    if (
      (curLine > m.startLineNumber || (curLine === m.startLineNumber && curCol >= m.startColumn)) &&
      (curLine < m.endLineNumber || (curLine === m.endLineNumber && curCol <= m.endColumn))
    ) {
      containing = i;
      break;
    }
  }
  let idx: number;
  if (dir === 1) {
    if (containing >= 0) idx = (containing + 1) % markers.length;
    else {
      idx = -1;
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        if (m.startLineNumber > curLine || (m.startLineNumber === curLine && m.startColumn > curCol)) {
          idx = i;
          break;
        }
      }
      if (idx === -1) idx = 0;
    }
  } else {
    if (containing >= 0) idx = (containing - 1 + markers.length) % markers.length;
    else {
      idx = -1;
      for (let i = markers.length - 1; i >= 0; i--) {
        const m = markers[i];
        if (m.startLineNumber < curLine || (m.startLineNumber === curLine && m.startColumn < curCol)) {
          idx = i;
          break;
        }
      }
      if (idx === -1) idx = markers.length - 1;
    }
  }
  const target = markers[idx];
  ed.setSelection({
    startLineNumber: target.startLineNumber,
    startColumn: target.startColumn,
    endLineNumber: target.endLineNumber,
    endColumn: target.endColumn,
  });
  ed.revealRangeInCenter(target);
  ed.focus();
  return markers.length;
}

/**
 * 折叠当前文件中所有「函数 / 方法 / 类 / 结构体 / 枚举 / trait / impl / mod」等声明体。
 * 对标 Zed editor::fold_function_bodies（crates/editor/src/fold.rs:359）：Zed 用 Tree-sitter
 * text_object_ranges 过滤 InsideFunction 折叠每个函数体；Monaco 无 tree-sitter，这里用
 * 「声明行识别 + 原生 editor.action.fold（折叠光标处最小可折叠区）」复刻同一意图——
 * 把每个函数/结构体的体折叠成一行，保留签名/声明行可见（与 Zed InsideFunction 口径一致）。
 */
function foldFunctionBodiesImpl(editor: any): void {
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;
  const lang = model.getLanguageId() || "";
  const lines = model.getLinesContent();
  const declLines = detectDeclarationStartLines(lines, lang); // 1-based 行号
  if (declLines.length === 0) return;
  // 保存光标，折叠后复位，避免强干扰用户位置
  const saved = editor.getPosition();
  // 自底向上折叠：先折靠后的声明，再折外层，行为稳定（嵌套折叠互不干扰）
  for (let i = declLines.length - 1; i >= 0; i--) {
    editor.setPosition({ lineNumber: declLines[i], column: 1 });
    editor.trigger("ps-workbench", "editor.action.fold", undefined);
  }
  if (saved) {
    try {
      editor.setPosition(saved);
    } catch {
      /* 忽略 */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 文本大小写转换（对标 Zed ConvertTo* 家族：UpperCase / LowerCase / TitleCase /
// SnakeCase / KebabCase / UpperCamelCase / LowerCamelCase / SentenceCase）
// ─────────────────────────────────────────────────────────────────────────────
// Zed 的 convert_text_case 底层用 convert_case crate（Zed Cargo.toml：convert_case 0.8，
// 由 editor.rs `use convert_case::{Case, Casing}` 引入）。其 `.to_case(case)` 直接用
// `Boundary::defaults()` 边界集切词，再施加 pattern + delim。下面逐字移植该算法，保证
// snake / kebab / camel / pascal / title / sentence 与 Zed 完全一致（含 HTTPRequest→http_request、
// myVarName→my_var_name 等缩写/驼峰处理）：
//   - 边界（consuming，从词中剔除）：下划线 '_'、连字符 '-'、空格 ' '
//   - 边界（non-consuming，在 i+1 处切）：LowerUpper / LowerDigit / UpperDigit /
//     DigitLower / DigitUpper / Acronym（连续两个大写后接小写，如 HTTPRequest → HTTP|Request）
//   - pattern：lowercase / uppercase / capital(首字母大写其余小写) / camel(首词小写其余 capital) /
//     sentence(首词 capital 其余小写)
//   - delim：snake '_' / kebab '-' / title|sentence ' ' / camel|pascal ''
export type ConvertCaseKind =
  | "upper"
  | "lower"
  | "title"
  | "snake"
  | "kebab"
  | "pascal"
  | "camel"
  | "sentence";

function isUpperCh(c: string): boolean {
  return c !== c.toLowerCase() && c === c.toUpperCase();
}
function isLowerCh(c: string): boolean {
  return c !== c.toUpperCase() && c === c.toLowerCase();
}
function isDigitCh(c: string): boolean {
  return c >= "0" && c <= "9";
}
function capitalWord(w: string): string {
  if (!w) return w;
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}

/** 按 convert_case `Boundary::defaults()` 把字符串切为词（分隔符/标点不进入词，与 Zed 一致） */
function splitWords(s: string): string[] {
  const chars = Array.from(s);
  const n = chars.length;
  const words: string[] = [];
  let last = 0;
  for (let i = 0; i < n; i++) {
    const c0 = chars[i];
    const c1 = chars[i + 1];
    const c2 = chars[i + 2];
    let cut = -1; // 词在此索引结束（exclusive）
    const consuming = c0 === "_" || c0 === "-" || c0 === " ";
    if (consuming) {
      cut = i; // 消耗型分隔符：整段剔除
    } else if (c0 && c1) {
      if (isLowerCh(c0) && isUpperCh(c1)) cut = i + 1;
      else if (isLowerCh(c0) && isDigitCh(c1)) cut = i + 1;
      else if (isUpperCh(c0) && isDigitCh(c1)) cut = i + 1;
      else if (isDigitCh(c0) && isLowerCh(c1)) cut = i + 1;
      else if (isDigitCh(c0) && isUpperCh(c1)) cut = i + 1;
      else if (isUpperCh(c0) && isUpperCh(c1) && c2 && isLowerCh(c2)) cut = i + 1;
    }
    if (cut >= 0) {
      const w = s.slice(last, cut);
      if (w) words.push(w);
      // 消耗型分隔符跳过自身（last=cut+1）；non-consuming 在 i+1 处切（last=cut）
      last = consuming ? cut + 1 : cut;
    }
  }
  const tail = s.slice(last);
  if (tail) words.push(tail);
  return words;
}

/** 对标 Zed convert_text_case：逐行保留前导/尾随空白（缩进），仅转换行内文本 */
function convertTextCase(text: string, kind: ConvertCaseKind): string {
  if (!text) return text;
  if (kind === "upper") return text.toUpperCase();
  if (kind === "lower") return text.toLowerCase();
  const delim =
    kind === "snake" ? "_" : kind === "kebab" ? "-" : kind === "title" || kind === "sentence" ? " " : "";
  return text
    .split("\n")
    .map((line) => {
      const lead = line.match(/^\s*/)?.[0] ?? "";
      const trail = line.match(/\s*$/)?.[0] ?? "";
      const mid = line.slice(lead.length, line.length - trail.length);
      if (!mid) return line;
      const words = splitWords(mid);
      const pat = words.map((w, i) => {
        if (kind === "title" || kind === "pascal") return capitalWord(w);
        if (kind === "snake" || kind === "kebab") return w.toLowerCase();
        if (kind === "camel") return i === 0 ? w.toLowerCase() : capitalWord(w);
        if (kind === "sentence") return i === 0 ? capitalWord(w) : w.toLowerCase();
        return w;
      });
      return lead + pat.join(delim) + trail;
    })
    .join("\n");
}

/**
 * 对当前编辑器选区执行大小写转换（对标 Zed manipulate_text）：
 * - 选区为空 → 取光标处单词（surrounding_word 口径），与 Zed 一致；
 * - 多选区逐段转换，每段保留变换后选区（便于连续转换 / 立即可见结果）；
 * - 仅在 newText≠oldText 时写入，单次可撤销（pushEditOperations 合并为一次 undo）；
 * - 只读模型直接跳过（与 Zed read_only 守卫一致）。
 */
function convertSelectionCase(ed: any, monaco: any, kind: ConvertCaseKind): void {
  if (!ed || !monaco) return;
  const model = ed.getModel();
  if (!model || model.isReadonly()) return;
  const sels = ed.getSelections();
  if (!sels || sels.length === 0) return;
  const ops: { range: any; text: string; forceMoveMarkers: true }[] = [];
  const newSels: any[] = [];
  for (const sel of sels) {
    let range = sel;
    if (sel.isEmpty()) {
      const word = model.getWordAtPosition(sel.getStartPosition());
      if (!word) continue;
      range = new monaco.Range(sel.startLineNumber, word.startColumn, sel.startLineNumber, word.endColumn);
    }
    const oldText = model.getValueInRange(range);
    const newText = convertTextCase(oldText, kind);
    if (newText === oldText) continue;
    ops.push({ range, text: newText, forceMoveMarkers: true });
    const lines = newText.split("\n");
    const endLine = range.startLineNumber + lines.length - 1;
    const endCol =
      lines.length === 1 ? range.startColumn + newText.length : lines[lines.length - 1].length + 1;
    newSels.push(new monaco.Selection(range.startLineNumber, range.startColumn, endLine, endCol));
  }
  if (ops.length === 0) return;
  const applied = model.pushEditOperations(sels, ops, () => newSels);
  ed.setSelections(applied && applied.length ? applied : newSels);
  ed.focus();
}

/**
 * 交换光标左右字符（对标 Zed editor::Transpose，语义对齐 zed crates/editor/src/editor_tests.rs::test_transpose）。
 *  - 仅对空选区生效（选区非空跳过，与 Zed 一致：change_selections 内 is_empty 即 return）；
 *  - 按「字符」而非 UTF-16 码元交换（Array.from 切分，emoji/代理对安全，对齐 Zed 用 chars_at 的字符粒度）；
 *  - 行内：交换光标左侧字符与右侧字符，光标右移一个字符（head.column += 1，落点取右侧字符末码元）；
 *  - 行尾（右字符越界，含行尾换行前）：交换末两字符，光标停在行尾；
 *  - 行首（无左字符）跳过；多光标逐段独立处理，单次可撤销（model.pushEditOperations 整体一事务）；
 *  - 刻意的偏差：Zed 在「行首下一行起点」会把换行符与下一字符交换（跨行合并），我们此处不跨行合并，
 *    行首一律 no-op，避免误删换行；该边界在 everyday 使用下不发生，且更安全（renderable≠useful 取舍）。
 *  - 零静态 monaco import（经 editorRef / monacoRef）。
 */
function transposeChars(ed: any, monaco: any): void {
  if (!ed || !monaco) return;
  const model = ed.getModel();
  if (!model || model.isReadonly()) return;
  const sels = ed.getSelections();
  if (!sels || sels.length === 0) return;
  const ops: { range: any; text: string; forceMoveMarkers: true }[] = [];
  const newSels: any[] = [];
  for (const sel of sels) {
    if (!sel.isEmpty()) {
      newSels.push(sel);
      continue;
    }
    const lineNum = sel.startLineNumber;
    const lineContent = model.getLineContent(lineNum);
    const chars = Array.from(lineContent) as string[];
    const L = chars.length;
    if (L === 0) {
      newSels.push(sel);
      continue;
    }
    // UTF-16 列 → 字符索引（光标左侧字符数）
    const cursorCharIdx = Array.from(lineContent.slice(0, sel.startColumn - 1)).length;
    let leftIdx = cursorCharIdx - 1;
    let rightIdx = cursorCharIdx;
    if (leftIdx < 0) {
      // 行首无左字符：跳过（不跨行合并换行符）
      newSels.push(sel);
      continue;
    }
    if (rightIdx >= L) {
      // 行尾：交换末两字符（对齐 Zed end-of-line 分支）
      if (L < 2) {
        newSels.push(sel);
        continue;
      }
      leftIdx = L - 2;
      rightIdx = L - 1;
    }
    const swapped = chars.slice();
    const tmp = swapped[leftIdx];
    swapped[leftIdx] = swapped[rightIdx];
    swapped[rightIdx] = tmp;
    ops.push({
      range: new monaco.Range(lineNum, 1, lineNum, lineContent.length + 1),
      text: swapped.join(""),
      forceMoveMarkers: true,
    });
    // 光标右移一个字符（取右侧字符的 UTF-16 码元长度，emoji=2）；钳制到行尾
    const rightCharUnits = Array.from(chars[rightIdx]).length;
    const newColumn = Math.min(sel.startColumn + rightCharUnits, lineContent.length + 1);
    newSels.push(new monaco.Selection(lineNum, newColumn, lineNum, newColumn));
  }
  if (ops.length === 0) return;
  const applied = model.pushEditOperations(sels, ops, () => newSels);
  ed.setSelections(applied && applied.length ? applied : newSels);
  ed.focus();
}

// ── 包围括号导航（对标 Zed editor::MoveToEnclosingBracket）──
// 与 goToMatchingBracket（光标位于括号上时跳到匹配括号）不同，本函数始终移动到「包含光标的最内层括号对」，
// 落点逻辑逐字复刻 Zed selection.rs::move_to_enclosing_bracket（inside → 闭括号起点；否则 → 闭括号之后 / 开括号起点）。
// Monaco 的 model.bracketPairs.findEnclosingBrackets 为运行时 API（.d.ts 未声明语法感知括号树），用最小局部接口 cast，零静态 monaco import。
interface MBPairRange {
  getStartPosition(): { lineNumber: number; column: number };
  getEndPosition(): { lineNumber: number; column: number };
}
interface MBracketPairs {
  findEnclosingBrackets(pos: { lineNumber: number; column: number }): [MBPairRange, MBPairRange] | null;
}
function moveCaretToEnclosingBracket(ed: any): void {
  if (!ed || !ed.getModel) return;
  const model = ed.getModel();
  if (!model) return;
  const sel = ed.getSelection();
  const pos = sel ? sel.getStartPosition() : ed.getPosition();
  if (!pos) return;
  const bp = (model as unknown as { bracketPairs: MBracketPairs }).bracketPairs;
  const enc = bp.findEnclosingBrackets(pos);
  if (!enc) return;
  const [open, close] = enc;
  const openStart = open.getStartPosition();
  const openEnd = open.getEndPosition();
  const closeStart = close.getStartPosition();
  const closeEnd = close.getEndPosition();
  const start = sel ? sel.getStartPosition() : pos;
  const end = sel ? sel.getEndPosition() : pos;
  const cmp = (a: { lineNumber: number; column: number }, b: { lineNumber: number; column: number }) =>
    a.lineNumber !== b.lineNumber ? a.lineNumber - b.lineNumber : a.column - b.column;
  const inside = cmp(start, openEnd) >= 0 && cmp(end, closeStart) <= 0;
  const closeContainsStart = cmp(start, closeStart) >= 0 && cmp(start, closeEnd) <= 0;
  const closeContainsEnd = cmp(end, closeStart) >= 0 && cmp(end, closeEnd) <= 0;
  let dest: { lineNumber: number; column: number };
  if (closeContainsStart && closeContainsEnd) {
    dest = inside ? openEnd : openStart;
  } else if (inside) {
    dest = closeStart;
  } else {
    dest = closeEnd;
  }
  ed.setPosition({ lineNumber: dest.lineNumber, column: dest.column });
  ed.revealPosition({ lineNumber: dest.lineNumber, column: dest.column });
}

/** 字符串稳定比较（按 UTF-16 码元序，ASCII 等价字节序；对齐 Zed str 默认 Ord） */
function cmpStr(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 行级变换种类（与 Zed editor::manipulate_immutable_lines 的 5 个 action 一一对应） */
type LineManipKind = "sortCI" | "sortCS" | "sortLen" | "uniqueCI" | "uniqueCS";

/**
 * 排序 / 去重选中行（对标 Zed editor::manipulate_lines + sort_lines_* + unique_lines_*）。
 *  - 仅对「选中行的连续区块」做变换，每个选区独立处理（多选区各自排序，互不串扰），与 Zed 逐 contiguous block 语义一致；
 *  - 折叠光标（无选区）时 Zed 仅处理当前单行＝无操作；为贴合「renderable≠useful」且符合用户直觉，
 *    若所有选区均为折叠态，则回退为对整份文件排序/去重（此点相对 Zed 的 no-op 做了可用性增强，已在 overview 注明）；
 *  - 只读模型直接跳过；单次可撤销（pushEditOperations 整体一事务）；变换后选区恢复到被处理区块；
 *  - 零静态 monaco import（经 editorRef / monacoRef）。
 */
function manipulateLines(ed: any, monaco: any, kind: LineManipKind): void {
  if (!ed || !monaco) return;
  const model = ed.getModel();
  if (!model || model.isReadonly()) return;
  const sels = ed.getSelections();
  if (!sels || sels.length === 0) return;

  // 计算每个选区覆盖的「整行」区间 [startLine, endLine]（含）；endColumn===1 时末行仅选到行尾前的折行，故不含末行（对齐 Zed ending_row）。
  const blocks: { startLine: number; endLine: number }[] = [];
  for (const sel of sels) {
    const sp = sel.getStartPosition();
    const ep = sel.getEndPosition();
    const startLine = sp.lineNumber;
    let endLine = ep.lineNumber;
    if (ep.column === 1 && endLine > startLine) endLine -= 1;
    if (endLine >= startLine) blocks.push({ startLine, endLine });
  }
  if (blocks.length === 0) return;

  // 无任何选区（全部折叠）时回退为整份文件（可用性增强，见上方说明）
  if (blocks.every((b) => b.endLine === b.startLine)) {
    blocks.length = 0;
    blocks.push({ startLine: 1, endLine: model.getLineCount() });
  }

  const ops: { range: any; text: string; forceMoveMarkers: true }[] = [];
  const newSels: any[] = [];

  for (const block of blocks) {
    const { startLine, endLine } = block;
    const lines: string[] = [];
    for (let i = startLine; i <= endLine; i++) lines.push(model.getLineContent(i));

    let out: string[];
    switch (kind) {
      case "sortCI":
        out = lines.slice().sort((a, b) => cmpStr(a.toLowerCase(), b.toLowerCase()));
        break;
      case "sortCS":
        out = lines.slice().sort(cmpStr);
        break;
      case "sortLen":
        out = lines.slice().sort((a, b) => a.length - b.length);
        break;
      case "uniqueCI": {
        const seen = new Set<string>();
        out = [];
        for (const l of lines) {
          const k = l.toLowerCase();
          if (!seen.has(k)) {
            seen.add(k);
            out.push(l);
          }
        }
        break;
      }
      case "uniqueCS": {
        const seen = new Set<string>();
        out = [];
        for (const l of lines) {
          if (!seen.has(l)) {
            seen.add(l);
            out.push(l);
          }
        }
        break;
      }
    }

    const newText = out.join("\n");
    const range = new monaco.Range(
      startLine,
      1,
      endLine,
      model.getLineMaxColumn(endLine)
    );
    ops.push({ range, text: newText, forceMoveMarkers: true });

    const endLineNew = startLine + out.length - 1;
    const endColNew = out.length > 0 ? out[out.length - 1].length + 1 : 1;
    newSels.push(new monaco.Selection(startLine, 1, endLineNew, endColNew));
  }

  if (ops.length === 0) return;
  const applied = model.pushEditOperations(sels, ops, () => newSels);
  ed.setSelections(applied && applied.length ? applied : newSels);
  ed.focus();
}

/** 控制流关键字（不视为「声明」，避免把 if/for/while/return 等块误当函数体折叠） */
const CONTROL_KW = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "do",
  "else",
  "with",
  "return",
  "typeof",
  "await",
  "yield",
  "throw",
  "finally",
  "try",
  "function",
]);

/**
 * 识别「声明体起始行」（1-based 行号）。覆盖 brace 语言（TS/JS/TSX/Rust/Go/C/Java…）与
 * 缩进语言（Python：def/class）。命中后由调用方用 Monaco 原生折叠收口，故此处只需定位声明行，
 * 不必自建括号匹配——复用 Monaco 语法/缩进折叠，更稳且零回归。
 */
function detectDeclarationStartLines(lines: string[], lang: string): number[] {
  const result: number[] = [];
  const isPy = lang === "python" || lang === "py";
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#")) continue;
    let matched = false;
    if (isPy) {
      if (/^(async\s+)?def\s+/.test(trimmed) || /^class\s+/.test(trimmed)) matched = true;
    } else {
      // 函数声明：function foo() {
      if (/^(export\s+)?(default\s+)?(async\s+)?function\b/.test(trimmed)) matched = true;
      // 箭头 / 函数表达式赋值：const x = () => { ... } 或 const x = function() {
      else if (/^(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/.test(trimmed)) matched = true;
      else if (/^(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*function\b/.test(trimmed)) matched = true;
      // 类 / 结构体 / 枚举 / 接口 / trait / impl / mod / namespace（带 { 体）
      else if (/^(export\s+)?(default\s+)?(abstract\s+)?(pub(?:\s*\([^)]*\))?\s+)?(class|struct|enum|interface|trait|impl|mod|namespace)\b[^;{]*\{/.test(trimmed)) matched = true;
      // Rust fn
      else if (/^(pub(?:\s*\([^)]*\))?\s+)?(async\s+)?(unsafe\s+)?fn\b/.test(trimmed)) matched = true;
      // Go func
      else if (/^func(\s|\()/.test(trimmed)) matched = true;
      // 方法 / 构造器 / 访问器：name(...):? ... {（排除控制流关键字），或签名在上一行、{ 在下一行
      else {
        const m = /^(?:[A-Za-z_$][\w$]*\s*:\s*)?(?:(?:async|static|public|private|protected|readonly|get|set|pub|override|virtual|extern|final|const|inline|explicit|friend)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{;]*)?\s*\{/.exec(trimmed);
        if (m && !CONTROL_KW.has(m[1])) matched = true;
        else {
          const sig = /^(?:[A-Za-z_$][\w$]*\s*:\s*)?(?:(?:async|static|public|private|protected|readonly|get|set|pub|override|virtual|extern|final|const|inline|explicit|friend)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{;]*)?$/.exec(trimmed);
          if (sig && !CONTROL_KW.has(sig[1])) {
            for (let k = i + 1; k < Math.min(i + 3, lines.length); k++) {
              const nx = lines[k].trim();
              if (nx.length === 0) continue;
              if (/^\{/.test(nx) || /^=>\s*\{/.test(nx)) matched = true;
              break;
            }
          }
        }
      }
    }
    if (matched) result.push(i + 1);
  }
  return result;
}

export const MonacoCodeEditor = forwardRef<MonacoEditorHandle, MonacoCodeEditorProps>(function MonacoCodeEditor(props, ref) {
  const {
    value,
    language,
    theme,
    onChange,
    readOnly = false,
    revealLine,
    revealColumn,
    marks,
    heatRanges,
    deadRanges,
    cloneRanges,
    onSelectionChange,
    onGoToDefinition,
    onFindReferences,
    onPeekDefinition,
    onDiagnoseSymbol,
    onRenameSymbol,
    gotoSymbols,
    onDiagnosticsChange,
    onCursorStatusChange,
    onMarkerStatsChange,
    onEditorInfoChange,
    onColumnSelectionChange,
    onWordWrapChange,
    onFontSizeChange,
    onMarkClick,
    onScroll,
    bookmarks,
    onToggleBookmark,
  } = props;

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decoRef = useRef<any>(null);
  const heatRef = useRef<any>(null);
  /** 诊断回调的稳定引用（onMount 仅执行一次，避免闭包捕获过期的 props 回调） */
  const onDiagRef = useRef<((diags: EditorDiagnostic[]) => void) | undefined>(undefined);
  onDiagRef.current = onDiagnosticsChange;
  /** 光标/选区状态回调的稳定引用（onMount 仅执行一次，避免闭包捕获过期的 props 回调） */
  const onCursorStatusRef = useRef<((s: CursorStatus) => void) | undefined>(undefined);
  onCursorStatusRef.current = onCursorStatusChange;
  /** 诊断计数回调的稳定引用（onMount 仅执行一次，避免闭包捕获过期的 props 回调） */
  const onMarkerStatsRef = useRef<((s: MarkerStats) => void) | undefined>(undefined);
  onMarkerStatsRef.current = onMarkerStatsChange;
  /** 编辑器文档信息回调的稳定引用（行尾符，onMount 仅执行一次） */
  const onEditorInfoRef = useRef<((info: EditorInfo) => void) | undefined>(undefined);
  onEditorInfoRef.current = onEditorInfoChange;
  /** 列选择模式状态回调的稳定引用（onMount 仅执行一次） */
  const onColumnSelectionRef = useRef<((on: boolean) => void) | undefined>(undefined);
  onColumnSelectionRef.current = onColumnSelectionChange;
  /** 软换行状态回调的稳定引用（onMount 仅执行一次） */
  const onWordWrapRef = useRef<((on: boolean) => void) | undefined>(undefined);
  onWordWrapRef.current = onWordWrapChange;
  /** 编辑器字号变化回调的稳定引用（onMount 仅执行一次，供 handle 方法回传最新字号） */
  const onFontSizeRef = useRef<((size: number) => void) | undefined>(undefined);
  onFontSizeRef.current = onFontSizeChange;
  onCursorStatusRef.current = onCursorStatusChange;
  /** 标记（含审查发现 id）的稳定引用：onMount 仅执行一次，点击处理器需读最新 marks */
  const marksRef = useRef<SourceMark[] | undefined>(undefined);
  marksRef.current = marks;
  /** 行内标记点击回调的稳定引用（onMount 仅执行一次） */
  const onMarkClickRef = useRef<((findingId: string, anchorEl: HTMLElement | null) => void) | undefined>(undefined);
  onMarkClickRef.current = onMarkClick;
  /** 书签行号集合的稳定引用（供 handle 方法 / 沟槽点击读取当前文件书签，避免闭包捕获过期 props） */
  const bookmarksRef = useRef<number[]>([]);
  bookmarksRef.current = bookmarks ?? [];
  /** 沟槽点击切换书签的回调稳定引用（onMount 仅执行一次） */
  const onToggleBookmarkRef = useRef<((line: number) => void) | undefined>(undefined);
  onToggleBookmarkRef.current = onToggleBookmark;
  /** 跳转到定义回调的稳定引用（onMount 仅执行一次，避免闭包捕获过期的 props 回调） */
  const onGoToDefinitionRef = useRef<((info: { word: string; line: number; column: number }) => void) | undefined>(undefined);
  onGoToDefinitionRef.current = onGoToDefinition;
  /** 查找引用回调的稳定引用（右键菜单 action 在 onMount 一次性注册） */
  const onFindReferencesRef = useRef<((word: string) => void) | undefined>(undefined);
  onFindReferencesRef.current = onFindReferences;
  /** 「内联 Peek 定义」回调的稳定引用（右键菜单 action + Alt+F12 命令在 onMount 一次性注册） */
  const onPeekDefinitionRef = useRef<
    ((info: { word: string; line: number; column: number; anchor: { x: number; y: number } | null }) => void) | undefined
  >(undefined);
  onPeekDefinitionRef.current = onPeekDefinition;
  /** 「AI 诊断此符号」回调的稳定引用（右键菜单 action 在 onMount 一次性注册） */
  const onDiagnoseSymbolRef = useRef<((info: { word: string; line: number; column: number }) => void) | undefined>(undefined);
  onDiagnoseSymbolRef.current = onDiagnoseSymbol;
  /** 「重命名符号」回调的稳定引用（右键菜单 action + F2 命令在 onMount 一次性注册） */
  const onRenameSymbolRef = useRef<((info: { word: string; line: number; column: number }) => void) | undefined>(undefined);
  onRenameSymbolRef.current = onRenameSymbol;
  /** 诊断订阅的销毁句柄（onMount 非 React effect，需手动 dispose 防泄漏） */
  const diagSubRef = useRef<{ dispose(): void } | null>(null);
  useEffect(() => () => { diagSubRef.current?.dispose(); }, []);
  const deadRef = useRef<any>(null);
  const cloneRef = useRef<any>(null);
  /** 书签装饰集合（对标 Zed BookmarkStore gutter 渲染） */
  const bmRef = useRef<any>(null);
  // AI 内联改动预览（Copilot Edits / Cursor 式：红删绿加，待用户确认）
  const inlineAddedRef = useRef<any>(null);
  const inlineStrikeRef = useRef<any>(null);
  // 「转到行」面板的实时预览高亮装饰集合（独立于 AI 内联改动装饰，互不干扰）
  const gotoLinePreviewRef = useRef<any>(null);
  const pendingInlineRef = useRef<{ strike?: [number, number]; added?: [number, number] } | null>(null);
  // 跳转下划线：按住 Ctrl/⌘ 悬停在可定位符号上显示
  const gotoRef = useRef<any>(null);
  const lastHoverPosRef = useRef<{ lineNumber: number; column: number } | null>(null);
  const modHeldRef = useRef(false);
  const gotoSymbolsRef = useRef<Set<string>>(new Set());

  // 窗格同步滚动：onScroll 回调稳定引用 + 程序化滚动抑制回声标记（避免 A→B→A 死循环）
  const onScrollRef = useRef<((ratio: number) => void) | undefined>(undefined);
  onScrollRef.current = onScroll;
  const suppressScrollRef = useRef(false);

  const applyDecos = useCallback(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const model = ed.getModel();
    if (!model) return;
    const lineCount = model.getLineCount();

    const markDecos = (marks || [])
      .filter((m) => m.line >= 1 && m.line <= lineCount)
      .map((m) => ({
        range: new monaco.Range(m.line, 1, m.line, 1),
        options: {
          isWholeLine: true,
          className: `ps-line-${m.severity}`,
          glyphMarginClassName: `ps-glyph ps-glyph-${m.severity}`,
          glyphMarginHoverMessage: { value: m.label },
          overviewRuler: {
            color: SEVERITY_RGB[m.severity],
            position: monaco.editor.OverviewRulerLane.Right,
          },
        },
      }));
    if (!decoRef.current) decoRef.current = ed.createDecorationsCollection(markDecos);
    else decoRef.current.set(markDecos);

    const heatDecos = (heatRanges || [])
      .filter((h) => h.startLine >= 1 && h.endLine >= h.startLine && h.endLine <= lineCount)
      .map((h) => ({
        range: new monaco.Range(h.startLine, 1, h.endLine, 1),
        options: {
          isWholeLine: true,
          className: `ps-heat-${h.level}`,
          hoverMessage: { value: t("editor.heatHover", { name: h.name, cc: h.cc }) },
        },
      }));
    if (!heatRef.current) heatRef.current = ed.createDecorationsCollection(heatDecos);
    else heatRef.current.set(heatDecos);

    const deadDecos = (deadRanges || [])
      .filter((d) => d.startLine >= 1 && d.endLine >= d.startLine && d.endLine <= lineCount)
      .map((d) => ({
        range: new monaco.Range(d.startLine, 1, d.endLine, 1),
        options: {
          isWholeLine: true,
          className: "ps-dead",
          hoverMessage: {
            value: t("editor.deadHover", {
              name: d.name,
              confidence: d.confidence,
              reason: d.reason ? " · " + d.reason : "",
            }),
          },
        },
      }));
    if (!deadRef.current) deadRef.current = ed.createDecorationsCollection(deadDecos);
    else deadRef.current.set(deadDecos);

    const cloneDecos = (cloneRanges || [])
      .filter((c) => c.startLine >= 1 && c.endLine >= c.startLine && c.endLine <= lineCount)
      .map((c) => {
        const idx = cloneColorIndex(c.groupId);
        const labelType = c.cloneType === "type2" ? t("editor.cloneType2") : t("editor.cloneVerbatim");
        return {
          range: new monaco.Range(c.startLine, 1, c.endLine, 1),
          options: {
            isWholeLine: true,
            className: `ps-clone-${idx}`,
            overviewRuler: {
              color: CLONE_RGB[idx],
              position: monaco.editor.OverviewRulerLane.Center,
            },
            hoverMessage: {
              value: t("editor.cloneHover", {
                n: c.groupSize,
                type: labelType,
                snippet: c.snippet ? "\n" + c.snippet : "",
              }),
            },
          },
        };
      });
    if (!cloneRef.current) cloneRef.current = ed.createDecorationsCollection(cloneDecos);
    else cloneRef.current.set(cloneDecos);

    // 书签：沟槽琥珀金标记 + 整行左侧细条（对标 Zed BookmarkStore 的 gutter 渲染）。
    // 与诊断标记共用同一 glyph margin 列，但书签用独立 class，互不覆盖逻辑；
    // 行号集合来自 props.bookmarks（外壳 store.bookmarks[fileId]），随切换/增删实时刷新。
    const bmLines = bookmarksRef.current;
    const bookmarkDecos = (bmLines || [])
      .filter((l) => l >= 1 && l <= lineCount)
      .map((l) => ({
        range: new monaco.Range(l, 1, l, 1),
        options: {
          isWholeLine: true,
          glyphMarginClassName: "ps-bookmark-glyph",
          overviewRuler: {
            color: "#EF9F27",
            position: monaco.editor.OverviewRulerLane.Left,
          },
        },
      }));
    if (!bmRef.current) bmRef.current = ed.createDecorationsCollection(bookmarkDecos);
    else bmRef.current.set(bookmarkDecos);
  }, [marks, heatRanges, deadRanges, cloneRanges, bookmarks]);

  useEffect(() => {
    applyDecos();
  }, [applyDecos]);

  // 评估当前悬停位置：仅当按住 Ctrl/⌘ 且词是可定位符号名时，显示下划线 + 手型指针
  const refreshGoto = useCallback(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const model = ed.getModel();
    const container = ed.getContainerDomNode?.() as HTMLElement | undefined;
    if (!model || !lastHoverPosRef.current || !modHeldRef.current) {
      gotoRef.current?.set([]);
      if (container) container.style.cursor = "";
      return;
    }
    const pos = lastHoverPosRef.current;
    const word = model.getWordAtPosition(pos);
    if (word && word.word && gotoSymbolsRef.current.has(word.word.toLowerCase())) {
      if (!gotoRef.current) gotoRef.current = ed.createDecorationsCollection();
      gotoRef.current.set([
        {
          range: new monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn),
          options: { inlineClassName: "cw-goto-underline" },
        },
      ]);
      if (container) container.style.cursor = "pointer";
    } else {
      gotoRef.current?.set([]);
      if (container) container.style.cursor = "";
    }
  }, []);

  // 可定位符号名集合实时同步（symbols 分片可能在编辑器挂载后才就绪）
  useEffect(() => {
    gotoSymbolsRef.current = new Set((gotoSymbols || []).map((s) => s.toLowerCase()));
    void refreshGoto();
  }, [gotoSymbols, refreshGoto]);

  // 只读态运行时切换（对标 Zed `Make Tab Read-Only`）：不重挂载编辑器，直接更新选项，
  // 保证标签菜单里「设为只读 / 取消只读」即时生效。
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  // 选中当前选区文本的全部出现位置（多光标，对标 Zed editor::SelectAllMatches）。
  // 复用点：① 命令面板入口 ② Ctrl/Cmd+Shift+L 键位。Monaco 本版本无对应内建命令，故手动实现。
  // 语义对齐 Zed：取主选区文本 → 全文精确（大小写敏感）匹配 → 全量设为多光标选区。
  const selectAllMatchesOf = (ed: any) => {
    if (!ed) return;
    const model = ed.getModel();
    if (!model) return;
    const sels = ed.getSelections();
    if (!sels || sels.length === 0) return;
    const primary = sels[sels.length - 1];
    if (primary.isEmpty()) return;
    const text = model.getValueInRange(primary);
    if (!text) return;
    const matches = model.findMatches(text, false, false, true, null, false);
    if (matches.length === 0) return;
    const next = matches.map((m: any) => ({
      selectionStartLineNumber: m.range.startLineNumber,
      selectionStartColumn: m.range.startColumn,
      positionLineNumber: m.range.endLineNumber,
      positionColumn: m.range.endColumn,
    }));
    ed.setSelections(next);
    ed.focus();
  };

  // 命令式句柄：供工作台 AI 面板「插入光标 / 应用到文件 / 跳转」使用（refs 稳定，deps 置空）
  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor: (text: string) => {
        const ed = editorRef.current;
        const monaco = monacoRef.current;
        if (!ed || !monaco) return;
        const sel = ed.getSelection();
        const pos = ed.getPosition();
        const range = sel && !sel.isEmpty()
          ? sel
          : new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
        ed.executeEdits("workbench-ai", [{ range, text, forceMoveMarkers: true }]);
        ed.pushUndoStop();
      },
      getCursorLine: () => {
        const ed = editorRef.current;
        const pos = ed?.getPosition();
        return pos ? pos.lineNumber : null;
      },
      getValue: () => editorRef.current?.getModel()?.getValue() ?? "",
      getCursorPosition: () => {
        const ed = editorRef.current;
        const pos = ed?.getPosition();
        return pos ? { line: pos.lineNumber, column: pos.column } : null;
      },
      getLineCount: () => {
        const ed = editorRef.current;
        const model = ed?.getModel();
        return model ? model.getLineCount() : null;
      },
      revealLine: (line: number) => {
        const ed = editorRef.current;
        if (ed && line > 0) {
          ed.revealLineInCenter(line);
          ed.setPosition({ lineNumber: line, column: 1 });
          ed.focus();
        }
      },
      // ── 转到行（对标 Zed go_to_line：居中 + 落光标 + 列定位）──
      gotoLineColumn: (line: number, column?: number) => {
        const ed = editorRef.current;
        if (!ed || line <= 0) return;
        const model = ed.getModel();
        const max = model ? model.getLineCount() : line;
        const target = Math.min(Math.max(1, line), max);
        const col = column && column > 0 ? column : 1;
        ed.revealLineInCenter(target);
        ed.setPosition({ lineNumber: target, column: col });
        ed.focus();
      },
      // 实时预览：滚动到目标行并加整行高亮，不改光标；取消时 clearLinePreview 还原
      previewLine: (line: number) => {
        const ed = editorRef.current;
        const monaco = monacoRef.current;
        if (!ed || !monaco || line <= 0) return;
        const model = ed.getModel();
        if (!model) return;
        const max = model.getLineCount();
        const target = Math.min(Math.max(1, line), max);
        ed.revealLineInCenter(target);
        if (!gotoLinePreviewRef.current) {
          gotoLinePreviewRef.current = ed.createDecorationsCollection();
        }
        gotoLinePreviewRef.current.set([
          {
            range: new monaco.Range(target, 1, target, model.getLineMaxColumn(target)),
            options: { isWholeLine: true, className: "goto-line-preview" },
          },
        ]);
      },
      clearLinePreview: () => {
        gotoLinePreviewRef.current?.set([]);
      },
      // ── AI 内联改动预览（VS Code Copilot Edits / Cursor composer 的「编辑器即差异视图」）──
      // 设计：不在独立弹窗里算全文 diff 再写盘，而是把 AI 的补丁直接投到当前编辑器里，
      // 旧行打红删线、新行打绿底，用户「保留/放弃」后才真正定植。确认走 executeEdits，
      // 天然可撤销，且会触发 onChange → 防抖自动保存 → 增量重扫，与现有写盘链路无缝衔接。
      previewInlineEdit: (spec: { startLine: number; endLine: number; newText: string }) => {
        const ed = editorRef.current;
        const monaco = monacoRef.current;
        if (!ed || !monaco) return;
        const model = ed.getModel();
        if (!model) return;
        const raw = (spec.newText ?? "").replace(/\r\n/g, "\n");
        if (!raw.trim()) return;
        const snip = raw.split("\n");
        const lineCount = model.getLineCount();
        const isInsert = spec.endLine < spec.startLine; // 纯插入：endLine = startLine-1

        ed.pushUndoStop();
        let added: [number, number] | undefined;
        let strike: [number, number] | undefined;
        const suffix = raw.endsWith("\n") ? "" : "\n";

        if (isInsert) {
          const at = Math.max(1, Math.min(spec.startLine, lineCount + 1));
          ed.executeEdits("workbench-inline-edit", [
            { range: new monaco.Range(at, 1, at, 1), text: raw + suffix, forceMoveMarkers: true },
          ]);
          added = [at, at + snip.length - 1];
        } else {
          const s = Math.max(1, spec.startLine);
          const e = Math.min(spec.endLine, lineCount);
          if (s > e) {
            ed.pushUndoStop();
            return;
          }
          const at = e + 1;
          ed.executeEdits("workbench-inline-edit", [
            { range: new monaco.Range(at, 1, at, 1), text: raw + suffix, forceMoveMarkers: true },
          ]);
          strike = [s, e];
          added = [at, at + snip.length - 1];
        }

        if (!inlineAddedRef.current) inlineAddedRef.current = ed.createDecorationsCollection();
        if (!inlineStrikeRef.current) inlineStrikeRef.current = ed.createDecorationsCollection();
        const addedDecos = added
          ? [
              {
                range: new monaco.Range(added[0], 1, added[1], model.getLineMaxColumn(added[1])),
                options: { isWholeLine: true, className: "ps-edit-added" },
              },
            ]
          : [];
        const strikeDecos = strike
          ? [
              {
                range: new monaco.Range(strike[0], 1, strike[1], model.getLineMaxColumn(strike[1])),
                options: { isWholeLine: true, className: "ps-edit-removed" },
              },
            ]
          : [];
        inlineAddedRef.current.set(addedDecos);
        inlineStrikeRef.current.set(strikeDecos);
        pendingInlineRef.current = { strike, added };
        ed.revealLineInCenter(Math.min(spec.startLine, lineCount));
        ed.focus();
      },
      acceptInlineEdit: () => {
        const ed = editorRef.current;
        const monaco = monacoRef.current;
        if (!ed || !monaco) return;
        const model = ed.getModel();
        const p = pendingInlineRef.current;
        if (!model || !p) return;
        ed.pushUndoStop();
        // 替换场景：删掉被打红线的旧行，绿行自然顶上来；纯插入场景无红行，仅清装饰。
        if (p.strike) {
          const [s, e] = p.strike;
          if (e <= model.getLineCount()) {
            ed.executeEdits("workbench-inline-edit-accept", [
              { range: new monaco.Range(s, 1, e, model.getLineMaxColumn(e)), text: "" },
            ]);
          }
        }
        inlineStrikeRef.current?.set([]);
        inlineAddedRef.current?.set([]);
        pendingInlineRef.current = null;
        ed.pushUndoStop();
      },
      rejectInlineEdit: () => {
        const ed = editorRef.current;
        const monaco = monacoRef.current;
        if (!ed || !monaco) return;
        const model = ed.getModel();
        const p = pendingInlineRef.current;
        if (!model || !p) return;
        ed.pushUndoStop();
        // 放弃：删掉插入的绿行，旧行（红/原样）保留。
        if (p.added) {
          const [s, e] = p.added;
          if (e <= model.getLineCount()) {
            ed.executeEdits("workbench-inline-edit-reject", [
              { range: new monaco.Range(s, 1, e, model.getLineMaxColumn(e)), text: "" },
            ]);
          }
        }
        inlineStrikeRef.current?.set([]);
        inlineAddedRef.current?.set([]);
        pendingInlineRef.current = null;
        ed.pushUndoStop();
      },
      clearInlineEdit: () => {
        // 切文件/关面板时静默回滚：只删插入的绿行（保留原始内容），并清装饰。
        const ed = editorRef.current;
        const monaco = monacoRef.current;
        const p = pendingInlineRef.current;
        if (ed && monaco && p) {
          const model = ed.getModel();
          if (model && p.added && p.added[1] <= model.getLineCount()) {
            const [s, e] = p.added;
            ed.executeEdits("workbench-inline-edit-clear", [
              { range: new monaco.Range(s, 1, e, model.getLineMaxColumn(e)), text: "" },
            ]);
          }
        }
        inlineStrikeRef.current?.set([]);
        inlineAddedRef.current?.set([]);
        pendingInlineRef.current = null;
      },
      // 选区视口坐标：getScrolledVisiblePosition 返回相对编辑器左上角坐标，叠加 domNode 视口矩形即得到窗口坐标。
      // 内联聊天浮窗用 position:fixed 直接吃这组坐标，锚定在选区上方，对齐 VS Code Ctrl/⌘+I 体感。
      getSelectionAnchor: () => {
        const ed = editorRef.current;
        if (!ed) return null;
        const sel = ed.getSelection();
        if (!sel || sel.isEmpty()) return null;
        const pos = ed.getScrolledVisiblePosition(sel);
        const node = ed.getDomNode();
        if (!pos || !node) return null;
        const rect = node.getBoundingClientRect();
        return { top: rect.top + pos.top, left: rect.left + pos.left, height: pos.height };
      },
      getEditorRect: () => {
        const ed = editorRef.current;
        const node = ed?.getDomNode();
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      },
      // 切换行尾符（对标 Zed LineEndingIndicator：点击状态栏项即换 LF/CRLF）。
      // 走 Monaco model.setEOL，天然可撤销，并会经 onChange 触发防抖自动保存落盘。
      toggleEol: () => {
        const ed = editorRef.current;
        const monaco = monacoRef.current;
        if (!ed || !monaco) return;
        const model = ed.getModel();
        if (!model) return;
        const current = model.getEOL();
        const nextSeq =
          current === "\r\n"
            ? monaco.editor.EndOfLineSequence.LF
            : monaco.editor.EndOfLineSequence.CRLF;
        model.setEOL(nextSeq);
        onEditorInfoRef.current?.({ eol: current === "\r\n" ? "LF" : "CRLF" });
      },
      getWordAtCursor: () => {
        const ed = editorRef.current;
        if (!ed) return null;
        const model = ed.getModel();
        const pos = ed.getPosition();
        if (!model || !pos) return null;
        const w = model.getWordAtPosition(pos);
        return w?.word ?? null;
      },
      // ── 多光标编辑（对标 Zed AddSelectionAbove/Below，差异化增强：命令面板可达 + 键位显式标注）──
      // Monaco 原生 editor.action.insertCursorAbove/Below 已默认绑定 Ctrl/Cmd+Alt+↑/↓（与 Zed mac 键位一致），
      // 此处通过 trigger 显式触发，使命令面板入口也能稳定调用（不依赖原生键是否被其它绑定覆盖）。
      addSelectionAbove: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.insertCursorAbove", undefined);
      },
      addSelectionBelow: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.insertCursorBelow", undefined);
      },
      // 选中当前选区文本的全部出现位置（Zed SelectAllMatches）。Monaco 本版本无对应内建命令，复用共享 helper。
      selectAllMatches: () => selectAllMatchesOf(editorRef.current),
      // 增量加入下一个匹配选区（Zed SelectNext）。取主选区/光标词文本，复用 Monaco 内建
      // editor.action.addSelectionToNextFindMatch（按当前选择/词逐个加下一个匹配，可重复按 = VS Code Ctrl/Cmd+D）。
      addSelectionToNextMatch: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.addSelectionToNextFindMatch", undefined);
      },
      // 增量加入上一个匹配选区（Zed SelectPrevious）。反向逐个加匹配，复用 Monaco 内建
      // editor.action.addSelectionToPreviousFindMatch（= VS Code Ctrl/Cmd+Shift+D），与 addSelectionToNextMatch 组成对称家族。
      addSelectionToPreviousMatch: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.addSelectionToPreviousFindMatch", undefined);
      },
      // 按语法向后扩展选区（Zed SelectLargerSyntaxNode）。复用 Monaco 内建 smartSelect.expand（逐级放大语法节点）。
      expandSelection: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.smartSelect.expand", undefined);
      },
      // 按语法向前收缩选区（Zed SelectSmallerSyntaxNode）。复用 Monaco 内建 smartSelect.shrink（回退一级语法节点）。
      shrinkSelection: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.smartSelect.shrink", undefined);
      },
      // 切换列选择模式（Zed ColumnarSelection）。开启后按住 Alt 拖拽可选矩形块；复用 Monaco columnSelection 选项。
      toggleColumnSelection: () => {
        const ed = editorRef.current;
        const monaco = monacoRef.current;
        if (!ed || !monaco) return;
        const cur = ed.getOption(monaco.editor.EditorOption.columnSelection);
        ed.updateOptions({ columnSelection: !cur });
        // updateOptions 触发 onDidChangeConfiguration → emitColumnSelection，此处兜底再发一次
        try {
          onColumnSelectionRef.current?.(!cur);
        } catch {
          /* 忽略 */
        }
      },
      // 退出多光标编辑（保留主光标，移除其余辅助光标）；原生键 Escape 同源。
      exitMultiCursor: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.removeSecondaryCursors", undefined);
      },
      // ── 编辑器字号缩放（对标 Zed IncreaseBufferFontSize / DecreaseBufferFontSize / ResetBufferFontSize）──
      // 复用模块级 applyFontSizeDelta / resetFontSize（步长 ±1、钳制 [6,100]、Reset 恢复默认 13px），
      // 变更经 updateOptions 触发 onDidChangeConfiguration → emitFontSize 回传外壳状态栏 + localStorage 持久化。
      increaseFont: () => applyFontSizeDelta(editorRef.current, monacoRef.current, +1, onFontSizeRef),
      decreaseFont: () => applyFontSizeDelta(editorRef.current, monacoRef.current, -1, onFontSizeRef),
      resetFont: () => resetFontSize(editorRef.current, monacoRef.current, onFontSizeRef),
      // ── 代码折叠（对标 Zed Fold / UnfoldLines / FoldRecursive / FoldAll / FoldSelectedRanges / FoldAtLevel_1..9）──
      // 复用 Monaco 内建 action（trigger 触发，零静态 monaco import）；原生键位默认已绑定，
      // 命令面板入口保证可达（无需先聚焦编辑器也能折叠），与 Zed 命令面板同口径。
      foldAtCursor: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.fold", undefined);
      },
      unfoldAtCursor: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.unfold", undefined);
      },
      toggleFoldAtCursor: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.toggleFold", undefined);
      },
      foldRecursively: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.foldRecursively", undefined);
      },
      unfoldRecursively: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.unfoldRecursively", undefined);
      },
      foldAll: () => {
        editorRef.current?.trigger("ps-workbench", "editor.foldAll", undefined);
      },
      unfoldAll: () => {
        editorRef.current?.trigger("ps-workbench", "editor.unfoldAll", undefined);
      },
      foldSelection: () => {
        editorRef.current?.trigger("ps-workbench", "editor.foldSelection", undefined);
      },
      foldLevel: (level: number) => {
        if (level >= 1 && level <= 7) {
          editorRef.current?.trigger("ps-workbench", `editor.foldLevel${level}`, undefined);
        }
      },
      toggleWordWrap: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.toggleWordWrap", undefined);
      },
      // 折叠当前文件全部函数/方法/类/结构体等声明体（对标 Zed editor::FoldFunctionBodies）。
      // 复用 Monaco 原生 editor.action.fold（折叠光标处最小可折叠区），零静态 monaco import；
      // 声明行识别见模块级 foldFunctionBodiesImpl / detectDeclarationStartLines。
      foldFunctionBodies: () => foldFunctionBodiesImpl(editorRef.current),
      // 跳转到下一个/上一个诊断（对标 Zed GoToDiagnostic / GoToPrevDiagnostic，F8 / Shift+F8）。
      // 编辑器聚焦时由 onMount 注册的 F8 命令触发；命令面板入口也复用同一逻辑，零漂移。
      goToNextProblem: () => goToProblem(editorRef.current, monacoRef.current, 1),
      goToPrevProblem: () => goToProblem(editorRef.current, monacoRef.current, -1),
      // ── 编辑器核心编辑动作（对标 Zed 编辑命令集：ToggleComments / Format / DuplicateLine / MoveLine* / JoinLines / GoToMatchingBracket）──
      // 复用 Monaco 内建 action（trigger 触发，零静态 monaco import）；原生键位默认已绑定，命令面板入口保证可达。
      toggleLineComment: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.commentLine", undefined);
      },
      toggleBlockComment: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.blockComment", undefined);
      },
      formatDocument: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.formatDocument", undefined);
      },
      duplicateLine: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.copyLinesDownAction", undefined);
      },
      moveLineUp: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.moveLinesUpAction", undefined);
      },
      moveLineDown: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.moveLinesDownAction", undefined);
      },
      joinLines: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.joinLines", undefined);
      },
      // ── 行结构编辑（对标 Zed DeleteLine / InsertNewlineAbove / InsertNewlineBelow；复用 Monaco 内建 action，零静态 monaco import）──
      deleteLine: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.deleteLines", undefined);
      },
      insertLineAbove: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.insertLineBefore", undefined);
      },
      insertLineBelow: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.insertLineAfter", undefined);
      },
      transpose: () => transposeChars(editorRef.current, monacoRef.current),
      // ── 缩进 / 取消缩进 / 向上复制（对标 Zed Indent / Outdent / DuplicateLineUp；复用 Monaco 内建 action，零静态 monaco import）──
      indentSelection: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.indentLines", undefined);
      },
      outdentSelection: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.outdentLines", undefined);
      },
      duplicateLineUp: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.copyLinesUpAction", undefined);
      },
      // ── 词级移动 / 扩选 / 删除（对标 Zed 编辑器词光标家族：MoveWordLeft/Right、SelectToPreviousWordStart/NextWordEnd、DeleteWordLeft/Right）──
      // 语义对齐 Zed Movement::PreviousWordStart / NextWordEnd（词首/词尾粒度的词边界导航，区别于逐字符移动）；
      // 全部复用 Monaco 内建 action（cursorWordStartLeft/EndRight + Select 变体 + deleteWordLeft/Right），零静态 monaco import。
      // 此前这些日常操作仅能靠 Monaco 原生 Ctrl/Cmd+←/→/Backspace/Delete 键位（依赖编辑器聚焦），命令面板与右键菜单均不可达＝renderable≠useful 缺口；本轮补齐双入口。
      moveWordLeft: () => {
        editorRef.current?.trigger("ps-workbench", "cursorWordStartLeft", undefined);
      },
      moveWordRight: () => {
        editorRef.current?.trigger("ps-workbench", "cursorWordEndRight", undefined);
      },
      selectWordLeft: () => {
        editorRef.current?.trigger("ps-workbench", "cursorWordStartLeftSelect", undefined);
      },
      selectWordRight: () => {
        editorRef.current?.trigger("ps-workbench", "cursorWordEndRightSelect", undefined);
      },
      deleteWordLeft: () => {
        editorRef.current?.trigger("ps-workbench", "deleteWordLeft", undefined);
      },
      deleteWordRight: () => {
        editorRef.current?.trigger("ps-workbench", "deleteWordRight", undefined);
      },
      // ── 子词级移动 / 扩选 / 删除（对标 Zed editor::Move*Subword/Select*Subword/Delete*Subword*：camelCase/蛇形边界的子词粒度导航）──
      // 语义对齐 Zed movement::NextSubwordEnd / PreviousSubwordStart（子词按大小写/下划线切分，区别于整词）；
      // 复用 Monaco 内建 action（cursorWordPartLeft/Right + Select 变体 + deleteWordPartLeft/Right），零静态 monaco import。
      // 此前整词家族已补命令面板/右键双入口，但「子词」维度完全缺失＝renderable≠useful 缺口（03:00 轮待续②）。
      moveSubwordLeft: () => {
        editorRef.current?.trigger("ps-workbench", "cursorWordPartLeft", undefined);
      },
      moveSubwordRight: () => {
        editorRef.current?.trigger("ps-workbench", "cursorWordPartRight", undefined);
      },
      selectSubwordLeft: () => {
        editorRef.current?.trigger("ps-workbench", "cursorWordPartLeftSelect", undefined);
      },
      selectSubwordRight: () => {
        editorRef.current?.trigger("ps-workbench", "cursorWordPartRightSelect", undefined);
      },
      deleteSubwordLeft: () => {
        editorRef.current?.trigger("ps-workbench", "deleteWordPartLeft", undefined);
      },
      deleteSubwordRight: () => {
        editorRef.current?.trigger("ps-workbench", "deleteWordPartRight", undefined);
      },
      // DeleteToNextWordStart / DeleteToPreviousWordEnd：Monaco 无直接命令，按「先选中再删」组合复刻 Zed 词首/词尾语义。
      // 选中阶段复用 cursorWordStartRightSelect（到下一个词首）/ cursorWordEndLeftSelect（到前一个词尾），删除复用 deleteLeft（选区非空时删选区）。
      deleteToNextWordStart: () => {
        const ed = editorRef.current;
        if (!ed) return;
        ed.trigger("ps-workbench", "cursorWordStartRightSelect", undefined);
        ed.trigger("ps-workbench", "deleteLeft", undefined);
      },
      deleteToPreviousWordEnd: () => {
        const ed = editorRef.current;
        if (!ed) return;
        ed.trigger("ps-workbench", "cursorWordEndLeftSelect", undefined);
        ed.trigger("ps-workbench", "deleteLeft", undefined);
      },
      // ── 行首尾编辑（对标 Zed MoveToEndOfLine / MoveToStartOfLine / DeleteToEndOfLine / DeleteToStartOfLine / CutToEndOfLine / CutToStartOfLine）──
      // 语义对齐 Zed input.rs：先 select_to_end/start_of_line（stop_at_soft_wraps=false → 真实行尾/行首），再 delete / cut 到剪贴板；
      // read_only 由 Monaco 内建 action 自动 no-op 保证零回归。全部复用 Monaco 内建 action（cursorEnd/cursorLineStart/deleteAllRight/deleteAllLeft
      // + cursorEndSelect/cursorLineStartSelect + editor.action.clipboardCutAction），零静态 monaco import。
      // 此前这些日常操作仅能靠 Monaco 原生 End/Home/Shift+Del 键位（依赖编辑器聚焦），命令面板与右键菜单均不可达＝renderable≠useful 缺口。
      moveToEndOfLine: () => {
        editorRef.current?.trigger("ps-workbench", "cursorEnd", undefined);
      },
      moveToStartOfLine: () => {
        editorRef.current?.trigger("ps-workbench", "cursorLineStart", undefined);
      },
      deleteToEndOfLine: () => {
        editorRef.current?.trigger("ps-workbench", "deleteAllRight", undefined);
      },
      deleteToStartOfLine: () => {
        editorRef.current?.trigger("ps-workbench", "deleteAllLeft", undefined);
      },
      cutToEndOfLine: () => {
        const ed = editorRef.current;
        if (!ed) return;
        ed.trigger("ps-workbench", "cursorEndSelect", undefined);
        ed.trigger("ps-workbench", "editor.action.clipboardCutAction", undefined);
      },
      cutToStartOfLine: () => {
        const ed = editorRef.current;
        if (!ed) return;
        ed.trigger("ps-workbench", "cursorLineStartSelect", undefined);
        ed.trigger("ps-workbench", "editor.action.clipboardCutAction", undefined);
      },
      goToMatchingBracket: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.jumpToBracket", undefined);
      },
      // ── 包围括号导航（对标 Zed MoveToEnclosingBracket；与 goToMatchingBracket 区分：后者跳匹配括号，本命令始终去最近包围光标的最内层括号）──
      // 选中操作复用 Monaco 内建 editor.action.selectToBracket（含包围回退，selectBrackets=true 选中含括号的整对）；零静态 monaco import。
      moveToEnclosingBracket: () => {
        moveCaretToEnclosingBracket(editorRef.current);
      },
      selectToEnclosingBracket: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.selectToBracket", { selectBrackets: true });
      },
      // ── 文本大小写转换（对标 Zed ConvertTo* 家族；逐字移植 convert_case 边界/模式算法，详见模块级 convertSelectionCase）──
      // 选区为空时取光标处单词（surrounding_word 口径）；多选区逐段转换并保留选区；单次可撤销；零静态 monaco import（经 editorRef/monacoRef）。
      convertToUpper: () => convertSelectionCase(editorRef.current, monacoRef.current, "upper"),
      convertToLower: () => convertSelectionCase(editorRef.current, monacoRef.current, "lower"),
      convertToTitle: () => convertSelectionCase(editorRef.current, monacoRef.current, "title"),
      convertToSnake: () => convertSelectionCase(editorRef.current, monacoRef.current, "snake"),
      convertToKebab: () => convertSelectionCase(editorRef.current, monacoRef.current, "kebab"),
      convertToPascal: () => convertSelectionCase(editorRef.current, monacoRef.current, "pascal"),
      convertToCamel: () => convertSelectionCase(editorRef.current, monacoRef.current, "camel"),
      convertToSentence: () => convertSelectionCase(editorRef.current, monacoRef.current, "sentence"),
      // 程序化滚动到比例位置（窗格同步滚动用）：先打抑制标记，再 setScrollTop，
      // 随后的回声 onDidScrollChange 会被 suppressScrollRef 拦截，不会反向广播。
      setScrollRatio: (ratio: number) => {
        const ed = editorRef.current;
        if (!ed) return;
        const max = ed.getScrollHeight() - ed.getLayoutInfo().height;
        const target = Math.max(0, Math.min(1, ratio)) * Math.max(0, max);
        suppressScrollRef.current = true;
        ed.setScrollTop(target);
      },
      // ── 跳转家族（对标 Zed GoToDefinition / FindAllReferences / GoToTypeDefinition / GoToImplementation / GoToDeclaration）──
      // Definition / References 复用右键菜单的同款增强流程（onGoToDefinitionRef / onFindReferencesRef），保证右键、键盘、命令面板三者一致；
      // Type / Implementation / Declaration 走 Monaco 原生 action（零静态 monaco import 铁律严守，经 editorRef.trigger）。
      goToDefinition: () => {
        const ed = editorRef.current;
        if (!ed) return;
        const pos = ed.getPosition();
        if (!pos) return;
        const word = ed.getModel()?.getWordAtPosition(pos);
        if (!word?.word) return;
        onGoToDefinitionRef.current?.({ word: word.word, line: pos.lineNumber, column: pos.column });
      },
      findReferences: () => {
        const ed = editorRef.current;
        if (!ed) return;
        const pos = ed.getPosition();
        if (!pos) return;
        const word = ed.getModel()?.getWordAtPosition(pos);
        if (!word?.word) return;
        onFindReferencesRef.current?.(word.word);
      },
      // 内联 Peek 定义：取光标处符号 + 其屏幕坐标作为浮层锚点（取不到则 null，上层置中渲染），
      // 回传上层弹浮层预览，避免像 gotoDefinition 那样直接跳转离开当前位置（对标 VS Code Peek Definition）。
      peekDefinition: () => {
        const ed = editorRef.current;
        if (!ed) return;
        const pos = ed.getPosition();
        if (!pos) return;
        const word = ed.getModel()?.getWordAtPosition(pos);
        if (!word?.word) return;
        let anchor: { x: number; y: number } | null = null;
        try {
          const vp = ed.getScrolledVisiblePosition(pos);
          const rect = ed.getDomNode()?.getBoundingClientRect();
          if (vp && rect) anchor = { x: rect.left + vp.left, y: rect.top + vp.top + vp.height };
        } catch {
          /* 取不到坐标则置中渲染，非阻断 */
        }
        onPeekDefinitionRef.current?.({ word: word.word, line: pos.lineNumber, column: pos.column, anchor });
      },
      goToTypeDefinition: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.goToTypeDefinition", undefined);
      },
      goToImplementation: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.goToImplementation", undefined);
      },
      goToDeclaration: () => {
        editorRef.current?.trigger("ps-workbench", "editor.action.goToDeclaration", undefined);
      },
      // 窗格方向导航后把 DOM 焦点移交给本编辑器（对标 Zed activate_pane_in_direction 末尾
      // `item.item_focus_handle(cx).focus(window, cx)`：导航不仅切激活窗格，还要让目标编辑器立即可键入）。
      focus: () => {
        const ed = editorRef.current;
        if (!ed) return;
        try {
          ed.focus();
        } catch {
          /* 编辑器未挂载完成等极端情况静默降级 */
        }
      },
      // ── 编辑器书签（对标 Zed ToggleBookmark / GoToNextBookmark / GoToPreviousBookmark）──
      toggleBookmark: () => {
        const ed = editorRef.current;
        if (!ed) return;
        const pos = ed.getPosition();
        if (!pos) return;
        onToggleBookmarkRef.current?.(pos.lineNumber);
      },
      goToNextBookmark: () => {
        const ed = editorRef.current;
        const monaco = monacoRef.current;
        if (!ed || !monaco) return;
        const pos = ed.getPosition();
        if (!pos) return;
        const lines = (bookmarksRef.current || []).slice().sort((a: number, b: number) => a - b);
        if (lines.length === 0) return;
        const cur = pos.lineNumber;
        const next = lines.find((l: number) => l > cur) ?? lines[0];
        ed.revealLineInCenter(next);
        ed.setPosition({ lineNumber: next, column: 1 });
        ed.focus();
      },
      goToPrevBookmark: () => {
        const ed = editorRef.current;
        const monaco = monacoRef.current;
        if (!ed || !monaco) return;
        const pos = ed.getPosition();
        if (!pos) return;
        const lines = (bookmarksRef.current || []).slice().sort((a: number, b: number) => a - b);
        if (lines.length === 0) return;
        const cur = pos.lineNumber;
        const prev = [...lines].reverse().find((l: number) => l < cur) ?? lines[lines.length - 1];
        ed.revealLineInCenter(prev);
        ed.setPosition({ lineNumber: prev, column: 1 });
        ed.focus();
      },
      // ── 行级排序 / 去重（对标 Zed editor::manipulate_lines + sort_lines_* + unique_lines_*）──
      // 选区级独立变换，单次可撤销，零静态 monaco import（经 editorRef / monacoRef 调模块级 manipulateLines）。
      sortLinesCI: () => manipulateLines(editorRef.current, monacoRef.current, "sortCI"),
      sortLinesCS: () => manipulateLines(editorRef.current, monacoRef.current, "sortCS"),
      sortLinesLen: () => manipulateLines(editorRef.current, monacoRef.current, "sortLen"),
      uniqueLinesCI: () => manipulateLines(editorRef.current, monacoRef.current, "uniqueCI"),
      uniqueLinesCS: () => manipulateLines(editorRef.current, monacoRef.current, "uniqueCS"),
    }),
    []
  );

  return (
    <Suspense fallback={<EditorFallback />}>
      <MonacoEditorLazy
        value={value}
        language={monacoLanguageOf(language)}
        theme={theme === "dark" ? "vs-dark" : "light"}
        onChange={onChange}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "off",
          tabSize: 2,
          renderLineHighlight: "all",
          glyphMargin: true,
          folding: true,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          padding: { top: 8 },
          // 语法错误即时提示（monaco 自带 TS/JS 诊断；其他语言仅高亮）
          quickSuggestions: false,
          suggestOnTriggerCharacters: true,
        }}
        onMount={(editor, monaco) => {
          editorRef.current = editor;
          monacoRef.current = monaco;
          ensureMarkStyles();
          // 应用持久化的编辑器字号（对标 Zed persist：跨会话保留用户偏好）；无持久化时保持选项默认 13px
          const persistedFont = readPersistedFontSize();
          if (persistedFont != null) {
            editor.updateOptions({ fontSize: persistedFont });
          }
          if (revealLine && revealLine > 0) {
            editor.revealLineInCenter(revealLine);
            editor.setPosition({
              lineNumber: revealLine,
              column: revealColumn && revealColumn > 0 ? revealColumn : 1,
            });
            editor.focus();
          }
          // 编辑模式默认聚焦
          if (!readOnly) editor.focus();
          applyDecos();

          // 编辑器右键上下文菜单接入分析能力（对标 Zed 编辑器上下文菜单的 Go to Definition / Find All References，
          // 差异化增强为「可执行的分析动作」而非死节点）。以 Monaco addAction 注册进原生右键菜单，
          // 保留 Cut/Copy/Paste/Format 等原生项，仅追加我们的分析动作；action 在 onMount 一次性注册，
          // 通过稳定 ref 回调，避免闭包捕获过期 props。无光标处符号时静默 no-op。
          const wordAtCursor = (): { word: string; line: number; column: number } | null => {
            const model = editor.getModel();
            const pos = editor.getPosition();
            if (!model || !pos) return null;
            const w = model.getWordAtPosition(pos);
            return w && w.word ? { word: w.word, line: pos.lineNumber, column: pos.column } : null;
          };
          // Peek 同款：在 wordAtCursor 基础上附带光标屏幕锚点（供浮层定位），取不到则 null 由上层置中渲染。
          const peekInfoAtCursor = (): { word: string; line: number; column: number; anchor: { x: number; y: number } | null } | null => {
            const info = wordAtCursor();
            if (!info) return null;
            let anchor: { x: number; y: number } | null = null;
            try {
              const vp = editor.getScrolledVisiblePosition({ lineNumber: info.line, column: info.column });
              const rect = editor.getDomNode()?.getBoundingClientRect();
              if (vp && rect) anchor = { x: rect.left + vp.left, y: rect.top + vp.top + vp.height };
            } catch {
              /* 非阻断 */
            }
            return { ...info, anchor };
          };
          editor.addAction({
            id: "ps.gotoDefinition",
            label: t("workbench.ctxMenu.gotoDefinition"),
            contextMenuGroupId: "navigation",
            contextMenuOrder: 1,
            run: () => { const info = wordAtCursor(); if (info) onGoToDefinitionRef.current?.(info); },
          });
          editor.addAction({
            id: "ps.findReferences",
            label: t("workbench.ctxMenu.findReferences"),
            contextMenuGroupId: "navigation",
            contextMenuOrder: 1.1,
            run: () => { const info = wordAtCursor(); if (info) onFindReferencesRef.current?.(info.word); },
          });
          editor.addAction({
            id: "ps.peekDefinition",
            label: t("workbench.ctxMenu.peekDefinition"),
            contextMenuGroupId: "navigation",
            contextMenuOrder: 1.15,
            // 内联 Peek：不跳转，弹浮层预览定义（对标 VS Code Peek Definition；Zed 无此能力我们自建）。
            run: () => { const info = peekInfoAtCursor(); if (info) onPeekDefinitionRef.current?.(info); },
          });
          editor.addAction({
            id: "ps.diagnoseSymbol",
            label: t("workbench.ctxMenu.diagnoseSymbol"),
            contextMenuGroupId: "9_ai",
            contextMenuOrder: 1,
            run: () => { const info = wordAtCursor(); if (info) onDiagnoseSymbolRef.current?.(info); },
          });
          editor.addAction({
            id: "ps.renameSymbol",
            label: t("workbench.ctxMenu.renameSymbol"),
            contextMenuGroupId: "navigation",
            contextMenuOrder: 1.2,
            run: () => { const info = wordAtCursor(); if (info) onRenameSymbolRef.current?.(info); },
          });
          // 行结构编辑：删除行 / 上方插空行 / 下方插空行 / 交换字符（对标 Zed DeleteLine / InsertNewlineAbove / InsertNewlineBelow / Transpose）。
          // 追加进 Monaco 原生右键菜单的「编辑」分组，与 Cut/Copy/Paste/Format 等原生项并存，命令面板入口保证可达。
          editor.addAction({
            id: "ps.deleteLine",
            label: t("workbench.ctxMenu.deleteLine"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 1,
            run: () => { editorRef.current?.trigger("ps-workbench", "editor.action.deleteLines", undefined); },
          });
          editor.addAction({
            id: "ps.insertLineAbove",
            label: t("workbench.ctxMenu.insertLineAbove"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 2,
            run: () => { editorRef.current?.trigger("ps-workbench", "editor.action.insertLineBefore", undefined); },
          });
          editor.addAction({
            id: "ps.insertLineBelow",
            label: t("workbench.ctxMenu.insertLineBelow"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 3,
            run: () => { editorRef.current?.trigger("ps-workbench", "editor.action.insertLineAfter", undefined); },
          });
          editor.addAction({
            id: "ps.transpose",
            label: t("workbench.ctxMenu.transpose"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 4,
            run: () => { transposeChars(editorRef.current, monaco); },
          });
          // 缩进 / 取消缩进 / 向上复制行：与行结构编辑同组，保证右键菜单与命令面板双入口可达。
          editor.addAction({
            id: "ps.indentSelection",
            label: t("workbench.ctxMenu.indentSelection"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 5,
            run: () => { editorRef.current?.trigger("ps-workbench", "editor.action.indentLines", undefined); },
          });
          editor.addAction({
            id: "ps.outdentSelection",
            label: t("workbench.ctxMenu.outdentSelection"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 6,
            run: () => { editorRef.current?.trigger("ps-workbench", "editor.action.outdentLines", undefined); },
          });
          editor.addAction({
            id: "ps.duplicateLineUp",
            label: t("workbench.ctxMenu.duplicateLineUp"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 7,
            run: () => { editorRef.current?.trigger("ps-workbench", "editor.action.copyLinesUpAction", undefined); },
          });
          // 词级移动 / 扩选 / 删除：与行结构编辑同组（edit），保证右键菜单与命令面板双入口可达（对标 Zed MoveWord*/SelectTo*/DeleteWord* 家族）。
          editor.addAction({
            id: "ps.moveWordLeft",
            label: t("workbench.ctxMenu.moveWordLeft"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 8,
            run: () => { editorRef.current?.trigger("ps-workbench", "cursorWordStartLeft", undefined); },
          });
          editor.addAction({
            id: "ps.moveWordRight",
            label: t("workbench.ctxMenu.moveWordRight"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 9,
            run: () => { editorRef.current?.trigger("ps-workbench", "cursorWordEndRight", undefined); },
          });
          editor.addAction({
            id: "ps.selectWordLeft",
            label: t("workbench.ctxMenu.selectWordLeft"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 10,
            run: () => { editorRef.current?.trigger("ps-workbench", "cursorWordStartLeftSelect", undefined); },
          });
          editor.addAction({
            id: "ps.selectWordRight",
            label: t("workbench.ctxMenu.selectWordRight"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 11,
            run: () => { editorRef.current?.trigger("ps-workbench", "cursorWordEndRightSelect", undefined); },
          });
          editor.addAction({
            id: "ps.deleteWordLeft",
            label: t("workbench.ctxMenu.deleteWordLeft"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 12,
            run: () => { editorRef.current?.trigger("ps-workbench", "deleteWordLeft", undefined); },
          });
          editor.addAction({
            id: "ps.deleteWordRight",
            label: t("workbench.ctxMenu.deleteWordRight"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 13,
            run: () => { editorRef.current?.trigger("ps-workbench", "deleteWordRight", undefined); },
          });
          // 子词级移动 / 扩选 / 删除（与整词家族同组 edit，保证右键菜单与命令面板双入口可达，对标 Zed Move*/Select*/Delete*Subword*）。
          // 顺序 14–19 紧接整词家族（8–13），语义相邻便于发现。
          editor.addAction({
            id: "ps.moveSubwordLeft",
            label: t("workbench.cmd.moveSubwordLeft"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 14,
            run: () => { editorRef.current?.trigger("ps-workbench", "cursorWordPartLeft", undefined); },
          });
          editor.addAction({
            id: "ps.moveSubwordRight",
            label: t("workbench.cmd.moveSubwordRight"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 15,
            run: () => { editorRef.current?.trigger("ps-workbench", "cursorWordPartRight", undefined); },
          });
          editor.addAction({
            id: "ps.selectSubwordLeft",
            label: t("workbench.cmd.selectSubwordLeft"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 16,
            run: () => { editorRef.current?.trigger("ps-workbench", "cursorWordPartLeftSelect", undefined); },
          });
          editor.addAction({
            id: "ps.selectSubwordRight",
            label: t("workbench.cmd.selectSubwordRight"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 17,
            run: () => { editorRef.current?.trigger("ps-workbench", "cursorWordPartRightSelect", undefined); },
          });
          editor.addAction({
            id: "ps.deleteSubwordLeft",
            label: t("workbench.cmd.deleteSubwordLeft"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 18,
            run: () => { editorRef.current?.trigger("ps-workbench", "deleteWordPartLeft", undefined); },
          });
          editor.addAction({
            id: "ps.deleteSubwordRight",
            label: t("workbench.cmd.deleteSubwordRight"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 19,
            run: () => { editorRef.current?.trigger("ps-workbench", "deleteWordPartRight", undefined); },
          });
          // 删除到下一个词首 / 上一个词尾（Monaco 无直接命令，按「先选中再删」组合，对标 Zed DeleteToNextWordStart/DeleteToPreviousWordEnd）。
          editor.addAction({
            id: "ps.deleteToNextWordStart",
            label: t("workbench.cmd.deleteToNextWordStart"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 20,
            run: () => {
              editorRef.current?.trigger("ps-workbench", "cursorWordStartRightSelect", undefined);
              editorRef.current?.trigger("ps-workbench", "deleteLeft", undefined);
            },
          });
          editor.addAction({
            id: "ps.deleteToPreviousWordEnd",
            label: t("workbench.cmd.deleteToPreviousWordEnd"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 21,
            run: () => {
              editorRef.current?.trigger("ps-workbench", "cursorWordEndLeftSelect", undefined);
              editorRef.current?.trigger("ps-workbench", "deleteLeft", undefined);
            },
          });
          // ── 行首尾编辑（对标 Zed MoveToEndOfLine / MoveToStartOfLine / DeleteToEndOfLine / DeleteToStartOfLine / CutToEndOfLine / CutToStartOfLine）──
          editor.addAction({
            id: "ps.moveToEndOfLine",
            label: t("workbench.ctxMenu.moveToEndOfLine"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 22,
            run: () => editorRef.current?.trigger("ps-workbench", "cursorEnd", undefined),
          });
          editor.addAction({
            id: "ps.moveToStartOfLine",
            label: t("workbench.ctxMenu.moveToStartOfLine"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 23,
            run: () => editorRef.current?.trigger("ps-workbench", "cursorLineStart", undefined),
          });
          editor.addAction({
            id: "ps.deleteToEndOfLine",
            label: t("workbench.ctxMenu.deleteToEndOfLine"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 24,
            run: () => editorRef.current?.trigger("ps-workbench", "deleteAllRight", undefined),
          });
          editor.addAction({
            id: "ps.deleteToStartOfLine",
            label: t("workbench.ctxMenu.deleteToStartOfLine"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 25,
            run: () => editorRef.current?.trigger("ps-workbench", "deleteAllLeft", undefined),
          });
          editor.addAction({
            id: "ps.cutToEndOfLine",
            label: t("workbench.ctxMenu.cutToEndOfLine"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 26,
            run: () => {
              editorRef.current?.trigger("ps-workbench", "cursorEndSelect", undefined);
              editorRef.current?.trigger("ps-workbench", "editor.action.clipboardCutAction", undefined);
            },
          });
          editor.addAction({
            id: "ps.cutToStartOfLine",
            label: t("workbench.ctxMenu.cutToStartOfLine"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 27,
            run: () => {
              editorRef.current?.trigger("ps-workbench", "cursorLineStartSelect", undefined);
              editorRef.current?.trigger("ps-workbench", "editor.action.clipboardCutAction", undefined);
            },
          });
          editor.addAction({
            id: "ps.addSelectionToNextMatch",
            label: t("workbench.ctxMenu.addSelectionNext"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 28,
            run: () =>
              editorRef.current?.trigger("ps-workbench", "editor.action.addSelectionToNextFindMatch", undefined),
          });
          editor.addAction({
            id: "ps.addSelectionToPreviousMatch",
            label: t("workbench.ctxMenu.addSelectionPrev"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 29,
            run: () =>
              editorRef.current?.trigger(
                "ps-workbench",
                "editor.action.addSelectionToPreviousFindMatch",
                undefined,
              ),
          });
          // 包围括号：跳到 / 选中最近包围光标的最内层括号对（对标 Zed MoveToEnclosingBracket；与 goToMatchingBracket 区分——后者跳匹配括号，本组始终去最近包围对）。
          // 顺序 30/31 紧接多光标家族（28/29），语义相邻便于发现；命令面板同步入口见 CodeWorkbench.tsx。
          editor.addAction({
            id: "ps.moveToEnclosingBracket",
            label: t("workbench.ctxMenu.moveToEnclosingBracket"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 30,
            run: () => moveCaretToEnclosingBracket(editorRef.current),
          });
          editor.addAction({
            id: "ps.selectToEnclosingBracket",
            label: t("workbench.ctxMenu.selectToEnclosingBracket"),
            contextMenuGroupId: "edit",
            contextMenuOrder: 31,
            run: () =>
              editorRef.current?.trigger("ps-workbench", "editor.action.selectToBracket", { selectBrackets: true }),
          });
          // F2 = 重命名符号（对标 Zed Rename action，覆盖 Monaco 默认 F2）
          editor.addCommand(monaco.KeyCode.F2, () => {
            const info = wordAtCursor();
            if (info) onRenameSymbolRef.current?.(info);
          });
          // F12 = 跳到定义（对标 Zed GoToDefinition；覆盖 Monaco 默认 peek，与右键增强选择器一致）
          editor.addCommand(monaco.KeyCode.F12, () => {
            const info = wordAtCursor();
            if (info) onGoToDefinitionRef.current?.(info);
          });
          // Shift+F12 = 查找所有引用（对标 Zed FindAllReferences；覆盖 Monaco 默认 peek，与右键引用面板一致）
          editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F12, () => {
            const info = wordAtCursor();
            if (info) onFindReferencesRef.current?.(info.word);
          });
          // Alt+F12 = 内联 Peek 定义（对标 VS Code Peek Definition；覆盖 Monaco 默认，与右键 Peek 一致）。
          // 与 F12(跳转)/Shift+F12(引用) 互不冲突，形成「跳 / 引用 / 原地预览」三键位家族。
          editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.F12, () => {
            const info = peekInfoAtCursor();
            if (info) onPeekDefinitionRef.current?.(info);
          });
          // Ctrl/Cmd+Shift+L = 选中当前选区文本的全部出现位置（对标 Zed SelectAllMatches；VS Code 同键位）。
          // Monaco 本版本无对应内建命令，复用共享 helper 手动实现；与命令面板入口共用同一逻辑，零漂移。
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL, () => {
            selectAllMatchesOf(editorRef.current);
          });
          // F8 / Shift+F8 = 跳到下一个/上一个诊断（对标 Zed editor::GoToDiagnostic / GoToPrevDiagnostic）。
          // 仅在编辑器聚焦时生效（editor action 语义），不会与命令面板/模态冲突；与命令面板入口共用 goToProblem，零漂移。
          // 无标记时给轻量提示（Zed 会弹诊断气泡，这里用 toast 等价呈现严重度+消息）。
          const announceProblem = (count: number, dir: 1 | -1) => {
            if (count === 0) {
              useToastStore.getState().showToast(t("workbench.cmd.problemNone"), "info", 2600);
              return;
            }
            const m = (monaco.editor.getModelMarkers({ resource: editor.getModel()?.uri }) as any[])
              .filter((x: any) => x.severity >= (monaco.MarkerSeverity?.Hint ?? 1))
              .sort(
                (a: any, b: any) =>
                  a.startLineNumber - b.startLineNumber ||
                  a.startColumn - b.startColumn ||
                  a.endLineNumber - b.endLineNumber ||
                  a.endColumn - b.endColumn
              )[0];
            if (!m) return;
            const sev = m.severity >= (monaco.MarkerSeverity?.Error ?? 8) ? "error" : m.severity >= (monaco.MarkerSeverity?.Warning ?? 4) ? "warning" : "info";
            const label = `${dir === 1 ? "↓" : "↑"} L${m.startLineNumber}:${m.startColumn} · ${String(m.message).slice(0, 120)}`;
            useToastStore.getState().showToast(label, sev as any, 3200);
          };
          editor.addCommand(monaco.KeyCode.F8, () => {
            const count = goToProblem(editorRef.current, monacoRef.current, 1);
            announceProblem(count, 1);
          });
          editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F8, () => {
            const count = goToProblem(editorRef.current, monacoRef.current, -1);
            announceProblem(count, -1);
          });

          // 窗格同步滚动：用户滚动时按归一化比例广播（程序化滚动由 suppressScrollRef 抑制回声，断绝 A→B→A 死循环）
          editor.onDidScrollChange(() => {
            if (suppressScrollRef.current) {
              suppressScrollRef.current = false;
              return;
            }
            const ed = editorRef.current;
            if (!ed) return;
            const max = ed.getScrollHeight() - ed.getLayoutInfo().height;
            const ratio = max > 0 ? ed.getScrollTop() / max : 0;
            onScrollRef.current?.(ratio);
          });

          // 光标/选区状态（对标 Zed CursorPosition 状态栏项）：实时回传 行:列 + 选区统计
          const emitCursorStatus = () => {
            const pos = editor.getPosition();
            const sels = editor.getSelections() ?? [];
            const model = editor.getModel();
            let selectedLines = 0;
            let selectedChars = 0;
            for (const s of sels) {
              if (s.isEmpty()) continue;
              selectedLines += s.endLineNumber - s.startLineNumber;
              if (s.endColumn !== 0) selectedLines += 1;
              if (model) selectedChars += model.getValueInRange(s).length;
            }
            onCursorStatusRef.current?.({
              line: pos?.lineNumber ?? 1,
              column: pos?.column ?? 1,
              selections: sels.length || 1,
              selectedLines,
              selectedChars,
            });
          };

          // 文档信息（行尾符，对标 Zed LineEndingIndicator）：model 切换 / EOL 改变时回传
          const emitEditorInfo = () => {
            const model = editor.getModel();
            if (!model) return;
            const eol: EditorInfo["eol"] = model.getEOL() === "\r\n" ? "CRLF" : "LF";
            onEditorInfoRef.current?.({ eol });
          };

          // 列选择模式状态（对标 Zed ColumnarSelection 视觉反馈）：option 改变 / 挂载时回传
          const emitColumnSelection = () => {
            try {
              const on = !!editor.getOption(monaco.editor.EditorOption.columnSelection);
              onColumnSelectionRef.current?.(on);
            } catch {
              /* 读取选项异常时静默忽略 */
            }
          };

          // 编辑器字号（对标 Zed 字号设置在状态栏/设置可见）：option 改变 / 挂载时回传，供外壳状态栏显示 + 持久化
          const emitFontSize = () => {
            try {
              const size = (editor.getOption(monaco.editor.EditorOption.fontSize) as number) ?? FONT_SIZE_DEFAULT;
              onFontSizeRef.current?.(size);
            } catch {
              /* 读取选项异常时静默忽略 */
            }
          };

          // 诊断计数（状态栏「问题」指示项，对标 Zed 状态栏 Problems）：切换文件 / 挂载时按当前模型聚合
          const emitMarkerStats = () => {
            const model = editor.getModel();
            if (!model) {
              onMarkerStatsRef.current?.({ errors: 0, warnings: 0 });
              return;
            }
            try {
              const markers = monaco.editor.getModelMarkers({ resource: model.uri });
              const Sev = monaco.MarkerSeverity ?? {};
              let errors = 0;
              let warnings = 0;
              for (const m of markers as any[]) {
                if (m.severity === Sev.Error) errors++;
                else if (m.severity === Sev.Warning) warnings++;
              }
              onMarkerStatsRef.current?.({ errors, warnings });
            } catch {
              /* 读取标记异常时静默忽略 */
            }
          };

          // 选区联动：选中文本后供「AI 诊断选中代码」消费精确坐标
          editor.onDidChangeCursorSelection((e) => {
            const sel = e.selection;
            const model = editor.getModel();
            if (!sel || sel.isEmpty() || !model) {
              onSelectionChange?.(null);
            } else {
              const text = model.getValueInRange(sel);
              onSelectionChange?.(
                text.trim()
                  ? { text, startLine: sel.startLineNumber, endLine: sel.endLineNumber }
                  : null,
              );
            }
            emitCursorStatus();
          });
          editor.onDidChangeCursorPosition(() => emitCursorStatus());
          editor.onDidChangeModel?.(() => { emitCursorStatus(); emitEditorInfo(); emitMarkerStats(); emitColumnSelection(); emitWordWrap(); });
          editor.onDidChangeModelOptions?.(() => emitEditorInfo());
          // 软换行状态（对标 Zed 软换行视觉反馈）：option 改变 / 挂载时回传
          const emitWordWrap = () => {
            const ed = editorRef.current;
            const monaco = monacoRef.current;
            if (!ed || !monaco) return;
            try {
              const ww = ed.getOption(monaco.editor.EditorOption.wordWrap);
              onWordWrapRef.current?.(ww !== "off");
            } catch {
              /* 读取选项异常静默忽略 */
            }
          };

          // 列选择开关（toggleColumnSelection 经 updateOptions 触发）回传状态
          editor.onDidChangeConfiguration?.((e) => {
            if (e.hasChanged(monaco.editor.EditorOption.columnSelection)) emitColumnSelection();
            if (e.hasChanged(monaco.editor.EditorOption.wordWrap)) emitWordWrap();
            if (e.hasChanged(monaco.editor.EditorOption.fontSize)) emitFontSize();
          });
          // 挂载即上报初始光标位置（对标 Zed CursorPosition 在 active editor 切换时刷新）
          emitCursorStatus();
          emitEditorInfo();
          emitMarkerStats();
          emitColumnSelection();
          emitWordWrap();
          emitFontSize();

          // 行内审查发现标记（沟槽图标）点击：聚焦审查面板 + 打开行级行动浮层
          // （对标 Zed crates/diagnostics 的 hover 详情，差异化增强为「可点击行动」，避免死节点）。
          // 仅沟槽图标命中且整行标记携带 findingId 时触发，不干扰普通点击/双击跳转定义。
          editor.onMouseDown((e) => {
            const pos = e.target.position;
            if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && pos) {
              const hit = (marksRef.current || []).find((m) => m.line === pos.lineNumber && m.findingId);
              if (hit?.findingId) {
                e.event.preventDefault();
                onMarkClickRef.current?.(hit.findingId, (e.target.element as HTMLElement | null) ?? null);
                return;
              }
              // 沟槽点击（非诊断标记行）= 切换书签（对标 Zed 沟槽点击 ToggleBookmark；
              // 与诊断标记共用同一沟槽列，但书签行无 findingId，故落到此处；preventDefault 避免误触发选区）。
              e.event.preventDefault();
              onToggleBookmarkRef.current?.(pos.lineNumber);
              return;
            }
            const isDbl = e.event.detail === 2;
            const isMod = e.event.ctrlKey || e.event.metaKey;
            if (!isDbl && !isMod) return;
            const model = editor.getModel();
            if (!pos || !model) return;
            const word = model.getWordAtPosition(pos);
            if (!word || !word.word) return;
            onGoToDefinitionRef.current?.({ word: word.word, line: pos.lineNumber, column: pos.column });
          });

          // 按住 Ctrl/Cmd 悬停可定位符号 → 下划线 + 手型（传统 IDE 行为）
          editor.onMouseMove((e) => {
            lastHoverPosRef.current = e.target.position ?? null;
            modHeldRef.current = !!(e.event.ctrlKey || e.event.metaKey);
            void refreshGoto();
          });
          editor.onMouseLeave(() => {
            lastHoverPosRef.current = null;
            void refreshGoto();
          });

          // 实时语法/类型诊断 → 推送给 AI 面板（VS Code「修复此错误」的数据源）。
          // monaco 自带 TS/JS 诊断；其余语言无标记则自然为空，功能优雅降级，不影响其他逻辑。
          try {
            const pushDiags = () => {
              const model = editor.getModel();
              if (!model) {
                onMarkerStatsRef.current?.({ errors: 0, warnings: 0 });
                return;
              }
              try {
                const markers = monaco.editor.getModelMarkers({ resource: model.uri });
                // 同步聚合 Error/Warning 计数喂状态栏「问题」指示项（对标 Zed 状态栏 Problems）。
                let errors = 0;
                let warnings = 0;
                const Sev = monaco.MarkerSeverity ?? {};
                for (const m of markers as any[]) {
                  if (m.severity === Sev.Error) errors++;
                  else if (m.severity === Sev.Warning) warnings++;
                }
                onMarkerStatsRef.current?.({ errors, warnings });
                const diags: EditorDiagnostic[] = markers
                  .filter(
                    (m: any) => m.severity === monaco.MarkerSeverity.Error || m.severity === monaco.MarkerSeverity.Warning,
                  )
                  .map((m: any) => ({
                    message: m.message,
                    severity: m.severity === monaco.MarkerSeverity.Error ? "error" : "warning",
                    startLine: m.startLineNumber,
                    startColumn: m.startColumn,
                    endLine: m.endLineNumber,
                    endColumn: m.endColumn,
                    code: typeof m.code === "string" || typeof m.code === "number" ? String(m.code) : undefined,
                    source: m.source,
                  }));
                onDiagRef.current?.(diags);
              } catch {
                /* 读取标记异常时静默忽略 */
              }
            };
            pushDiags();
            diagSubRef.current = monaco.editor.onDidChangeMarkers((e: any) => {
              const uri = editor.getModel()?.uri;
              if (uri && e.affects(uri)) pushDiags();
            });
          } catch {
            /* 不支持诊断的语言静默降级 */
          }
          // 修饰键按下/松开时即时刷新（无需移动鼠标）
          const onKey = (ev: KeyboardEvent) => {
            modHeldRef.current = !!(ev.ctrlKey || ev.metaKey);
            void refreshGoto();
          };
          const dom = editor.getContainerDomNode?.() as HTMLElement | undefined;
          dom?.addEventListener("keydown", onKey);
          dom?.addEventListener("keyup", onKey);
        }}
        loading={<EditorFallback />}
      />
    </Suspense>
  );
});
