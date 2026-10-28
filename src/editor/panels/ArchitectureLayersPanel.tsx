import { memo, useState, useCallback, useMemo, useEffect, type DragEvent } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Chip from "@mui/material/Chip";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import LayersIcon from "@mui/icons-material/Layers";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { useProjectStore } from "../../store/projectStore";
import { useSceneStore } from "../../store/sceneStore";
import { useWritingStore } from "../../store/writingStore";
import { t, resolveFragments, getLang } from "../../i18n";
import { buildTree, defaultLevels, suggestedChildKind, type TreeNode } from "../../utils/writingTree";
import { openWritingDesk } from "../../utils/writingDeskWindow";

const LAYER_COLORS = [
  "#94A3B8",
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
];

/**
 * 架构分层管理对话框
 * 显示当前 analysis 的所有分层 + 文件归属
 */
export const ArchitectureLayersPanel = memo(function ArchitectureLayersPanel({
  open,
  onClose,
  analysisId,
}: {
  open: boolean;
  onClose: () => void;
  analysisId: string | null;
}) {
  const layers = useProjectStore((s) => s.layers);
  const files = useProjectStore((s) => s.files);
  const createLayer = useProjectStore((s) => s.createLayer);
  const deleteLayer = useProjectStore((s) => s.deleteLayer);
  const saveLayer = useProjectStore((s) => s.saveLayer);
  // 书场景（novel-zh）→ 本对话框改写为「卷部结构」管理，不再显示代码架构分层
  const isBookScene = useSceneStore(
    (s) => s.scenes.find((sc) => sc.id === analysisId)?.primaryLanguage === "novel-zh"
  );

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(LAYER_COLORS[0]);
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!analysisId || !newName.trim()) return;
    const newLayer = await createLayer(analysisId, newName.trim(), newColor);
    if (newLayer) {
      // 设置 sortOrder 为新层的位置
      await saveLayer({ ...newLayer, sortOrder: layers.length, updatedAt: Math.floor(Date.now() / 1000) });
    }
    setNewName("");
    setNewColor(LAYER_COLORS[(layers.length + 1) % LAYER_COLORS.length]);
  };

  // 排序：上移
  const handleMoveUp = useCallback(
    async (index: number) => {
      if (index <= 0) return;
      const layer = layers[index];
      const prevLayer = layers[index - 1];
      if (!layer || !prevLayer) return;
      await saveLayer({ ...layer, sortOrder: prevLayer.sortOrder, updatedAt: Math.floor(Date.now() / 1000) });
      await saveLayer({ ...prevLayer, sortOrder: layer.sortOrder, updatedAt: Math.floor(Date.now() / 1000) });
    },
    [layers, saveLayer]
  );

  // 排序：下移
  const handleMoveDown = useCallback(
    async (index: number) => {
      if (index >= layers.length - 1) return;
      const layer = layers[index];
      const nextLayer = layers[index + 1];
      if (!layer || !nextLayer) return;
      await saveLayer({ ...layer, sortOrder: nextLayer.sortOrder, updatedAt: Math.floor(Date.now() / 1000) });
      await saveLayer({ ...nextLayer, sortOrder: layer.sortOrder, updatedAt: Math.floor(Date.now() / 1000) });
    },
    [layers, saveLayer]
  );

  // 防抖保存名称：只在失焦时保存
  const handleBlurName = useCallback(
    (layer: any) => {
      const newName = editingNames[layer.id];
      if (newName !== undefined && newName.trim() && newName.trim() !== layer.name) {
        saveLayer({ ...layer, name: newName.trim(), updatedAt: Math.floor(Date.now() / 1000) });
      }
      setEditingNames((prev) => {
        const next = { ...prev };
        delete next[layer.id];
        return next;
      });
    },
    [saveLayer, editingNames]
  );

  // 选择颜色
  const handleColorChange = useCallback(
    (layer: any, color: string) => {
      saveLayer({ ...layer, color, updatedAt: Math.floor(Date.now() / 1000) });
    },
    [saveLayer]
  );

  // 统计每个层的文件数
  const counts: Record<string, number> = {};
  files.forEach((f) => {
    if (!f.isDirectory && f.layerId) {
      counts[f.layerId] = (counts[f.layerId] || 0) + 1;
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {isBookScene ? <MenuBookIcon sx={{ color: "primary.main" }} /> : <LayersIcon sx={{ color: "primary.main" }} />}
        {isBookScene ? t("panel.layers.bookTitle") : t("panel.layers.title")}
      </DialogTitle>
      <DialogContent dividers>
        {isBookScene ? (
          <BookVolumeView analysisId={analysisId} />
        ) : (
        <>
        {/* 新建 */}
        <Box sx={{ display: "flex", gap: 1, mb: 3, alignItems: "center" }}>
          <TextField
            size="small"
            label={t("panel.layers.newName")}
            placeholder={t("panel.layers.placeholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            sx={{ flex: 1 }}
          />
          <Box sx={{ display: "flex", gap: 0.5 }}>
            {LAYER_COLORS.map((c) => (
              <Box
                key={c}
                onClick={() => setNewColor(c)}
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  backgroundColor: c,
                  cursor: "pointer",
                  border: newColor === c ? "2px solid" : "1px solid",
                  borderColor: newColor === c ? "primary.main" : "divider",
                  transition: "all 0.15s",
                }}
              />
            ))}
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleCreate}
            disabled={!newName.trim()}
          >
            {t("panel.layers.create")}
          </Button>
        </Box>

        {/* 已有分层 */}
        {layers.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
            <LayersIcon sx={{ fontSize: 40, opacity: 0.3 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>
              {t("panel.layers.noTitle")}
            </Typography>
            <Typography variant="caption">
              {t("panel.layers.noHint")}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {layers
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((layer, idx) => (
                <Box
                  key={layer.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    p: 1.5,
                    borderRadius: 1,
                    border: 1,
                    borderColor: "divider",
                    "&:hover": { borderColor: "primary.main" },
                  }}
                >
                  {/* 排序序号 */}
                  <Typography variant="caption" color="text.disabled" sx={{ width: 20, textAlign: "center", flexShrink: 0, fontSize: 10 }}>
                    {idx + 1}
                  </Typography>

                  {/* 颜色选择器 */}
                  <Box sx={{ position: "relative", flexShrink: 0 }}>
                    <Box
                      onClick={() => setColorPickerOpen(colorPickerOpen === layer.id ? null : layer.id)}
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: 1,
                        backgroundColor: layer.color,
                        cursor: "pointer",
                        border: "2px solid transparent",
                        "&:hover": { borderColor: "primary.main" },
                      }}
                    />
                    {colorPickerOpen === layer.id && (
                      <Box
                        sx={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          zIndex: 10,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 0.5,
                          p: 1,
                          bgcolor: "background.paper",
                          borderRadius: 1,
                          boxShadow: 4,
                          border: 1,
                          borderColor: "divider",
                          minWidth: 120,
                          mt: 0.5,
                        }}
                      >
                        {LAYER_COLORS.map((c) => (
                          <Box
                            key={c}
                            onClick={() => {
                              handleColorChange(layer, c);
                              setColorPickerOpen(null);
                            }}
                            sx={{
                              width: 22,
                              height: 22,
                              borderRadius: "50%",
                              backgroundColor: c,
                              cursor: "pointer",
                              border: layer.color === c ? "2px solid" : "1px solid",
                              borderColor: layer.color === c ? "primary.main" : "divider",
                              transition: "all 0.1s",
                              "&:hover": { transform: "scale(1.2)" },
                            }}
                          />
                        ))}
                      </Box>
                    )}

                  </Box>
                  {/* 名称（内联编辑 - 失焦保存） */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      size="small"
                      value={editingNames[layer.id] !== undefined ? editingNames[layer.id] : resolveFragments(layer.name)}
                      onChange={(e) =>
                        setEditingNames((prev) => ({ ...prev, [layer.id]: e.target.value }))
                      }
                      onBlur={() => handleBlurName(layer)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleBlurName(layer);
                      }}
                      fullWidth
                      variant="standard"
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {t("panel.layers.files", { n: counts[layer.id] || 0 })}
                  </Typography>

                  {/* 排序按钮 */}
                  <IconButton size="small" onClick={() => handleMoveUp(idx)} disabled={idx === 0} aria-label={t("layerPanel.moveUp")}>
                    <ArrowUpwardIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleMoveDown(idx)} disabled={idx >= layers.length - 1} aria-label={t("layerPanel.moveDown")}>
                    <ArrowDownwardIcon sx={{ fontSize: 14 }} />
                  </IconButton>

                  {/* 删除 */}
                  <IconButton size="small" onClick={() => deleteLayer(layer.id)} color="error" aria-label={t("layerPanel.delete")}>
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              ))}
          </Box>
        )}

        {/* 提示 */}
        <Box sx={{ mt: 3, p: 1.5, borderRadius: 1, backgroundColor: "action.hover" }}>
          <Typography variant="caption" color="text.secondary">
            {t("panel.layers.tip")}
          </Typography>
        </Box>
        </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("panel.layers.close")}</Button>
      </DialogActions>
    </Dialog>
  );
});

