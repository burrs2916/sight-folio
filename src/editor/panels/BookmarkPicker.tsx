/**
 * 查看书签清单（对标 Zed crates/editor/src/bookmarks.rs::view_bookmarks —— 把全部书签打开为 multibuffer 清单）。
 *
 * 参考项目深度理解要点（zed-main/crates/editor/src/bookmarks.rs）：
 *  - ViewBookmarks 把所有书签按 buffer 聚合成一个可跳转清单（我们平铺为可筛选列表，语义等价）；
 *  - 每条书签带可选 label（对标 Zed ToggleBookmarkWithLabel），清单里展示便于区分；
 *  - 选中即跳转到对应 buffer 的锚点（我们经 onPick → 外壳 openFileInTab 复用既有「已开则切+落点」口径）。
 *
 * 差异化增强（renderable AND useful）：Zed 清单是只读 multibuffer，我们额外支持——
 *  ① 模糊筛选（文件名 / 路径 / 备注 / 行号）；② 行内删除书签（Delete 键或行尾按钮）；
 *  ③ 点击即跳、键盘可达（↑/↓/Enter），让「列出书签」真正可行动而非死列表。
 */
import { useEffect, useMemo, useRef, useState } from "react";
// 大包导入改子路径（避免与 @mui/material/* 预构建双实例 split-brain，2026-09-14）
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { t } from "../../i18n";
import { useCodeWorkbenchStore, computeAllBookmarks } from "../../store/codeWorkbenchStore";

interface BookmarkRow {
  fileId: string;
  name: string;
  relPath: string;
  line: number;
  label?: string;
}

export function BookmarkPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** 跳转到某书签（fileId + 行），由外壳实现：openFileInTab(fileId, line) 复用「已开则切+落点」口径 */
  onPick: (fileId: string, line: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 清单数据来自 store（带文件元信息），随增删实时刷新。
  // 关键：必须按稳定引用订阅 panes/bookmarks，再于 useMemo 中派生——
  // 绝不能写 `useStore((s) => s.getAllBookmarks())`：每次 getSnapshot 都返回全新数组，
  // 触发 zustand v5 useSyncExternalStore 无限重渲染（"getSnapshot should be cached"
  // → "Maximum update depth exceeded"，见 console 报错链）。
  const panes = useCodeWorkbenchStore((s) => s.panes);
  const bookmarks = useCodeWorkbenchStore((s) => s.bookmarks);
  const clearBookmark = useCodeWorkbenchStore((s) => s.clearBookmark);

  const all = useMemo(
    () => computeAllBookmarks(panes, bookmarks),
    [panes, bookmarks]
  );

  const rows: BookmarkRow[] = all;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.relPath, r.label ?? "", String(r.line)]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, query]);

  // 打开即清空筛选 + 聚焦输入框 + 重置选中
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSel(0);
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  // 筛选结果变化后把选中钳制到可见范围内（避免悬空）
  useEffect(() => {
    if (sel > filtered.length - 1) setSel(Math.max(0, filtered.length - 1));
  }, [filtered.length, sel]);

  const jump = (r: BookmarkRow | undefined) => {
    if (!r) return;
    onPick(r.fileId, r.line);
    onClose();
  };

  const remove = (r: BookmarkRow, e: React.MouseEvent) => {
    e.stopPropagation();
    clearBookmark(r.fileId, r.line);
    if (sel >= filtered.length - 1) setSel(Math.max(0, filtered.length - 2));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(filtered.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      jump(filtered[sel]);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      // 在筛选输入框内 Backspace 正常删字；仅当选中行且输入框为空时删书签
      if (query === "" && filtered[sel]) {
        e.preventDefault();
        remove(filtered[sel], e as unknown as React.MouseEvent);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      slotProps={{
        paper: { sx: { width: 520, maxWidth: "94vw", mt: 8, mb: "auto" } },
      }}
    >
      <Box sx={{ p: 1 }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          placeholder={t("workbench.bookmarkPicker.placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKeyDown}
        />
      </Box>
      <Box ref={listRef} sx={{ maxHeight: 360, overflowY: "auto", px: 0.5, pb: 0.5 }}>
        {filtered.length === 0 ? (
          <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              {t("workbench.bookmarkPicker.empty")}
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {filtered.map((r, i) => (
              <ListItemButton
                key={`${r.fileId}:${r.line}`}
                selected={i === sel}
                onMouseEnter={() => setSel(i)}
                onClick={() => jump(r)}
                sx={{ borderRadius: 1, gap: 1 }}
              >
                <BookmarkIcon sx={{ fontSize: 15, color: "#EF9F27", flexShrink: 0 }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ fontWeight: i === sel ? 700 : 400 }}
                    title={r.relPath}
                  >
                    {r.name}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {r.label ? ` · ${r.label}` : ""}
                    </Typography>
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }} title={r.relPath}>
                    {r.relPath || r.fileId}
                  </Typography>
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
                >
                  {t("workbench.bookmarkPicker.line", { line: r.line })}
                </Typography>
                <IconButton
                  size="small"
                  title={t("workbench.bookmarkPicker.remove")}
                  onClick={(e) => remove(r, e)}
                  sx={{ flexShrink: 0 }}
                 aria-label={t("workbench.bookmarkPicker.remove")}>
                  <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
      <Box
        sx={{
          px: 2,
          pb: 1,
          pt: 0.5,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="caption" color="text.disabled">
          {t("workbench.bookmarkPicker.count", { count: filtered.length })}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          ↑/↓ · Enter 跳转 · Delete 删除
        </Typography>
      </Box>
    </Dialog>
  );
}
