/**
 * 项目代码工作台（IDE 风格：文件树 + 多标签编辑器）
 *
 * 点击任意「打开源码」入口后拉起：左侧文件树加载整个已扫描项目（轻量元数据，
 * 内容按需懒加载），中间多标签 Monaco 编辑器，焦点定位到当前跳转的文件与行。
 * 取代原先的单文件查看 dialog，对齐「比 IDEA 更强的开发平台」定位。
 */

import { useEffect, useMemo, useState, useCallback, useRef, Fragment, CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import Dialog from "@mui/material/Dialog";
import Drawer from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import FolderIcon from "@mui/icons-material/Folder";
import PushPinIcon from "@mui/icons-material/PushPin";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import SearchIcon from "@mui/icons-material/Search";
import ListAltIcon from "@mui/icons-material/ListAlt";
import { useTheme } from "@mui/material/styles";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import TerminalIcon from "@mui/icons-material/Terminal";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import TextSnippetIcon from "@mui/icons-material/TextSnippet";
import LabelIcon from "@mui/icons-material/Label";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CodeIcon from "@mui/icons-material/Code";
import {
  useCodeWorkbenchStore,
  openWorkbenchTab,
  type WorkbenchTab,
  type PaneNode,
  type PaneOrientation,
  type SplitDirection,
} from "../../store/codeWorkbenchStore";
import { useProjectStore } from "../../store/projectStore";
import { useToastStore } from "../../store/toastStore";
import { useAgentStore } from "../../store/agentStore";
import { MonacoCodeEditor, type HeatRange, type DeadRange, type CloneRange, type EditorSelectionInfo, type MonacoEditorHandle, type CursorStatus, type EditorInfo, type MarkerStats } from "./MonacoCodeEditor";
import type { SourceMark } from "../../store/sourceViewerStore";
import { useEditorDiagnosticsStore } from "../../store/editorDiagnosticsStore";
import { useProblemsPanelStore } from "../../store/problemsPanelStore";
import { triggerDiagnosis } from "../../ai/triggerDiagnosis";
import { L } from "../../ai/aiLang";
import { CommandPalette, type WorkbenchCommand } from "./CommandPalette";
import { GotoLineDialog } from "./GotoLineDialog";
import { BookmarkPicker } from "./BookmarkPicker";
import { WorkbenchSearchPanel } from "./WorkbenchSearchPanel";
import { WorkbenchEditorPane } from "./WorkbenchEditorPane";
import { WorkbenchAiPanel } from "./WorkbenchAiPanel";
import { WorkbenchTerminalTabs } from "./WorkbenchTerminalTabs";
import { WorkbenchProblemsPanel } from "./WorkbenchProblemsPanel";
import { sendToActiveTerminal } from "./terminalBus";
import { RequirementsPanel } from "./RequirementsPanel";

/** 稳定的空标签数组，避免选择器返回新引用触发多余重渲染 */
const EMPTY_TABS: WorkbenchTab[] = [];
import { InlineChat } from "./InlineChat";
import { t } from "../../i18n";
import { readLineFromMetadata } from "../utils/sourceNavigate";
import { parseFileMetricMeta, projectScanApi, type FileChangeEvent, type ProjectFile, type ProjectSymbol } from "../../services/tauri";
import { languageColor } from "../../utils/languageMeta";
import { LanguageIcon } from "../../utils/languageIcon";

/** 查找引用结果项（合并 symbolRefs 与 callEdges 去重后） */
interface UsageHit {
  fileId: string;
  filePath: string;
  line: number;
  text: string;
  kind: string;
}

/** 引用结果按文件分组的呈现单元（对标 Zed find_all_references 的多缓冲分组） */
interface UsageGroup {
  fileId: string;
  label: string;
  count: number;
  items: UsageHit[];
}

/** 重命名目标：一个 (文件, 行) 定位点（行级精度，匹配我们 symbolRefs 数据现实） */
interface RenameTarget {
  fileId: string;
  filePath: string;
  line: number;
}

/** 转义正则特殊字符（符号名可能含 $ 等） */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 在单行内按词边界把旧名替换为新名（对标 Zed perform_rename 的精确范围改写，
 *  我们无列精度，退化为「整行词边界全替换」——同一行内该符号的每次出现都重命名）。
 *  返回改写后的文本与替换次数，未命中则 text 不变、count=0。 */
function replaceWordOnLine(
  line: string,
  oldName: string,
  newName: string,
): { text: string; count: number } {
  if (!oldName) return { text: line, count: 0 };
  const re = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, "g");
  let count = 0;
  const text = line.replace(re, () => {
    count++;
    return newName;
  });
  return { text, count };
}

/**
 * 符号重命名提交事件总线（模块级）。
 * 生产方：CodeWorkbenchBody.confirmRename 写盘成功后 emit(oldName, newName)。
 * 消费方：EditorPane 的引用抽屉订阅，乐观刷新（标题/预览/懒读缓存切到新名）。
 * 解耦两个组件作用域，避免把引用面板状态上移或 prop 层层透传（零回归）。
 */
type SymbolRenamedListener = (oldName: string, newName: string) => void;
const symbolRenamedListeners = new Set<SymbolRenamedListener>();
function emitSymbolRenamed(oldName: string, newName: string) {
  for (const l of symbolRenamedListeners) l(oldName, newName);
}
function onSymbolRenamed(listener: SymbolRenamedListener): () => void {
  symbolRenamedListeners.add(listener);
  return () => {
    symbolRenamedListeners.delete(listener);
  };
}

/** 符号 kind → 短标签（大纲行首徽标）。getter 而非模块级 const：
 *   const 会在模块加载时固化中文（切语言不刷新，历史教训 ×3）。 */
function symbolKindLabel(kind: string): string {
  const label = t(`workbench.symbolKind.${kind}`);
  // t() 对未知 key 返回 key 本身 → 用带前缀的 key 判断是否命中
  return label !== `workbench.symbolKind.${kind}` ? label : kind;
}

/** 符号 kind → 着色（按类别，与语言着色区分） */
function symbolKindColor(kind: string): string {
  switch (kind) {
    case "class":
    case "interface":
    case "struct":
    case "enum":
    case "type":
      return "#a371f7";
    case "function":
    case "method":
    case "constructor":
      return "#3fb950";
    case "module":
    case "namespace":
      return "#d29922";
    case "variable":
    case "const":
    case "let":
    case "field":
    case "property":
      return "#58a6ff";
    default:
      return "#8b949e";
  }
}

/** 大纲符号树节点（按 lineStart/lineEnd 包含关系推导层级，对标 Zed outline 的嵌套结构） */
interface OutlineNode {
  sym: ProjectSymbol;
  children: OutlineNode[];
  depth: number;
}

/** 大纲「按类型聚类」视图的 kind 稳定排序（类型 → 函数 → 模块 → 变量 → 其它），让聚类分组顺序可预期 */
const KIND_ORDER = [
  "class", "interface", "struct", "enum", "type",
  "function", "method", "constructor",
  "module", "namespace",
  "variable", "const", "let", "field", "property",
  "unknown",
];
function kindSortIndex(kind: string): number {
  const i = KIND_ORDER.indexOf(kind || "unknown");
  return i < 0 ? KIND_ORDER.length : i;
}

/**
 * 由平铺符号列表推导嵌套大纲：子符号的 [lineStart,lineEnd] 落在其父符号范围内即视为嵌套。
 * 排序先按 lineStart 升序、同行再按 lineEnd 降序，保证更宽（更外层）的符号先入栈成为父节点。
 * 栈式算法：每处理一个符号，先把「不再包含它」的栈顶弹出，剩余栈顶即其最近父节点。
 */
function buildOutlineTree(symbols: ProjectSymbol[]): OutlineNode[] {
  const sorted = symbols
    .slice()
    .sort((a, b) => a.lineStart - b.lineStart || b.lineEnd - a.lineEnd);
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const sym of sorted) {
    const node: OutlineNode = { sym, children: [], depth: 0 };
    while (stack.length) {
      const top = stack[stack.length - 1];
      const contained =
        top.sym.lineStart <= sym.lineStart &&
        sym.lineEnd <= top.sym.lineEnd &&
        !(top.sym.lineStart === sym.lineStart && top.sym.lineEnd === sym.lineEnd);
      if (contained) break;
      stack.pop();
    }
    if (stack.length) {
      const parent = stack[stack.length - 1];
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  }
  return roots;
}

/** 深度优先收集子树全部节点（含根），用于「全部展开/折叠」与过滤。 */
function collectOutlineNodes(nodes: OutlineNode[], acc: OutlineNode[] = []): OutlineNode[] {
  for (const n of nodes) {
    acc.push(n);
    if (n.children.length) collectOutlineNodes(n.children, acc);
  }
  return acc;
}

/** 子树最佳模糊命中分（用于排序：命中越靠前/越连续越优先，贴近 Zed picker 体验）。 */
function outlineNodeBestScore(n: OutlineNode, q: string): number {
  const self = fuzzyScore(n.sym.name, q) ?? -Infinity;
  let best = self;
  for (const c of n.children) best = Math.max(best, outlineNodeBestScore(c, q));
  return best;
}

/** 递归模糊剪枝 + 排序（对标 Zed outline/picker 的模糊评分过滤，05:00 待续③）：
 *  保留「自身命中」或「含命中后代」的节点（自动展开匹配分支），并对每层按子树最佳分降序、
 *  同行按行号升序排序，使最相关符号排在顶部，而非原始出现顺序。 */
function filterOutlineTree(nodes: OutlineNode[], q: string): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const n of nodes) {
    const self = fuzzyScore(n.sym.name, q);
    const kids = filterOutlineTree(n.children, q);
    if (self != null || kids.length) out.push({ ...n, children: kids });
  }
  out.sort(
    (a, b) =>
      outlineNodeBestScore(b, q) - outlineNodeBestScore(a, q) || a.sym.lineStart - b.sym.lineStart,
  );
  return out;
}

/** 圈复杂度 → 等级（McCabe 通用阈值） */
export function ccLevel(cc: number): HeatRange["level"] {
  if (cc <= 5) return "low";
  if (cc <= 10) return "medium";
  if (cc <= 20) return "high";
  return "extreme";
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  fileId?: string;
  language?: string | null;
  children: TreeNode[];
}

/** 路径归一化：去反斜杠、去 ./ 前缀、去首尾斜杠、去空段，保证 dirIndex key 一致 */
function normalizeRel(rel: string): string {
  return rel
    .replace(/\\/g, "/")
    .replace(/^\.+\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter((s) => s.length > 0)
    .join("/");
}

/** 由 files 表（轻量元数据）按 relPath 构建目录树 */
function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  const dirIndex = new Map<string, TreeNode>();
  dirIndex.set("", root);

  const getOrCreateDir = (normPath: string): TreeNode => {
    const existing = dirIndex.get(normPath);
    if (existing) return existing;
    const parts = normPath.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const parent = parentPath ? getOrCreateDir(parentPath) : root;
    const node: TreeNode = { name, path: normPath, isDir: true, children: [] };
    parent.children.push(node);
    dirIndex.set(normPath, node);
    return node;
  };

  for (const f of files) {
    const norm = normalizeRel(f.relPath);
    if (!norm) continue;
    if (f.isDirectory) {
      getOrCreateDir(norm);
      continue;
    }
    const parts = norm.split("/");
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const parent = parentPath ? getOrCreateDir(parentPath) : root;
    parent.children.push({
      name: f.name || parts[parts.length - 1],
      path: norm,
      isDir: false,
      fileId: f.id,
      language: f.language,
      children: [],
    });
  }

  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
    );
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root.children;
}

/** 文件树按名称筛选：保留匹配节点及其全部祖先目录，其余裁剪；空壳目录（目录名命中）也保留。 */
function filterTreeNodes(nodes: TreeNode[], rawQuery: string): TreeNode[] {
  const q = rawQuery.toLowerCase();
  const rec = (n: TreeNode): TreeNode | null => {
    if (n.isDir) {
      const kids = n.children.map(rec).filter((x): x is TreeNode => x !== null);
      if (kids.length > 0) return { ...n, children: kids };
      if (n.name.toLowerCase().includes(q)) return { ...n, children: [] };
      return null;
    }
    return n.name.toLowerCase().includes(q) ? n : null;
  };
  return nodes.map(rec).filter((x): x is TreeNode => x !== null);
}

/** 收集树中所有目录路径（用于筛选时自动全展开，使命中节点可见）。 */
function collectDirPaths(nodes: TreeNode[]): Set<string> {
  const out = new Set<string>();
  const rec = (n: TreeNode) => {
    if (n.isDir) {
      out.add(n.path);
      n.children.forEach(rec);
    }
  };
  nodes.forEach(rec);
  return out;
}

// ───────────────────────── 文件树右键菜单（复用 ProjectTree 的专业视觉语言）─────────────────────────
// 卡片小箭头 + 分区大写标题 + 独立语义图标 + 细分割线，与项目树右键菜单视觉一致。
const treeMenuSx = {
  minWidth: 200,
  borderRadius: 2,
  py: 0.5,
  overflow: "visible",
  boxShadow: (theme: any) =>
    theme.palette.mode === "dark"
      ? "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)"
      : "0 8px 32px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.04)",
  "&:before": {
    content: '""',
    display: "block",
    position: "absolute",
    top: 12,
    left: -5,
    width: 10,
    height: 10,
    bgcolor: "background.paper",
    transform: "rotate(45deg)",
    zIndex: 0,
    boxShadow: (theme: any) =>
      theme.palette.mode === "dark"
        ? "-2px 2px 4px rgba(0,0,0,0.2)"
        : "-2px 2px 4px rgba(0,0,0,0.06)",
  },
} as const;
const treeItemSx = {
  py: 0.75,
  px: 1.5,
  borderRadius: 0.75,
  mx: 0.5,
  "&:hover": { backgroundColor: "action.hover" },
} as const;
const treeHeaderSx = { px: 1.5, py: 0.4, mb: 0.25 } as const;
const treeHeaderTextSx = {
  fontWeight: 600,
  color: "text.secondary",
  fontSize: 10,
  letterSpacing: 0.5,
  textTransform: "uppercase",
} as const;

/** 轻量模糊匹配评分：子序列命中返回分数（越靠前/越连续越高），否则 null。 */
function fuzzyScore(text: string, rawQuery: string): number | null {
  const t = text.toLowerCase();
  const q = rawQuery.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < q.length; i++) {
    const idx = t.indexOf(q[i], ti);
    if (idx === -1) return null;
    streak = idx === ti ? streak + 1 : 0;
    score += 1 + streak * 2;
    ti = idx + 1;
  }
  return score - t.length * 0.01;
}

// 模糊匹配（对标 Zed file_finder 的 HighlightedLabel）：在 fuzzyScore 基础上额外返回命中字符的连续区间，
// 供结果列表高亮匹配位置，让用户看清「为何命中」。返回 null 表示不匹配。
function fuzzyMatch(
  text: string,
  rawQuery: string,
): { score: number; ranges: [number, number][] } | null {
  const t = text.toLowerCase();
  const q = rawQuery.toLowerCase();
  if (!q) return { score: 0, ranges: [] };
  let ti = 0;
  let score = 0;
  let streak = 0;
  const idxs: number[] = [];
  for (let i = 0; i < q.length; i++) {
    const idx = t.indexOf(q[i], ti);
    if (idx === -1) return null;
    streak = idx === ti ? streak + 1 : 0;
    score += 1 + streak * 2;
    idxs.push(idx);
    ti = idx + 1;
  }
  // 把命中下标合并成连续区间 [start,end]
  const ranges: [number, number][] = [];
  let start = idxs[0];
  let prev = idxs[0];
  for (let i = 1; i < idxs.length; i++) {
    if (idxs[i] === prev + 1) {
      prev = idxs[i];
    } else {
      ranges.push([start, prev]);
      start = idxs[i];
      prev = idxs[i];
    }
  }
  ranges.push([start, prev]);
  return { score: score - t.length * 0.01, ranges };
}

// 解析 Zed 式「路径:行[:列]」后缀（对标 Zed PathWithPosition::parse_str）。
// 返回真正用于模糊匹配的 search 部分，以及解析出的行/列（无后缀则均为 null）。
function parsePathWithPosition(raw: string): {
  search: string;
  line: number | null;
  col: number | null;
} {
  const m = raw.match(/^(.+?):(\d+)(?::(\d+))?\s*$/);
  if (m) {
    return {
      search: m[1],
      line: parseInt(m[2], 10),
      col: m[3] ? parseInt(m[3], 10) : null,
    };
  }
  return { search: raw, line: null, col: null };
}

function FileTreeNode({
  node,
  depth,
  expanded,
  onToggle,
  onOpen,
  activeFileId,
  onDragFileStart,
  onDragFileEnd,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (fileId: string) => void;
  activeFileId: string | null;
  /** 从文件树拖出文件（对标 Zed 项目面板拖条目到窗格）：起始记录 fileId */
  onDragFileStart?: (fileId: string) => void;
  onDragFileEnd?: () => void;
  /** 右键唤起上下文菜单（与项目树一致：打开源码/AI 诊断/复制路径/在文件管理器显示） */
  onContextMenu?: (node: TreeNode, e: ReactMouseEvent) => void;
}) {
  const pad = { pl: depth * 2 + 2 };
  if (node.isDir) {
    const open = expanded.has(node.path);
    return (
      <Box>
        <Box
          onClick={() => onToggle(node.path)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(node, e); }}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            py: 0.4,
            paddingLeft: pad.pl,
            paddingRight: 1,
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
            userSelect: "none",
          }}
        >
          <FolderIcon sx={{ fontSize: 15, color: "#f59e0b" }} />
          <Typography variant="caption" sx={{ fontSize: 11.5, lineHeight: 1.4 }}>
            {node.name}
          </Typography>
        </Box>
      {open &&
        node.children.map((c) => (
          <FileTreeNode
            key={c.path}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onOpen={onOpen}
            activeFileId={activeFileId}
            onDragFileStart={onDragFileStart}
            onDragFileEnd={onDragFileEnd}
            onContextMenu={onContextMenu}
          />
        ))}
      </Box>
    );
  }
  const active = node.fileId === activeFileId;
  return (
    <Box
      onClick={() => node.fileId && onOpen(node.fileId)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(node, e); }}
      draggable={!!node.fileId}
      onDragStart={(e) => {
        if (!node.fileId) return;
        e.dataTransfer.effectAllowed = "copy";
        // 阻止默认拖拽文本/图标行为，确保拖的是「文件条目」而非选区
        e.dataTransfer.setData("text/plain", node.fileId);
        onDragFileStart?.(node.fileId);
      }}
      onDragEnd={() => onDragFileEnd?.()}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        py: 0.4,
        paddingLeft: pad.pl,
        paddingRight: 1,
        cursor: "pointer",
        bgcolor: active ? "rgba(59,130,246,0.14)" : "transparent",
        color: active ? "primary.main" : "text.primary",
        "&:hover": { bgcolor: active ? "rgba(59,130,246,0.20)" : "action.hover" },
        userSelect: "none",
        fontWeight: active ? 600 : 400,
      }}
    >
      <LanguageIcon lang={node.language} size={14} />
      <Typography
        variant="caption"
        noWrap
        sx={{ fontSize: 11.5, lineHeight: 1.4, flex: 1, minWidth: 0 }}
      >
        {node.name}
      </Typography>
    </Box>
  );
}

