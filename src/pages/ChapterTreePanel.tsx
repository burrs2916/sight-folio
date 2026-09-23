// 写作台左栏「章节」tab · 树形渲染（2026-09-22）
//
// 背景：左栏此前是**扁平列表**（按 sortOrder 一列铺开）+ 基于遗留 volume 字符串的分组头，
// 作者看不到「卷 › 章 › 节」的从属关系。工作室侧三处（大纲视图 NodeRow / 卷部管理 /
// 左栏作品目录树 WritingTreeTab）都已按 writing_chapters.parentId 展示树；这里把写作台
// 的章节 tab 对齐到同一口径，行结构逐字镜像 works/WritingTreeTab 的 TreeRow。
//
// ─── 数据与算法全部复用（零新表 / 零新存储 / 零 Rust / 零 store 改造）───
//   树形      → utils/writingTree.buildTree（与卷部管理 / 作品目录树同一份）
//   缩进几何  → INDENT_BASE=8 / INDENT_STEP=20 + 竖向引导线 + elbow（与大纲树同款）
//   状态点    → editor/components/ChapterStatusDot（共用同一枚；此处**只读**，与作品目录树一致）
//   折叠态    → writingStore.collapsedNodeIds（与大纲视图共用一份，不落库）
//   子树章数  → 树口径：容器不算内容、只数叶章。等价于 writingOutline.subtreeAccount(...).rows.length，
//               但改用**一次后序遍历 O(n)** 取代「逐容器各扫一遍」，因为本面板在每 800ms 自动保存
//               时都会因 chapters 换引用而重算——不能是 O(n²)。
//   加子级    → store.createChildNode + writingTree.suggestedChildKind（卷→章→节顺延）
//   移到该行前 → store.reorderChapter（**行身拖动**，语义与改动前的扁平列表逐字一致）
//   挂为其子级 → store.reparentNode（**⠿ 手柄拖动**，含防环；与大纲树同款双通道拖拽）
//
// ─── 双通道拖拽怎么分流 ───
// 手柄是行内更深一层的 draggable，它的 dragstart 先于行触发并写入 NEST_DND_MIME；
// 行身的 dragstart/handler 据此 MIME 分流（行身通道不写这个 MIME）。与大纲树用
// BEAT_DND_MIME / NODE_DND_MIME 区分「挂节拍」与「挂节点」是同一套思路。
//
// ─── 遗留 volume 字符串 ───
// 只有当这本书**没有任何 parentId 层级**（旧模型书）时，才按 volume 变化渲染分组头——与改动
// 前的扁平列表逐字同口径，旧书外观零变化；已有层级的书里 volume 不再渲染（新模型由
// parentId + kind 表达，WritingChapter.volume 的类型注释已标注它是旧模型遗留字段）。
// 「移卷」对话框未动，能力未减。
//
// ─── memo ───
// 与 ChapterListPanel 同因：WritingPage 每 800ms 自动保存会翻转顶层 saveState 触发整树重渲染，
// 本面板 props 全为稳定引用（store 选择器 / useState setter / useMemo / ref）时 memo 浅比较
// 全部命中，即可跳过整棵树的重新渲染。

import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import type { Dispatch, MutableRefObject, ReactNode, SetStateAction } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import type { WritingChapter, WritingOutline } from '../services/tauri';
import { buildTree, defaultLevels, suggestedChildKind, treeRowIndent, type TreeNode } from '../utils/writingTree';
import { ChapterStatusDot } from '../editor/components/ChapterStatusDot';
import { TreeIndentGuides, TreeChevron, TreeKindBadge, TreeMetaText } from '../editor/components/TreeRowShared';
import { t } from '../i18n';
import { logger } from '../utils/logger';
import { useToastStore } from '../store/toastStore';
import type { ChapterListDialog } from './ChapterListPanel';

/** 「挂为其子级」通道的 MIME：只有 ⠿ 手柄发出的拖动带它，据此与行身拖动（移到该行之前）分流。 */
const NEST_DND_MIME = 'application/x-chapter-nest';

/** 上一根节点的哨兵（保证首个根节点也出分组头），与改动前扁平列表的 '\u0000no-prev' 同义。 */
const NO_PREV_VOLUME = '\u0000no-prev';

