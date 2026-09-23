// sight-folio: 实体 tab 的「项目树」组件
//
// 需求（用户点名）：实体 tab 里的「模块」组是平铺的顶层目录行，没有层级/缩进，
// 无法打开目录看到子目录、无法定位子目录节点。这里用与文件 tab 同一棵目录树
// （utils/fileTree.ts 的 buildFileTree）渲染真正的多级树：
//   - 目录行：展开箭头 + 文件夹图标 + 名称 + 子项计数；点击 = 展开/收起 + 画布定位该目录
//   - 文件行：语言色点（图片青 / 资源橙 / 无语言灰图标）+ 名称；点击交给父组件
//     （打开源码 + 画布定位；图片/资源走各自的画像入口，绝不开代码编辑器看乱码）
//   - 缩进随层级递增（0.5 + depth * 1.5，与文件 tab 一致）
//   - 搜索时按文件名/路径过滤并保留祖先目录
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import ImageIcon from "@mui/icons-material/Image";
import FontDownloadIcon from "@mui/icons-material/FontDownload";
import CodeIcon from "@mui/icons-material/Code";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import TextSnippetIcon from "@mui/icons-material/TextSnippet";
import LabelIcon from "@mui/icons-material/Label";
import { invoke } from "@tauri-apps/api/core";
import { languageColor } from "../../utils/languageMeta";
import { isImageFile, isAssetFile, assetFormatLabel } from "../utils/fileKind";
import { imageFormatLabel } from "../utils/imageAsset";
import { navigateToSourceByPath } from "../utils/sourceNavigate";
import { triggerDiagnosis } from "../../ai/triggerDiagnosis";
import { t } from "../../i18n";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { useToastStore } from "../../store/toastStore";
import type { TreeNode } from "../utils/fileTree";

/** 按搜索词裁剪树：文件命中 name/relPath，目录仅保留含命中后代的祖先链。 */
function pruneTree(nodes: TreeNode[], q: string): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.isDirectory) {
      const children = pruneTree(n.children, q);
      if (children.length > 0) out.push({ ...n, children });
    } else if (n.name.toLowerCase().includes(q) || n.relPath.toLowerCase().includes(q)) {
      out.push(n);
    }
  }
  return out;
}

/** 在目录树里按 relPath 找到从根到该节点的链路（含自身），用于展开祖先 + 滚动定位。 */
function findNodeChain(nodes: TreeNode[], relPath: string): TreeNode[] | null {
  for (const n of nodes) {
    if (n.relPath === relPath) return [n];
    if (n.isDirectory && n.children && n.children.length > 0) {
      const sub = findNodeChain(n.children, relPath);
      if (sub) return [n, ...sub];
    }
  }
  return null;
}

/** 按 node.id 找到链路（含自身）。文件实体 config.fileId = ProjectFile.id = 树节点 id，
 *  与 relPath 无关，是最稳的命中方式（relPath 万一不一致也不会漏）。 */
function findNodeByIdWithChain(nodes: TreeNode[], id: string): TreeNode[] | null {
  for (const n of nodes) {
    if (n.id === id) return [n];
    if (n.isDirectory && n.children && n.children.length > 0) {
      const sub = findNodeByIdWithChain(n.children, id);
      if (sub) return [n, ...sub];
    }
  }
  return null;
}

/** 单行文件图标：图片青缩略图占位 / 资源橙格式块 / 语言色点 / 无语言灰图标 */
function FileGlyphIcon({ node }: { node: TreeNode }) {
  const rel = node.relPath || node.name;
  if (isImageFile(rel)) {
    const fmt = imageFormatLabel(node.name);
    return (
      <Box
        sx={{
          width: 14,
          height: 14,
          borderRadius: 0.5,
          bgcolor: languageColor("image"),
          color: "#fff",
          fontSize: 6.5,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          ml: 0.25,
          lineHeight: 1,
        }}
      >
        {(fmt || "IMG").slice(0, 2)}
      </Box>
    );
  }
  if (isAssetFile(rel)) {
    const fmt = assetFormatLabel(node.name);
    return (
      <Box
        sx={{
          width: 14,
          height: 14,
          borderRadius: 0.5,
          bgcolor: languageColor("asset"),
          color: "#fff",
          fontSize: 6.5,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          ml: 0.25,
          lineHeight: 1,
        }}
      >
        {(fmt || "BIN").slice(0, 3)}
      </Box>
    );
  }
  if (node.language) {
    return (
      <Box
        sx={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          bgcolor: languageColor(node.language),
          flexShrink: 0,
          ml: 0.25,
        }}
      />
    );
  }
  return <InsertDriveFileIcon sx={{ fontSize: 13, color: "text.disabled", flexShrink: 0 }} />;
}

