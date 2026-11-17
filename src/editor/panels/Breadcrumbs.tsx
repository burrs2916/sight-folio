/**
 * 编辑器面包屑（对标 Zed breadcrumbs，并做差异化增强）
 *
 * Zed 行为：编辑器顶端显示 `app › src › main.rs › fn main` 形态 = 文件路径 + 当前光标符号链，
 * 段整体可点击切换大纲、右键复制路径；但 Zed 的**目录段本身不可单独点击弹出同级兄弟**。
 *
 * 我们持有整库扫描文件树，因此差异化增强：点击任意目录段 → 弹出该目录下「兄弟文件 / 子目录」
 * 下拉（可下钻），把面包屑从「只读路径」变成「可导航的目录跳跃器」——renderable AND useful。
 * 进一步：文件段 / 符号段右键弹出分析菜单（依赖画像聚焦此文件 / 复杂度 / 调用图 / AI 诊断），
 * 让面包屑成为连接「导航」与「分析能力层（画像 + AI 诊断）」的入口——renderable AND useful 的延伸。
 */

import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { LanguageIcon } from "../../utils/languageIcon";
import { t } from "../../i18n";
import type { ProjectFile } from "../../services/tauri";
import type { PortraitKind } from "../utils/portraits";

interface BreadcrumbSymbol {
  name: string;
  line: number;
}

interface BreadcrumbsProps {
  relPath: string;
  language?: string | null;
  files: ProjectFile[];
  /** 当前光标符号链（外层→内层，对标 Zed outline_symbols_at_cursor 的整条祖先链）。空数组=光标不在任何符号内。 */
  symbols?: BreadcrumbSymbol[] | null;
  onOpenFile: (fileId: string) => void;
  onToggleOutline: () => void;
  onCopyPath: () => void;
  onRevealLine: (line: number) => void;
  /** 对标 Zed breadcrumbs「上下文感知动作」哲学：段右键 → 触发对该文件/符号的分析能力（画像 + AI 诊断） */
  onAnalyzeFile?: (fileId: string, kind: PortraitKind) => void;
  onDiagnoseFile?: (fileId: string) => void;
  onDiagnoseSymbol?: (fileId: string, symbolName: string, line: number) => void;
}

interface ChildEntry {
  type: "dir" | "file";
  name: string;
  path: string;
  fileId?: string;
  language?: string | null;
}

function dirnameOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i >= 0 ? rel.slice(0, i) : "";
}

/** 取某目录的直接子项：子目录 + 直接文件，目录在前、各自按名称排序 */
function childrenOf(dirPath: string, files: ProjectFile[]): ChildEntry[] {
  const prefix = dirPath ? `${dirPath}/` : "";
  const dirs = new Map<string, ChildEntry>();
  const fileChildren: ChildEntry[] = [];
  for (const f of files) {
    if (dirPath && !f.relPath.startsWith(prefix)) continue;
    if (!dirPath && f.relPath.includes("/")) {
      // 根目录下的子目录（取第一段）
      const seg = f.relPath.split("/")[0];
      if (!dirs.has(seg)) dirs.set(seg, { type: "dir", name: seg, path: seg });
      continue;
    }
    const rest = f.relPath.slice(prefix.length);
    const parts = rest.split("/");
    if (parts.length === 1) {
      fileChildren.push({ type: "file", name: f.name, path: f.relPath, fileId: f.id, language: f.language });
    } else {
      const seg = parts[0];
      if (!dirs.has(seg)) dirs.set(seg, { type: "dir", name: seg, path: `${prefix}${seg}` });
    }
  }
  const dirList = Array.from(dirs.values()).sort((a, b) => a.name.localeCompare(b.name));
  fileChildren.sort((a, b) => a.name.localeCompare(b.name));
  return [...dirList, ...fileChildren];
}

const segButtonSx = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "text.secondary",
  fontSize: 12,
  px: 0.5,
  py: 0.2,
  borderRadius: 0.5,
  "&:hover": { color: "primary.main", textDecoration: "underline" },
} as const;