export function EditorPane({
  tab,
  themeMode,
  heatRanges,
  deadRanges,
  cloneRanges,
  marks,
  onAskAi,
  onChangeCapture,
  onRequestAiOpen,
  gotoSymbols,
  editorHandleRef,
  onSelectionExternal,
  onCursorStatusChange,
  onEditorInfoChange,
  onMarkerStatsChange,
  onColumnSelectionChange,
  onWordWrapChange,
  onFontSizeChange,
  onMarkClick,
  onRenameSymbol,
  onGoToDefinition,
  openFileInSplit,
  onScroll,
  bookmarks,
  onToggleBookmark,
}: {
  tab: WorkbenchTab;
  themeMode: "light" | "dark";
  heatRanges: HeatRange[];
  deadRanges: DeadRange[];
  cloneRanges: CloneRange[];
  /** 行内洞察标记（审查发现），由外壳按激活文件从 findings 实时推导后传入 */
  marks?: SourceMark[];
  onAskAi?: (sel: EditorSelectionInfo) => void;
  /** 编辑器内容变更回调（Body 用于收集最新文本 + 置脏标记） */
  onChangeCapture?: (text: string) => void;
  /** 请求展开内嵌 AI 面板（诊断按钮等在工作台独立窗口内无画布订阅者，需显式展开） */
  onRequestAiOpen?: () => void;
  /** 可定位符号名（小写集合），用于按住 Ctrl/⌘ 悬停显示跳转下划线 */
  gotoSymbols?: string[];
  /** 暴露给工作台 AI 面板的编辑器命令句柄（插入光标 / 应用到文件 / 跳转） */
  editorHandleRef?: React.MutableRefObject<MonacoEditorHandle | null>;
  /** 选区变化上报（供 Body 维护 AI 上下文芯片） */
  onSelectionExternal?: (sel: EditorSelectionInfo | null) => void;
  /** 光标/选区状态回传（供外壳状态栏渲染行:列 + 选区统计，对标 Zed CursorPosition 状态栏项） */
  onCursorStatusChange?: (status: CursorStatus) => void;
  /** 编辑器文档信息回传（行尾符 LF/CRLF，对标 Zed LineEndingIndicator 状态栏项） */
  onEditorInfoChange?: (info: EditorInfo) => void;
  /** 诊断计数回传（供外壳状态栏渲染「问题」指示项：N 错误 · M 警告，对标 Zed 状态栏 Problems） */
  onMarkerStatsChange?: (stats: MarkerStats) => void;
  /** 列选择模式状态回传（供外壳状态栏渲染指示项，对标 Zed ColumnarSelection 视觉反馈） */
  onColumnSelectionChange?: (on: boolean) => void;
  /** 软换行状态回传（供外壳状态栏渲染指示项，对标 Zed 软换行视觉反馈） */
  onWordWrapChange?: (on: boolean) => void;
  /** 编辑器字号变化回传（供外壳状态栏渲染字号缩放控件，对标 Zed 字号设置在状态栏可见） */
  onFontSizeChange?: (size: number) => void;
  /** 行内审查发现标记（沟槽图标）点击回调：传回 findingId 与锚点 DOM，供外壳聚焦/行动 */
  onMarkClick?: (findingId: string, anchorEl: HTMLElement | null) => void;
  /** 重命名符号：右键菜单 / F2 触发，由外壳聚合引用并弹出确认（对标 Zed editor::Rename） */
  onRenameSymbol?: (info: { word: string; line: number; column: number }) => void;
  /** 跳转到定义：右键菜单 / Ctrl+单击触发；多定义时由外壳弹候选选择器（对标 Zed navigate_to_hover_links） */
  onGoToDefinition?: (info: { word: string; line: number; column: number }) => void;
  /** 编辑器滚动比例（0~1）变化回调：由外壳用于窗格同步滚动（对标 Zed 多窗格同文件对照滚动） */
  onScroll?: (ratio: number) => void;
  /** 当前文件的书签行号集合（来自外壳 store.bookmarks[fileId]），供编辑器沟槽渲染琥珀金标记 */
  bookmarks?: number[];
  /** 沟槽点击切换书签的回调：传回被点击行号（1 起），由外壳写入/移除 store 书签（对标 Zed 沟槽点击 ToggleBookmark） */
  onToggleBookmark?: (line: number) => void;
  /** 在分屏打开文件（Peek / 选择等分屏动作复用，对标 Zed split 打开；dir 复用 lastSplitDirRef 会话记忆） */
  openFileInSplit?: (
    fid: string,
    relPath: string,
    name: string,
    language: string | null,
    line: number | null,
    dir?: SplitDirection,
    column?: number | null
  ) => void;
}) {
  const [selection, setSelection] = useState<EditorSelectionInfo | null>(null);
  const [usagesOpen, setUsagesOpen] = useState(false);
  const [usages, setUsages] = useState<UsageHit[]>([]);
  const [usagesWord, setUsagesWord] = useState("");
  // 内联 Peek 定义浮层状态（对标 VS Code Peek Definition；单定义场景原地预览，Esc 返回）。多定义回落 onGoToDefinition（DefinitionPicker）。
  const [peek, setPeek] = useState<{
    word: string;
    fileId: string;
    relPath: string;
    name: string;
    language: string | null;
    line: number;
    anchor: { x: number; y: number } | null;
  } | null>(null);
  const symbols = useProjectStore((s) => s.symbols);
  const symbolRefs = useProjectStore((s) => s.symbolRefs);
  const callEdges = useProjectStore((s) => s.callEdges);
  const files = useProjectStore((s) => s.files);

  // ── 引用结果按文件分组 + 键盘导航（对标 Zed find_all_references 的多缓冲分组呈现）──
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selIdx, setSelIdx] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement | null>(null);
  // 编辑器光标行（对标 Zed find_all_references 的「active match 跟随光标」）：本窗格作用域，
  // 用于引用抽屉高亮「光标当前所在行的引用」并自动定位，使抽屉成为「我在引用中的位置」实时地图。
  const [cursorLine, setCursorLine] = useState(0);
  // 引用行内代码预览：对标 Zed find_all_references 多缓冲 excerpt（引用呈现真实代码 + 命中词高亮）。
  // 按 fileId 去重懒读源码（每文件只读一次），封顶 24 个文件防超大项目卡顿；读取失败静默降级到静态 h.text。
  const [refExcerpts, setRefExcerpts] = useState<Record<string, string[]>>({});
  const refExcerptsRef = useRef<Record<string, string[]>>({});
  useEffect(() => {
    refExcerptsRef.current = refExcerpts;
  }, [refExcerpts]);

  const groupedUsages = useMemo<UsageGroup[]>(() => {
    const map = new Map<string, UsageHit[]>();
    const order: string[] = [];
    for (const h of usages) {
      if (!map.has(h.fileId)) {
        map.set(h.fileId, []);
        order.push(h.fileId);
      }
      map.get(h.fileId)!.push(h);
    }
    const groups: UsageGroup[] = order.map((fileId) => {
      const items = map.get(fileId)!.slice().sort((a, b) => a.line - b.line);
      const label = files.find((f) => f.id === fileId)?.relPath ?? items[0].filePath;
      return { fileId, label, count: items.length, items };
    });
    groups.sort((a, b) => a.label.localeCompare(b.label));
    return groups;
  }, [usages, files]);

  const flat = useMemo(() => {
    const items: UsageHit[] = [];
    const idxMap = new Map<string, number>();
    for (const g of groupedUsages) {
      if (collapsed.has(g.fileId)) continue;
      for (const it of g.items) {
        const key = `${it.fileId}:${it.line}`;
        if (!idxMap.has(key)) {
          idxMap.set(key, items.length);
          items.push(it);
        }
      }
    }
    return { items, idxMap };
  }, [groupedUsages, collapsed]);

  // 光标跟随：仅本窗格文件(tab.fileId)的引用能命中，跨文件抽屉不会误标（光标行恒为当前文件行）。
  const cursorUidx =
    cursorLine > 0 ? flat.idxMap.get(`${tab.fileId}:${cursorLine}`) ?? -1 : -1;

  const jumpTo = useCallback(
    (h: UsageHit) => {
      openWorkbenchTab(h.fileId, h.line, t("workbench.jumpToUsage", { name: usagesWord }));
      // 保持抽屉打开，便于像 Zed 多缓冲引用面板那样逐步跳转
    },
    [openWorkbenchTab, usagesWord],
  );

  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (flat.items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelIdx((i) => Math.min(i + 1, flat.items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const it = flat.items[selIdx >= 0 ? selIdx : 0];
        if (it) jumpTo(it);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setUsagesOpen(false);
      }
    },
    [flat.items, selIdx, jumpTo],
  );

  // 新的一次查找：重置折叠与选中
  useEffect(() => {
    setCollapsed(new Set());
    setSelIdx(-1);
  }, [usages]);

  // 抽屉打开：聚焦列表以便键盘导航
  useEffect(() => {
    if (usagesOpen) {
      const id = requestAnimationFrame(() => listRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [usagesOpen]);

  // 选中项滚动入视口（不抢焦点）
  useEffect(() => {
    if (selIdx < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-uidx="${selIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selIdx, flat]);

  // 光标跟随：编辑器光标落在某引用行时，将该条目滚入视口（仅当命中项变化时才滚动，不抢焦点）
  useEffect(() => {
    if (cursorUidx < 0 || !usagesOpen) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-uidx="${cursorUidx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursorUidx, usagesOpen, flat]);

  // 抽屉打开：按 fileId 懒读被引用文件源码（跨文件引用组在抽屉内直接预览该行代码，对标 Zed 多缓冲 excerpt）
  useEffect(() => {
    if (!usagesOpen) {
      setRefExcerpts({});
      return;
    }
    let cancelled = false;
    const fileIds = Array.from(new Set(usages.map((u) => u.fileId))).slice(0, 24);
    (async () => {
      const map: Record<string, string[]> = { ...refExcerptsRef.current };
      for (const fid of fileIds) {
        if (map[fid]) continue;
        try {
          const src = await projectScanApi.readSourceFile(fid);
          if (!src.skippedReason) map[fid] = src.lines;
        } catch {
          // 读取失败（二进制/过大/越权）：静默跳过，绝不阻断抽屉
        }
      }
      if (!cancelled) setRefExcerpts(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [usagesOpen, usages]);

  // 重命名提交事件 → 乐观刷新引用抽屉（仅当抽屉正展示被重命名的符号）。
  // 对标 Zed find_all_references：引用视图持有真实 buffer 锚点，重命名后文本即时更新；我们无共享 buffer，
  // 故订阅全局重命名事件主动同步标题/预览/懒读缓存到新名，避免抽屉变成旧名死视图（renderable≠useful）。
  useEffect(() => {
    return onSymbolRenamed((oldName, newName) => {
      if (!usagesOpen || usagesWord !== oldName) return;
      // 命中行预览文本逐行按词边界替换旧名→新名（与 rename 同语义，全局多命中）
      setUsages((prev) =>
        prev.map((h) => ({ ...h, text: replaceWordOnLine(h.text, oldName, newName).text })),
      );
      // 抽屉标题 + 行内高亮锚点（highlightCode 以 usagesWord 为命中词）切到新名
      setUsagesWord(newName);
      // 懒读源码缓存同步替换——否则引用预览仍从缓存读旧名代码行；替换后上方 effect 因该 fileId 已在
      // refExcerpts 中而跳过重取，保留我们乐观写入的内容，零闪动。
      setRefExcerpts((prev) => {
        const next: Record<string, string[]> = {};
        for (const fid of Object.keys(prev)) {
          next[fid] = prev[fid].map((ln) => replaceWordOnLine(ln, oldName, newName).text);
        }
        return next;
      });
      // 同步 ref，避免上方 effect 读取到未更新的 ref 而跳过重取（与 state 保持一致）
      const refNext: Record<string, string[]> = {};
      for (const fid of Object.keys(refExcerptsRef.current)) {
        refNext[fid] = refExcerptsRef.current[fid].map((ln) =>
          replaceWordOnLine(ln, oldName, newName).text,
        );
      }
      refExcerptsRef.current = refNext;
    });
  }, [usagesOpen, usagesWord]);

  // 编辑落盘：最新文本由 Body 的 onChangeCapture 收集，脏标记与保存也在 Body 统一管理


  // 查找引用：合并 symbolRefs（通用符号引用）与 callEdges（函数调用），按(文件,行)去重
  const handleFindUsages = useCallback(
    (word: string) => {
      const hits: UsageHit[] = [];
      const seen = new Set<string>();
      for (const r of symbolRefs) {
        if (r.symbolName !== word) continue;
        const k = `${r.fromFileId}:${r.refLine}`;
        if (seen.has(k)) continue;
        seen.add(k);
        hits.push({ fileId: r.fromFileId, filePath: r.fromFilePath, line: r.refLine, text: r.refText, kind: `ref:${r.kind}` });
      }
      for (const e of callEdges) {
        if (e.calleeName !== word) continue;
        const k = `${e.callerFileId}:${e.lineNo}`;
        if (seen.has(k)) continue;
        seen.add(k);
        hits.push({ fileId: e.callerFileId, filePath: e.callerFilePath, line: e.lineNo, text: `${e.callerName}()`, kind: "call" });
      }
      hits.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line);
      setUsages(hits);
      setUsagesWord(word);
      setUsagesOpen(true);
    },
    [symbolRefs, callEdges],
  );

  // 内联 Peek 定义（对标 VS Code Peek Definition；Zed 无此能力，我们自建浮层）。
  // 与 onGoToDefinition 同源解析，但单定义不跳转——弹浮层原地预览；多定义回落既有 DefinitionPicker（onGoToDefinition，零回归）。
  const handlePeekDefinition = useCallback(
    (info: { word: string; line: number; column: number; anchor: { x: number; y: number } | null }) => {
      const word = info.word;
      if (!word) return;
      let matches = symbols.filter((s) => s.name === word);
      if (matches.length === 0) {
        const ci = symbols.find((s) => s.name.toLowerCase() === word.toLowerCase());
        if (ci) matches = [ci];
      }
      if (matches.length === 0) {
        useToastStore.getState().showToast(t("workbench.peekNoDefinition", { name: word }), "info");
        return;
      }
      if (matches.length > 1) {
        // 多定义：复用既有 DefinitionPicker（已含分组/折叠），peek 仅增强单定义场景，避免重复 UI 与行为漂移。
        onGoToDefinition?.(info);
        return;
      }
      const best = matches[0];
      const file = files.find((f) => f.id === best.fileId);
      setPeek({
        word,
        fileId: best.fileId,
        relPath: best.filePath,
        name: file?.name ?? best.filePath.split("/").pop() ?? best.filePath,
        language: file?.language ?? null,
        line: best.lineStart,
        anchor: info.anchor,
      });
    },
    [symbols, files, onGoToDefinition],
  );

  // 右键菜单「AI 诊断此符号」：把光标处符号名 + 精确行号交给 AI（复用既有 triggerDiagnosis 通道，
  // 结论自动回流画布；让编辑器右键菜单从「导航」升级为「可执行的分析动作」）。
  const handleDiagnoseSymbolAt = useCallback(
    (info: { word: string; line: number; column: number }) => {
      if (!tab.relPath) return;
      void triggerDiagnosis({
        filePath: tab.relPath,
        kind: "complexity",
        title: info.word,
        lineRange: [info.line, info.line],
      });
    },
    [tab.relPath],
  );

  if (tab.loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 1.5 }}>
        <CircularProgress size={22} />
        <Typography variant="body2" color="text.secondary">
          {t("workbench.loading")}
        </Typography>
      </Box>
    );
  }
  if (tab.error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{t("workbench.loadFail", { error: tab.error })}</Alert>
      </Box>
    );
  }
  if (!tab.content) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">{t("workbench.noActive")}</Alert>
      </Box>
    );
  }
  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 0, bgcolor: themeMode === "dark" ? "#0d1117" : "#ffffff" }}>
      <MonacoCodeEditor
        key={tab.fileId}
        value={tab.content.lines.join("\n")}
        language={tab.content.language}
        theme={themeMode}
        readOnly={tab.readOnly}
        onChange={(val) => onChangeCapture?.(val ?? "")}
        revealLine={tab.focusLine}
        revealColumn={tab.focusColumn}
        marks={marks}
        heatRanges={heatRanges}
        deadRanges={deadRanges}
        cloneRanges={cloneRanges}
        onSelectionChange={(sel) => {
          setSelection(sel);
          onSelectionExternal?.(sel);
        }}
        onGoToDefinition={onGoToDefinition}
        onFindReferences={handleFindUsages}
        onPeekDefinition={handlePeekDefinition}
        onDiagnoseSymbol={handleDiagnoseSymbolAt}
        onRenameSymbol={onRenameSymbol}
        gotoSymbols={gotoSymbols}
        onDiagnosticsChange={(diags) => useEditorDiagnosticsStore.getState().setDiagnostics(tab.relPath, diags)}
        onCursorStatusChange={(status) => {
          setCursorLine(status.line);
          onCursorStatusChange?.(status);
        }}
        onEditorInfoChange={onEditorInfoChange}
        onMarkerStatsChange={onMarkerStatsChange}
        onColumnSelectionChange={onColumnSelectionChange}
        onWordWrapChange={onWordWrapChange}
        onFontSizeChange={onFontSizeChange}
        onMarkClick={onMarkClick}
        onScroll={onScroll}
        bookmarks={bookmarks}
        onToggleBookmark={onToggleBookmark}
        ref={editorHandleRef}
      />
      {peek && (
        <PeekPanel
          word={peek.word}
          fileId={peek.fileId}
          relPath={peek.relPath}
          name={peek.name}
          language={peek.language}
          line={peek.line}
          anchor={peek.anchor}
          onClose={() => setPeek(null)}
          onOpen={(fid, relPath, name, language, line) =>
            openFileInSplit?.(fid, relPath, name, language, line)
          }
        />
      )}
      <Box sx={{ position: "absolute", top: 8, right: 12, zIndex: 6, display: "flex", gap: 1 }}>
        {selection && (
          <>
          <Tooltip title={t("workbench.findUsagesHint", { word: selection.text.trim() })}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<SearchIcon sx={{ fontSize: 14 }} />}
              onClick={() => handleFindUsages(selection.text.trim())}
              sx={{
                textTransform: "none",
                fontSize: 11,
                height: 26,
                minWidth: 0,
                px: 1.25,
                boxShadow: 2,
              }}
            >
              {t("workbench.findUsages")}
            </Button>
          </Tooltip>
          <Tooltip title={t("workbench.diagnoseSelectionHint", { path: tab.relPath, line: selection.startLine })}>
            <Button
              size="small"
              variant="contained"
              startIcon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
              onClick={() => {
                onRequestAiOpen?.();
                void triggerDiagnosis({
                  filePath: tab.relPath,
                  kind: "generic",
                  title: t("workbench.diagnoseSelection"),
                  lineRange: [selection.startLine, selection.endLine],
                  detail: selection.text.slice(0, 600),
                });
                setSelection(null);
              }}
              sx={{
                textTransform: "none",
                fontSize: 11,
                height: 26,
                minWidth: 0,
                px: 1.25,
                boxShadow: 2,
              }}
            >
              {t("workbench.diagnoseSelection")}
            </Button>
          </Tooltip>
          <Tooltip title={t("workbench.askAiHint", { path: tab.relPath, line: selection.startLine })}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<SmartToyIcon sx={{ fontSize: 14 }} />}
              onClick={() => {
                onAskAi?.(selection);
                setSelection(null);
              }}
              sx={{
                textTransform: "none",
                fontSize: 11,
                height: 26,
                minWidth: 0,
                px: 1.25,
                boxShadow: 2,
              }}
            >
              {t("workbench.askAi")}
            </Button>
          </Tooltip>
        </>
        )}
      </Box>

      <Drawer
        anchor="right"
        open={usagesOpen}
        onClose={() => setUsagesOpen(false)}
        sx={{ "& .MuiDrawer-paper": { width: 340 } }}
      >
        <Box sx={{ p: 1.5, height: "100%", display: "flex", flexDirection: "column" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t("workbench.findUsages")}: {usagesWord} ({usages.length})
            </Typography>
            <IconButton size="small" onClick={() => setUsagesOpen(false)}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
          <Box
            ref={listRef}
            tabIndex={0}
            onKeyDown={onListKeyDown}
            sx={{ flex: 1, overflow: "auto", outline: "none" }}
          >
            {usages.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                {t("workbench.noUsages")}
              </Typography>
            ) : (
              groupedUsages.map((g) => {
                const isCollapsed = collapsed.has(g.fileId);
                const isActive = g.fileId === tab.fileId;
                return (
                  <Box key={g.fileId} sx={{ mb: 0.5 }}>
                    <Box
                      onClick={(e) => {
                        e.stopPropagation();
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.fileId)) next.delete(g.fileId);
                          else next.add(g.fileId);
                          return next;
                        });
                      }}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.75,
                        px: 1,
                        py: 0.5,
                        cursor: "pointer",
                        userSelect: "none",
                        borderRadius: 1,
                        bgcolor: isActive ? "action.selected" : "transparent",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                      title={t("workbench.refsToggle")}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: 11,
                          flexShrink: 0,
                          transform: isCollapsed ? "rotate(-90deg)" : "none",
                          transition: "transform .12s",
                          color: "text.secondary",
                        }}
                      >
                        ▾
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 700,
                          fontSize: 11,
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: isActive ? "primary.main" : "text.primary",
                        }}
                      >
                        {g.label}
                        {isActive ? ` ${t("workbench.refsActiveFile")}` : ""}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ fontSize: 10, color: "text.secondary", flexShrink: 0 }}
                      >
                        {t("workbench.refsCount", { n: g.count })}
                      </Typography>
                    </Box>
                    {!isCollapsed &&
                      g.items.map((h) => {
                        const uidx = flat.idxMap.get(`${h.fileId}:${h.line}`);
                        const selected = uidx != null && uidx === selIdx;
                        const isCursor = uidx != null && uidx === cursorUidx;
                        // 行内代码预览：优先用懒读到的真实源码行，读取未就绪/失败降级到静态 h.text（绝不空白）。
                        const lineArr = refExcerpts[h.fileId];
                        const codeLine = lineArr ? lineArr[h.line - 1] ?? h.text : h.text;
                        // 键盘选中或光标跟随项展开 ±1 上下文（对标 Zed excerpt_context_lines，避免长列表塌陷）
                        const expanded = (selected || isCursor) && !!lineArr;
                        return (
                          <Fragment key={`${h.fileId}:${h.line}`}>
                            <Box
                              data-uidx={uidx}
                              onClick={() => {
                                if (uidx != null) setSelIdx(uidx);
                                jumpTo(h);
                              }}
                              sx={{
                                display: "flex",
                                gap: 0.75,
                                pl: 2.5,
                                pr: 1,
                                py: 0.5,
                                cursor: "pointer",
                                borderLeft: "2px solid",
                                // 键盘选中=蓝边；光标跟随=琥珀金边（品牌色 #EF9F27），两者可叠加
                                borderColor: selected
                                  ? "primary.main"
                                  : isCursor
                                    ? "#EF9F27"
                                    : "transparent",
                                bgcolor: selected
                                  ? "action.selected"
                                  : isCursor
                                    ? "rgba(239,159,39,0.12)"
                                    : "transparent",
                                "&:hover": { bgcolor: "action.hover" },
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{
                                  fontWeight: 600,
                                  fontSize: 10,
                                  color: "text.secondary",
                                  flexShrink: 0,
                                  width: 36,
                                  textAlign: "right",
                                }}
                              >
                                {h.line}
                              </Typography>
                              <Box
                                component="span"
                                sx={{
                                  flex: 1,
                                  minWidth: 0,
                                  color: "text.secondary",
                                  fontFamily: "monospace",
                                  fontSize: 10,
                                  whiteSpace: "pre",
                                  overflow: "hidden",
                                }}
                              >
                                {highlightCode(codeLine, usagesWord)}
                              </Box>
                            </Box>
                            {expanded &&
                              (() => {
                                const ctxStart = Math.max(1, h.line - 1);
                                const ctxEnd = Math.min(lineArr!.length, h.line + 1);
                                const rows: React.ReactNode[] = [];
                                for (let ln = ctxStart; ln <= ctxEnd; ln++) {
                                  const isRef = ln === h.line;
                                  const code = lineArr![ln - 1] ?? "";
                                  rows.push(
                                    <Box
                                      key={ln}
                                      title={t("workbench.refsJumpLine", { line: ln })}
                                      onClick={(e) => {
                                        // 对标 Zed Definitions 多缓冲：摘录每行都是真实可导航位置，点击跳该行。
                                        e.stopPropagation();
                                        jumpTo({ ...h, line: ln });
                                      }}
                                      sx={{
                                        display: "flex",
                                        fontFamily: "monospace",
                                        fontSize: 10.5,
                                        lineHeight: 1.5,
                                        px: 1,
                                        cursor: "pointer",
                                        color: isRef ? "text.primary" : "text.secondary",
                                        bgcolor: isRef ? "rgba(239,159,39,0.16)" : "transparent",
                                        "&:hover": {
                                          bgcolor: isRef
                                            ? "rgba(239,159,39,0.24)"
                                            : "rgba(59,130,246,0.10)",
                                        },
                                      }}
                                    >
                                      <Box
                                        component="span"
                                        sx={{
                                          flex: "0 0 30px",
                                          width: 30,
                                          textAlign: "right",
                                          pr: 1,
                                          color: "text.disabled",
                                          userSelect: "none",
                                        }}
                                      >
                                        {ln}
                                      </Box>
                                      <Box
                                        component="span"
                                        sx={{
                                          minWidth: 0,
                                          flex: 1,
                                          whiteSpace: "pre",
                                          overflow: "hidden",
                                        }}
                                      >
                                        {highlightCode(code, usagesWord)}
                                      </Box>
                                    </Box>
                                  );
                                }
                                return (
                                  <Box
                                    sx={{
                                      ml: 2.5,
                                      mt: 0.25,
                                      mb: 0.5,
                                      borderLeft: "2px solid #EF9F27",
                                      pl: 0.5,
                                    }}
                                  >
                                    {rows}
                                  </Box>
                                );
                              })()}
                          </Fragment>
                        );
                      })}
                  </Box>
                );
              })
            )}
          </Box>
          <Box sx={{ px: 1, py: 0.5, borderTop: 1, borderColor: "divider", mt: 0.5 }}>
            <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
              {t("workbench.refsNavHint")}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", display: "block", mt: 0.25 }}>
              {t("workbench.refsCursorHint")}
            </Typography>
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}