// ─── 卷部结构（书场景）：读**真树**（writing_chapters.parent_id），不再读旧 volume 串 ───
// 2026-09-14 方案 A：旧版按扫描层 metadata.volume 字符串分组，与编辑区大纲搭的父/子树
// 零同步（新书全堆「未分卷」卷章混列；旧书同一卷两份表示）。现在直接渲染 buildTree 的层级：
// 容器节点（部/卷/篇…）为组头，叶章为行；卷节点不再被当成章行混进列表。

// 2026-09-21 优化：从「只读树查看器」升级为真正的结构编辑器 —— 复用大纲树 NodeRow 同一套
// store CRUD（createChildNode / reparentNode / renameNodeKind / renameChapter / deleteChapter /
// setChapterStatus / toggleNodeCollapse），在弹窗里即可增/删/改名/拖拽挂接/折叠/改状态；
// 叶章双击 = 开写作台（openWritingDesk），不再误拉代码工作台（navigateToSource→spawnCodeWorkbench）。

const VOLUME_DND_MIME = "application/x-volume-node";
const VOLUME_STATUS_CYCLE = ["", "draft", "finished"];

/** 字数缩写（≥1 万 → X.X 万），与书架一致 */
function fmtVolumeWords(n: number): string {
  if (n >= 10000) {
    const k = (n / 1000).toFixed(1).replace(/\.0$/, "");
    return getLang() === "en-US" ? `${k}k` : `${(n / 10000).toFixed(1)}万`;
  }
  return `${n}`;
}