export function Breadcrumbs({
  relPath,
  language,
  files,
  symbols,
  onOpenFile,
  onToggleOutline,
  onCopyPath,
  onRevealLine,
  onAnalyzeFile,
  onDiagnoseFile,
  onDiagnoseSymbol,
}: BreadcrumbsProps) {
  const parts = relPath.split("/");
  const fileName = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);
  // 当前光标符号链（外层→内层）；最内层（末项）承载符号级 AI 诊断。
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chain 是 symbols 的空值兜底（|| []），实际数据源是 symbols
  const chain = symbols && symbols.length ? symbols : [];
  const activeSym = chain.length ? chain[chain.length - 1] : null;
  // 链过长时取「头 + ⋯ + 尾」，对标 Zed MAX_SEGMENTS=12 的中段省略（保持首尾上下文）。
  const SYMBOL_CHAIN_MAX = 8;
  const symbolChainItems = useMemo<
    { type: "sym" | "ellipsis"; name: string; line: number }[]
  >(() => {
    if (chain.length === 0) return [];
    if (chain.length <= SYMBOL_CHAIN_MAX)
      return chain.map((s) => ({ type: "sym" as const, name: s.name, line: s.line }));
    const headN = Math.ceil(SYMBOL_CHAIN_MAX / 2);
    const tailN = Math.floor(SYMBOL_CHAIN_MAX / 2);
    const head = chain
      .slice(0, headN)
      .map((s) => ({ type: "sym" as const, name: s.name, line: s.line }));
    const tail = chain
      .slice(chain.length - tailN)
      .map((s) => ({ type: "sym" as const, name: s.name, line: s.line }));
    return [...head, { type: "ellipsis" as const, name: "⋯", line: -1 }, ...tail];
  }, [chain]);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [menuDir, setMenuDir] = useState<string>("");
  // 分析动作右键菜单：区分文件段 / 符号段，承载画像 + AI 诊断入口（renderable AND useful）
  const [ctxMenu, setCtxMenu] = useState<{ anchor: HTMLElement; kind: "file" | "symbol"; fileId: string } | null>(
    null,
  );

  const openMenu = (e: React.MouseEvent<HTMLElement>, dirPath: string) => {
    e.stopPropagation();
    setMenuDir(dirPath);
    setAnchor(e.currentTarget);
  };
  const closeMenu = () => setAnchor(null);

  const openCtxMenu = (e: React.MouseEvent<HTMLElement>, kind: "file" | "symbol", fileId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ anchor: e.currentTarget, kind, fileId });
  };
  const closeCtxMenu = () => setCtxMenu(null);

  const currentFile = useMemo(() => files.find((f) => f.relPath === relPath), [files, relPath]);

  const kids = useMemo(() => (anchor ? childrenOf(menuDir, files) : []), [anchor, menuDir, files]);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        px: 1,
        py: 0.3,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflowX: "auto",
        minHeight: 28,
        fontSize: 12,
      }}
    >
      {dirParts.map((seg, i) => {
        const cum = dirParts.slice(0, i + 1).join("/");
        return (
          <span key={cum} style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
            <Box component="button" type="button" onClick={(e) => openMenu(e, cum)} sx={segButtonSx}>
              {seg}
            </Box>
            <NavigateNextIcon sx={{ fontSize: 14, color: "text.disabled", mx: 0.1 }} />
          </span>
        );
      })}

      {/* 文件锚点（图标）：点击切换大纲，右键打开分析菜单。
          文件名已由标签栏承载，此处刻意不再重复渲染文字（消除与标签栏的重复），
          仅保留 LanguageIcon 作为「切换大纲 / 右键分析」的可点击锚点（aria-label 保无障碍）。 */}
      <Tooltip title={t("workbench.breadcrumb.toggleOutlineTip")}>
        <Box
          component="button"
          type="button"
          aria-label={fileName}
          onClick={onToggleOutline}
          onContextMenu={(e) => {
            if (currentFile?.id && (onAnalyzeFile || onDiagnoseFile)) {
              openCtxMenu(e, "file", currentFile.id);
            } else {
              e.preventDefault();
              onCopyPath();
            }
          }}
          sx={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "text.primary",
            fontWeight: 600,
            fontSize: 12,
            px: 0.5,
            py: 0.2,
            borderRadius: 0.5,
            display: "inline-flex",
            alignItems: "center",
            gap: 0.3,
            flexShrink: 0,
            "&:hover": { color: "primary.main" },
          }}
        >
          <LanguageIcon lang={language} size={12} />
        </Box>
      </Tooltip>

      {/* 当前光标符号链（对标 Zed outline_symbols_at_cursor：外层→内层整条链，随 caret 实时更新）。
          每个段可点击跳转到该符号所在行；仅最内层段右键可 AI 诊断该符号（差异化增强同文件段）。 */}
      {chain.length > 0 && (
        <>
          <NavigateNextIcon sx={{ fontSize: 14, color: "text.disabled", mx: 0.1 }} />
          {symbolChainItems.map((item, idx) =>
            item.type === "ellipsis" ? (
              <Typography
                key={`el-${idx}`}
                component="span"
                sx={{ color: "text.disabled", fontSize: 12, flexShrink: 0, px: 0.25 }}
              >
                {item.name}
              </Typography>
            ) : (
              <Tooltip key={`sym-${idx}`} title={t("workbench.breadcrumb.revealSymbolTip")}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => onRevealLine(item.line)}
                  onContextMenu={(e) => {
                    // 仅最内层符号段提供「AI 诊断此符号」右键入口
                    if (
                      idx === symbolChainItems.length - 1 &&
                      item.type === "sym" &&
                      currentFile?.id &&
                      onDiagnoseSymbol
                    )
                      openCtxMenu(e, "symbol", currentFile.id);
                  }}
                  sx={segButtonSx}
                >
                  {item.name}
                </Box>
              </Tooltip>
            ),
          )}
        </>
      )}

      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ width: 280, maxHeight: 360, display: "flex", flexDirection: "column" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
            <FolderOpenIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            <Typography variant="caption" noWrap sx={{ flex: 1, fontFamily: "monospace" }}>
              {menuDir || "/"}
            </Typography>
          </Box>
          <Box sx={{ overflow: "auto", flex: 1, py: 0.5 }}>
            <List dense disablePadding>
              {menuDir && (
                <ListItemButton onClick={() => setMenuDir(dirnameOf(menuDir))}>
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <ArrowUpwardIcon sx={{ fontSize: 16 }} />
                  </ListItemIcon>
                  <ListItemText primary={t("workbench.breadcrumb.up")} sx={{ "& .MuiListItemText-primary": { fontSize: 12 } }} />
                </ListItemButton>
              )}
              {kids.length === 0 && (
                <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 1, py: 1 }}>
                  {t("workbench.breadcrumb.empty")}
                </Typography>
              )}
              {kids.map((c) => (
                <ListItemButton
                  key={c.path}
                  onClick={() => {
                    if (c.type === "dir") setMenuDir(c.path);
                    else if (c.fileId) {
                      onOpenFile(c.fileId);
                      closeMenu();
                    }
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    {c.type === "dir" ? (
                      <FolderIcon sx={{ fontSize: 16, color: "#d29922" }} />
                    ) : (
                      <LanguageIcon lang={c.language} size={14} />
                    )}
                  </ListItemIcon>
                  <ListItemText primary={c.name} sx={{ "& .MuiListItemText-primary": { fontSize: 12 } }} />
                </ListItemButton>
              ))}
            </List>
          </Box>
        </Box>
      </Popover>

      {/* 分析动作右键菜单：文件段 → 画像 + AI 诊断；符号段 → AI 诊断。对标 Zed 面包屑「上下文感知动作」哲学。 */}
      <Popover
        open={!!ctxMenu}
        anchorEl={ctxMenu?.anchor ?? null}
        onClose={closeCtxMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ width: 260, maxHeight: 360, display: "flex", flexDirection: "column" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
            <AutoFixHighIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            <Typography variant="caption" noWrap sx={{ flex: 1, fontFamily: "monospace" }}>
              {ctxMenu?.kind === "symbol" ? (activeSym?.name ?? fileName) : fileName}
            </Typography>
          </Box>
          <Box sx={{ overflow: "auto", flex: 1, py: 0.5 }}>
            <List dense disablePadding>
              {ctxMenu?.kind === "file" && onAnalyzeFile && (
                <>
                  <ListItemButton onClick={() => { onAnalyzeFile(ctxMenu.fileId, "dependency"); closeCtxMenu(); }}>
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <LanguageIcon lang={language} size={14} />
                    </ListItemIcon>
                    <ListItemText primary={t("page.cmd.portraitDependency")} sx={{ "& .MuiListItemText-primary": { fontSize: 12 } }} />
                  </ListItemButton>
                  <ListItemButton onClick={() => { onAnalyzeFile(ctxMenu.fileId, "complexity"); closeCtxMenu(); }}>
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <LanguageIcon lang={language} size={14} />
                    </ListItemIcon>
                    <ListItemText primary={t("page.cmd.portraitComplexity")} sx={{ "& .MuiListItemText-primary": { fontSize: 12 } }} />
                  </ListItemButton>
                  <ListItemButton onClick={() => { onAnalyzeFile(ctxMenu.fileId, "callGraph"); closeCtxMenu(); }}>
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <LanguageIcon lang={language} size={14} />
                    </ListItemIcon>
                    <ListItemText primary={t("page.cmd.portraitCallGraph")} sx={{ "& .MuiListItemText-primary": { fontSize: 12 } }} />
                  </ListItemButton>
                  {onDiagnoseFile && <Divider />}
                </>
              )}
              {ctxMenu?.kind === "file" && onDiagnoseFile && (
                <ListItemButton onClick={() => { onDiagnoseFile(ctxMenu.fileId); closeCtxMenu(); }}>
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <AutoFixHighIcon sx={{ fontSize: 16 }} />
                  </ListItemIcon>
                  <ListItemText primary={t("workbench.breadcrumb.diagnoseFile")} sx={{ "& .MuiListItemText-primary": { fontSize: 12 } }} />
                </ListItemButton>
              )}
              {ctxMenu?.kind === "symbol" && onDiagnoseSymbol && activeSym && (
                <ListItemButton onClick={() => { onDiagnoseSymbol(ctxMenu.fileId, activeSym.name, activeSym.line); closeCtxMenu(); }}>
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <AutoFixHighIcon sx={{ fontSize: 16 }} />
                  </ListItemIcon>
                  <ListItemText primary={t("workbench.breadcrumb.diagnoseSymbol")} sx={{ "& .MuiListItemText-primary": { fontSize: 12 } }} />
                </ListItemButton>
              )}
              <Divider />
              <ListItemButton onClick={() => { onCopyPath(); closeCtxMenu(); }}>
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </ListItemIcon>
                <ListItemText primary={t("workbench.breadcrumb.copyPath")} sx={{ "& .MuiListItemText-primary": { fontSize: 12 } }} />
              </ListItemButton>
            </List>
          </Box>
        </Box>
      </Popover>
    </Box>
  );
}