/** 全局快开面板（Ctrl/Cmd+P）：按文件名/路径模糊匹配，键盘 ↑↓ 选择、⏎ 打开、Esc 关闭。 */
// 把文本按命中区间渲染为高亮片段（对标 Zed file_finder 的 HighlightedLabel）
function HighlightedRelPath({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (ranges.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontSize: 10 }}>
        {text}
      </Typography>
    );
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([s, e], idx) => {
    if (s > cursor) parts.push(<span key={`p${idx}`}>{text.slice(cursor, s)}</span>);
    parts.push(
      <span
        key={`h${idx}`}
        style={{ fontWeight: 700, color: "#EF9F27" }}
      >
        {text.slice(s, e + 1)}
      </span>,
    );
    cursor = e + 1;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return (
    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontSize: 10 }}>
      {parts}
    </Typography>
  );
}

// 快速打开文件（对标 Zed file_finder）：在既有模糊文件查找基础上补齐 Zed 的核心能力——
// ①「路径:行[:列]」后缀解析跳转（PathWithPosition）；② 命中字符高亮（HighlightedLabel）；
// ③ 空查询时按最近打开历史置顶（history items）；④ Cmd/Ctrl+Enter 在分屏打开（对标 Zed split open）。
function QuickOpen({
  open,
  onClose,
  files,
  onPick,
  onPickSplit,
}: {
  open: boolean;
  onClose: () => void;
  files: ProjectFile[];
  onPick: (fileId: string, line?: number | null, column?: number | null) => void;
  onPickSplit: (
    fileId: string,
    line?: number | null,
    column?: number | null,
    dir?: SplitDirection
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // 最近打开文件历史（fileId，最新在前），组件常驻故跨次打开保留
  const recentRef = useRef<string[]>([]);
  // 分屏方向记忆（对标 Zed go_to_file_split_* 方向感知，而非写死 right）：
  // 首次=右；用户按住修饰键主动指定方向后，下次纯 Cmd/Ctrl+Enter 复用该方向。
  const lastSplitDirRef = useRef<SplitDirection>("right");
  // 与拖拽拆分同源的方向映射（Alt=上下/左右，Alt+Ctrl=上/左，其余默认右）
  const splitDirFromMods = (
    alt: boolean,
    ctrl: boolean,
    shift: boolean
  ): SplitDirection | null => {
    if (alt && ctrl) return shift ? "left" : "up";
    if (alt) return shift ? "down" : "right";
    return null;
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // 解析「:行[:列]」后缀
  const { search, line, col } = useMemo(() => parsePathWithPosition(query), [query]);

  const results = useMemo(() => {
    const q = search.trim();
    if (!q) {
      // 空查询：最近打开置顶，其余随后（对标 Zed file_finder 空查询展示 history）
      const recIds = recentRef.current;
      const rec = recIds
        .map((id) => files.find((f) => f.id === id))
        .filter((f): f is ProjectFile => !!f);
      const rest = files.filter((f) => !recIds.includes(f.id));
      return [...rec, ...rest].slice(0, 60).map((f) => ({ f, ranges: [] as [number, number][] }));
    }
    const scored = files
      .map((f) => {
        const m = fuzzyMatch(f.relPath, q);
        return m ? { f, score: m.score, ranges: m.ranges } : null;
      })
      .filter((x): x is { f: ProjectFile; score: number; ranges: [number, number][] } => x !== null);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 60).map((x) => ({ f: x.f, ranges: x.ranges }));
  }, [files, search]);

  useEffect(() => {
    if (sel >= results.length) setSel(Math.max(0, results.length - 1));
  }, [results.length, sel]);

  const pick = (
    item: { f: ProjectFile; ranges: [number, number][] },
    split = false,
    dir: SplitDirection = "right"
  ) => {
    const fid = item.f.id;
    recentRef.current = [fid, ...recentRef.current.filter((id) => id !== fid)].slice(0, 12);
    if (split) {
      lastSplitDirRef.current = dir;
      onPickSplit(fid, line, col, dir);
    } else onPick(fid, line, col);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(results.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl+Enter → 分屏打开（对标 Zed go_to_file_split_*：方向感知而非写死，记忆上次方向）
        if (results[sel]) {
          const dir =
            splitDirFromMods(e.altKey, e.ctrlKey, e.shiftKey) ?? lastSplitDirRef.current;
          pick(results[sel], true, dir);
        }
      } else if (results[sel]) {
        pick(results[sel], false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { mt: 10, mb: "auto" } } }}
    >
      <Box sx={{ p: 1 }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          placeholder={t("workbench.quickOpenPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKeyDown}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment:
                line !== null ? (
                  <InputAdornment position="end">
                    <Chip
                      size="small"
                      color="primary"
                      label={
                        col !== null
                          ? t("workbench.quickOpenLineHint", { line, col })
                          : t("workbench.quickOpenLine", { line })
                      }
                      sx={{ height: 20, fontSize: 10 }}
                    />
                  </InputAdornment>
                ) : null,
            },
          }}
        />
      </Box>
      <Box sx={{ maxHeight: 360, overflow: "auto", pb: 1 }}>
        {results.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 2, py: 2 }}>
            {t("workbench.noMatch")}
          </Typography>
        ) : (
          results.map((item, i) => (
            <Box
              key={item.f.id}
              onClick={() => pick(item, false)}
              onMouseEnter={() => setSel(i)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 2,
                py: 0.8,
                cursor: "pointer",
                bgcolor: i === sel ? "rgba(59,130,246,0.14)" : "transparent",
                "&:hover": { bgcolor: "rgba(59,130,246,0.08)" },
              }}
            >
              <LanguageIcon lang={item.f.language} size={15} />
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ fontWeight: i === sel ? 600 : 400, display: "block" }}
                >
                  {item.f.name}
                </Typography>
                <HighlightedRelPath text={item.f.relPath} ranges={item.ranges} />
              </Box>
            </Box>
          ))
        )}
      </Box>
      {search.trim() === "" && recentRef.current.length > 0 && (
        <Box sx={{ px: 2, py: 0.5, borderTop: "1px solid", borderColor: "divider" }}>
          <Typography variant="caption" color="text.disabled">
            {t("workbench.quickOpenRecent")}
          </Typography>
        </Box>
      )}
    </Dialog>
  );
}

/** 转到符号（项目级，Ctrl/Cmd+Shift+O）：对标 Zed `Go to Symbol in Project` —— 模态选择器列出
 *  全项目符号索引，按名称模糊匹配（文件路径辅助），↑↓ 选择、⏎ 跳到定义行、Esc 关闭。
 *  与 QuickOpen(文件)/GotoLine(行) 互为兄弟导航入口，补全工作台「键盘优先」导航三件套（文件/行/符号）。 */
