// sight-folio: 项目文件树构建（共享工具）
//
// 文件 tab（ScannedFilesPanel）与实体 tab（ProjectTree）都需要「按 parent_id 构建
// 多级目录树」。此前 buildFileTree 内联在 ScannedFilesPanel 里，实体 tab 要树形就得
// 复制一份 —— 又是「一处修 bug 另一处不跟着动」的发散源。抽到这里统一维护：
// 目录在前、按名称排序、递归子级，两处共用同一棵树语义。
import type { ProjectFile } from "../../services/tauri";

export interface TreeNode {
  id: string;
  name: string;
  relPath: string;
  isDirectory: boolean;
  language: string | null;
  lineCount: number;
  size: number;
  /** 资源文件格式（TTF/PDF/ZIP…，asset 兜底识别用） */
  format?: string;
  children: TreeNode[];
}

export function buildFileTree(files: ProjectFile[]): TreeNode[] {
  // 按 parent_id 构建父子关系
  const idToNode = new Map<string, TreeNode>();
  files.forEach((f) => {
    idToNode.set(f.id, {
      id: f.id,
      name: f.name,
      relPath: f.relPath,
      isDirectory: f.isDirectory,
      language: f.language,
      lineCount: f.lineCount,
      size: f.size ?? 0,
      children: [],
    });
  });

  const roots: TreeNode[] = [];
  files.forEach((f) => {
    const node = idToNode.get(f.id)!;
    if (f.parentId && idToNode.has(f.parentId)) {
      idToNode.get(f.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // 排序：目录在前，按名称
  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sortTree(n.children));
  };
  sortTree(roots);
  return roots;
}

/** 统计树内目录/文件数量（组头徽标用）。 */
export function countTree(root: TreeNode[]): { dirs: number; files: number } {
  let dirs = 0;
  let files = 0;
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.isDirectory) {
        dirs += 1;
        walk(n.children);
      } else {
        files += 1;
      }
    }
  };
  walk(root);
  return { dirs, files };
}