const ProjectTreeNode = memo(function ProjectTreeNode({
  node,
  depth,
  expanded,
  selectedId,
  highlightRelPath,
  onSelect,
  onToggle,
  onDirFocus,
  onFileClick,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selectedId: string | null;
  highlightRelPath?: string | null;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  onDirFocus: (node: TreeNode) => void;
  onFileClick: (node: TreeNode) => void;
  onContextMenu: (node: TreeNode, e: ReactMouseEvent) => void;
}) {
  const isOpen = expanded.has(node.id);
  // 高亮来源有二：树内单击（selectedId）或画布双击选中实体（highlightRelPath）。
  const isSelected = selectedId === node.id || (highlightRelPath != null && node.relPath === highlightRelPath);
  // 单击/双击分流：双击会连发两次 click（会把目录展开又收起、或触发两次动作）。
  // 单击用 180ms 延迟执行，双击到达时清掉待执行的单击 —— 单击专注树内操作
  // （目录=展开/收起、文件=选中高亮），双击才去关联右侧画布（目录=定位实体、文件=打开源码/画像）。
  const clickTimer = useRef<number | null>(null);
  const scheduleSingle = (fn: () => void) => {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      fn();
    }, 180);
  };
  useEffect(() => () => {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
  }, []);
  const cancelSingle = () => {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
  };

  if (node.isDirectory) {
    const directCount = node.children.length;
    return (
      <Box>
        <Box
          onClick={(e) => {
            e.stopPropagation();
            // 单击 = 展开/收起（延迟执行，让双击优先）
            scheduleSingle(() => {
              onToggle(node.id);
              onSelect(node.id);
            });
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            cancelSingle();
            // 双击 = 关联右侧画布（定位该目录实体），不再重复 toggle
            onDirFocus(node);
          }}
          onContextMenu={(e) => onContextMenu(node, e)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 0.5,
            py: 0.35,
            pl: 0.5 + depth * 1.5,
            cursor: "pointer",
            borderRadius: 0.5,
            backgroundColor: isSelected ? "action.selected" : "transparent",
            "&:hover": { backgroundColor: "action.hover" },
          }}
          title={`${node.relPath}\n${t("projectTree.clickHintDir")}`}
          data-tree-id={node.id}
        >
          <ChevronRightIcon
            sx={{
              fontSize: 14,
              color: "text.secondary",
              flexShrink: 0,
              transform: isOpen ? "rotate(90deg)" : "none",
              transition: "transform 0.12s",
            }}
          />
          {isOpen ? (
            <FolderOpenIcon sx={{ fontSize: 14, color: "primary.main", flexShrink: 0 }} />
          ) : (
            <FolderIcon sx={{ fontSize: 14, color: "primary.main", flexShrink: 0 }} />
          )}
          <Typography
            variant="caption"
            sx={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 500,
            }}
          >
            {node.name}
          </Typography>
          {directCount > 0 && (
            <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled", flexShrink: 0 }}>
              {directCount}
            </Typography>
          )}
        </Box>
        {isOpen && (
          <Box>
            {node.children.map((child) => (
              <ProjectTreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                selectedId={selectedId}
                highlightRelPath={highlightRelPath}
                onSelect={onSelect}
                onToggle={onToggle}
                onDirFocus={onDirFocus}
                onFileClick={onFileClick}
                onContextMenu={onContextMenu}
              />
            ))}
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box
      onClick={(e) => {
        e.stopPropagation();
        // 单击 = 树内选中（高亮），不碰画布
        onSelect(node.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        cancelSingle();
        // 双击 = 关联右侧画布（打开源码 / 图片预览 / 资源定位）
        onFileClick(node);
      }}
      onContextMenu={(e) => onContextMenu(node, e)}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 0.5,
        py: 0.35,
        pl: 0.5 + (depth + 1) * 1.5,
        cursor: "pointer",
        borderRadius: 0.5,
        backgroundColor: isSelected ? "action.selected" : "transparent",
        "&:hover": { backgroundColor: "action.hover" },
      }}
      title={`${node.relPath}\n${t("projectTree.clickHintFile")}`}
      data-tree-id={node.id}
    >
      <FileGlyphIcon node={node} />
      <Typography
        variant="caption"
        sx={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {node.name}
      </Typography>
    </Box>
  );
});