/** 子树统计：章节数 / 字数 / 完稿数（组头进度账） */
function subtreeStats(tree: TreeNode): { chapters: number; words: number; finished: number } {
  if (tree.children.length === 0) {
    return { chapters: 1, words: tree.node.wordCount, finished: tree.node.status === "finished" ? 1 : 0 };
  }
  return tree.children.reduce(
    (acc, k) => {
      const s = subtreeStats(k);
      acc.chapters += s.chapters;
      acc.words += s.words;
      acc.finished += s.finished;
      return acc;
    },
    { chapters: 0, words: 0, finished: 0 }
  );
}

/** 状态点：色=层级进度（灰未设 / 琥珀草稿 / 绿完稿），点击循环状态 */
function VolumeStatusDot({ status, onClick }: { status: string; onClick: () => void }) {
  const color = status === "finished" ? "#10B981" : status === "draft" ? "#F59E0B" : "#94A3B8";
  return (
    <Box
      onClick={onClick}
      title={t(`editor.writing.status.${status === "finished" ? "finished" : "draft"}`)}
      sx={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        flexShrink: 0,
        cursor: "pointer",
        border: `2px solid ${color}`,
        background: status === "finished" ? color : "transparent",
      }}
    />
  );
}

/** 递归卷部节点行：容器（部/卷/篇）= 组头可改名/加子级/折叠；叶章 = 行可改名/改状态/双击开写作台 */
function BookVolumeRow({ tree, depth, bookId, bookTitle, genre }: {
  tree: TreeNode;
  depth: number;
  bookId: string;
  bookTitle: string;
  genre: string;
}) {
  const createChildNode = useWritingStore((s) => s.createChildNode);
  const reparentNode = useWritingStore((s) => s.reparentNode);
  const renameNodeKind = useWritingStore((s) => s.renameNodeKind);
  const renameChapter = useWritingStore((s) => s.renameChapter);
  const deleteChapter = useWritingStore((s) => s.deleteChapter);
  const setChapterStatus = useWritingStore((s) => s.setChapterStatus);
  const collapsed = useWritingStore((s) => s.collapsedNodeIds.includes(tree.node.id));
  const toggleNodeCollapse = useWritingStore((s) => s.toggleNodeCollapse);

  const [editingKind, setEditingKind] = useState(false);
  const [kindDraft, setKindDraft] = useState(tree.node.kind);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(tree.node.title);
  const [overNode, setOverNode] = useState(false);
  const [hoverHandle, setHoverHandle] = useState(false);

  const isLeaf = tree.children.length === 0;
  const levels = useMemo(() => defaultLevels(genre), [genre]);
  const childKind = suggestedChildKind(tree.node.kind, depth, levels);
  const stats = useMemo(() => subtreeStats(tree), [tree]);

  const commitKind = () => {
    setEditingKind(false);
    const v = kindDraft.trim();
    if (v && v !== tree.node.kind) void renameNodeKind(tree.node.id, v);
    else setKindDraft(tree.node.kind);
  };
  const commitTitle = () => {
    setEditingTitle(false);
    const v = titleDraft.trim();
    if (v && v !== tree.node.title) void renameChapter(tree.node.id, v);
    else setTitleDraft(tree.node.title);
  };
  const cycleStatus = () => {
    const cur = tree.node.status ?? "";
    const next = VOLUME_STATUS_CYCLE[(VOLUME_STATUS_CYCLE.indexOf(cur) + 1) % VOLUME_STATUS_CYCLE.length];
    void setChapterStatus(tree.node.id, next);
  };
  const addChild = () => void createChildNode(tree.node.id, childKind, `${childKind} ${tree.children.length + 1}`);
  const open = () => void openWritingDesk({ bookId, chapterId: tree.node.id });

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(VOLUME_DND_MIME)) {
      e.preventDefault();
      setOverNode(true);
    }
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverNode(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setOverNode(false);
    const draggedId = e.dataTransfer.getData(VOLUME_DND_MIME);
    if (draggedId && draggedId !== tree.node.id) void reparentNode(draggedId, tree.node.id);
  };

  const indent = 6 + depth * 18;

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          pl: indent,
          pr: 0.5,
          py: 0.5,
          borderRadius: 1,
          border: `1px solid ${overNode ? "primary.main" : "transparent"}`,
          background: overNode ? "action.hover" : "transparent",
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* 拖动手柄：挂到别的节点下（reparent），串成任意深树 */}
        <Box
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(VOLUME_DND_MIME, tree.node.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onMouseEnter={() => setHoverHandle(true)}
          onMouseLeave={() => setHoverHandle(false)}
          title={t("writingDesign.dropToNest")}
          sx={{
            cursor: "grab",
            color: hoverHandle ? "text.primary" : "text.disabled",
            fontSize: 13,
            lineHeight: 1,
            flexShrink: 0,
            userSelect: "none",
            px: 0.25,
          }}
        >
          ⠿
        </Box>
        {/* 状态点：点击循环（草稿/完稿） */}
        <VolumeStatusDot status={tree.node.status ?? ""} onClick={cycleStatus} />
        {/* 层级名徽章：点击行内改名（部/卷/章/节…） */}
        {editingKind ? (
          <TextField
            autoFocus
            size="small"
            value={kindDraft}
            onChange={(e) => setKindDraft(e.target.value)}
            onBlur={commitKind}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitKind();
              if (e.key === "Escape") {
                setKindDraft(tree.node.kind);
                setEditingKind(false);
              }
            }}
            sx={{ width: 56, flexShrink: 0 }}
          />
        ) : (
          <Typography
            onClick={() => {
              setKindDraft(tree.node.kind);
              setEditingKind(true);
            }}
            title={t("writingDesign.kindPh")}
            sx={{
              fontSize: 10,
              lineHeight: 1,
              px: 0.75,
              py: 0.25,
              borderRadius: 999,
              border: "1px solid",
              borderColor: "divider",
              color: "primary.main",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {tree.node.kind || "—"}
          </Typography>
        )}
        {/* 标题：行内改名；叶章双击开写作台 */}
        {editingTitle ? (
          <TextField
            autoFocus
            size="small"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setTitleDraft(tree.node.title);
                setEditingTitle(false);
              }
            }}
            sx={{ flex: 1, minWidth: 0 }}
          />
        ) : (
          <Typography
            onDoubleClick={isLeaf ? open : undefined}
            title={isLeaf ? t("writingDesign.openHint") : undefined}
            sx={{
              fontSize: 13,
              fontWeight: isLeaf ? 400 : 600,
              flex: 1,
              minWidth: 0,
              cursor: isLeaf ? "pointer" : "default",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tree.node.title}
          </Typography>
        )}
        {/* 叶章字数 */}
        {isLeaf && (
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {t("writing.words", { n: tree.node.wordCount })}
          </Typography>
        )}
        {/* 组头进度账：章数 · 字数 · 完稿 */}
        {!isLeaf && (
          <Chip
            size="small"
            variant="outlined"
            label={t("panel.layers.bookVolumeStat", {
              chapters: stats.chapters,
              words: fmtVolumeWords(stats.words),
              finished: stats.finished,
            })}
            sx={{ height: 18, fontSize: "0.65rem", flexShrink: 0 }}
          />
        )}
        {/* 加子级：默认层级顺延（卷→章→节…） */}
        <IconButton size="small" onClick={addChild} title={t("writingDesign.addChild")} sx={{ flexShrink: 0 }} aria-label={t("writingDesign.addChild")}>
          <AddIcon sx={{ fontSize: 16 }} />
        </IconButton>
        {/* 折叠/展开：有子级才出现 */}
        {tree.children.length > 0 && (
          <IconButton
            size="small"
            onClick={() => toggleNodeCollapse(tree.node.id)}
            title={collapsed ? t("writingDesign.collapseNode") : t("writingDesign.expandNode")}
            sx={{ flexShrink: 0 }}
           aria-label={collapsed ? t("writingDesign.collapseNode") : t("writingDesign.expandNode")}>
            {collapsed ? <ArrowDownwardIcon sx={{ fontSize: 14 }} /> : <ArrowUpwardIcon sx={{ fontSize: 14 }} />}
          </IconButton>
        )}
        {/* 删除：子级上提，不级联 */}
        <IconButton
          size="small"
          onClick={() => void deleteChapter(tree.node.id)}
          title={t("writingDesign.deleteNode")}
          color="error"
          sx={{ flexShrink: 0 }}
         aria-label={t("writingDesign.deleteNode")}>
          <DeleteIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      {!collapsed &&
        tree.children.map((k) => (
          <BookVolumeRow
            key={k.node.id}
            tree={k}
            depth={depth + 1}
            bookId={bookId}
            bookTitle={bookTitle}
            genre={genre}
          />
        ))}
    </Box>
  );
}