export interface ChapterTreePanelProps {
  /** 本书全部章节（store 原始数组；树由它构建，不做预过滤） */
  chapters: WritingChapter[];
  /** 搜索命中集（WritingPage 的既有 memo：标题或正文命中）——本面板据此保留祖先链 */
  visibleChapters: WritingChapter[];
  /** 扁平下标 Map（O(1) 取「第几个」，也是拖拽落点 / reorderChapter 的入参） */
  chapterIndexById: Map<string, number>;
  activeChapterId: string | null;
  chapterQuery: string;
  chapterSearchQuery: string;
  selectionMode: boolean;
  selectedChapterIds: string[];
  setSelectedChapterIds: Dispatch<SetStateAction<string[]>>;
  setActiveSetting: (id: string | null) => void;
  setActiveChapter: (id: string) => void;
  dragChapterIdRef: MutableRefObject<string | null>;
  flushSave: () => Promise<void>;
  setDropIndex: (i: number | null) => void;
  reorderChapter: (id: string, toIndex: number) => Promise<void>;
  reparentNode: (nodeId: string, newParentId: string | null) => Promise<void>;
  dropIndex: number | null;
  openDialog: (d: ChapterListDialog, initialText?: string) => void;
  outlines: WritingOutline[];
  /** 体裁：决定「加子级」的默认层级名（novel→卷/章，essay|poetry|script→篇/节） */
  genre: string;
  collapsedNodeIds: string[];
  toggleNodeCollapse: (id: string) => void;
  createChildNode: (parentId: string, kind: string, title: string) => Promise<WritingChapter | null>;
}