export function ProjectTree({
  roots,
  onFileClick,
  onDirFocus,
  search = "",
}: {
  roots: TreeNode[];
  onFileClick: (node: TreeNode) => void;
  onDirFocus: (node: TreeNode) => void;
  search?: string;
}) {
  // 默认展开第一层目录（用户要「打开目录就能看到子目录」）
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(roots.filter((r) => r.isDirectory).map((r) => r.id)));
  // 当前选中行（单击=树内选中高亮，双击才联动画布）
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 分析/数据切换（roots 引用变化）时重置为第一层展开
  useEffect(() => {
    setExpanded(new Set(roots.filter((r) => r.isDirectory).map((r) => r.id)));
    setSelectedId(null);
  }, [roots]);

  // ─── 反向联动：画布双击实体 → 项目树自动展开祖先 + 平滑滚入视野 + 高亮 ───
  // 与文件 tab（ScannedFilesPanel）同机制：读 editorStore.selectedIds → 取选中实体
  // 的 filePath（文件/图片/符号）或 dirPath（文件夹）→ 在树上按 relPath 命中节点。
  const listRef = useRef<HTMLDivElement>(null);
  const pendingScrollId = useRef<string | null>(null);
  const prevSelId = useRef<string | null>(null);
  const selectedNodePath = useEditorStore((s) => {
    const sel = s.selection.selectedIds;
    if (sel.length === 0) return null;
    const comp = s.components.find((c) => c.id === sel[0]);
    if (!comp) return null;
    const fp = (comp.config as any)?.filePath;
    if (typeof fp === "string") return fp;
    const dp = (comp.config as any)?.dirPath;
    if (typeof dp === "string") return dp;
    // v2.18 耦合矩形树图联动：单击 treemap-cell → moduleName 即目录 relPath，驱动树自动展开+滚动
    if (comp.type === "treemap-cell") {
      const mn = (comp.config as any)?.moduleName;
      if (typeof mn === "string") return mn;
    }
    return null;
  });

  useEffect(() => {
    if (!selectedNodePath) {
      pendingScrollId.current = null;
      prevSelId.current = null;
      return;
    }
    // 优先按 filePath/dirPath 命中；文件实体额外用 fileId（=ProjectFile.id=树节点 id）
    // 兜底，确保 relPath 万一不一致时文件也能定位到目录树节点。
    let chain = findNodeChain(roots, selectedNodePath);
    if (!chain) {
      const sel = useEditorStore.getState().selection.selectedIds;
      if (sel.length > 0) {
        const comp = useEditorStore.getState().components.find((c) => c.id === sel[0]);
        const fid = (comp?.config as any)?.fileId;
        if (typeof fid === "string" && fid) chain = findNodeByIdWithChain(roots, fid);
      }
    }
    if (chain && chain.length > 0) {
      const targetId = chain[chain.length - 1].id;
      const ancIds = chain.slice(0, -1).map((n) => n.id);
      setExpanded((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const id of ancIds) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      // 仅当选中实体真正变化时，才标记待滚动（避免用户手动折叠被抢滚动）
      if (selectedNodePath !== prevSelId.current) {
        pendingScrollId.current = targetId;
        prevSelId.current = selectedNodePath;
      }
    }
  }, [selectedNodePath, roots]);

  useEffect(() => {
    const id = pendingScrollId.current;
    if (!id) return;
    // 等展开/选中重渲染完成后再滚动，确保目标行已在 DOM
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-tree-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        pendingScrollId.current = null;
      }
    });
  }, [selectedNodePath, expanded]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ─── 右键菜单：对标典型 IDE 的项目树上下文菜单（复制路径 / 打开源码 / AI 诊断 / 在文件管理器显示）───
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  // 按 / 与 \ 双分隔符取父目录（跨平台：macOS/Linux 用 /，Windows 用 \）
  const dirOf = (p: string): string => {
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return i > 0 ? p.slice(0, i) : p;
  };
  const closeMenu = () => setMenu(null);
  const handleContextMenu = (node: TreeNode, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(node.id); // 右键也高亮该行，让菜单作用对象可见
    setMenu({ x: e.clientX, y: e.clientY, node });
  };
  const copyToClipboard = (label: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    useToastStore.getState().success(t("projectTree.copied", { kind: label }));
    closeMenu();
  };
  // 复用画布右键菜单（EditorContextMenu）的专业视觉语言：卡片小箭头 + 分区大写标题 + 独立语义图标 + 细分割线
  const menuSx = {
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
  const itemSx = {
    py: 0.75,
    px: 1.5,
    borderRadius: 0.75,
    mx: 0.5,
    "&:hover": { backgroundColor: "action.hover" },
  } as const;
  const headerSx = { px: 1.5, py: 0.4, mb: 0.25 } as const;
  const headerTextSx = {
    fontWeight: 600,
    color: "text.secondary",
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  } as const;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? pruneTree(roots, q) : roots;
  }, [roots, search]);

  if (visible.length === 0) {
    return (
      <Typography variant="caption" sx={{ display: "block", px: 2, py: 1, fontSize: 10, color: "text.disabled" }}>
        {t("leftPanel.noMatchTree")}
      </Typography>
    );
  }

  return (
    <>
      <Box ref={listRef} sx={{ py: 0.25 }}>
        {visible.map((n) => (
          <ProjectTreeNode
            key={n.id}
            node={n}
            depth={0}
            expanded={expanded}
            selectedId={selectedId}
            highlightRelPath={selectedNodePath}
            onSelect={setSelectedId}
            onToggle={toggle}
            onDirFocus={onDirFocus}
            onFileClick={onFileClick}
            onContextMenu={handleContextMenu}
          />
        ))}
      </Box>

      <Menu
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y + 4, left: menu.x + 4 } : undefined}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        open={Boolean(menu)}
        onClose={closeMenu}
        slotProps={{ paper: { sx: menuSx } }}
      >
        {menu &&
          (() => {
            const node = menu.node;
            const file = useProjectStore.getState().files.find((f) => f.id === node.id);
            const abs = file?.path || node.relPath; // file.path 为绝对路径（参考 WorkbenchEditorPane 调 reveal_in_file_manager）
            const rel = node.relPath;
            const reveal = () => {
              if (file?.path) {
                void invoke("reveal_in_file_manager", { path: file.path }).catch(() => {});
                useToastStore.getState().info(t("projectTree.revealToast", { name: node.name }));
              }
              closeMenu();
            };
            type Item = { label: string; icon: React.ReactNode; onClick: () => void };
            const sections: { header: string; items: Item[] }[] = [];
            if (node.isDirectory) {
              sections.push({
                header: t("projectTree.secActions"),
                items: [
                  {
                    label: t("projectTree.locateOnCanvas"),
                    icon: <CenterFocusStrongIcon sx={{ fontSize: 16 }} />,
                    onClick: () => {
                      onDirFocus(node);
                      closeMenu();
                    },
                  },
                ],
              });
            } else {
              sections.push({
                header: t("projectTree.secActions"),
                items: [
                  {
                    label: t("projectTree.openSource"),
                    icon: <CodeIcon sx={{ fontSize: 16 }} />,
                    onClick: () => {
                      navigateToSourceByPath(node.relPath, null, t("projectTree.toastOpen", { name: node.name }));
                      closeMenu();
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
                      triggerDiagnosis({ filePath: node.relPath, kind: "file", title: t("projectTree.aiDiagnoseTitle") });
                      closeMenu();
                    },
                  },
                ],
              });
            }
            const copyItems: Item[] = [
              {
                label: t("projectTree.copyDir"),
                icon: <FolderIcon sx={{ fontSize: 16 }} />,
                onClick: () => copyToClipboard(t("projectTree.copyDir"), node.isDirectory ? abs : dirOf(abs)),
              },
              ...(node.isDirectory
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
                onClick: () => copyToClipboard(t("projectTree.copyRel"), node.isDirectory ? rel : dirOf(rel)),
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
                    <Box sx={headerSx}>
                      <Typography variant="caption" sx={headerTextSx}>
                        {sec.header}
                      </Typography>
                    </Box>
                    {sec.items.map((it) => (
                      <MenuItem key={it.label} onClick={it.onClick} sx={itemSx}>
                        <ListItemIcon sx={{ minWidth: 28 }}>{it.icon}</ListItemIcon>
                        <ListItemText
                          primary={it.label}
                          sx={{ "& .MuiListItemText-primary": { fontSize: 13 } }}
                        />
                      </MenuItem>
                    ))}
                  </Box>
                ))}
              </>
            );
          })()}
      </Menu>
    </>
  );
}
