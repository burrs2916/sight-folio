/** CodeWorkbench 文件树：树构建、模糊匹配与 FileTreeNode 组件。 */

import type { MouseEvent as ReactMouseEvent } from "react";

import Box from "@mui/material/Box";

import Typography from "@mui/material/Typography";

import FolderIcon from "@mui/icons-material/Folder";

import type { HeatRange } from "./MonacoCodeEditor";


import type { ProjectFile } from "../../services/tauri";
import { LanguageIcon } from "../../utils/languageIcon";


/** 圈复杂度 → 等级（McCabe 通用阈值） */
export function ccLevel(cc: number): HeatRange["level"] {
  if (cc <= 5) return "low";
  if (cc <= 10) return "medium";
  if (cc <= 20) return "high";
  return "extreme";
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  fileId?: string;
  language?: string | null;
  children: TreeNode[];
}

/** 路径归一化：去反斜杠、去 ./ 前缀、去首尾斜杠、去空段，保证 dirIndex key 一致 */
export function normalizeRel(rel: string): string {
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
export function buildTree(files: ProjectFile[]): TreeNode[] {
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
export function filterTreeNodes(nodes: TreeNode[], rawQuery: string): TreeNode[] {
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
export function collectDirPaths(nodes: TreeNode[]): Set<string> {
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
export const treeMenuSx = {
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
export const treeItemSx = {
  py: 0.75,
  px: 1.5,
  borderRadius: 0.75,
  mx: 0.5,
  "&:hover": { backgroundColor: "action.hover" },
} as const;
export const treeHeaderSx = { px: 1.5, py: 0.4, mb: 0.25 } as const;
export const treeHeaderTextSx = {
  fontWeight: 600,
  color: "text.secondary",
  fontSize: 10,
  letterSpacing: 0.5,
  textTransform: "uppercase",
} as const;

/** 轻量模糊匹配评分：子序列命中返回分数（越靠前/越连续越高），否则 null。 */
export function fuzzyScore(text: string, rawQuery: string): number | null {
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
export function fuzzyMatch(
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
export function parsePathWithPosition(raw: string): {
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

export function FileTreeNode({
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