export function BookVolumeView({ analysisId }: { analysisId: string | null }) {
  const chapters = useWritingStore((s) => s.chapters);
  const loadChapters = useWritingStore((s) => s.loadChapters);
  const createChapter = useWritingStore((s) => s.createChapter);
  const books = useWritingStore((s) => s.books);
  // 书场景 id = "wscan_{bookId}"（studioBook.bookSceneId），剥前缀即书 id
  const bookId = analysisId?.startsWith("wscan_") ? analysisId.slice("wscan_".length) : null;
  const book = useMemo(() => (bookId ? books.find((b) => b.id === bookId) : undefined), [books, bookId]);
  const bookTitle = book?.title ?? "";
  const genre = book?.genre ?? "";
  const bookChapters = useMemo(
    () => (bookId ? chapters.filter((c) => c.bookId === bookId) : []),
    [chapters, bookId]
  );
  // 只服务当前书：activeBookId 不匹配时绝不 loadChapters（会打翻当前书的章节态）。
  // 正常路径里打开书场景时 openBookInStudio 已 setActiveBook + loadChapters。
  useEffect(() => {
    if (!bookId) return;
    const ws = useWritingStore.getState();
    if (ws.activeBookId !== bookId) return;
    if (ws.chapters.length === 0) void loadChapters(bookId).catch(() => {});
  }, [bookId, loadChapters]);
  const forest = useMemo(() => buildTree(bookChapters), [bookChapters]);

  if (bookChapters.length === 0 || forest.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
        <MenuBookIcon sx={{ fontSize: 40, opacity: 0.3 }} />
        <Typography variant="body2" sx={{ mt: 1 }}>
          {t("panel.layers.bookEmpty")}
        </Typography>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          sx={{ mt: 2 }}
          onClick={() => void createChapter(t("writing.newChapterName", { n: 1 }))}
        >
          {t("writingDesign.addNode")}
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      {forest.map((r) => (
        <BookVolumeRow
          key={r.node.id}
          tree={r}
          depth={0}
          bookId={bookId ?? ""}
          bookTitle={bookTitle}
          genre={genre}
        />
      ))}
      <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, backgroundColor: "action.hover" }}>
        <Typography variant="caption" color="text.secondary">
          {t("panel.layers.bookTip")}
        </Typography>
      </Box>
    </Box>
  );
}