/** 树的一行：引导线 + 折叠尖角 + 状态点 + 层级徽章 + 标题 + 尾注 + 行尾动作（悬停显出） */
function TreeRow({
  depth,
  chapter,
  idx,
  meta,
  active,
  boundBeatTitle,
  expandable,
  expanded,
  onToggleExpand,
  selectionMode,
  selected,
  onToggleSelect,
  onClick,
  onOpenDialog,
  onAddChild,
  onMoveUp,
  onMoveDown,
  onNestDrop,
  dragging,
  dropIndex,
  dragChapterIdRef,
  flushSave,
  setDropIndex,
  reorderChapter,
}: {
  depth: number;
  chapter: WritingChapter;
  idx: number;
  meta: string;
  active: boolean;
  boundBeatTitle: string | null;
  expandable: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onOpenDialog: (d: ChapterListDialog, initialText?: string) => void;
  onAddChild: () => void;
  /** 同级上移（存在前兄弟时才有值）：移到前兄弟之前 */
  onMoveUp?: () => void;
  /** 同级下移（存在后兄弟时才有值）：移到后兄弟之后 */
  onMoveDown?: () => void;
  onNestDrop: (draggedId: string) => void;
  dragging: boolean;
  dropIndex: number | null;
  dragChapterIdRef: MutableRefObject<string | null>;
  flushSave: () => Promise<void>;
  setDropIndex: (i: number | null) => void;
  reorderChapter: (id: string, toIndex: number) => Promise<void>;
}) {
  // 挂载落点高亮：只有「手柄拖动」悬到本行才点亮，给「松手即挂到它下面」的明确反馈
  const [overNode, setOverNode] = useState(false);

  return (
    <Box sx={{ position: 'relative' }}>
      <TreeIndentGuides depth={depth} />
      <Box
        data-testid={`chapter-row-${chapter.id}`}
        onClick={selectionMode ? onToggleSelect : onClick}
        draggable={dragging}
        onDragStart={(e) => {
          // 手柄是更深的 draggable，它的 dragstart 先触发并已写入 NEST_DND_MIME；据此刻意
          // 不认领行身通道（不写 dropIndex 通道的 id），两种拖动互不干扰。
          if (!e.dataTransfer.types.includes(NEST_DND_MIME)) dragChapterIdRef.current = chapter.id;
          e.dataTransfer.effectAllowed = 'move';
          // 两种拖动都会整行写回落库，先 flush 未保存正文避免旧内容覆盖新输入
          void flushSave();
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(NEST_DND_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOverNode(true);
            return;
          }
          if (!dragChapterIdRef.current || !dragging) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropIndex(idx);
        }}
        onDragLeave={(e) => {
          // 移出整行（而非滑入内部子元素）才熄灭高亮，避免子元素间移动时闪烁
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverNode(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOverNode(false);
          const nestId = e.dataTransfer.getData(NEST_DND_MIME);
          if (nestId) {
            dragChapterIdRef.current = null;
            setDropIndex(null);
            if (nestId !== chapter.id) onNestDrop(nestId);
            return;
          }
          const draggedId = dragChapterIdRef.current;
          dragChapterIdRef.current = null;
          setDropIndex(null);
          if (draggedId && draggedId !== chapter.id) {
            void reorderChapter(draggedId, idx).catch((err) => {
              logger.warn('WritingPage', 'reorder chapter failed', { error: err });
              useToastStore.getState().error(String(err));
            });
          }
        }}
        onDragEnd={() => {
          dragChapterIdRef.current = null;
          setDropIndex(null);
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          pl: treeRowIndent(depth),
          pr: 0.5,
          py: '3px',
          minHeight: 22,
          borderRadius: 0.75,
          cursor: 'pointer',
          bgcolor: active ? 'action.selected' : overNode ? 'action.hover' : 'transparent',
          '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' },
          '& .row-actions': { opacity: 0 },
          '&:hover .row-actions': { opacity: 1 },
          // 放置指示线：行身拖动落在该行上方 = 移到它之前（沿用改动前的提示样式）
          boxShadow: (th) => (dropIndex === idx ? `inset 0 2px 0 0 ${th.palette.primary.main}` : undefined),
        }}
      >
        {selectionMode && (
          <>
            {selected ? (
              <CheckCircleRoundedIcon sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
            ) : (
              <RadioButtonUncheckedRoundedIcon sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }} />
            )}
          </>
        )}
        {/* 拖拽手柄：抓它拖 = 挂到别的节点下（reparent）。加大加深 + 悬停高亮，专治「太小太灰不好抓」 */}
        {!selectionMode && (
          <Box
            component="span"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(NEST_DND_MIME, chapter.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            title={t('writingDesign.dropToNest')}
            sx={{
              cursor: 'grab',
              color: 'text.disabled',
              fontSize: 12,
              lineHeight: 1,
              flexShrink: 0,
              userSelect: 'none',
              px: '3px',
              borderRadius: 0.5,
              '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
            }}
          >
            ⠿
          </Box>
        )}
        {/* 折叠尖角固定占位（共享基元）：保证同层标题左缘对齐 */}
        <TreeChevron expandable={expandable} expanded={expanded} onToggleExpand={onToggleExpand} />
        <ChapterStatusDot status={chapter.status} depth={depth} />
        {chapter.kind && <TreeKindBadge kind={chapter.kind} />}
        <Typography
          variant="caption"
          // 原生 title 而非 MUI Tooltip：本树可达上百行，逐行挂 Tooltip 会多出上百个组件实例
          title={chapter.title}
          sx={{
            fontSize: 12,
            fontWeight: active ? 600 : 400,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {chapter.title}
        </Typography>
        {boundBeatTitle && (
          <Tooltip title={`${t('writing.tabOutline')} · ${boundBeatTitle}`}>
            <FlagRoundedIcon sx={{ fontSize: 12, color: 'primary.main', flexShrink: 0 }} />
          </Tooltip>
        )}
        <TreeMetaText text={meta} />
        <Box className="row-actions" sx={{ display: selectionMode ? 'none' : 'flex', transition: 'opacity 0.15s' }}>
          {/* 同级上/下移：只在存在前/后兄弟时出现（复用 reorderChapter 的「移到该行前」语义） */}
          {onMoveUp && (
            <Tooltip title={t('writingTree.moveUp')}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp();
                }}
              >
                <KeyboardArrowUpRoundedIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Tooltip>
          )}
          {onMoveDown && (
            <Tooltip title={t('writingTree.moveDown')}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown();
                }}
              >
                <KeyboardArrowDownRoundedIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t('writingDesign.addChild')}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onAddChild();
              }}
            >
              <Typography component="span" sx={{ fontSize: 13, lineHeight: 1 }}>
                ＋
              </Typography>
            </IconButton>
          </Tooltip>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDialog({ kind: 'move-volume', chapterId: chapter.id }, chapter.volume);
            }}
          >
            <DriveFileMoveRoundedIcon sx={{ fontSize: 13 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDialog({ kind: 'rename-chapter', chapterId: chapter.id }, chapter.title);
            }}
          >
            <EditRoundedIcon sx={{ fontSize: 13 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDialog({ kind: 'delete-chapter', chapterId: chapter.id });
            }}
          >
            <DeleteOutlineRoundedIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}