// 转到定义：多定义候选选择器（对标 Zed navigate_to_hover_links：num_locations>1 时弹 Definitions 浮层让用户选，
// 而非静默跳到 matches[0]）。单定义时外壳已直接跳转、不进此浮层；本浮层只负责「多义性消解」。
// 命中词高亮：在代码摘录中高亮光标词/筛选词（case-insensitive + 词边界），对标 Zed Definitions 多缓冲的 query/term 高亮。
function highlightCode(text: string, term: string) {
  const t = term.trim();
  if (!t) return text;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w$])(${esc})(?![\\w$])`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <Box component="span" key={i} sx={{ bgcolor: "#EF9F27", color: "#1a1a1a", borderRadius: 0.5, px: "1px" }}>
        {p}
      </Box>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    )
  );
}

function DefinitionPicker({
  open,
  onClose,
  word,
  candidates,
  files,
  onPick,
  onPickSplit,
}: {
  open: boolean;
  onClose: () => void;
  word: string;
  candidates: ProjectSymbol[];
  files: ProjectFile[];
  onPick: (fileId: string, relPath: string, name: string, language: string | null, line: number) => void;
  onPickSplit: (
    fileId: string,
    relPath: string,
    name: string,
    language: string | null,
    line: number,
    dir: SplitDirection
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 定义预览：对标 Zed navigation.rs「Definitions」多缓冲展示真实代码（excerpt_context_lines）。
  // 按 fileId 分组懒加载（每文件只读一次），封顶 24 个文件避免超大项目卡顿；行级摘要在各候选下方渲染。
  const [excerpts, setExcerpts] = useState<Record<string, string[]>>({});
  // 跨文件定义组折叠（对标 Zed Definitions 按 buffer 分组）：记录被折叠的 fileId；默认全展开，用户可逐文件折叠。
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setExcerpts({});
      return;
    }
    let cancelled = false;
    const fileIds = Array.from(new Set(candidates.map((c) => c.fileId))).slice(0, 24);
    (async () => {
      const map: Record<string, string[]> = {};
      for (const fid of fileIds) {
        try {
          const src = await projectScanApi.readSourceFile(fid);
          if (!src.skippedReason) map[fid] = src.lines;
        } catch {
          /* 读取失败（二进制/过大/越权）：静默跳过，绝不阻断选择器 */
        }
      }
      if (!cancelled) setExcerpts(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, candidates]);

  const fileMap = useMemo(() => {
    const m = new Map<string, ProjectFile>();
    for (const f of files) m.set(f.id, f);
    return m;
  }, [files]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return candidates;
    return candidates
      .map((s) => {
        const nameScore = fuzzyScore(s.name, q) ?? 0;
        const pathScore = fuzzyScore(s.filePath, q) ?? 0;
        const score = nameScore > 0 ? nameScore : pathScore > 0 ? pathScore * 0.6 : 0;
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.s);
  }, [candidates, query]);

  // 按 fileId 分组（保持首次出现顺序），对标 Zed Definitions 按 buffer 分组呈现。
  // visibleResults = 折叠组之外的可见候选，键盘导航/选择只在其上操作；visibleIndexMap 把候选映射到可见索引用于高亮。
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, ProjectSymbol[]>();
    for (const s of results) {
      if (!map.has(s.fileId)) {
        map.set(s.fileId, []);
        order.push(s.fileId);
      }
      map.get(s.fileId)!.push(s);
    }
    return order.map((fid) => ({ fileId: fid, file: fileMap.get(fid), items: map.get(fid)! }));
  }, [results, fileMap]);

  const visibleResults = useMemo(
    () => groups.flatMap((g) => (collapsedFiles.has(g.fileId) ? [] : g.items)),
    [groups, collapsedFiles]
  );

  const visibleIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    visibleResults.forEach((s, idx) => m.set(`${s.fileId}:${s.lineStart}`, idx));
    return m;
  }, [visibleResults]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      const tm = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(tm);
    }
  }, [open]);

  useEffect(() => {
    if (sel >= visibleResults.length) setSel(Math.max(0, visibleResults.length - 1));
  }, [visibleResults.length, sel]);

  const splitDirFromMods = (
    alt: boolean,
    ctrl: boolean,
    shift: boolean
  ): SplitDirection | null => {
    if (alt && ctrl) return shift ? "left" : "up";
    if (alt) return shift ? "down" : "right";
    return null;
  };
  const splitPreviewDir = splitDirFromMods(altHeld, ctrlHeld, shiftHeld);
  const dirLabel = (d: SplitDirection) =>
    d === "right"
      ? t("workbench.gotoSymbolSplitRight")
      : d === "down"
      ? t("workbench.gotoSymbolSplitDown")
      : d === "up"
      ? t("workbench.gotoSymbolSplitUp")
      : t("workbench.gotoSymbolSplitLeft");

  const pick = (s: ProjectSymbol) => {
    const f = fileMap.get(s.fileId);
    onPick(s.fileId, f?.relPath ?? s.filePath, s.name, f?.language ?? null, s.lineStart);
    onClose();
  };
  const pickSplit = (s: ProjectSymbol, dir: SplitDirection) => {
    const f = fileMap.get(s.fileId);
    onPickSplit(s.fileId, f?.relPath ?? s.filePath, s.name, f?.language ?? null, s.lineStart, dir);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Alt") setAltHeld(true);
    if (e.key === "Shift") setShiftHeld(true);
    if (e.key === "Control") setCtrlHeld(true);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((v) => Math.min(visibleResults.length - 1, v + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((v) => Math.max(0, v - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visibleResults[sel]) {
        const dir = splitDirFromMods(e.altKey, e.ctrlKey, e.shiftKey);
        if (dir) pickSplit(visibleResults[sel], dir);
        else pick(visibleResults[sel]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === "Alt") setAltHeld(false);
    if (e.key === "Shift") setShiftHeld(false);
    if (e.key === "Control") setCtrlHeld(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { mt: 10, mb: "auto" } } }}
    >
      <Box sx={{ p: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, px: 0.5, mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {t("workbench.defPickerTitle", { name: word })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("workbench.defPickerCount", { n: candidates.length })}
          </Typography>
        </Box>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          placeholder={t("workbench.defPickerPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Box sx={{ mt: 1, maxHeight: 320, overflowY: "auto" }}>
          {visibleResults.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
              {t("workbench.defPickerEmpty")}
            </Typography>
          ) : (
            groups.map((g) => {
              const rel = g.file?.relPath ?? g.items[0]?.filePath ?? "";
              const isCollapsed = collapsedFiles.has(g.fileId);
              return (
                <Box key={g.fileId} sx={{ mb: 0.5 }}>
                  <Box
                    role="button"
                    aria-label={t("workbench.defPickerToggleGroup")}
                    onClick={() =>
                      setCollapsedFiles((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.fileId)) next.delete(g.fileId);
                        else next.add(g.fileId);
                        return next;
                      })
                    }
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      px: 1,
                      py: 0.5,
                      cursor: "pointer",
                      borderRadius: 1,
                      userSelect: "none",
                      bgcolor: "rgba(0,0,0,0.04)",
                      "&:hover": { bgcolor: "rgba(0,0,0,0.08)" },
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        transform: isCollapsed ? "rotate(-90deg)" : "none",
                        transition: "transform 120ms ease",
                        fontSize: 10,
                        lineHeight: 1,
                        color: "text.secondary",
                      }}
                    >
                      ▾
                    </Box>
                    <Typography
                      component="span"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "text.secondary",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {rel}
                    </Typography>
                    <Typography component="span" sx={{ fontSize: 11, color: "text.disabled", ml: "auto", whiteSpace: "nowrap" }}>
                      {g.items.length}
                    </Typography>
                  </Box>
                  {!isCollapsed &&
                    g.items.map((s) => {
                      const f = fileMap.get(s.fileId);
                      const rel2 = f?.relPath ?? s.filePath;
                      const lang = f?.language ?? null;
                      const i = visibleIndexMap.get(`${s.fileId}:${s.lineStart}`)!;
                      const active = i === sel;
                      const lineArr = excerpts[s.fileId];
                      // 多行上下文：对标 Zed EXCERPT_CONTEXT_LINES 默认 2（定义行 ±2 行）；聚焦条目展开 5 行带行号 + 命中词高亮，非聚焦条目保持单行摘要。
                      const CTX = 2;
                      const term = query.trim() || word;
                      let excerptBlock: React.ReactNode = null;
                      if (lineArr) {
                      if (active) {
                        const defNo = s.lineStart;
                        const ctxStart = Math.max(1, defNo - CTX);
                        const ctxEnd = Math.min(lineArr.length, defNo + CTX);
                        const rows: React.ReactNode[] = [];
                        for (let ln = ctxStart; ln <= ctxEnd; ln++) {
                          const isDef = ln === defNo;
                          const code = lineArr[ln - 1] ?? "";
                          rows.push(
                            <Box
                              key={ln}
                              title={t("workbench.defPickerJumpLine", { line: ln })}
                              onClick={(e) => {
                                // 对标 Zed Definitions 多缓冲：摘录的每一行都是可导航的真实位置，点击直跳该行。
                                // 整行 onClick 已跳定义行，此处 stopPropagation 避免重复触发；renderable≠useful·可行动。
                                e.stopPropagation();
                                onPick(s.fileId, rel2, s.name, lang, ln);
                                onClose();
                              }}
                              sx={{
                                position: "relative",
                                display: "flex",
                                fontFamily: "monospace",
                                fontSize: 11,
                                lineHeight: 1.45,
                                px: 1,
                                cursor: "pointer",
                                bgcolor: isDef ? "rgba(239,159,39,0.16)" : "transparent",
                                color: isDef ? "text.primary" : "text.secondary",
                                "&:hover": {
                                  bgcolor: isDef ? "rgba(239,159,39,0.24)" : "rgba(59,130,246,0.10)",
                                },
                              }}
                            >
                              <Box
                                component="span"
                                sx={{ flex: "0 0 30px", width: 30, textAlign: "right", pr: 1, color: "text.disabled", userSelect: "none" }}
                              >
                                {ln}
                              </Box>
                              <Box
                                component="span"
                                sx={{ minWidth: 0, flex: 1, whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis" }}
                              >
                                {highlightCode(code, term)}
                              </Box>
                            </Box>
                          );
                        }
                        excerptBlock = (
                          <Box sx={{ ml: 2.5, mt: 0.25, borderLeft: "2px solid #EF9F27", pl: 0.5 }}>{rows}</Box>
                        );
                      } else {
                        const defLine = lineArr[Math.max(0, s.lineStart - 1)];
                        if (defLine != null) {
                          excerptBlock = (
                            <Box
                              component="pre"
                              sx={{
                                m: 0,
                                mt: 0.25,
                                ml: 2.5,
                                pl: 1,
                                fontFamily: "monospace",
                                fontSize: 11,
                                lineHeight: 1.5,
                                whiteSpace: "pre",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                color: "text.secondary",
                                borderLeft: "2px solid",
                                borderColor: "divider",
                              }}
                            >
                              {highlightCode(defLine, term)}
                            </Box>
                          );
                        }
                      }
                      }
                      return (
                        <Box
                          key={`${s.fileId}:${s.lineStart}`}
                          onClick={() => pick(s)}
                          onMouseEnter={() => setSel(i)}
                          sx={{
                            px: 1,
                            py: 0.5,
                            borderRadius: 1,
                            cursor: "pointer",
                            bgcolor: active ? "rgba(59,130,246,0.14)" : "transparent",
                            "&:hover": { bgcolor: "rgba(59,130,246,0.08)" },
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              py: 0.25,
                            }}
                          >
                            <Box
                              component="span"
                              sx={{
                                fontSize: 10,
                                fontWeight: 700,
                                px: 0.5,
                                borderRadius: 0.5,
                                color: "#fff",
                                bgcolor: symbolKindColor(s.kind),
                                whiteSpace: "nowrap",
                              }}
                            >
                              {symbolKindLabel(s.kind)}
                            </Box>
                            <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13 }}>
                              {s.name}
                            </Typography>
                            <Typography
                              component="span"
                              sx={{ fontSize: 12, color: "text.secondary", ml: "auto", whiteSpace: "nowrap" }}
                            >
                              {rel2}:{s.lineStart}
                            </Typography>
                          </Box>
                          {excerptBlock}
                        </Box>
                      );
                    })}
                </Box>
              );
            })
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, px: 0.5 }}>
          {t("workbench.gotoSymbolFooter")}
          {splitPreviewDir && (
            <Box component="span" sx={{ color: "#EF9F27", ml: 0.5 }}>
              {dirLabel(splitPreviewDir)}
            </Box>
          )}
        </Typography>
      </Box>
    </Dialog>
  );
}

// 内联 Peek 定义预览浮层（对标 VS Code Peek Definition；Zed 无此能力，我们自建）。
// 单定义场景：原地悬浮预览目标源码（定义行上下各 CONTEXT 行上下文 + 定义行高亮），用户不离开当前位置即可 glance 定义；
// Esc 关闭返回、Enter/点击任意行在分屏打开（复用分屏方向记忆 lastSplitDirRef）。补齐 goto-family「不想跳转只看一眼」的弱项，
// 让单定义导航从「必跳转离开」升级为「原地可预览、可行动」（renderable AND useful）。浮层自取源码 excerpt，纯前端零新依赖。
function PeekPanel({
  word,
  fileId,
  relPath,
  name,
  language,
  line,
  anchor,
  onClose,
  onOpen,
}: {
  word: string;
  fileId: string;
  relPath: string;
  name: string;
  language: string | null;
  line: number;
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  onOpen: (fid: string, relPath: string, name: string, language: string | null, line: number) => void;
}) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "err">("loading");
  const rootRef = useRef<HTMLDivElement>(null);
  const CONTEXT = 7; // 定义行上下各 7 行上下文

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = await projectScanApi.readSourceFile(fileId);
        if (cancelled) return;
        if (src.skippedReason) {
          setStatus("err");
          return;
        }
        setLines(src.lines);
        setStatus("ok");
      } catch {
        if (!cancelled) setStatus("err");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  // Esc 关闭 / Enter 在分屏打开定义行（capture 阶段拦截，避免冒泡到编辑器命令）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onOpen(fileId, relPath, name, language, line);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    rootRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, relPath, name, language, line]);

  // 浮层定位：以光标锚点为基准，限制在视口内不溢出（右侧/下方空间不足则翻到另一侧）。
  const W = 560;
  const H = 360;
  const style: CSSProperties = (() => {
    const base: React.CSSProperties = { position: "fixed", zIndex: 1400, width: W, maxWidth: "92vw" };
    if (anchor) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = anchor.x + 8;
      let top = anchor.y + 6;
      if (left + W > vw - 12) left = Math.max(12, anchor.x - W - 8);
      if (top + H > vh - 12) top = Math.max(12, anchor.y - H - 6);
      left = Math.min(Math.max(12, left), vw - W - 12);
      top = Math.min(Math.max(12, top), vh - H - 12);
      base.left = left;
      base.top = top;
    } else {
      base.left = "50%";
      base.top = "42%";
      base.transform = "translate(-50%, -50%)";
    }
    return base;
  })();

  const start = Math.max(0, line - 1 - CONTEXT);
  const end = lines ? Math.min(lines.length, line + CONTEXT) : 0;
  const shortPath = relPath.split("/").slice(-2).join("/");

  return (
    <Box
      ref={rootRef}
      tabIndex={-1}
      sx={{
        ...style,
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1.5,
        boxShadow: 8,
        outline: "none",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 头部：符号名 + 文件名:行 + 操作提示 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.25,
          py: 0.75,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "action.hover",
        }}
      >
        <AutoAwesomeIcon sx={{ fontSize: 15, color: "#EF9F27" }} />
        <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{t("workbench.peekTitle", { name: word })}</Typography>
        <Typography
          sx={{
            fontSize: 11,
            color: "text.secondary",
            ml: "auto",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 220,
          }}
        >
          {shortPath}:{line}
        </Typography>
      </Box>
      {/* 源码预览（只读；定义行高亮，单击任意行在分屏打开该行） */}
      <Box sx={{ flex: 1, overflow: "auto", fontFamily: "monospace", fontSize: 12, lineHeight: 1.5, py: 0.5 }}>
        {status === "loading" && (
          <Typography sx={{ p: 1.5, color: "text.secondary" }}>{t("workbench.peekLoading")}</Typography>
        )}
        {status === "err" && (
          <Typography sx={{ p: 1.5, color: "text.secondary" }}>{t("workbench.peekReadError")}</Typography>
        )}
        {status === "ok" &&
          lines &&
          Array.from({ length: end - start }, (_, i) => {
            const ln = start + i;
            const code = lines[ln];
            const isDef = ln + 1 === line;
            return (
              <Box
                key={ln}
                onClick={() => {
                  onOpen(fileId, relPath, name, language, ln + 1);
                  onClose();
                }}
                sx={{
                  display: "flex",
                  gap: 1,
                  px: 1,
                  cursor: "pointer",
                  bgcolor: isDef ? "rgba(239,159,39,0.16)" : "transparent",
                  borderLeft: isDef ? "3px solid #EF9F27" : "3px solid transparent",
                  "&:hover": { bgcolor: isDef ? "rgba(239,159,39,0.24)" : "action.hover" },
                }}
              >
                <Box
                  component="span"
                  sx={{ width: 38, textAlign: "right", color: "text.disabled", userSelect: "none", flexShrink: 0 }}
                >
                  {ln + 1}
                </Box>
                <Box
                  component="span"
                  sx={{ whiteSpace: "pre", color: isDef ? "text.primary" : "text.secondary" }}
                >
                  {isDef ? highlightCode(code, word) : code}
                </Box>
              </Box>
            );
          })}
      </Box>
      {/* 底部操作提示 */}
      <Box
        sx={{
          px: 1.25,
          py: 0.5,
          borderTop: "1px solid",
          borderColor: "divider",
          fontSize: 11,
          color: "text.secondary",
          display: "flex",
          gap: 1,
        }}
      >
        <span>{t("workbench.peekOpenHint")}</span>
        <Box component="span" sx={{ ml: "auto", color: "#EF9F27" }}>
          {t("workbench.peekGotoDef")}
        </Box>
      </Box>
    </Box>
  );
}

function GoToSymbol({
  open,
  onClose,
  symbols,
  files,
  onPick,
  onPickSplit,
}: {
  open: boolean;
  onClose: () => void;
  symbols: ProjectSymbol[];
  files: ProjectFile[];
  onPick: (fileId: string, relPath: string, name: string, language: string | null, line: number) => void;
  /** 拆分窗格打开（对标 Zed `go_to_file_split_*`）：Alt+⏎→右分屏 / Alt+Shift+⏎→下分屏；dir 指定生长方向 */
  onPickSplit: (
    fileId: string,
    relPath: string,
    name: string,
    language: string | null,
    line: number,
    dir: SplitDirection
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时若符号索引为空，惰性加载（分析未预载符号时也能用，零新依赖）
  useEffect(() => {
    if (open && symbols.length === 0) {
      const id = useProjectStore.getState().activeAnalysisId;
      if (id) void useProjectStore.getState().loadSymbols(id);
    }
  }, [open, symbols.length]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      const tm = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(tm);
    }
  }, [open]);

  const fileMap = useMemo(() => {
    const m = new Map<string, ProjectFile>();
    for (const f of files) m.set(f.id, f);
    return m;
  }, [files]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) {
      // 空查询：按文件 + 行号排序，展示项目符号全景（截断避免超长列表）
      return symbols
        .slice()
        .sort((a, b) =>
          a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : a.lineStart - b.lineStart
        )
        .slice(0, 200);
    }
    return symbols
      .map((s) => {
        const nameScore = fuzzyScore(s.name, q) ?? 0;
        const pathScore = fuzzyScore(s.filePath, q) ?? 0;
        const score = nameScore > 0 ? nameScore : pathScore > 0 ? pathScore * 0.6 : 0;
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 80)
      .map((x) => x.s);
  }, [symbols, query]);

  useEffect(() => {
    if (sel >= results.length) setSel(Math.max(0, results.length - 1));
  }, [results.length, sel]);

  const pick = (s: ProjectSymbol) => {
    const f = fileMap.get(s.fileId);
    onPick(s.fileId, f?.relPath ?? s.filePath, s.name, f?.language ?? null, s.lineStart);
    onClose();
  };

  // 拆分窗格打开：在激活窗格旁按 dir 方向生长新分屏并打开符号所在文件（对标 Zed go_to_file_split_*）
  const pickSplit = (s: ProjectSymbol, dir: SplitDirection) => {
    const f = fileMap.get(s.fileId);
    onPickSplit(s.fileId, f?.relPath ?? s.filePath, s.name, f?.language ?? null, s.lineStart, dir);
    onClose();
  };

  // 由修饰键推导拆分方向（对标 Zed go_to_file_split_{left,right,up,down}）：
  // Alt(+Shift) → 右/下；Ctrl+Alt(+Shift) → 上/左
  const splitDirFromMods = (
    alt: boolean,
    ctrl: boolean,
    shift: boolean
  ): SplitDirection | null => {
    if (alt && ctrl) return shift ? "left" : "up";
    if (alt) return shift ? "down" : "right";
    return null;
  };
  const splitPreviewDir: SplitDirection | null = splitDirFromMods(altHeld, ctrlHeld, shiftHeld);
  const splitPreviewKbd = ctrlHeld && altHeld ? "⌃⌥" : "⌥";
  const dirLabel = (d: SplitDirection) =>
    d === "right"
      ? t("workbench.gotoSymbolSplitRight")
      : d === "down"
      ? t("workbench.gotoSymbolSplitDown")
      : d === "up"
      ? t("workbench.gotoSymbolSplitUp")
      : t("workbench.gotoSymbolSplitLeft");

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Alt") setAltHeld(true);
    if (e.key === "Shift") setShiftHeld(true);
    if (e.key === "Control") setCtrlHeld(true);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((v) => Math.min(results.length - 1, v + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((v) => Math.max(0, v - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[sel]) {
        const dir = splitDirFromMods(e.altKey, e.ctrlKey, e.shiftKey);
        if (dir) pickSplit(results[sel], dir);
        else pick(results[sel]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === "Alt") setAltHeld(false);
    if (e.key === "Shift") setShiftHeld(false);
    if (e.key === "Control") setCtrlHeld(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { mt: 10, mb: "auto" } } }}
    >
      <Box sx={{ p: 1 }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          placeholder={t("workbench.gotoSymbolPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>
      <Box sx={{ maxHeight: 360, overflow: "auto", pb: 1 }}>
        {results.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 2, py: 2 }}>
            {t("workbench.noMatchSymbol")}
          </Typography>
        ) : (
          results.map((s, i) => {
            const f = fileMap.get(s.fileId);
            return (
              <Box
                key={s.id}
                onClick={(e) => {
                  const dir = splitDirFromMods(e.altKey, e.ctrlKey, e.shiftKey);
                  if (dir) pickSplit(s, dir);
                  else pick(s);
                }}
                onMouseEnter={() => setSel(i)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  px: 2,
                  py: 0.8,
                  cursor: "pointer",
                  bgcolor: i === sel ? "rgba(59,130,246,0.14)" : "transparent",
                  "&:hover": { bgcolor: "rgba(59,130,246,0.08)" },
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    flexShrink: 0,
                    width: 34,
                    fontSize: 9,
                    textTransform: "uppercase",
                    fontWeight: 600,
                    color: symbolKindColor(s.kind),
                  }}
                  noWrap
                >
                  {symbolKindLabel(s.kind)}
                </Typography>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="caption" noWrap sx={{ fontWeight: i === sel ? 600 : 400, display: "block" }}>
                    {s.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontSize: 10 }}>
                    {f?.relPath ?? s.filePath}:{s.lineStart}
                  </Typography>
                </Box>
                {i === sel && splitPreviewDir && (
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{
                      flexShrink: 0,
                      ml: "auto",
                      pl: 1,
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#EF9F27",
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                    }}
                  >
                    {splitPreviewKbd}{shiftHeld ? "⇧ " : " "}
                    {dirLabel(splitPreviewDir)}
                  </Typography>
                )}
              </Box>
            );
          })
        )}
      </Box>
      <Box
        sx={{
          px: 2,
          py: 0.6,
          borderTop: "1px solid",
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
          {t("workbench.gotoSymbolFooter")}
        </Typography>
        {splitPreviewDir && (
          <Typography
            variant="caption"
            noWrap
            sx={{ fontSize: 10, fontWeight: 600, color: "#EF9F27", ml: "auto" }}
          >
            {splitPreviewKbd}{shiftHeld ? "⇧ " : " "}
            {dirLabel(splitPreviewDir)}
          </Typography>
        )}
      </Box>
    </Dialog>
  );
}

export function CodeWorkbenchBody({
  onRequestClose,
  showBackButton = true,
}: {
  onRequestClose: () => void;
  showBackButton?: boolean;
}) {
  const panes = useCodeWorkbenchStore((s) => s.panes);
  const paneTree = useCodeWorkbenchStore((s) => s.paneTree);
  const activePaneId = useCodeWorkbenchStore((s) => s.activePaneId);
  // tabs / activeFileId 取「当前激活窗格」，与 Zed 一致：外壳的 AI 面板 / 大纲 / 终端跟随聚焦窗格
  const tabs = useCodeWorkbenchStore((s) => s.panes[s.activePaneId]?.tabs ?? EMPTY_TABS);
  const activeFileId = useCodeWorkbenchStore((s) => s.panes[s.activePaneId]?.activeFileId ?? null);
  const diskChanged = useCodeWorkbenchStore((s) => s.diskChanged);
  const openTab = useCodeWorkbenchStore((s) => s.openTab);
  const setDraggingFile = useCodeWorkbenchStore((s) => s.setDraggingFile);
  const splitPaneWithFile = useCodeWorkbenchStore((s) => s.splitPaneWithFile);
  const setActive = useCodeWorkbenchStore((s) => s.setActive);
  const closeTab = useCodeWorkbenchStore((s) => s.closeTab);
  const togglePin = useCodeWorkbenchStore((s) => s.togglePin);
  const closeOthers = useCodeWorkbenchStore((s) => s.closeOthers);
  const closeLeft = useCodeWorkbenchStore((s) => s.closeLeft);
  const closeRight = useCodeWorkbenchStore((s) => s.closeRight);
  const closeAll = useCodeWorkbenchStore((s) => s.closeAll);
  const reorderTab = useCodeWorkbenchStore((s) => s.reorderTab);
  const toggleReadOnly = useCodeWorkbenchStore((s) => s.toggleReadOnly);
  const splitPane = useCodeWorkbenchStore((s) => s.splitPane);
  const closePane = useCodeWorkbenchStore((s) => s.closePane);
  const setActivePane = useCodeWorkbenchStore((s) => s.setActivePane);
  const moveTabToPane = useCodeWorkbenchStore((s) => s.moveTabToPane);
  const splitPaneWithTab = useCodeWorkbenchStore((s) => s.splitPaneWithTab);
  const setDraggingTab = useCodeWorkbenchStore((s) => s.setDraggingTab);
  const setAxisFlexes = useCodeWorkbenchStore((s) => s.setAxisFlexes);
  const resetPaneSizes = useCodeWorkbenchStore((s) => s.resetPaneSizes);
  const resetLayout = useCodeWorkbenchStore((s) => s.resetLayout);

  // 标签拖拽重排（对标 Zed tab drag-reorder）：dragId=正在拖的标签，dropPos=落点指示
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<{ fileId: string; pos: "before" | "after" } | null>(null);

  // 标签右键上下文菜单状态（对标 Zed tab context menu）
  const [tabMenu, setTabMenu] = useState<{
    anchor: HTMLElement;
    fileId: string;
    index: number;
    pinned: boolean;
    readOnly: boolean;
  } | null>(null);

  // 窗格可拖拽分隔条（对标 Zed PaneGroup 分隔条：按所属 axis 调整 flex 权重，双击复位均分）
  const paneContainerRef = useRef<HTMLDivElement>(null);
  const axisRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setAxisRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) axisRefs.current.set(id, el);
      else axisRefs.current.delete(id);
    },
    []
  );
  const [dragDivider, setDragDivider] = useState<{ axisId: string; gapIndex: number } | null>(null);

  const onDividerDown = useCallback(
    (axisId: string, i: number, horizontal: boolean, flexes: number[], e: React.MouseEvent) => {
      e.preventDefault();
      const axisEl = axisRefs.current.get(axisId);
      if (!axisEl) return;
      const rect = axisEl.getBoundingClientRect();
      const size = horizontal ? rect.width : rect.height;
      if (size <= 0) return;
      const fa = flexes[i] ?? 1;
      const fb = flexes[i + 1] ?? 1;
      const sum = fa + fb;
      // Zed 最小尺寸：横向 80px / 纵向 100px，换算成 flex 下限避免窗格被压没
      const minFlex = Math.max(0.04, ((horizontal ? 80 : 100) / size) * sum);
      const startPos = horizontal ? e.clientX : e.clientY;
      setDragDivider({ axisId, gapIndex: i });
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
      const onMove = (ev: MouseEvent) => {
        const cur = horizontal ? ev.clientX : ev.clientY;
        const delta = ((cur - startPos) / size) * sum; // 像素增量 → flex 单位
        let na = fa + delta;
        na = Math.max(minFlex, Math.min(sum - minFlex, na));
        const nb = sum - na;
        const next = [...flexes];
        next[i] = na;
        next[i + 1] = nb;
        setAxisFlexes(axisId, next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = prevCursor;
        setDragDivider(null);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [setAxisFlexes]
  );

  // 双击分隔条 → 全部 axis flex 复位均分（对标 Zed 双击 handle 均分）
  const onDividerReset = useCallback(() => {
    resetPaneSizes();
  }, [resetPaneSizes]);

  const files = useProjectStore((s) => s.files);
  // 符号索引三表（定义/引用/调用），供重命名符号聚合 (文件,行) 定位点
  const symbols = useProjectStore((s) => s.symbols);
  const symbolRefs = useProjectStore((s) => s.symbolRefs);
  const callEdges = useProjectStore((s) => s.callEdges);
  // 打开文件并反向联动主窗口画布（选中对应实体并居中）
  const openFileInTab = useCallback(
    (fid: string, line?: number | null, column?: number | null) => {
      const f = files.find((x) => x.id === fid);
      if (!f) return;
      openTab(f.id, f.relPath, f.name, f.language, line ?? null, null, [], column ?? null);
      void emit("workbench-focus-canvas", { fileId: f.id });
    },
    [files, openTab]
  );

  // 拆分窗格打开文件（对标 Zed go_to_file_split_*）：先在激活窗格旁按 dir 方向生长一个空分屏（设为激活），
  // 再在该分屏打开目标文件。与 openFileInTab 共享同一 openTab 口径，零重复基建。
  const openFileInSplit = useCallback(
    (
      fid: string,
      relPath: string,
      name: string,
      language: string | null,
      line: number | null,
      dir: SplitDirection = "right",
      column?: number | null
    ) => {
      splitPane(dir, "empty");
      openTab(fid, relPath, name, language, line, null, [], column ?? null);
      void emit("workbench-focus-canvas", { fileId: fid });
    },
    [splitPane, openTab]
  );

  // 递归渲染窗格树（对标 Zed `PaneGroup` 渲染：轴节点按自身 orientation 排布子节点并插分隔条，
  // 叶子窗格承载标签+编辑器；嵌套轴各自持 flex 权重，支持任意层级拆分）
  // 用函数而非立即对象，避免在闭包中早于部分 state setter（如 setSelection）声明处求值
  const getPaneProps = () => ({
    files,
    onActivateEditor: (ref: MonacoEditorHandle | null) => {
      editorHandleRef.current = ref;
    },
    onChangeCapture: (text: string) => {
      const pid = useCodeWorkbenchStore.getState().activePaneId;
      const fid = useCodeWorkbenchStore.getState().panes[pid]?.activeFileId;
      if (fid) {
        contentBuffers.current.set(fid, text);
        scheduleSave(fid);
      }
    },
    onAskAi: (sel: EditorSelectionInfo | null) => void askAi("selection", sel),
    onRequestAiOpen: () => {
      setAiOpen(true);
      setRightTab(0);
    },
    onOpenInline: () => setInlineOpen(true),
    splitPane,
    closePane,
    setActivePane,
    activePaneId,
    setActive,
    closeTab,
    togglePin,
    closeOthers,
    closeLeft,
    closeRight,
    closeAll,
    reorderTab,
    moveTabToPane,
    splitPaneWithTab,
    setDraggingTab,
    setDraggingFile,
    splitPaneWithFile,
    toggleReadOnly,
    openTab,
    onOpenFile: openFileInTab,
    onToggleOutline: () => setOutlineOpen((v) => !v),
    onOpenInTerminal: (dir?: string) => {
      setTerminalOpen(true);
      if (dir) sendToActiveTerminal(`cd "${dir}"\n`);
    },
    onSelectionChange: setSelection,
    onCursorLineChange: setCursorLine,
    onOpenGotoLine: () => setGotoOpen(true),
    onRenameSymbol: handleRenameSymbol,
    onGoToDefinition: handleGoToDefinition,
    openFileInSplit,
  });
  const renderPaneNode = (node: PaneNode, axis: PaneOrientation | null, flex: number): React.ReactNode => {
    if (node.kind === "pane") {
      return (
        <WorkbenchEditorPane
          key={node.id}
          paneId={node.id}
          paneFlex={flex}
          paneAxis={axis}
          onShowBookmarks={() => setBookmarkPickerOpen(true)}
          {...getPaneProps()}
        />
      );
    }
    const isRow = node.axis === "row";
    const els: React.ReactNode[] = [];
    node.children.forEach((child, i) => {
      els.push(renderPaneNode(child, node.axis, node.flexes[i] ?? 1));
      if (i < node.children.length - 1) {
        els.push(
          <Box
            key={`div-${node.id}-${i}`}
            onMouseDown={(e) => onDividerDown(node.id, i, isRow, node.flexes, e)}
            onDoubleClick={onDividerReset}
            title={t("workbench.pane.resizeHint")}
            sx={{
              flex: "0 0 6px",
              cursor: isRow ? "col-resize" : "row-resize",
              bgcolor:
                dragDivider?.axisId === node.id && dragDivider.gapIndex === i
                  ? "primary.main"
                  : "transparent",
              "&:hover": { bgcolor: "action.hover" },
              zIndex: 2,
              transition:
                dragDivider?.axisId === node.id && dragDivider.gapIndex === i
                  ? "none"
                  : "background-color 120ms",
            }}
          />
        );
      }
    });
    return (
      <Box
        key={node.id}
        ref={setAxisRef(node.id)}
        sx={{
          flex,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: isRow ? "row" : "column",
          overflow: "hidden",
        }}
      >
        {els}
      </Box>
    );
  };

  // 改动评审列表点击文件名时用：AI 改的往往不是当前打开的文件，必须能跳过去并定位行。
  // relPath → fileId 映射走 files 表；line 经 openTab 的 focusLine 落到编辑器 revealLine。
  const handleOpenPath = useCallback(
    (relPath: string, line?: number) => {
      const f = files.find((x) => x.relPath === relPath);
      if (!f) return;
      openTab(f.id, f.relPath, f.name, f.language, line ?? null);
      void emit("workbench-focus-canvas", { fileId: f.id });
    },
    [files, openTab]
  );
  // 项目内搜索结果跳转：命中只带 fileId + 行号，需反查 files 取 name/language/relPath 再 openTab 落到 revealLine。
  const handleSearchJump = useCallback(
    (fileId: string, lineNo: number) => {
      const f = files.find((x) => x.id === fileId);
      if (!f) return;
      openTab(f.id, f.relPath, f.name, f.language, lineNo);
    },
    [files, openTab]
  );
  // 内嵌 AI 面板：构建带精确坐标（文件:行）的上下文提示，让 AI 不跑偏
  type AiAskKind = "file" | "selection" | "test" | "review";
  const buildAiPrompt = (kind: AiAskKind, filePath: string, lang: string, sel?: EditorSelectionInfo | null): string => {
    const codeBlock = sel?.text ? `\n\n\`\`\`${lang}\n${sel.text}\n\`\`\`` : "";
    const ref = sel ? `${filePath}:${sel.startLine}-${sel.endLine}` : filePath;
    if (kind === "selection") {
      return L(
        `请解释下面选中的代码，并说明它的作用、潜在问题与改进点：\n\n【文件】${ref}${codeBlock}\n\n先通过 project_context / scan_records(action="dossier", path="${filePath}") 读取真实上下文，不要凭空猜测。`,
        `Please explain the selected code and point out its purpose, potential issues and improvements:\n\n[File] ${ref}${codeBlock}\n\nFirst read the real context via project_context / scan_records(action="dossier", path="${filePath}").`,
      );
    }
    if (kind === "test") {
      return L(
        `请为文件 ${filePath} 编写单元测试，覆盖关键函数/分支与边界情况，并给出可执行的测试代码。先通过 scan_records 读取真实代码。`,
        `Please write unit tests for ${filePath} covering key functions/branches and edge cases with runnable test code. First read the real code via scan_records.`,
      );
    }
    if (kind === "review") {
      return L(
        `请审查文件 ${filePath}，指出 bug、坏味道（bad smell）、安全隐患与可改进点，引用具体「文件:行号」证据。先通过 scan_records 读取真实代码。`,
        `Please review ${filePath}, point out bugs, code smells, security risks and improvements, citing concrete "file:line" evidence. First read the real code via scan_records.`,
      );
    }
    return L(
      `请解释文件 ${filePath} 的整体结构、关键逻辑、依赖关系与潜在问题，给出模块级概述。先通过 scan_records(action="dossier", path="${filePath}") 读取真实代码。`,
      `Please explain the overall structure, key logic, dependencies and potential issues of ${filePath} at module level. First read the real code via scan_records(action="dossier", path="${filePath}").`,
    );
  };

  // 内嵌 AI 面板：确保 Agent + 会话存在，发出上下文化消息并展开右侧面板
  const askAi = useCallback(
    async (kind: AiAskKind, sel?: EditorSelectionInfo | null) => {
      const file = tabs.find((t) => t.fileId === activeFileId);
      if (!file) return;
      const toast = useToastStore.getState().showToast;
      let agentStore = useAgentStore.getState();
      if (agentStore.agents.length === 0) await agentStore.loadAgents();
      agentStore = useAgentStore.getState();
      if (agentStore.agents.length === 0) {
        toast(t("aiPanel.diagnose.noAgent"), "error");
        return;
      }
      // 线程连续：复用当前会话（同 Agent），只有「新对话」才开线程（修掉「每点一次建新会话」的爆炸）
      let convId = agentStore.selectedConversationId;
      const selectedConv = convId ? agentStore.conversations.find((c) => c.id === convId) : null;
      if (selectedConv) {
        if (agentStore.selectedAgentId !== selectedConv.agentId) {
          useAgentStore.getState().selectAgent(selectedConv.agentId);
        }
      } else {
        const agent = agentStore.agents.find((a) => a.id === agentStore.selectedAgentId) ?? agentStore.agents[0];
        if (agentStore.selectedAgentId !== agent.id) useAgentStore.getState().selectAgent(agent.id);
        const conv = await useAgentStore.getState().createConversation(agent.id, t("workbench.aiConvTitle", { file: file.name }));
        convId = conv.id;
      }
      useAgentStore.getState().selectConversation(convId);
      const prompt = buildAiPrompt(kind, file.relPath, file.language ?? "", sel);
      if (!convId) return;
      await useAgentStore.getState().sendMessage(convId, prompt);
      setAiOpen(true);
    },
    [tabs, activeFileId],
  );
  const metrics = useProjectStore((s) => s.metrics);
  const deadSymbols = useProjectStore((s) => s.deadSymbols);
  const clones = useProjectStore((s) => s.clones);
  const findings = useProjectStore((s) => s.findings);
  const themeMode = useTheme().palette.mode as "light" | "dark";

  // 当前激活文件的审查发现计数（驱动顶部状态条徽标，与编辑器行内标记同源）
  const activeFindingsCount = useMemo(() => {
    if (!activeFileId) return 0;
    let n = 0;
    for (const f of findings) {
      if (f.targetId === activeFileId && readLineFromMetadata(f.metadata)) n += 1;
    }
    return n;
  }, [findings, activeFileId]);

  // 编辑器命令句柄：仅激活标签挂载，指向当前打开的编辑器，供 AI 面板「插入光标 / 应用到文件」
  const editorHandleRef = useRef<MonacoEditorHandle | null>(null);
  // 当前编辑器选区（供 AI 上下文芯片实时反映选区）
  const [selection, setSelection] = useState<EditorSelectionInfo | null>(null);

  const tree = useMemo(() => buildTree(files), [files]);

  // 当前激活文件的复杂度热力区间（函数体整块）
  const activeMetric = useMemo(() => {
    if (!activeFileId) return null;
    const list = metrics.filter((m) => m.fileId === activeFileId);
    if (list.length === 0) return null;
    return list.sort((a, b) => b.createdAt - a.createdAt)[0];
  }, [metrics, activeFileId]);

  const heatRanges = useMemo<HeatRange[]>(() => {
    if (!activeMetric) return [];
    const meta = parseFileMetricMeta(activeMetric);
    return (meta.functions || [])
      .filter((f) => f.endLine >= f.line)
      .map((f) => ({
        startLine: f.line,
        endLine: f.endLine,
        cc: f.cc,
        level: ccLevel(f.cc),
        name: f.name,
      }));
  }, [activeMetric]);

  // 当前激活文件的死代码区间（整行灰显）
  const deadRanges = useMemo<DeadRange[]>(() => {
    if (!activeFileId) return [];
    return deadSymbols
      .filter((d) => d.fileId === activeFileId)
      .map((d) => ({
        startLine: d.lineStart,
        endLine: d.lineEnd,
        name: d.name,
        reason: d.reason,
        confidence: d.confidence,
      }));
  }, [deadSymbols, activeFileId]);

  // 当前激活文件的代码克隆区间（同组同色整块高亮）
  const cloneRanges = useMemo<CloneRange[]>(() => {
    if (!activeFileId) return [];
    return clones
      .filter((c) => c.fileId === activeFileId)
      .map((c) => ({
        startLine: c.startLine,
        endLine: c.endLine,
        groupId: c.groupId,
        groupSize: c.groupSize,
        cloneType: c.cloneType,
        snippet: c.snippet,
      }));
  }, [clones, activeFileId]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  // 文件树右键菜单（对标 ProjectTree 的专业上下文菜单，本工作台无画布故不含「在画布中定位」）
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const closeTreeMenu = () => setTreeMenu(null);
  const handleTreeContextMenu = (node: TreeNode, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTreeMenu({ x: e.clientX, y: e.clientY, node });
  };
  // 按 / 与 \ 双分隔符取父目录（跨平台：macOS/Linux 用 /，Windows 用 \）
  const dirOf = (p: string): string => {
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return i > 0 ? p.slice(0, i) : p;
  };
  // 解析节点的绝对路径：文件直接查 files；目录从其首个子文件反推（空目录退化为相对路径）
  const absPathOf = (node: TreeNode): string | null => {
    if (!node.isDir) {
      return files.find((f) => f.id === node.fileId)?.path ?? null;
    }
    const child = files.find((f) => f.relPath.startsWith(node.path + "/"));
    if (child) {
      const suffix = child.relPath.slice(node.path.length);
      return child.path.slice(0, child.path.length - suffix.length);
    }
    return null;
  };
  const copyToClipboard = (label: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    useToastStore.getState().success(t("projectTree.copied", { kind: label }));
    closeTreeMenu();
  };
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  // 对标 VS Code：AI 面板是常驻右侧栏，默认展开。用户关/开后记忆偏好（localStorage），
  // 下次进工作台不再重新点开——「右侧就是 AI 面板」从打开那一刻就在。
  const [aiOpen, setAiOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem("workbench.ai.open");
    return saved === null ? true : saved === "1";
  });
  // 记忆开/合偏好（跨会话保持，对标 VS Code 的 Chat 面板状态持久化）
  useEffect(() => {
    try {
      localStorage.setItem("workbench.ai.open", aiOpen ? "1" : "0");
    } catch {
      /* localStorage 不可用时静默降级，不影响面板本身 */
    }
  }, [aiOpen]);
  // 集成终端开/合偏好（对标 VS Code 的终端面板，Ctrl+` / Cmd+` 切换）
  const [terminalOpen, setTerminalOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem("workbench.terminal.open");
    return saved === "1";
  });
  useEffect(() => {
    try {
      localStorage.setItem("workbench.terminal.open", terminalOpen ? "1" : "0");
    } catch {
      /* localStorage 不可用时静默降级 */
    }
  }, [terminalOpen]);
  // 集成终端是「键盘孤岛」：当按键源自终端（.xterm 内）时，所有 app 级快捷键必须放行给 PTY，
  // 否则 Ctrl/Cmd+P（应进 shell，如 fzf/上一条）、Ctrl/Cmd+S（XOFF）会被 app 抢走，表现为"有些键用不了"。
  const isTerminalTarget = (e: KeyboardEvent): boolean =>
    !!(e.target as HTMLElement | null)?.closest?.(".xterm");
  // Ctrl+` / Cmd+` 切换终端（IDE 习惯）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setTerminalOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // 右侧 dock 的 tab：0 = AI 助手，1 = 需求分析（业务功能独立于 AI 交互入口）。
  // requirements-capture 等 AI 预设只 *读取* 需求基线（数据流向），本 tab 切换不改变这一事实。
  const [rightTab, setRightTab] = useState<number>(0);
  // 需求分析面板「AI 协助」芯片注入到 AI 输入框的一次性提示词；消费后置空避免重复触发。
  const [pendingAiPrompt, setPendingAiPrompt] = useState<string | null>(null);
  // dock 宽度与拖拽（原 AI 面板的宽度/拖拽上移到这一层，两个 tab 共享同一宽度与手柄）
  const [dockWidth, setDockWidth] = useState<number>(() => {
    const w = Number(localStorage.getItem("workbench.ai.width"));
    return Number.isFinite(w) && w > 0 ? w : 430;
  });
  const dockDraggingRef = useRef(false);
  const startDockDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dockDraggingRef.current = true;
    const startX = e.clientX;
    const startW = dockWidth;
    const onMove = (ev: MouseEvent) => {
      if (!dockDraggingRef.current) return;
      const nw = Math.max(300, Math.min(900, startW + (startX - ev.clientX)));
      setDockWidth(nw);
    };
    const onUp = () => {
      dockDraggingRef.current = false;
      try {
        localStorage.setItem("workbench.ai.width", String(dockWidth));
      } catch {
        /* 忽略持久化失败 */
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [dockWidth]);
  const [inlineOpen, setInlineOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // 大纲（对标 Zed outline）：层级树 + 过滤 + 跟随光标 + 折叠
  const [outlineQuery, setOutlineQuery] = useState("");
  const [collapsedOutline, setCollapsedOutline] = useState<Set<string>>(new Set());
  // 大纲视图模式：层级树 ↔ 按类型聚类（对标「结构化符号导航」，大文件下可一键跳到某类符号）
  const [outlineViewMode, setOutlineViewMode] = useState<"tree" | "kind">("tree");
  const [collapsedKind, setCollapsedKind] = useState<Set<string>>(new Set());
  const [cursorLine, setCursorLine] = useState(0);
  const outlineListRef = useRef<HTMLDivElement>(null);
  // 自动保存：编辑即防抖写回磁盘（无需手动保存按钮）
  // 按文件隔离缓冲区与定时器，杜绝「切标签后旧定时器把 B 全文写进 A」的串写缺陷（P0-A）
  const contentBuffers = useRef<Map<string, string>>(new Map());
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 我们刚写盘的文件（短 TTL），用于区分「自己刚保存」与「外部/AI 改盘」（P0-B）
  const justWroteByUs = useRef<Map<string, number>>(new Map());

  // Ctrl/Cmd+P 唤起全局快开面板（与主流编辑器一致）；终端内按键放行给 PTY。
  // 注意：Shift 组合留给命令面板（Ctrl/Cmd+Shift+P），此处必须排除，否则会同时唤起两个面板。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setQuickOpenOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl/Cmd+Shift+P 唤起统一命令面板（对标 Zed command_palette / VS Code Ctrl+Shift+P）；
  // 终端内按键放行给 PTY（如 shell 的 fzf 历史搜索）。
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  // 转到行（对标 Zed go_to_line / VS Code Ctrl+G）：从一处精确跳到 line:column
  const [gotoOpen, setGotoOpen] = useState(false);
  // 项目内全文搜索（对标 Zed crates/search ProjectSearchView / VS Code Ctrl+Shift+F）
  const [searchOpen, setSearchOpen] = useState(false);
  // 问题面板（对标 Zed crates/diagnostics ProjectDiagnosticsEditor）：聚合所有已打开文件的实时诊断，
  // 开关走 useProblemsPanelStore（与状态栏「问题」指示项跨组件通信）。
  const problemsOpen = useProblemsPanelStore((s) => s.open);
  const setProblemsOpen = useProblemsPanelStore((s) => s.setOpen);
  // 转到项目符号（对标 Zed Go to Symbol in Project / VS Code Ctrl+Shift+O）
  const [symbolOpen, setSymbolOpen] = useState(false);
  // 查看书签清单（对标 Zed ViewBookmarks：全部书签聚合为可跳转清单）
  const [bookmarkPickerOpen, setBookmarkPickerOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setCmdPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl/Cmd+G 唤起「转到行」（对标 Zed go_to_line / VS Code Ctrl+G）；终端内按键放行给 PTY。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        setGotoOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl/Cmd+Shift+F 唤起「项目内搜索」（对标 Zed crates/search ProjectSearchView / VS Code Ctrl+Shift+F）；
  // 终端内按键放行给 PTY（如 shell 的前向搜索）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl/Cmd+Shift+O 唤起「转到项目符号」（对标 Zed Go to Symbol in Project / VS Code Ctrl+Shift+O）；
  // 终端内按键放行给 PTY（如 shell 的编辑命令）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        setSymbolOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 窗格键盘导航（对标 Zed ActivatePaneInDirection / ActivateNextPane / SwapPanesInDirection）：
  //  - Ctrl/Cmd+Shift+Alt+Arrow → 按方向把焦点移到几何相邻窗格（避免与多光标 Ctrl/Cmd+Alt+↑/↓ 冲突，零回归）；
  //  - Ctrl/Cmd+Alt+[ / ] → 循环切到上一/下一窗格；
  //  - Ctrl/Cmd+Shift+Alt+Arrow 仅做方向聚焦；交换位置经命令面板暴露（不占额外键位）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      const dirMap: Record<string, SplitDirection> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      // 方向聚焦：Ctrl/Cmd + Shift + Alt + Arrow
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.shiftKey && !e.repeat) {
        const dir = dirMap[e.key];
        if (dir) {
          e.preventDefault();
          useCodeWorkbenchStore.getState().activatePaneInDirection(dir);
        }
        return;
      }
      // 循环切换窗格：Ctrl/Cmd + Alt + [ / ]
      if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && !e.repeat) {
        if (e.key === "]") {
          e.preventDefault();
          useCodeWorkbenchStore.getState().activateNextPane();
        } else if (e.key === "[") {
          e.preventDefault();
          useCodeWorkbenchStore.getState().activatePrevPane();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 标签键盘导航（对标 Zed pane::ActivateNextItem / ActivatePreviousItem / ActivateItem）：
  //  - Ctrl/Cmd+PageDown / PageUp → 当前窗格的下一/上一标签（到尾/到头回绕，零回归）；
  //  - Ctrl/Cmd+1..9 → 按索引切到当前窗格第 N 个标签（越界忽略，对标 Zed ctrl-1..9 = ActivateItem）。
  //  刻意避开多光标(Ctrl/Cmd+Alt+↑/↓)、窗格循环(Ctrl/Cmd+Alt+[ ])、窗格方向聚焦(Ctrl/Cmd+Shift+Alt+Arrow) 键位，守零回归。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.altKey) return; // 让位给多光标 / 窗格循环键位，避免误触
      if (e.key === "PageDown" && !e.shiftKey) {
        e.preventDefault();
        useCodeWorkbenchStore.getState().activateNextTab();
      } else if (e.key === "PageUp" && !e.shiftKey) {
        e.preventDefault();
        useCodeWorkbenchStore.getState().activatePrevTab();
      } else if (!e.shiftKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        useCodeWorkbenchStore.getState().activateTabByIndex(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 书签键位（对标 Zed ToggleBookmark / GoToNextBookmark / GoToPreviousBookmark）：
  //  - Ctrl/Cmd+F2 → 切换当前行书签；Ctrl/Cmd+Shift+F2 → 下一书签；Ctrl/Cmd+Alt+F2 → 上一书签。
  //  仅当按住 Ctrl/Cmd 时接管（普通 F2 仍是重命名符号，由编辑器 addCommand 处理，零冲突）；
  //  终端聚焦时让位（isTerminalTarget 守卫，零回归）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if (e.key !== "F2") return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      e.preventDefault();
      if (e.shiftKey && !e.altKey) editorHandleRef.current?.goToNextBookmark();
      else if (e.altKey && !e.shiftKey) editorHandleRef.current?.goToPrevBookmark();
      else editorHandleRef.current?.toggleBookmark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 文件树筛选：有筛选词时自动全展开命中分支，否则沿用用户展开状态
  const filteredTree = useMemo(
    () => (filter.trim() ? filterTreeNodes(tree, filter.trim()) : null),
    [tree, filter]
  );
  const displayTree = filteredTree ?? tree;
  const displayExpanded = filteredTree ? collectDirPaths(filteredTree) : expanded;
  // 打开新文件时自动展开其所在路径，确保焦点文件可见
  useEffect(() => {
    const a = tabs.find((t) => t.fileId === activeFileId);
    if (!a) return;
    const parts = a.relPath.split("/");
    const anc = new Set<string>();
    let p = "";
    for (let i = 0; i < parts.length - 1; i++) {
      p = p ? `${p}/${parts[i]}` : parts[i];
      anc.add(p);
    }
    setExpanded(anc);
  }, [activeFileId, tabs]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const activeTab = tabs.find((t) => t.fileId === activeFileId) ?? null;

  // ═══ 重命名符号（对标 Zed editor::Rename：光标符号 → 聚合引用 → 确认跨文件改写）═══
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameOld, setRenameOld] = useState("");
  const [renameNew, setRenameNew] = useState("");
  const [renameTargets, setRenameTargets] = useState<RenameTarget[]>([]);
  const [renameIndexed, setRenameIndexed] = useState(true);
  const [renameBusy, setRenameBusy] = useState(false);

  // ═══ 转到定义候选选择器（对标 Zed navigate_to_hover_links：num_locations>1 弹 Definitions 浮层）═══
  const [defPickerOpen, setDefPickerOpen] = useState(false);
  const [defPickerWord, setDefPickerWord] = useState("");
  const [defPickerCandidates, setDefPickerCandidates] = useState<ProjectSymbol[]>([]);

  // 取当前激活标签（供只读判断与「仅当前文件」降级扫描）
  const getActiveTab = useCallback((): WorkbenchTab | null => {
    const st = useCodeWorkbenchStore.getState();
    const pane = st.panes[st.activePaneId];
    if (!pane) return null;
    return pane.tabs.find((t) => t.fileId === pane.activeFileId) ?? null;
  }, []);

  // 重命名符号：聚合 定义(symbols) + 引用(symbolRefs) + 调用(callEdges) 的 (文件,行) 定位点。
  // 若项目索引零命中，降级为「仅当前文件内词边界全量替换」（覆盖局部变量/参数等未被索引的符号）。
  const handleRenameSymbol = useCallback(
    (info: { word: string; line: number; column: number }) => {
      const activeTab = getActiveTab();
      if (activeTab?.readOnly) {
        useToastStore.getState().showToast(t("workbench.rename.readOnly"), "info");
        return;
      }
      const word = info.word;
      if (!word) return;
      const targets = new Map<string, RenameTarget>();
      const add = (fileId: string, line: number) => {
        const key = `${fileId}:${line}`;
        if (targets.has(key)) return;
        const f = files.find((x) => x.id === fileId);
        targets.set(key, { fileId, filePath: f?.relPath ?? fileId, line });
      };
      for (const s of symbols) {
        if (s.name === word) add(s.fileId, s.lineStart);
      }
      for (const r of symbolRefs) {
        if (r.symbolName === word) add(r.fromFileId, r.refLine);
      }
      for (const e of callEdges) {
        if (e.calleeName === word) add(e.callerFileId, e.lineNo);
      }
      let indexed = true;
      if (targets.size === 0) {
        // 降级：仅当前文件内按词边界全量替换（覆盖局部变量/参数等未被 symbols 索引的符号）
        indexed = false;
        const lines = activeTab?.content ? activeTab.content.lines : [];
        const re = new RegExp(`\\b${escapeRegExp(word)}\\b`);
        lines.forEach((ln, i) => {
          if (re.test(ln)) add(activeTab!.fileId, i + 1);
        });
      }
      if (targets.size === 0) {
        useToastStore.getState().showToast(t("workbench.rename.noTarget", { name: word }), "info");
        return;
      }
      setRenameIndexed(indexed);
      setRenameOld(word);
      setRenameNew(word);
      setRenameTargets(Array.from(targets.values()));
      setRenameOpen(true);
    },
    [getActiveTab, symbols, symbolRefs, callEdges, files],
  );

  // 跳转到定义：聚合 symbols 同名候选；单定义直接跳（保持原行为，无回归），
  // 多定义跨文件时弹候选选择器让用户选（对标 Zed navigate_to_hover_links: num_locations>1 → Definitions 浮层，而非静默跳 matches[0]）。
  const handleGoToDefinition = useCallback(
    (info: { word: string; line: number; column: number }) => {
      const word = info.word;
      if (!word) return;
      let matches = symbols.filter((s) => s.name === word);
      if (matches.length === 0) {
        const ci = symbols.find((s) => s.name.toLowerCase() === word.toLowerCase());
        if (ci) matches = [ci];
      }
      if (matches.length === 0) return;
      if (matches.length === 1) {
        const best = matches[0];
        openWorkbenchTab(best.fileId, best.lineStart, t("workbench.jumpToSymbol", { name: word }));
        return;
      }
      const defKinds = new Set([
        "function", "method", "class", "interface", "constructor",
        "enum", "struct", "trait", "module", "namespace", "type",
      ]);
      // 默认选中：优先同文件内定义，其次按定义型符号排序（与 Zed 单一定位点偏好一致）
      const sorted = matches.slice().sort((a, b) => {
        const aSame = a.fileId === activeFileId ? 1 : 0;
        const bSame = b.fileId === activeFileId ? 1 : 0;
        if (aSame !== bSame) return bSame - aSame;
        return (defKinds.has(b.kind) ? 1 : 0) - (defKinds.has(a.kind) ? 1 : 0);
      });
      setDefPickerWord(word);
      setDefPickerCandidates(sorted);
      setDefPickerOpen(true);
    },
    [symbols, activeFileId, openWorkbenchTab],
  );

  // 取某文件当前应写盘文本：优先未保存缓冲区，否则回退到标签内存内容，最后读磁盘。
  // 避免覆盖编辑器里尚未落盘的改动（相比搜索替换轮直接读磁盘，这里更稳妥）。
  const getFileText = useCallback(async (fid: string): Promise<string | null> => {
    const buf = contentBuffers.current.get(fid);
    if (buf != null) return buf;
    const panes = useCodeWorkbenchStore.getState().panes;
    for (const pid in panes) {
      const tt = panes[pid].tabs.find((t) => t.fileId === fid);
      if (tt?.content) return tt.content.lines.join("\n");
    }
    try {
      const src = await projectScanApi.readSourceFile(fid);
      if (src.skippedReason) return null;
      return src.lines.join("\n");
    } catch {
      return null;
    }
  }, []);

  // 确认重命名：按文件分组，逐文件读→行级重写→受控写回（自动 .bak + 登记台账 + 增量重扫）。
  const confirmRename = useCallback(async () => {
    const newName = renameNew.trim();
    if (!newName) {
      useToastStore.getState().showToast(t("workbench.rename.emptyName"), "warning");
      return;
    }
    if (newName === renameOld) {
      setRenameOpen(false);
      return;
    }
    setRenameBusy(true);
    try {
      const byFile = new Map<string, Set<number>>();
      for (const tg of renameTargets) {
        if (!byFile.has(tg.fileId)) byFile.set(tg.fileId, new Set());
        byFile.get(tg.fileId)!.add(tg.line);
      }
      let total = 0;
      let fileCount = 0;
      for (const [fileId, lineSet] of byFile) {
        const text = await getFileText(fileId);
        if (text == null) continue; // 二进制/过大/读取失败：安全跳过，绝不写回
        const lines = text.split("\n");
        for (const ln of lineSet) {
          if (ln >= 1 && ln <= lines.length) {
            const before = lines[ln - 1];
            const { text: after, count } = replaceWordOnLine(before, renameOld, newName);
            if (after !== before) {
              lines[ln - 1] = after;
              total += count;
            }
          }
        }
        await projectScanApi.writeSourceFile(fileId, lines.join("\n"), {
          reason: t("workbench.rename.ledgerReason", { old: renameOld, new: newName }),
          origin: "user",
        });
        fileCount++;
      }
      // 写盘成功后广播重命名事件：引用抽屉(EditorPane)据此乐观刷新（标题/预览/缓存切到新名），
      // 对标 Zed find_all_references 引用视图随 buffer 实时更新。
      emitSymbolRenamed(renameOld, newName);
      useToastStore.getState().showToast(
        t("workbench.rename.done", { old: renameOld, new: newName, count: total, files: fileCount }),
        "success",
      );
    } catch (e) {
      useToastStore.getState().showToast(t("workbench.rename.fail", { error: String(e) }), "error");
    } finally {
      setRenameBusy(false);
      setRenameOpen(false);
    }
  }, [renameNew, renameOld, renameTargets, getFileText]);

  // 全部窗格已打开缓冲区去重聚合（供「切换到打开的文件」模糊缓冲区切换器，对标 Zed buffer_picker 列出全部打开缓冲区）
  const openBuffers = useMemo(() => {
    const seen = new Set<string>();
    const list: { fileId: string; name: string; relPath: string }[] = [];
    for (const p of Object.values(panes)) {
      for (const tab of p.tabs) {
        if (seen.has(tab.fileId)) continue;
        seen.add(tab.fileId);
        list.push({ fileId: tab.fileId, name: tab.name, relPath: tab.relPath });
      }
    }
    return list;
  }, [panes]);

  // 统一命令面板命令注册表（对标 Zed command_palette 的 available_actions）：
  // 动作以数据驱动，组件只负责模糊匹配 / 频次排序 / 历史，不耦合任何业务逻辑。
  const workbenchCommands: WorkbenchCommand[] = useMemo(() => {
    const nav = t("workbench.cmd.catNav");
    const ai = t("workbench.cmd.catAi");
    const view = t("workbench.cmd.catView");
    const file = t("workbench.cmd.catFile");
    const selection = t("workbench.cmd.catSelection");
    const pane = t("workbench.cmd.catPane");
    const diagnostic = t("workbench.cmd.catDiagnostic");
    const edit = t("workbench.cmd.catEdit");
    const tabsCat = t("workbench.cmd.catTabs");
    const fold = t("workbench.cmd.catFold");
    const bookmarksCat = t("workbench.cmd.catBookmarks");
    const convert = t("workbench.cmd.catConvert");
    const catLines = t("workbench.cmd.catLines");
    return [
      {
        id: "gotoFile",
        title: t("workbench.cmd.gotoFile"),
        category: nav,
        keybinding: "Ctrl/Cmd+P",
        keywords: "open file quick switch",
        run: () => setQuickOpenOpen(true),
      },
      {
        id: "gotoLine",
        title: t("workbench.cmd.gotoLine"),
        category: nav,
        keybinding: "Ctrl/Cmd+G",
        keywords: "go to line column jump navigate",
        run: () => setGotoOpen(true),
      },
      {
        id: "gotoSymbol",
        title: t("workbench.cmd.gotoSymbol"),
        category: nav,
        keybinding: "Ctrl/Cmd+Shift+O",
        keywords: "symbol function class interface jump navigate definition",
        run: () => setSymbolOpen(true),
      },
      {
        id: "goToDefinition",
        title: t("workbench.cmd.goToDefinition"),
        category: nav,
        keybinding: "F12",
        keywords: "definition jump navigate symbol",
        run: () => editorHandleRef.current?.goToDefinition(),
      },
      {
        id: "findReferences",
        title: t("workbench.cmd.findReferences"),
        category: nav,
        keybinding: "Shift+F12",
        keywords: "references usages find all navigate",
        run: () => editorHandleRef.current?.findReferences(),
      },
      {
        id: "peekDefinition",
        title: t("workbench.cmd.peekDefinition"),
        category: nav,
        keybinding: "Alt+F12",
        keywords: "peek definition preview inline glance navigate",
        run: () => editorHandleRef.current?.peekDefinition(),
      },
      {
        id: "goToTypeDefinition",
        title: t("workbench.cmd.goToTypeDefinition"),
        category: nav,
        keywords: "type definition jump navigate",
        run: () => editorHandleRef.current?.goToTypeDefinition(),
      },
      {
        id: "goToImplementation",
        title: t("workbench.cmd.goToImplementation"),
        category: nav,
        keywords: "implementation jump navigate",
        run: () => editorHandleRef.current?.goToImplementation(),
      },
      {
        id: "goToDeclaration",
        title: t("workbench.cmd.goToDeclaration"),
        category: nav,
        keywords: "declaration jump navigate",
        run: () => editorHandleRef.current?.goToDeclaration(),
      },
      {
        id: "searchProject",
        title: t("workbench.cmd.searchProject"),
        category: nav,
        keybinding: "Ctrl/Cmd+Shift+F",
        keywords: "search find in files content grep project",
        run: () => setSearchOpen(true),
      },
      {
        id: "renameSymbol",
        title: t("workbench.cmd.renameSymbol"),
        category: nav,
        keybinding: "F2",
        keywords: "rename symbol refactor identifier",
        run: () => {
          const w = editorHandleRef.current?.getWordAtCursor();
          if (w) handleRenameSymbol({ word: w, line: 0, column: 0 });
        },
      },
      {
        id: "addCursorAbove",
        title: t("workbench.cmd.addCursorAbove"),
        category: selection,
        keybinding: "Ctrl/Cmd+Alt+↑",
        keywords: "multi cursor selection above add edit",
        run: () => editorHandleRef.current?.addSelectionAbove(),
      },
      {
        id: "addCursorBelow",
        title: t("workbench.cmd.addCursorBelow"),
        category: selection,
        keybinding: "Ctrl/Cmd+Alt+↓",
        keywords: "multi cursor selection below add edit",
        run: () => editorHandleRef.current?.addSelectionBelow(),
      },
      {
        id: "selectAllMatches",
        title: t("workbench.cmd.selectAllMatches"),
        category: selection,
        keybinding: "Ctrl/Cmd+Shift+L",
        keywords: "select all occurrences matches multi cursor replace",
        run: () => editorHandleRef.current?.selectAllMatches(),
      },
      {
        id: "addSelectionToNextMatch",
        title: t("workbench.cmd.addSelectionNext"),
        category: selection,
        keybinding: "Ctrl/Cmd+D",
        keywords: "add next occurrence match selection multi cursor incremental",
        run: () => editorHandleRef.current?.addSelectionToNextMatch(),
      },
      {
        id: "addSelectionToPreviousMatch",
        title: t("workbench.cmd.addSelectionPrev"),
        category: selection,
        keybinding: "Ctrl/Cmd+Shift+D",
        keywords: "add previous occurrence match selection multi cursor incremental reverse",
        run: () => editorHandleRef.current?.addSelectionToPreviousMatch(),
      },
      {
        id: "toggleColumnSelection",
        title: t("workbench.cmd.toggleColumnSelection"),
        category: selection,
        keywords: "column block rectangular selection alt drag",
        run: () => editorHandleRef.current?.toggleColumnSelection(),
      },
      {
        id: "expandSelection",
        title: t("workbench.cmd.expandSelection"),
        category: selection,
        keybinding: "Shift+Alt+→",
        keywords: "select larger syntax node expand selection smart select",
        run: () => editorHandleRef.current?.expandSelection(),
      },
      {
        id: "shrinkSelection",
        title: t("workbench.cmd.shrinkSelection"),
        category: selection,
        keybinding: "Shift+Alt+←",
        keywords: "select smaller syntax node shrink selection smart select",
        run: () => editorHandleRef.current?.shrinkSelection(),
      },
      {
        id: "toggleLineComment",
        title: t("workbench.cmd.toggleLineComment"),
        category: edit,
        keybinding: "Ctrl/Cmd+/",
        keywords: "comment line toggle edit",
        run: () => editorHandleRef.current?.toggleLineComment(),
      },
      {
        id: "toggleBlockComment",
        title: t("workbench.cmd.toggleBlockComment"),
        category: edit,
        keybinding: "Shift+Alt+A",
        keywords: "comment block toggle edit",
        run: () => editorHandleRef.current?.toggleBlockComment(),
      },
      {
        id: "formatDocument",
        title: t("workbench.cmd.formatDocument"),
        category: edit,
        keybinding: "Shift+Alt+F",
        keywords: "format document indent edit",
        run: () => editorHandleRef.current?.formatDocument(),
      },
      {
        id: "duplicateLine",
        title: t("workbench.cmd.duplicateLine"),
        category: edit,
        keybinding: "Shift+Alt+↓",
        keywords: "duplicate line copy down edit",
        run: () => editorHandleRef.current?.duplicateLine(),
      },
      {
        id: "moveLineUp",
        title: t("workbench.cmd.moveLineUp"),
        category: edit,
        keybinding: "Alt+↑",
        keywords: "move line up edit",
        run: () => editorHandleRef.current?.moveLineUp(),
      },
      {
        id: "moveLineDown",
        title: t("workbench.cmd.moveLineDown"),
        category: edit,
        keybinding: "Alt+↓",
        keywords: "move line down edit",
        run: () => editorHandleRef.current?.moveLineDown(),
      },
      {
        id: "joinLines",
        title: t("workbench.cmd.joinLines"),
        category: edit,
        keybinding: "Ctrl/Cmd+J",
        keywords: "join lines merge edit",
        run: () => editorHandleRef.current?.joinLines(),
      },
      // —— 行结构编辑（对标 Zed DeleteLine / InsertNewlineAbove / InsertNewlineBelow / Transpose）——
      // 此前这些日常操作仅能靠 Monaco 原生键位（若有），命令面板与右键菜单均不可达＝renderable≠useful 缺口；本轮补齐可达入口。
      {
        id: "deleteLine",
        title: t("workbench.cmd.deleteLine"),
        category: edit,
        keybinding: "Ctrl/Cmd+Shift+K",
        keywords: "delete line remove edit",
        run: () => editorHandleRef.current?.deleteLine(),
      },
      {
        id: "insertLineAbove",
        title: t("workbench.cmd.insertLineAbove"),
        category: edit,
        keywords: "insert line above newline edit",
        run: () => editorHandleRef.current?.insertLineAbove(),
      },
      {
        id: "insertLineBelow",
        title: t("workbench.cmd.insertLineBelow"),
        category: edit,
        keywords: "insert line below newline edit",
        run: () => editorHandleRef.current?.insertLineBelow(),
      },
      {
        id: "transpose",
        title: t("workbench.cmd.transpose"),
        category: edit,
        keywords: "transpose swap characters edit",
        run: () => editorHandleRef.current?.transpose(),
      },
      // —— 缩进 / 取消缩进 / 向上复制行（对标 Zed Indent / Outdent / DuplicateLineUp）——
      // 此前仅能靠原生 Tab/Shift+Tab 键位（且依赖编辑器聚焦），命令面板与右键菜单均不可达＝renderable≠useful 缺口；本轮补齐双入口。
      {
        id: "indentSelection",
        title: t("workbench.cmd.indentSelection"),
        category: edit,
        keybinding: "Tab",
        keywords: "indent selection increase tab edit",
        run: () => editorHandleRef.current?.indentSelection(),
      },
      {
        id: "outdentSelection",
        title: t("workbench.cmd.outdentSelection"),
        category: edit,
        keybinding: "Shift+Tab",
        keywords: "outdent selection decrease untab edit",
        run: () => editorHandleRef.current?.outdentSelection(),
      },
      {
        id: "duplicateLineUp",
        title: t("workbench.cmd.duplicateLineUp"),
        category: edit,
        keybinding: "Shift+Alt+↑",
        keywords: "duplicate line up copy edit",
        run: () => editorHandleRef.current?.duplicateLineUp(),
      },
      // —— 词级移动 / 扩选 / 删除（对标 Zed MoveWordLeft/Right、SelectToPreviousWordStart/NextWordEnd、DeleteWordLeft/Right）——
      // 此前仅能靠 Monaco 原生 Ctrl/Cmd+←/→/Backspace/Delete 键位（且依赖编辑器聚焦），命令面板与右键菜单均不可达＝renderable≠useful 缺口；本轮补齐双入口。
      {
        id: "moveWordLeft",
        title: t("workbench.cmd.moveWordLeft"),
        category: edit,
        keywords: "move word left caret navigate edit",
        run: () => editorHandleRef.current?.moveWordLeft(),
      },
      {
        id: "moveWordRight",
        title: t("workbench.cmd.moveWordRight"),
        category: edit,
        keywords: "move word right caret navigate edit",
        run: () => editorHandleRef.current?.moveWordRight(),
      },
      {
        id: "selectWordLeft",
        title: t("workbench.cmd.selectWordLeft"),
        category: edit,
        keywords: "select word left extend selection edit",
        run: () => editorHandleRef.current?.selectWordLeft(),
      },
      {
        id: "selectWordRight",
        title: t("workbench.cmd.selectWordRight"),
        category: edit,
        keywords: "select word right extend selection edit",
        run: () => editorHandleRef.current?.selectWordRight(),
      },
      {
        id: "deleteWordLeft",
        title: t("workbench.cmd.deleteWordLeft"),
        category: edit,
        keywords: "delete word left backspace edit",
        run: () => editorHandleRef.current?.deleteWordLeft(),
      },
      {
        id: "deleteWordRight",
        title: t("workbench.cmd.deleteWordRight"),
        category: edit,
        keywords: "delete word right edit",
        run: () => editorHandleRef.current?.deleteWordRight(),
      },
      // —— 子词级移动 / 扩选 / 删除（对标 Zed MoveTo*Subword / SelectTo*Subword / DeleteTo*Subword*：camelCase/下划线切分的子词粒度）——
      // 此前整词家族已补命令面板/右键双入口，子词维度完全缺失＝renderable≠useful 缺口（03:00 轮待续②）；本轮补齐双入口。
      {
        id: "moveSubwordLeft",
        title: t("workbench.cmd.moveSubwordLeft"),
        category: edit,
        keywords: "subword move left caret navigate camelcase edit",
        run: () => editorHandleRef.current?.moveSubwordLeft(),
      },
      {
        id: "moveSubwordRight",
        title: t("workbench.cmd.moveSubwordRight"),
        category: edit,
        keywords: "subword move right caret navigate camelcase edit",
        run: () => editorHandleRef.current?.moveSubwordRight(),
      },
      {
        id: "selectSubwordLeft",
        title: t("workbench.cmd.selectSubwordLeft"),
        category: edit,
        keywords: "subword select left extend selection camelcase edit",
        run: () => editorHandleRef.current?.selectSubwordLeft(),
      },
      {
        id: "selectSubwordRight",
        title: t("workbench.cmd.selectSubwordRight"),
        category: edit,
        keywords: "subword select right extend selection camelcase edit",
        run: () => editorHandleRef.current?.selectSubwordRight(),
      },
      {
        id: "deleteSubwordLeft",
        title: t("workbench.cmd.deleteSubwordLeft"),
        category: edit,
        keywords: "subword delete left backspace camelcase edit",
        run: () => editorHandleRef.current?.deleteSubwordLeft(),
      },
      {
        id: "deleteSubwordRight",
        title: t("workbench.cmd.deleteSubwordRight"),
        category: edit,
        keywords: "subword delete right camelcase edit",
        run: () => editorHandleRef.current?.deleteSubwordRight(),
      },
      {
        id: "deleteToNextWordStart",
        title: t("workbench.cmd.deleteToNextWordStart"),
        category: edit,
        keywords: "delete next word start skip edit",
        run: () => editorHandleRef.current?.deleteToNextWordStart(),
      },
      {
        id: "deleteToPreviousWordEnd",
        title: t("workbench.cmd.deleteToPreviousWordEnd"),
        category: edit,
        keywords: "delete previous word end edit",
        run: () => editorHandleRef.current?.deleteToPreviousWordEnd(),
      },
      // —— 行首尾编辑（对标 Zed MoveToEndOfLine / MoveToStartOfLine / DeleteToEndOfLine / DeleteToStartOfLine / CutToEndOfLine / CutToStartOfLine）——
      // 此前这些日常操作仅能靠 Monaco 原生 End/Home/Shift+Del 键位（依赖编辑器聚焦），命令面板与右键菜单均不可达＝renderable≠useful 缺口。
      {
        id: "moveToEndOfLine",
        title: t("workbench.cmd.moveToEndOfLine"),
        category: edit,
        keybinding: "End",
        keywords: "move end of line caret edit",
        run: () => editorHandleRef.current?.moveToEndOfLine(),
      },
      {
        id: "moveToStartOfLine",
        title: t("workbench.cmd.moveToStartOfLine"),
        category: edit,
        keybinding: "Home",
        keywords: "move start of line caret edit",
        run: () => editorHandleRef.current?.moveToStartOfLine(),
      },
      {
        id: "deleteToEndOfLine",
        title: t("workbench.cmd.deleteToEndOfLine"),
        category: edit,
        keywords: "delete end of line edit",
        run: () => editorHandleRef.current?.deleteToEndOfLine(),
      },
      {
        id: "deleteToStartOfLine",
        title: t("workbench.cmd.deleteToStartOfLine"),
        category: edit,
        keywords: "delete start of line edit",
        run: () => editorHandleRef.current?.deleteToStartOfLine(),
      },
      {
        id: "cutToEndOfLine",
        title: t("workbench.cmd.cutToEndOfLine"),
        category: edit,
        keywords: "cut end of line clipboard edit",
        run: () => editorHandleRef.current?.cutToEndOfLine(),
      },
      {
        id: "cutToStartOfLine",
        title: t("workbench.cmd.cutToStartOfLine"),
        category: edit,
        keywords: "cut start of line clipboard edit",
        run: () => editorHandleRef.current?.cutToStartOfLine(),
      },
      {
        id: "goToMatchingBracket",
        title: t("workbench.cmd.goToMatchingBracket"),
        category: edit,
        keybinding: "Ctrl/Cmd+Shift+\\",
        keywords: "matching bracket jump navigate edit",
        run: () => editorHandleRef.current?.goToMatchingBracket(),
      },
      {
        id: "moveToEnclosingBracket",
        title: t("workbench.cmd.moveToEnclosingBracket"),
        category: edit,
        keywords: "enclosing bracket move navigate edit",
        run: () => editorHandleRef.current?.moveToEnclosingBracket(),
      },
      {
        id: "selectToEnclosingBracket",
        title: t("workbench.cmd.selectToEnclosingBracket"),
        category: edit,
        keywords: "enclosing bracket select edit",
        run: () => editorHandleRef.current?.selectToEnclosingBracket(),
      },
      // —— 文本大小写转换（对标 Zed ConvertTo* 家族：UpperCase/LowerCase/TitleCase/SnakeCase/KebabCase/UpperCamelCase/LowerCamelCase/SentenceCase）——
      // 算法逐字移植 Zed convert_case（defaults 边界），命令面板入口保证可达（无需先聚焦编辑器也能转换）；选区为空时取光标处单词。
      {
        id: "convertUpper",
        title: t("workbench.cmd.convertUpper"),
        category: convert,
        keywords: "upper case uppercase transform convert",
        run: () => editorHandleRef.current?.convertToUpper(),
      },
      {
        id: "convertLower",
        title: t("workbench.cmd.convertLower"),
        category: convert,
        keywords: "lower case lowercase transform convert",
        run: () => editorHandleRef.current?.convertToLower(),
      },
      {
        id: "convertTitle",
        title: t("workbench.cmd.convertTitle"),
        category: convert,
        keywords: "title case transform convert",
        run: () => editorHandleRef.current?.convertToTitle(),
      },
      {
        id: "convertSnake",
        title: t("workbench.cmd.convertSnake"),
        category: convert,
        keywords: "snake case underscore transform convert",
        run: () => editorHandleRef.current?.convertToSnake(),
      },
      {
        id: "convertKebab",
        title: t("workbench.cmd.convertKebab"),
        category: convert,
        keywords: "kebab case hyphen dash transform convert",
        run: () => editorHandleRef.current?.convertToKebab(),
      },
      {
        id: "convertPascal",
        title: t("workbench.cmd.convertPascal"),
        category: convert,
        keywords: "pascal case upper camel transform convert",
        run: () => editorHandleRef.current?.convertToPascal(),
      },
      {
        id: "convertCamel",
        title: t("workbench.cmd.convertCamel"),
        category: convert,
        keywords: "camel case lower camel transform convert",
        run: () => editorHandleRef.current?.convertToCamel(),
      },
      {
        id: "convertSentence",
        title: t("workbench.cmd.convertSentence"),
        category: convert,
        keywords: "sentence case transform convert",
        run: () => editorHandleRef.current?.convertToSentence(),
      },
      // —— 行级排序 / 去重（对标 Zed SortLines* / UniqueLines*：选区独立变换，命令面板保证可达，无全局键位以免劫持 Monaco 原生 chords）——
      {
        id: "sortLinesCI",
        title: t("workbench.cmd.sortLinesCI"),
        category: catLines,
        keywords: "sort lines alphabetical case insensitive order arrange",
        run: () => editorHandleRef.current?.sortLinesCI(),
      },
      {
        id: "sortLinesCS",
        title: t("workbench.cmd.sortLinesCS"),
        category: catLines,
        keywords: "sort lines alphabetical case sensitive order arrange",
        run: () => editorHandleRef.current?.sortLinesCS(),
      },
      {
        id: "sortLinesLen",
        title: t("workbench.cmd.sortLinesLen"),
        category: catLines,
        keywords: "sort lines length shortest longest order arrange",
        run: () => editorHandleRef.current?.sortLinesLen(),
      },
      {
        id: "uniqueLinesCI",
        title: t("workbench.cmd.uniqueLinesCI"),
        category: catLines,
        keywords: "unique dedupe remove duplicate lines case insensitive",
        run: () => editorHandleRef.current?.uniqueLinesCI(),
      },
      {
        id: "uniqueLinesCS",
        title: t("workbench.cmd.uniqueLinesCS"),
        category: catLines,
        keywords: "unique dedupe remove duplicate lines case sensitive",
        run: () => editorHandleRef.current?.uniqueLinesCS(),
      },
      {
        id: "goToNextProblem",
        title: t("workbench.cmd.goToNextProblem"),
        category: diagnostic,
        keybinding: "F8",
        keywords: "diagnostic error warning next problem jump navigate",
        run: () => editorHandleRef.current?.goToNextProblem(),
      },
      {
        id: "goToPrevProblem",
        title: t("workbench.cmd.goToPrevProblem"),
        category: diagnostic,
        keybinding: "Shift+F8",
        keywords: "diagnostic error warning previous problem jump navigate",
        run: () => editorHandleRef.current?.goToPrevProblem(),
      },
      {
        id: "fold",
        title: t("workbench.cmd.fold"),
        category: fold,
        keybinding: "Ctrl/Cmd+Shift+[",
        keywords: "fold collapse region cursor",
        run: () => editorHandleRef.current?.foldAtCursor(),
      },
      {
        id: "unfold",
        title: t("workbench.cmd.unfold"),
        category: fold,
        keybinding: "Ctrl/Cmd+Shift+]",
        keywords: "unfold expand region cursor",
        run: () => editorHandleRef.current?.unfoldAtCursor(),
      },
      {
        id: "toggleFold",
        title: t("workbench.cmd.toggleFold"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+L",
        keywords: "toggle fold collapse",
        run: () => editorHandleRef.current?.toggleFoldAtCursor(),
      },
      {
        id: "foldRecursively",
        title: t("workbench.cmd.foldRecursively"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+[",
        keywords: "fold recursively nested collapse",
        run: () => editorHandleRef.current?.foldRecursively(),
      },
      {
        id: "unfoldRecursively",
        title: t("workbench.cmd.unfoldRecursively"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+]",
        keywords: "unfold recursively nested expand",
        run: () => editorHandleRef.current?.unfoldRecursively(),
      },
      {
        id: "foldAll",
        title: t("workbench.cmd.foldAll"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+0",
        keywords: "fold all collapse everything",
        run: () => editorHandleRef.current?.foldAll(),
      },
      {
        id: "unfoldAll",
        title: t("workbench.cmd.unfoldAll"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+J",
        keywords: "unfold all expand everything",
        run: () => editorHandleRef.current?.unfoldAll(),
      },
      {
        id: "foldSelection",
        title: t("workbench.cmd.foldSelection"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+,",
        keywords: "fold selected selection region collapse",
        run: () => editorHandleRef.current?.foldSelection(),
      },
      ...Array.from({ length: 7 }, (_, i) => i + 1).map((lv) => ({
        id: `foldLevel${lv}`,
        title: t("workbench.cmd.foldLevel", { level: lv }),
        category: fold,
        keybinding: `Ctrl/Cmd+K Ctrl+${lv}`,
        keywords: `fold level ${lv} collapse nesting depth`,
        run: () => editorHandleRef.current?.foldLevel(lv),
      })),
      {
        id: "toggleWordWrap",
        title: t("workbench.cmd.toggleWordWrap"),
        category: fold,
        keybinding: "Alt+Z",
        keywords: "soft wrap word wrap line wrap toggle",
        run: () => editorHandleRef.current?.toggleWordWrap(),
      },
      {
        id: "foldFunctionBodies",
        title: t("workbench.cmd.foldFunctionBodies"),
        category: fold,
        keywords: "fold function bodies collapse definitions classes methods rust fn",
        run: () => editorHandleRef.current?.foldFunctionBodies(),
      },
      // —— 书签（对标 Zed ToggleBookmark / GoToNextBookmark / GoToPreviousBookmark / ViewBookmarks）——
      {
        id: "toggleBookmark",
        title: t("workbench.cmd.toggleBookmark"),
        category: bookmarksCat,
        keybinding: "Ctrl/Cmd+F2",
        keywords: "bookmark mark line gutter toggle pin",
        run: () => editorHandleRef.current?.toggleBookmark(),
      },
      {
        id: "nextBookmark",
        title: t("workbench.cmd.nextBookmark"),
        category: bookmarksCat,
        keybinding: "Ctrl/Cmd+Shift+F2",
        keywords: "bookmark next jump navigate",
        run: () => editorHandleRef.current?.goToNextBookmark(),
      },
      {
        id: "prevBookmark",
        title: t("workbench.cmd.prevBookmark"),
        category: bookmarksCat,
        keybinding: "Ctrl/Cmd+Alt+F2",
        keywords: "bookmark previous jump navigate",
        run: () => editorHandleRef.current?.goToPrevBookmark(),
      },
      {
        id: "viewBookmarks",
        title: t("workbench.cmd.viewBookmarks"),
        category: bookmarksCat,
        keywords: "bookmarks list all view jump navigate picker",
        run: () => setBookmarkPickerOpen(true),
      },
      {
        id: "toggleAi",
        title: t("workbench.cmd.toggleAi"),
        category: ai,
        keywords: "chat assistant panel",
        run: () => setAiOpen((v) => !v),
      },
      {
        id: "openRequirements",
        title: t("workbench.cmd.openRequirements"),
        category: ai,
        keywords: "requirements spec capture",
        run: () => {
          setRightTab(1);
          setAiOpen(true);
        },
      },
      {
        id: "toggleTerminal",
        title: t("workbench.cmd.toggleTerminal"),
        category: view,
        keybinding: "Ctrl/Cmd+`",
        keywords: "console shell",
        run: () => setTerminalOpen((v) => !v),
      },
      {
        id: "toggleProblems",
        title: t("workbench.cmd.toggleProblems"),
        category: view,
        keywords: "diagnostics problems errors warnings panel",
        run: () => useProblemsPanelStore.getState().toggle(),
      },
      {
        id: "toggleOutline",
        title: t("workbench.cmd.toggleOutline"),
        category: view,
        keywords: "symbol structure map",
        run: () => setOutlineOpen((v) => !v),
      },
      {
        id: "toggleInlineAi",
        title: t("workbench.cmd.toggleInlineAi"),
        category: ai,
        keywords: "inline assist ask",
        run: () => setInlineOpen((v) => !v),
      },
      {
        id: "copyPath",
        title: t("workbench.cmd.copyPath"),
        category: file,
        keywords: "clipboard path",
        run: () => {
          if (activeTab?.relPath) navigator.clipboard?.writeText(activeTab.relPath);
        },
      },
      {
        id: "locateFile",
        title: t("workbench.cmd.locateFile"),
        category: file,
        keywords: "tree reveal focus",
        run: () => {
          if (!activeTab) return;
          const parts = activeTab.relPath.split("/");
          let p = "";
          const anc = new Set<string>();
          for (let i = 0; i < parts.length - 1; i++) {
            p = p ? `${p}/${parts[i]}` : parts[i];
            anc.add(p);
          }
          setExpanded(anc);
        },
      },
      {
        id: "closeCurrentTab",
        title: t("workbench.cmd.closeCurrentTab"),
        category: file,
        keywords: "close tab",
        run: () => {
          if (activeFileId) closeTab(activeFileId);
        },
      },
      {
        id: "nextTab",
        title: t("workbench.cmd.nextTab"),
        category: tabsCat,
        keybinding: "Ctrl/Cmd+PageDown",
        keywords: "switch tab forward next",
        run: () => useCodeWorkbenchStore.getState().activateNextTab(),
      },
      {
        id: "prevTab",
        title: t("workbench.cmd.prevTab"),
        category: tabsCat,
        keybinding: "Ctrl/Cmd+PageUp",
        keywords: "switch tab back previous",
        run: () => useCodeWorkbenchStore.getState().activatePrevTab(),
      },
      {
        id: "lastTab",
        title: t("workbench.cmd.lastTab"),
        category: tabsCat,
        keywords: "switch tab last final end",
        run: () => {
          if (tabs.length) useCodeWorkbenchStore.getState().activateTabByIndex(tabs.length - 1);
        },
      },
      // —— 标签管理家族（对标 Zed pane::close_other_items / close_items_to_the_left|right / close_all_items，
      //    均保留 pinned；此前仅右键菜单可达，命令面板不可达 = renderable≠useful 发现性缺口） ——
      {
        id: "closeOthers",
        title: t("workbench.cmd.closeOthers"),
        category: tabsCat,
        keywords: "close others tabs keep active",
        run: () => { if (activeFileId) useCodeWorkbenchStore.getState().closeOthers(activeFileId); },
      },
      {
        id: "closeLeft",
        title: t("workbench.cmd.closeLeft"),
        category: tabsCat,
        keywords: "close left tabs",
        run: () => { if (activeFileId) useCodeWorkbenchStore.getState().closeLeft(activeFileId); },
      },
      {
        id: "closeRight",
        title: t("workbench.cmd.closeRight"),
        category: tabsCat,
        keywords: "close right tabs",
        run: () => { if (activeFileId) useCodeWorkbenchStore.getState().closeRight(activeFileId); },
      },
      {
        id: "closeAll",
        title: t("workbench.cmd.closeAll"),
        category: tabsCat,
        keywords: "close all tabs",
        run: () => useCodeWorkbenchStore.getState().closeAll(),
      },
      {
        id: "pinTab",
        title: t("workbench.cmd.pinTab"),
        category: tabsCat,
        keywords: "pin unpin tab toggle",
        run: () => { if (activeFileId) useCodeWorkbenchStore.getState().togglePin(activeFileId); },
      },
      // 按序号定位标签（对标 Zed pane::activate_item(N)；Alt+1..9 已绑，此处仅补面板曝光）
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `goToTab${i + 1}`,
        title: t("workbench.cmd.goToTab", { n: i + 1 }),
        category: tabsCat,
        keywords: `go to tab ${i + 1} switch index`,
        run: () => useCodeWorkbenchStore.getState().activateTabByIndex(i),
      })),
      // —— 切换到打开的文件（对标 Zed buffer_picker：列出全部已打开缓冲区，模糊过滤后跳） ——
      ...openBuffers.map((b) => ({
        id: `buffer:${b.fileId}`,
        title: b.name,
        category: tabsCat,
        keywords: `switch open buffer ${b.relPath}`,
        run: () => useCodeWorkbenchStore.getState().activateBuffer(b.fileId),
      })),
      {
        id: "resetLayout",
        title: t("workbench.cmd.resetLayout"),
        category: view,
        keywords: "reset layout panes split restore default",
        run: () => {
          resetLayout();
          useToastStore.getState().showToast(
            t("workbench.layout.resetToast"),
            "success"
          );
        },
      },
      // —— 编辑器字号缩放（对标 Zed IncreaseBufferFontSize / DecreaseBufferFontSize / ResetBufferFontSize）——
      // 此前编辑器无任何字号控制入口（命令面板/状态栏均缺失）＝renderable≠useful 缺口；本轮补齐双入口。
      {
        id: "increaseFont",
        title: t("workbench.cmd.increaseFont"),
        category: view,
        keywords: "font size larger zoom in increase editor readability",
        run: () => editorHandleRef.current?.increaseFont(),
      },
      {
        id: "decreaseFont",
        title: t("workbench.cmd.decreaseFont"),
        category: view,
        keywords: "font size smaller zoom out decrease editor readability",
        run: () => editorHandleRef.current?.decreaseFont(),
      },
      {
        id: "resetFont",
        title: t("workbench.cmd.resetFont"),
        category: view,
        keywords: "font size reset default editor zoom restore",
        run: () => editorHandleRef.current?.resetFont(),
      },
      // —— 窗格导航（对标 Zed ActivatePaneInDirection / ActivateNextPane / SwapPanesInDirection） ——
      {
        id: "focusPaneLeft",
        title: t("workbench.cmd.focusPaneLeft"),
        category: pane,
        keybinding: "Ctrl/Cmd+Shift+Alt+←",
        keywords: "pane focus left navigate split",
        run: () => useCodeWorkbenchStore.getState().activatePaneInDirection("left"),
      },
      {
        id: "focusPaneRight",
        title: t("workbench.cmd.focusPaneRight"),
        category: pane,
        keybinding: "Ctrl/Cmd+Shift+Alt+→",
        keywords: "pane focus right navigate split",
        run: () => useCodeWorkbenchStore.getState().activatePaneInDirection("right"),
      },
      {
        id: "focusPaneUp",
        title: t("workbench.cmd.focusPaneUp"),
        category: pane,
        keybinding: "Ctrl/Cmd+Shift+Alt+↑",
        keywords: "pane focus up navigate split",
        run: () => useCodeWorkbenchStore.getState().activatePaneInDirection("up"),
      },
      {
        id: "focusPaneDown",
        title: t("workbench.cmd.focusPaneDown"),
        category: pane,
        keybinding: "Ctrl/Cmd+Shift+Alt+↓",
        keywords: "pane focus down navigate split",
        run: () => useCodeWorkbenchStore.getState().activatePaneInDirection("down"),
      },
      {
        id: "focusPaneNext",
        title: t("workbench.cmd.focusPaneNext"),
        category: pane,
        keybinding: "Ctrl/Cmd+Alt+]",
        keywords: "pane next cycle focus",
        run: () => useCodeWorkbenchStore.getState().activateNextPane(),
      },
      {
        id: "focusPanePrev",
        title: t("workbench.cmd.focusPanePrev"),
        category: pane,
        keybinding: "Ctrl/Cmd+Alt+[",
        keywords: "pane previous cycle focus",
        run: () => useCodeWorkbenchStore.getState().activatePrevPane(),
      },
      {
        id: "swapPaneLeft",
        title: t("workbench.cmd.swapPaneLeft"),
        category: pane,
        keywords: "pane swap left exchange position",
        run: () => useCodeWorkbenchStore.getState().swapPanesInDirection("left"),
      },
      {
        id: "swapPaneRight",
        title: t("workbench.cmd.swapPaneRight"),
        category: pane,
        keywords: "pane swap right exchange position",
        run: () => useCodeWorkbenchStore.getState().swapPanesInDirection("right"),
      },
      {
        id: "swapPaneUp",
        title: t("workbench.cmd.swapPaneUp"),
        category: pane,
        keywords: "pane swap up exchange position",
        run: () => useCodeWorkbenchStore.getState().swapPanesInDirection("up"),
      },
      {
        id: "swapPaneDown",
        title: t("workbench.cmd.swapPaneDown"),
        category: pane,
        keywords: "pane swap down exchange position",
        run: () => useCodeWorkbenchStore.getState().swapPanesInDirection("down"),
      },
    ];
  }, [
    t,
    activeTab,
    activeFileId,
    tabs,
    setAiOpen,
    setRightTab,
    setTerminalOpen,
    setOutlineOpen,
    setInlineOpen,
    setExpanded,
    setQuickOpenOpen,
    closeTab,
    setActive,
    openBuffers,
    resetLayout,
    handleRenameSymbol,
    editorHandleRef,
  ]);

  // 取某文件当前应写盘的文本：优先未保存缓冲区，否则回退到标签内存内容（Ctrl+S 无改动时也安全）
  const getTabText = useCallback((fid: string): string | null => {
    const buf = contentBuffers.current.get(fid);
    if (buf != null) return buf;
    const tab = useCodeWorkbenchStore.getState().panes[useCodeWorkbenchStore.getState().activePaneId]?.tabs.find((t) => t.fileId === fid);
    return tab?.content ? tab.content.lines.join("\n") : null;
  }, []);

  // 清掉某文件待触发的保存定时器（切标签/关标签/立即保存前调用，避免旧定时器错写到别的文件）
  const clearSaveTimer = useCallback((fid: string) => {
    const t = saveTimers.current.get(fid);
    if (t) {
      clearTimeout(t);
      saveTimers.current.delete(fid);
    }
  }, []);

  // 自动保存：防抖写回磁盘（编辑停止 800ms 后触发）
  const flushSave = useCallback(
    async (fid: string) => {
      clearSaveTimer(fid);
      const text = getTabText(fid);
      if (!fid || text == null) return;
      const toast = useToastStore.getState().showToast;
      try {
        const res = await projectScanApi.writeSourceFile(fid, text);
        // 写盘成功 → 该文件回到「干净」状态：清缓冲区 + 标记刚由我们写盘（区分外部改盘）
        contentBuffers.current.delete(fid);
        justWroteByUs.current.set(fid, Date.now());
        useCodeWorkbenchStore.getState().setContent(fid, text);
        toast(t("workbench.autoSaved", { file: res.relPath }), "success");
      } catch (e) {
        toast(t("workbench.saveFail", { error: e instanceof Error ? e.message : String(e) }), "error");
      }
    },
    [clearSaveTimer, getTabText],
  );

  const scheduleSave = useCallback(
    (fid: string) => {
      clearSaveTimer(fid);
      saveTimers.current.set(
        fid,
        setTimeout(() => {
          void flushSave(fid);
        }, 800),
      );
    },
    [clearSaveTimer, flushSave],
  );

  // 切/关标签前先把当前文件待写缓冲区落盘，避免静默丢改动（P0-A）
  const flushPendingBeforeLeave = useCallback(
    (fid: string | null) => {
      if (!fid) return;
      if (contentBuffers.current.has(fid)) {
        clearSaveTimer(fid);
        void flushSave(fid);
      }
    },
    [clearSaveTimer, flushSave],
  );

  // 切/关标签前先落盘当前文件待写缓冲区（P0-A 防静默丢改动）
  const handleSetActive = useCallback(
    (fid: string) => {
      flushPendingBeforeLeave(activeFileId);
      setActive(fid);
    },
    [activeFileId, flushPendingBeforeLeave, setActive],
  );
  const handleCloseTab = useCallback(
    (fid: string) => {
      flushPendingBeforeLeave(fid);
      closeTab(fid);
    },
    [flushPendingBeforeLeave, closeTab],
  );

  // Ctrl/Cmd+S 立即写回（仍屏蔽浏览器保存对话框；自动保存已覆盖常规场景）；终端内按键放行给 PTY
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        flushPendingBeforeLeave(activeFileId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushPendingBeforeLeave, activeFileId]);

  // P0-B：监听外部/AI 改盘，避免 AI 改完被用户下一次按键静默覆盖
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen<FileChangeEvent[]>("file-changes", (event) => {
          const changes = Array.isArray(event.payload) ? event.payload : [];
          if (!changes.length) return;
          const openTabs = useCodeWorkbenchStore.getState().panes[useCodeWorkbenchStore.getState().activePaneId]?.tabs ?? EMPTY_TABS;
          for (const c of changes) {
            if (c.kind === "removed") continue;
            const p = c.path.replace(/\\/g, "/");
            const match = openTabs.find((t) => {
              const r = t.relPath.replace(/\\/g, "/");
              return p === r || p.endsWith("/" + r);
            });
            if (!match) continue;
            const fid = match.fileId;
            // 我们自己刚写盘的，跳过（否则会把自己刚保存的当成外部改盘）
            const wrote = justWroteByUs.current.get(fid);
            if (wrote && Date.now() - wrote < 2000) continue;
            if (contentBuffers.current.has(fid)) {
              // 用户有未保存改动 + 外部又改了盘 → 提示而非静默覆盖
              useCodeWorkbenchStore.getState().markDiskChanged(fid);
            } else {
              // 无未保存改动 → 静默原地重读，刷新出 AI/外部的最新内容
              void useCodeWorkbenchStore.getState().reloadTab(fid);
            }
          }
        });
      } catch {
        /* 监听注册失败不影响编辑器本身 */
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  // 当前激活文件的符号大纲（按行排序，点条目跳到对应行）
  const outlineSymbols = useMemo<ProjectSymbol[]>(() => {
    if (!activeFileId) return [];
    return symbols
      .filter((s) => s.fileId === activeFileId)
      .sort((a, b) => a.lineStart - b.lineStart || a.name.localeCompare(b.name));
  }, [symbols, activeFileId]);

  // 大纲层级树（按包含关系推导嵌套）+ 全部节点（用于展开/折叠/过滤）
  const outlineTree = useMemo(() => buildOutlineTree(outlineSymbols), [outlineSymbols]);
  const allOutlineNodes = useMemo(() => collectOutlineNodes(outlineTree), [outlineTree]);
  const outlineQueryLc = outlineQuery.trim().toLowerCase();
  const filteredOutlineTree = useMemo(
    () => (outlineQueryLc ? filterOutlineTree(outlineTree, outlineQueryLc) : outlineTree),
    [outlineTree, outlineQueryLc],
  );
  // 「按类型聚类」视图：把（已过滤的）符号按 kind 分组，组内按行号排序；分组顺序由 KIND_ORDER 稳定化。
  const kindGroups = useMemo(() => {
    const list: ProjectSymbol[] = [];
    const walk = (ns: OutlineNode[]) => {
      for (const n of ns) {
        list.push(n.sym);
        if (n.children.length) walk(n.children);
      }
    };
    walk(filteredOutlineTree);
    const map = new Map<string, ProjectSymbol[]>();
    const order: string[] = [];
    for (const s of list) {
      const k = s.kind || "unknown";
      if (!map.has(k)) {
        map.set(k, []);
        order.push(k);
      }
      map.get(k)!.push(s);
    }
    order.sort((a, b) => kindSortIndex(a) - kindSortIndex(b) || a.localeCompare(b));
    return order.map((k) => ({
      kind: k,
      items: map.get(k)!.slice().sort((x, y) => x.lineStart - y.lineStart),
    }));
  }, [filteredOutlineTree]);
  // 跟随光标：光标所在（最深）符号高亮，便于在长文件中随时定位当前位置
  const activeOutlineId = useMemo(() => {
    if (!cursorLine) return null;
    let best: OutlineNode | null = null;
    for (const n of allOutlineNodes) {
      const s = n.sym;
      if (s.lineStart <= cursorLine && cursorLine <= s.lineEnd) {
        if (!best || n.depth > best.depth) best = n;
      }
    }
    return best?.sym.id ?? null;
  }, [allOutlineNodes, cursorLine]);

  // 跟随光标：活动符号进入视口（仅平滑滚动，不抢焦点，避免打断编辑）
  useEffect(() => {
    if (!activeOutlineId || !outlineListRef.current) return;
    const el = outlineListRef.current.querySelector(
      `[data-outline-id="${CSS.escape(activeOutlineId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeOutlineId, filteredOutlineTree]);
  // 可定位符号名集合（小写去重），供编辑器按住 Ctrl/⌘ 悬停显示跳转下划线
  const gotoSymbols = useMemo<string[]>(
    () => Array.from(new Set(symbols.map((s) => s.name.toLowerCase()))),
    [symbols],
  );

  // 面包屑符号段：取光标所在（最内层）符号，点击可跳转该行（renderable AND useful）
  const activeSymbol = useMemo<{ name: string; line: number } | null>(() => {
    if (!selection?.startLine || outlineSymbols.length === 0) return null;
    let best: (typeof outlineSymbols)[number] | null = null;
    for (const s of outlineSymbols) {
      if (s.lineStart <= selection.startLine && (!best || s.lineStart > best.lineStart)) best = s;
    }
    return best ? { name: best.name, line: best.lineStart } : null;
  }, [selection, outlineSymbols]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {/* 顶栏 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        {showBackButton && (
          <Tooltip title={t("workbench.backCanvas")}>
            <IconButton size="small" onClick={onRequestClose}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            {t("workbench.title")}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
            {activeTab ? activeTab.relPath : t("workbench.subtitle")}
          </Typography>
        </Box>
        {activeFindingsCount > 0 && (
          <Chip
            size="small"
            color="warning"
            label={t("workbench.marks", { n: activeFindingsCount })}
            sx={{ height: 20, fontSize: 10 }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t("workbench.outlineToggle")}>
          <IconButton size="small" onClick={() => setOutlineOpen((v) => !v)} color={outlineOpen ? "primary" : "default"}>
            <ListAltIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.aiToggle")}>
          <IconButton size="small" onClick={() => setAiOpen((v) => !v)} color={aiOpen ? "primary" : "default"}>
            <SmartToyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.terminalToggle")}>
          <IconButton size="small" onClick={() => setTerminalOpen((v) => !v)} color={terminalOpen ? "primary" : "default"}>
            <TerminalIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.problemsToggle")}>
          <IconButton size="small" onClick={() => useProblemsPanelStore.getState().toggle()} color={problemsOpen ? "primary" : "default"}>
            <ReportProblemIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.close")}>
          <IconButton size="small" onClick={onRequestClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 主体：左栏(文件树+符号大纲) + 右编辑区 */}
      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* 左侧栏：文件树与上方可折叠的符号大纲堆叠 */}
        <Box
          sx={{
            width: 264,
            flexShrink: 0,
            borderRight: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <Box sx={{ px: 1, pt: 0.5, pb: 0.5 }}>
            <TextField
              size="small"
              fullWidth
              placeholder={t("workbench.filterPlaceholder")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setFilter("");
                if (e.key === "Enter") {
                  const firstFile = displayTree.find((n) => n.fileId);
                  if (firstFile?.fileId) {
                    openFileInTab(firstFile.fileId);
                  }
                }
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  sx: { fontSize: 12 },
                },
              }}
              sx={{ "& .MuiInputBase-root": { height: 30 } }}
            />
          </Box>
          {/* 文件树滚动区 */}
          <Box sx={{ flex: 1, overflow: "auto", minHeight: 0, py: 0.5 }}>
            {displayTree.length === 0 ? (
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 1.5, py: 1 }}>
                {filteredTree ? t("workbench.noMatch") : t("workbench.empty")}
              </Typography>
            ) : (
              displayTree.map((n) => (
                <FileTreeNode
                  key={n.path}
                  node={n}
                  depth={0}
                  expanded={displayExpanded}
                  onToggle={toggle}
                  onOpen={(fid) => openFileInTab(fid)}
                  activeFileId={activeFileId}
                  onDragFileStart={(fid) => setDraggingFile({ fileId: fid })}
                  onDragFileEnd={() => setDraggingFile(null)}
                  onContextMenu={handleTreeContextMenu}
                />
              ))
            )}
          </Box>
          <Menu
            anchorReference="anchorPosition"
            anchorPosition={treeMenu ? { top: treeMenu.y + 4, left: treeMenu.x + 4 } : undefined}
            anchorOrigin={{ vertical: "top", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "left" }}
            open={Boolean(treeMenu)}
            onClose={closeTreeMenu}
            slotProps={{ paper: { sx: treeMenuSx } }}
          >
            {treeMenu &&
              (() => {
                const node = treeMenu.node;
                const abs = absPathOf(node) ?? node.path;
                const rel = node.path;
                const reveal = () => {
                  const p = absPathOf(node);
                  if (p) {
                    void invoke("reveal_in_file_manager", { path: p }).catch(() => {});
                    useToastStore.getState().info(t("projectTree.revealToast", { name: node.name }));
                  }
                  closeTreeMenu();
                };
                type Item = { label: string; icon: React.ReactNode; onClick: () => void };
                const sections: { header: string; items: Item[] }[] = [];
                if (!node.isDir) {
                  sections.push({
                    header: t("projectTree.secActions"),
                    items: [
                      {
                        label: t("workbench.treeMenu.openInSplit"),
                        icon: <CodeIcon sx={{ fontSize: 16 }} />,
                        onClick: () => {
                          if (node.fileId) {
                            openFileInSplit(node.fileId, node.path, node.name, node.language ?? null, null, "right", null);
                          }
                          closeTreeMenu();
                        },
                      },
                    ],
                  });
                  sections.push({
                    header: t("projectTree.secAi"),
                    items: [
                      {
                        label: t("panel.menu.aiDiagnose"),
                        icon: <AutoFixHighIcon sx={{ fontSize: 16 }} />,
                        onClick: () => {
                          triggerDiagnosis({ filePath: node.path, kind: "file", title: t("projectTree.aiDiagnoseTitle", { name: node.name }) });
                          closeTreeMenu();
                        },
                      },
                    ],
                  });
                }
                const copyItems: Item[] = [
                  {
                    label: t("projectTree.copyDir"),
                    icon: <FolderIcon sx={{ fontSize: 16 }} />,
                    onClick: () => copyToClipboard(t("projectTree.copyDir"), node.isDir ? abs : dirOf(abs)),
                  },
                  ...(node.isDir
                    ? []
                    : [
                        {
                          label: t("projectTree.copyFile"),
                          icon: <InsertDriveFileIcon sx={{ fontSize: 16 }} />,
                          onClick: () => copyToClipboard(t("projectTree.copyFile"), abs),
                        },
                      ]),
                  {
                    label: t("projectTree.copyRel"),
                    icon: <TextSnippetIcon sx={{ fontSize: 16 }} />,
                    onClick: () => copyToClipboard(t("projectTree.copyRel"), node.isDir ? rel : dirOf(rel)),
                  },
                  {
                    label: t("projectTree.copyName"),
                    icon: <LabelIcon sx={{ fontSize: 16 }} />,
                    onClick: () => copyToClipboard(t("projectTree.copyName"), node.name),
                  },
                ];
                sections.push({ header: t("projectTree.copyHeader"), items: copyItems });
                sections.push({
                  header: t("projectTree.secSystem"),
                  items: [
                    {
                      label: t("workbench.tabMenu.revealInFileManager"),
                      icon: <FolderOpenIcon sx={{ fontSize: 16 }} />,
                      onClick: reveal,
                    },
                  ],
                });
                return (
                  <>
                    {sections.map((sec, i) => (
                      <Box key={sec.header + i}>
                        {i > 0 && <Divider sx={{ my: 0.5, mx: 1 }} />}
                        <Box sx={treeHeaderSx}>
                          <Typography variant="caption" sx={treeHeaderTextSx}>
                            {sec.header}
                          </Typography>
                        </Box>
                        {sec.items.map((it) => (
                          <MenuItem key={it.label} onClick={it.onClick} sx={treeItemSx}>
                            <ListItemIcon sx={{ minWidth: 28 }}>{it.icon}</ListItemIcon>
                            <ListItemText primary={it.label} sx={{ "& .MuiListItemText-primary": { fontSize: 13 } }} />
                          </MenuItem>
                        ))}
                      </Box>
                    ))}
                  </>
                );
              })()}
          </Menu>
          {/* 符号大纲（可折叠 · 层级树 + 过滤 + 跟随光标，对标 Zed outline 的嵌套/过滤/跳转能力） */}
          {outlineOpen && (
            <Box
              sx={{
                height: "52%",
                flexShrink: 0,
                borderTop: 1,
                borderColor: "divider",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              {/* 标题行 + 视图模式切换 + 全部展开/折叠 */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", flex: 1 }}>
                  {t("workbench.outlineTitle")}
                </Typography>
                {/* 视图模式切换：层级树 ↔ 按类型聚类（对标结构化符号导航，大文件一键跳到某类符号） */}
                <Box
                  sx={{
                    display: "flex",
                    borderRadius: 1,
                    overflow: "hidden",
                    border: "1px solid",
                    borderColor: "divider",
                    flexShrink: 0,
                  }}
                  title={t("workbench.outlineToggleView")}
                >
                  {(["tree", "kind"] as const).map((m) => (
                    <Box
                      key={m}
                      onClick={() => setOutlineViewMode(m)}
                      sx={{
                        px: 0.6,
                        py: 0.2,
                        fontSize: 10,
                        cursor: "pointer",
                        userSelect: "none",
                        bgcolor: outlineViewMode === m ? "primary.main" : "transparent",
                        color: outlineViewMode === m ? "#fff" : "text.secondary",
                        "&:hover": { bgcolor: outlineViewMode === m ? "primary.main" : "action.hover" },
                      }}
                    >
                      {m === "tree" ? t("workbench.outlineViewTree") : t("workbench.outlineViewKind")}
                    </Box>
                  ))}
                </Box>
                <Typography variant="caption" color="text.disabled">
                  {allOutlineNodes.length}
                </Typography>
                <Tooltip title={t("workbench.outlineExpandAll")}>
                  <IconButton
                    size="small"
                    sx={{ p: 0.25 }}
                    onClick={() => {
                      setCollapsedOutline(new Set());
                      setCollapsedKind(new Set());
                    }}
                  >
                    <span style={{ fontSize: 12, lineHeight: 1 }}>▾▾</span>
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("workbench.outlineCollapseAll")}>
                  <IconButton
                    size="small"
                    sx={{ p: 0.25 }}
                    onClick={() => {
                      setCollapsedOutline(
                        new Set(
                          allOutlineNodes.filter((n) => n.children.length > 0).map((n) => n.sym.id),
                        ),
                      );
                      setCollapsedKind(new Set(kindGroups.map((g) => g.kind)));
                    }}
                  >
                    <span style={{ fontSize: 12, lineHeight: 1 }}>▸▸</span>
                  </IconButton>
                </Tooltip>
              </Box>
              {/* 过滤输入框 */}
              <Box sx={{ px: 1, pb: 0.5 }}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder={t("workbench.outlineFilter")}
                  value={outlineQuery}
                  onChange={(e) => setOutlineQuery(e.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                      sx: { fontSize: 12 },
                    },
                  }}
                  sx={{ "& .MuiInputBase-root": { height: 28 } }}
                />
              </Box>
              {/* 层级树 */}
              <Box ref={outlineListRef} sx={{ flex: 1, overflow: "auto", minHeight: 0, pb: 1 }}>
                {allOutlineNodes.length === 0 ? (
                  <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 1.5, py: 1 }}>
                    {t("workbench.noSymbols")}
                  </Typography>
                ) : filteredOutlineTree.length === 0 ? (
                  <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 1.5, py: 1 }}>
                    {t("workbench.noMatch")}
                  </Typography>
                ) : outlineViewMode === "tree" ? (
                  (() => {
                    const renderNode = (n: OutlineNode): JSX.Element => {
                      const hasChildren = n.children.length > 0;
                      const collapsed = collapsedOutline.has(n.sym.id);
                      const isActive = n.sym.id === activeOutlineId;
                      const indent = 6 + n.depth * 12;
                      return (
                        <Box key={n.sym.id}>
                          <Box
                            data-outline-id={n.sym.id}
                            onClick={() =>
                              useCodeWorkbenchStore
                                .getState()
                                .jumpTo(n.sym.lineStart, t("workbench.outlineJump", { name: n.sym.name }))
                            }
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.5,
                              pl: `${indent}px`,
                              pr: 1,
                              py: 0.4,
                              cursor: "pointer",
                              borderLeft: `2px solid ${isActive ? "primary.main" : "transparent"}`,
                              bgcolor: isActive ? "action.selected" : "transparent",
                              "&:hover": { bgcolor: "action.hover" },
                            }}
                          >
                            {hasChildren ? (
                              <Box
                                component="span"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCollapsedOutline((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(n.sym.id)) next.delete(n.sym.id);
                                    else next.add(n.sym.id);
                                    return next;
                                  });
                                }}
                                sx={{
                                  width: 14,
                                  flexShrink: 0,
                                  fontSize: 11,
                                  color: "text.secondary",
                                  cursor: "pointer",
                                }}
                              >
                                {collapsed ? "▸" : "▾"}
                              </Box>
                            ) : (
                              <Box component="span" sx={{ width: 14, flexShrink: 0 }} />
                            )}
                            <Typography
                              variant="caption"
                              sx={{
                                flexShrink: 0,
                                width: 34,
                                fontSize: 9,
                                color: symbolKindColor(n.sym.kind),
                                textTransform: "uppercase",
                                fontWeight: 600,
                              }}
                              noWrap
                            >
                              {symbolKindLabel(n.sym.kind)}
                            </Typography>
                            <Typography
                              variant="caption"
                              noWrap
                              sx={{ flex: 1, fontWeight: isActive ? 700 : 500 }}
                            >
                              {n.sym.name}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.disabled"
                              sx={{ flexShrink: 0, fontSize: 10 }}
                            >
                              {n.sym.lineStart}
                            </Typography>
                          </Box>
                          {hasChildren && (!collapsed || outlineQueryLc) && n.children.map((c) => renderNode(c))}
                        </Box>
                      );
                    };
                    return filteredOutlineTree.map((n) => renderNode(n));
                  })()
                ) : (
                  kindGroups.map((g) => {
                    const isCollapsed = collapsedKind.has(g.kind);
                    return (
                      <Fragment key={g.kind}>
                        <Box
                          onClick={() =>
                            setCollapsedKind((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.kind)) next.delete(g.kind);
                              else next.add(g.kind);
                              return next;
                            })
                          }
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                            pl: 1,
                            pr: 1,
                            py: 0.4,
                            cursor: "pointer",
                            userSelect: "none",
                            bgcolor: "action.selected",
                            "&:hover": { bgcolor: "action.hover" },
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{
                              fontSize: 11,
                              fontWeight: 700,
                              flexShrink: 0,
                              color: symbolKindColor(g.kind),
                              textTransform: "uppercase",
                            }}
                          >
                            {symbolKindLabel(g.kind)}
                          </Typography>
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
                            {g.items.length}
                          </Typography>
                          <Box component="span" sx={{ fontSize: 11, color: "text.secondary", ml: "auto" }}>
                            {isCollapsed ? "▸" : "▾"}
                          </Box>
                        </Box>
                        {!isCollapsed &&
                          g.items.map((s) => {
                            const isActive = s.id === activeOutlineId;
                            return (
                              <Box
                                key={s.id}
                                data-outline-id={s.id}
                                onClick={() =>
                                  useCodeWorkbenchStore
                                    .getState()
                                    .jumpTo(s.lineStart, t("workbench.outlineJump", { name: s.name }))
                                }
                                sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 0.5,
                                  pl: "6px",
                                  pr: 1,
                                  py: 0.4,
                                  cursor: "pointer",
                                  borderLeft: `2px solid ${isActive ? "primary.main" : "transparent"}`,
                                  bgcolor: isActive ? "action.selected" : "transparent",
                                  "&:hover": { bgcolor: "action.hover" },
                                }}
                              >
                                <Typography
                                  variant="caption"
                                  sx={{
                                    flexShrink: 0,
                                    width: 34,
                                    fontSize: 9,
                                    color: symbolKindColor(s.kind),
                                    textTransform: "uppercase",
                                    fontWeight: 600,
                                  }}
                                  noWrap
                                >
                                  {symbolKindLabel(s.kind)}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  noWrap
                                  sx={{ flex: 1, fontWeight: isActive ? 700 : 500 }}
                                >
                                  {s.name}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color="text.disabled"
                                  sx={{ flexShrink: 0, fontSize: 10 }}
                                >
                                  {s.lineStart}
                                </Typography>
                              </Box>
                            );
                          })}
                      </Fragment>
                    );
                  })
                )}
              </Box>
            </Box>
          )}
        </Box>

        {/* 多窗格编辑区（对标 Zed PaneGroup）：递归窗格树，各 axis 按自身 orientation 排布窗格 */}
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          <Box
            ref={paneContainerRef}
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              userSelect: dragDivider !== null ? "none" : undefined,
            }}
          >
            {renderPaneNode(paneTree, null, 1)}
          </Box>
          {inlineOpen && (
              <InlineChat
                open={inlineOpen}
                onClose={() => setInlineOpen(false)}
                activeFile={
                  activeTab
                    ? {
                        fileId: activeTab.fileId,
                        relPath: activeTab.relPath,
                        language: activeTab.language,
                        name: activeTab.name,
                        totalLines: activeTab.content?.totalLines,
                      }
                    : null
                }
                selection={selection}
                editorRef={editorHandleRef}
                onOpenPanel={() => {
                  setInlineOpen(false);
                  setAiOpen(true);
                  setRightTab(0);
                }}
              />
            )}
        </Box>

        {/* 右侧 dock：tab 分栏（AI 助手 | 需求分析），两个 tab 共享同一宽度与拖拽手柄。
           需求分析是独立业务功能，不再混进 AI 面板的模式下拉——AI 入口只管「怎么跟 AI 对话」。 */}
        {aiOpen && (
          <Box
            sx={{
              width: dockWidth,
              flexShrink: 0,
              borderLeft: 1,
              borderColor: "divider",
              bgcolor: "background.paper",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              position: "relative",
            }}
          >
            {/* 拖拽手柄（共享宽度，整块 dock 可拖） */}
            <Box
              onMouseDown={startDockDrag}
              sx={{ position: "absolute", left: -3, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 5, "&:hover": { bgcolor: "primary.main", opacity: 0.3 } }}
            />
            {/* tab 栏 */}
            <Box sx={{ display: "flex", alignItems: "center", borderBottom: 1, borderColor: "divider", pl: 0.5, pr: 0.25 }}>
              <Tabs value={rightTab} onChange={(_e, v) => setRightTab(v)} sx={{ minHeight: 34, flex: 1 }}>
                <Tab label={t("workbench.tab.ai")} sx={{ minHeight: 34, py: 0.5, fontSize: 12, textTransform: "none" }} />
                <Tab label={t("workbench.tab.requirements")} sx={{ minHeight: 34, py: 0.5, fontSize: 12, textTransform: "none" }} />
              </Tabs>
              <IconButton size="small" onClick={() => setAiOpen(false)} sx={{ flexShrink: 0 }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            {/* tab 内容 */}
            <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {rightTab === 0 && (
                <WorkbenchAiPanel
                  activeFile={
                    activeTab
                      ? {
                          fileId: activeTab.fileId,
                          relPath: activeTab.relPath,
                          language: activeTab.language,
                          name: activeTab.name,
                          totalLines: activeTab.content?.totalLines,
                        }
                      : null
                  }
                  selection={selection}
                  editorRef={editorHandleRef}
                  onClose={() => setAiOpen(false)}
                  onOpenPath={handleOpenPath}
                  initialPrompt={pendingAiPrompt}
                  onConsumeInitialPrompt={() => setPendingAiPrompt(null)}
                  isBookScene={false}
                />
              )}
              {rightTab === 1 && (
                <RequirementsPanel
                  onAssist={(prompt) => {
                    setPendingAiPrompt(prompt);
                    setRightTab(0);
                  }}
                />
              )}
            </Box>
          </Box>
        )}
      </Box>
      {/* 集成终端（IDE 标准可交互 shell；默认收起，顶部终端按钮 / Ctrl+` 开合） */}
      {terminalOpen && (
        <Box
          sx={{
            height: 240,
            flexShrink: 0,
            borderTop: 1,
            borderColor: "divider",
            minHeight: 0,
          }}
        >
          <WorkbenchTerminalTabs onClose={() => setTerminalOpen(false)} />
        </Box>
      )}
      <QuickOpen
        open={quickOpenOpen}
        onClose={() => setQuickOpenOpen(false)}
        files={files}
        onPick={(fid, line, col) => openFileInTab(fid, line, col)}
        onPickSplit={(fid, line, col, dir) => {
          const f = files.find((x) => x.id === fid);
          if (f) openFileInSplit(f.id, f.relPath, f.name, f.language, line ?? null, dir ?? "right", col ?? null);
        }}
      />
      <GoToSymbol
        open={symbolOpen}
        onClose={() => setSymbolOpen(false)}
        symbols={symbols}
        onPickSplit={openFileInSplit}
        files={files}
        onPick={(fileId, relPath, name, language, line) =>
          openTab(fileId, relPath, name, language, line, t("workbench.symbolJump", { name }))
        }
      />
      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        commands={workbenchCommands}
        title={t("workbench.commandPalette")}
        placeholder={t("workbench.commandPalettePlaceholder")}
        emptyText={t("workbench.commandPaletteEmpty")}
      />
      <GotoLineDialog
        open={gotoOpen}
        onClose={() => setGotoOpen(false)}
        editorHandleRef={editorHandleRef}
      />
      {/* 查看书签清单（对标 Zed ViewBookmarks：全部书签聚合为可跳转清单；点击即跳、Delete 即删） */}
      <BookmarkPicker
        open={bookmarkPickerOpen}
        onClose={() => setBookmarkPickerOpen(false)}
        onPick={(fileId, line) => openFileInTab(fileId, line)}
      />
      <WorkbenchSearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onJump={handleSearchJump}
      />
      {problemsOpen && (
        <WorkbenchProblemsPanel onClose={() => setProblemsOpen(false)} onJump={handleOpenPath} />
      )}

      {/* 重命名符号对话框（对标 Zed editor::Rename 的内联确认：预填旧名 → 确认跨文件改写） */}
      <Dialog
        open={renameOpen}
        onClose={() => !renameBusy && setRenameOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <Box sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t("workbench.rename.title")}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>{renameOld}</Box>
            {" → "}
            {renameIndexed
              ? t("workbench.rename.summary", {
                  count: renameTargets.length,
                  files: new Set(renameTargets.map((x) => x.fileId)).size,
                })
              : t("workbench.rename.currentFileOnly", { count: renameTargets.length })}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={renameNew}
            placeholder={t("workbench.rename.placeholder")}
            onChange={(e) => setRenameNew(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmRename();
              else if (e.key === "Escape") setRenameOpen(false);
            }}
            sx={{ mb: 1 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
            {t("workbench.rename.note")}
          </Typography>
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            <Button size="small" disabled={renameBusy} onClick={() => setRenameOpen(false)}>
              {t("workbench.rename.cancel")}
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={renameBusy || !renameNew.trim() || renameNew.trim() === renameOld}
              onClick={confirmRename}
              startIcon={renameBusy ? <CircularProgress size={14} color="inherit" /> : null}
            >
              {renameBusy ? t("workbench.rename.busy") : t("workbench.rename.confirm")}
            </Button>
          </Box>
        </Box>
      </Dialog>
      <DefinitionPicker
        open={defPickerOpen}
        onClose={() => setDefPickerOpen(false)}
        word={defPickerWord}
        candidates={defPickerCandidates}
        files={files}
        onPick={(fileId, relPath, name, language, line) => {
          openWorkbenchTab(fileId, line, t("workbench.jumpToSymbol", { name }));
          setDefPickerOpen(false);
        }}
        onPickSplit={openFileInSplit}
      />
    </Box>
  );
}

export function CodeWorkbench() {
  const open = useCodeWorkbenchStore((s) => s.open);
  const close = useCodeWorkbenchStore((s) => s.close);
  return (
    <Dialog
      open={open}
      onClose={close}
      fullScreen
      slotProps={{ paper: { sx: { bgcolor: "background.default" } } }}
    >
      <CodeWorkbenchBody onRequestClose={close} showBackButton />
    </Dialog>
  );
}