function ChapterTreePanelInner(props: ChapterTreePanelProps) {
  const {
    chapters,
    visibleChapters,
    chapterIndexById,
    activeChapterId,
    chapterQuery,
    chapterSearchQuery,
    selectionMode,
    selectedChapterIds,
    setSelectedChapterIds,
    setActiveSetting,
    setActiveChapter,
    dragChapterIdRef,
    flushSave,
    setDropIndex,
    reorderChapter,
    reparentNode,
    dropIndex,
    openDialog,
    outlines,
    genre,
    collapsedNodeIds,
    toggleNodeCollapse,
    createChildNode,
  } = props;

  const searching = chapterSearchQuery.length > 0;
  const collapsed = useMemo(() => new Set(collapsedNodeIds), [collapsedNodeIds]);
  const levels = useMemo(() => defaultLevels(genre), [genre]);
  const tree = useMemo(() => buildTree(chapters), [chapters]);
  const keptIds = useMemo(() => new Set(visibleChapters.map((c) => c.id)), [visibleChapters]);
  // 节拍绑定：一次建 Map，避免逐行 outlines.find 的 O(n²)
  const beatByChapter = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of outlines) if (o.chapterId) m.set(o.chapterId, o.title);
    return m;
  }, [outlines]);

  // 子树章数（树口径：容器不算内容、只数叶章）——一次后序遍历 O(n)。
  // 只缓存数字、文案在渲染期再取，否则切语言时 memo 不会重算、标签会留在旧语言。
  const subtreeChapters = useMemo(() => {
    const m = new Map<string, number>();
    const walk = (n: TreeNode): number => {
      if (n.children.length === 0) return 1;
      let sum = 0;
      for (const c of n.children) sum += walk(c);
      m.set(n.node.id, sum);
      return 0;
    };
    tree.forEach(walk);
    return m;
  }, [tree]);

  // 搜索命中判定（保留祖先链）：后序标记「本子树内是否有命中」
  const keepSubtree = useMemo(() => {
    if (!searching) return null;
    const m = new Map<string, boolean>();
    const walk = (n: TreeNode): boolean => {
      let keep = keptIds.has(n.node.id);
      for (const c of n.children) if (walk(c)) keep = true;
      m.set(n.node.id, keep);
      return keep;
    };
    tree.forEach(walk);
    return m;
  }, [searching, keptIds, tree]);

  // 遗留 volume 分组头：只在这本书完全没有 parentId 层级（旧模型书）时启用——
  // 此时所有节点都是根、外观与改动前的扁平列表逐字一致，旧书零变化。
  // 派生表只缓存**原始 volume 字符串**（'' = 未分卷），文案在渲染期再取——否则切语言时
  // memo 不会重算、分组头会留在旧语言（与 subtreeChapters 同一取舍）。
  const volumeHeaders = useMemo(() => {
    const legacyOnly = !chapters.some((c) => c.parentId);
    return legacyOnly && chapters.some((c) => !!c.volume);
  }, [chapters]);

  // 检索期只渲染命中的根 + 其祖先链（keepSubtree 后序标记）
  const roots = useMemo(
    () => (keepSubtree ? tree.filter((n) => keepSubtree.get(n.node.id)) : tree),
    [keepSubtree, tree],
  );

  // 分组头落在「根级行之间」：上一根的 volume 与它不同时给这一根加头（与改动前逻辑同义）
  const volumeHeaderById = useMemo(() => {
    if (!volumeHeaders) return null;
    const m = new Map<string, string>();
    roots.forEach((n, i) => {
      const prev = i > 0 ? roots[i - 1].node.volume : NO_PREV_VOLUME;
      if (n.node.volume !== prev) m.set(n.node.id, n.node.volume);
    });
    return m;
  }, [volumeHeaders, roots]);

  // 同级邻接表（上/下移手势）：一次先序遍历记下每个节点的前/后兄弟（按 buildTree 的
  // sortOrder 排序口径）。检索/多选期手势不出现（dragging 同口径）。
  const siblingNeighbors = useMemo(() => {
    const m = new Map<string, { prev: TreeNode | null; next: TreeNode | null }>();
    const walk = (nodes: TreeNode[]) => {
      for (let i = 0; i < nodes.length; i++) {
        m.set(nodes[i].node.id, {
          prev: i > 0 ? nodes[i - 1] : null,
          next: i < nodes.length - 1 ? nodes[i + 1] : null,
        });
        walk(nodes[i].children);
      }
    };
    walk(tree);
    return m;
  }, [tree]);

  // 章树跟随（批次③）：激活章变化时把该行滚进可视区（⌘K 跳章 / 上一下一章后不再靠肉眼找）
  useEffect(() => {
    if (!activeChapterId) return;
    // 等渲染完成再滚：直接查 DOM，rAF 一拍足够
    const raf = requestAnimationFrame(() => {
      document.querySelector(`[data-testid="chapter-row-${activeChapterId}"]`)?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeChapterId]);

  if (searching && visibleChapters.length === 0) {
    return (
      <Typography sx={{ fontSize: 11.5, color: 'text.disabled', textAlign: 'center', py: 2 }}>
        {t('writing.searchNoMatch', { q: chapterQuery.trim() })}
      </Typography>
    );
  }

  if (chapters.length === 0) {
    return (
      <Typography sx={{ fontSize: 10.5, color: 'text.disabled', px: 1.5, py: 1.5, lineHeight: 1.7 }}>
        {t('writingTree.emptyStructure')}
      </Typography>
    );
  }

  // 同级上/下移：复用 reorderChapter 的扁平重排。up = 移到前兄弟的扁平位（它之前）；
  // down = 移到后兄弟的扁平位（重排在移除后进行，插入点恰在其后一格）。
  const moveSibling = (n: TreeNode, dir: 'up' | 'down') => {
    const nb = siblingNeighbors.get(n.node.id);
    const target = dir === 'up' ? nb?.prev : nb?.next;
    if (!target) return;
    const toIndex = chapterIndexById.get(target.node.id) ?? 0;
    void reorderChapter(n.node.id, toIndex).catch((err) => {
      logger.warn('WritingPage', 'move sibling failed', { error: err });
      useToastStore.getState().error(String(err));
    });
  };

  const renderNode = (n: TreeNode): ReactNode => {
    const ch = n.node;
    // 检索剪枝：本子树内无命中就整枝不渲染（祖先链因 keepSubtree 后序标记而保留）
    if (keepSubtree && !keepSubtree.get(ch.id)) return null;
    const hasKids = n.children.length > 0;
    // 检索期强制展开：命中项可能藏在收起的分支里，收起就没法定位
    const expanded = searching || !collapsed.has(ch.id);
    const selected = ch.id === activeChapterId;
    const kids = subtreeChapters.get(ch.id) ?? 0;
    const childKind = suggestedChildKind(ch.kind, n.depth, levels);
    return (
      <Box key={ch.id}>
        <TreeRow
          depth={n.depth}
          chapter={ch}
          idx={chapterIndexById.get(ch.id) ?? 0}
          active={selected}
          boundBeatTitle={beatByChapter.get(ch.id) ?? null}
          // 容器给「N 章」，叶章给自身字数——各自最能说明规模的那个数（与作品目录树同口径）
          meta={
            hasKids
              ? t('writingTree.chapterCount', { n: kids })
              : ch.wordCount > 0
                ? t('writing.words', { n: ch.wordCount })
                : ''
          }
          expandable={hasKids}
          expanded={expanded}
          onToggleExpand={() => toggleNodeCollapse(ch.id)}
          selectionMode={selectionMode}
          selected={selectedChapterIds.includes(ch.id)}
          onToggleSelect={() =>
            setSelectedChapterIds((ids) => (ids.includes(ch.id) ? ids.filter((x) => x !== ch.id) : [...ids, ch.id]))
          }
          onClick={() => {
            setActiveSetting(null);
            setActiveChapter(ch.id);
          }}
          onOpenDialog={openDialog}
          onAddChild={() => {
            // 新子级藏在收起的分支里就没反馈：先展开本节点
            if (collapsed.has(ch.id)) toggleNodeCollapse(ch.id);
            void createChildNode(ch.id, childKind, `${childKind} ${(n.children.length ?? 0) + 1}`);
          }}
          // 上/下移按钮只在存在前/后兄弟时渲染（检索/多选期与拖拽同口径一起消失）
          onMoveUp={
            !searching && !selectionMode && siblingNeighbors.get(ch.id)?.prev ? () => moveSibling(n, 'up') : undefined
          }
          onMoveDown={
            !searching && !selectionMode && siblingNeighbors.get(ch.id)?.next ? () => moveSibling(n, 'down') : undefined
          }
          onNestDrop={(draggedId) => {
            void reparentNode(draggedId, ch.id).catch((err) => {
              logger.warn('WritingPage', 'reparent chapter failed', { error: err });
              useToastStore.getState().error(String(err));
            });
          }}
          dragging={!searching && !selectionMode}
          dropIndex={dropIndex}
          dragChapterIdRef={dragChapterIdRef}
          flushSave={flushSave}
          setDropIndex={setDropIndex}
          reorderChapter={reorderChapter}
        />
        {hasKids && expanded && n.children.map(renderNode)}
      </Box>
    );
  };

  return (
    <>
      {roots.map((n) => {
        const rawVolume = volumeHeaderById?.get(n.node.id);
        return (
          <Fragment key={n.node.id}>
            {rawVolume !== undefined && (
              <Typography
                sx={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  color: 'primary.main',
                  textTransform: 'uppercase',
                  px: 1,
                  pt: 1,
                  pb: 0.25,
                }}
              >
                {rawVolume || t('writing.volumeNone')}
              </Typography>
            )}
            {renderNode(n)}
          </Fragment>
        );
      })}
    </>
  );
}

export const ChapterTreePanel = memo(ChapterTreePanelInner);
