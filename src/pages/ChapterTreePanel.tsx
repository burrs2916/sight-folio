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
// ─── 封面展示说明 ───
// 2026-10-06：写作台只保留**排版渲染与展示**职责，不在这里设置/上传章头图。
// 封面由工作室（studio）负责设置，写作台仅读取并展示已设置的封面缩略图。
//
// ─── memo ───
// 与 ChapterListPanel 同因：WritingPage 每 800ms 自动保存会翻转顶层 saveState 触发整树重渲染，
// 本面板 props 全为稳定引用（store 选择器 / useState setter / useMemo / ref）时 memo 浅比较
// 全部命中，即可跳过整棵树的重新渲染。

import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import {
  POETRY_TRADITION_KEYS,
  poetryGroupsForLang,
  poemFormView,
  readPoemForm,
} from '../utils/poetryForms';
import { structureInspectorForGenre } from '../utils/writingSchema';
import { surfaceKeyForGenre } from '../utils/writingSchema';
import { diaryDateShort, parseDiaryDate } from '../utils/diaryEntry';
import { unitTermParams } from '../utils/unitTerms';
import {
  analyzeScriptStructure,
  scriptStructureBadge,
  scriptStructureTone,
  scriptStructureCorpusLines,
} from '../utils/scriptStructure';
import { useWritingStore } from '../store/writingStore';
import ListSubheader from '@mui/material/ListSubheader';
import Chip from '@mui/material/Chip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
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
import {
  buildTree,
  defaultLevels,
  suggestedChildKind,
  treeRowIndent,
  type TreeNode,
} from '../utils/writingTree';
import { TreeIndentGuides, TreeChevron, TreeKindBadge, TreeMetaText } from '../editor/components/TreeRowShared';
import { getLang, t } from '../i18n';
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
  /**
   * 非多选期点击章行后追加的动作。写作台用它把右栏落到**正文**：作者是点章来写作的，
   * 不是来读元信息的（2026-11-07 李先生定口径；改前默认落章详情）。
   * 章详情没有被删掉——它仍在右栏页签与抽屉按钮两个常驻入口里，只是不再抢默认位。
   */
  onChapterOpened?: (id: string) => void;
  dragChapterIdRef: MutableRefObject<string | null>;
  flushSave: () => Promise<boolean>;
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

/** 树的一行：引导线 + 折叠尖角 + 状态点 + 层级徽章 + 封面缩略 + 标题 + 尾注 + 行尾动作（悬停显出） */
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
  structureKind,
  genre,
  onMoveUp,
  onMoveDown,
  onNestDrop,
  dragging,
  dropIndex,
  dragChapterIdRef,
  flushSave,
  setDropIndex,
  reorderChapter,
  chapterIndexById,
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
  /** 体裁专属的行尾结构读数（⑯-1 由 writingSchema.structureInspectorForGenre 判）：
   *  poem = 形式徽标 + 选择器；script = 幕场/对白读数；'' = 小说与散文，行 DOM 一字不改 */
  structureKind: '' | 'poem' | 'script';
  /** 本书体裁（行尾动作的叫法按它插值：新建篇目 / 重命名诗作 / 删除场次） */
  genre: string;
  /** 同级上移（存在前兄弟时才有值）：移到前兄弟之前 */
  onMoveUp?: () => void;
  /** 同级下移（存在后兄弟时才有值）：移到后兄弟之后 */
  onMoveDown?: () => void;
  onNestDrop: (draggedId: string) => void;
  dragging: boolean;
  dropIndex: number | null;
  dragChapterIdRef: MutableRefObject<string | null>;
  flushSave: () => Promise<boolean>;
  setDropIndex: (i: number | null) => void;
  reorderChapter: (id: string, toIndex: number) => Promise<void>;
  /** 扁平下标 Map：行身拖拽换算落点（向后拖减 1 抵消移除偏移）时查询被拖节点下标 */
  chapterIndexById: Map<string, number>;
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
            // 指示线画在本行上方 = 「移到本行之前」；reorderChapter 是「先移除再插入到 toIndex」。
            // 向后拖（from < idx）时目标行移除后前移一格，直接传 idx 会落进目标行之后一格，
            // 与视觉相反——需减 1 抵消偏移（向前拖 from > idx 不受影响）。
            const from = chapterIndexById.get(draggedId);
            const toIndex = from !== undefined && from < idx ? idx - 1 : idx;
            void reorderChapter(draggedId, toIndex).catch((err) => {
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
        {/* 行尾动作：绝对定位浮层，不占 flex 宽度——否则 240px 左栏里标题被压到 0 宽、
            长标题必然省略号截断（2026-10-10 定位：5 个按钮常驻占 115px，标题只剩 0–17px）。
            背景用不透明面板底色整块遮断：bgcolor:'inherit' 继承的 action.hover/selected 是半透明
            （alpha 0.2/0.3），叠在行上方盖不住底下的标题/图标，形成叠印式视觉重叠（2026-10-10 修复）。 */}
        <Box
          className="row-actions"
          sx={{
            position: 'absolute',
            right: 2,
            top: 0,
            bottom: 0,
            display: selectionMode ? 'none' : 'flex',
            alignItems: 'center',
            borderRadius: 0.75,
            bgcolor: (th) => th.palette.background.paper,
            transition: 'opacity 0.15s',
          }}
        >
          {/* 同级上/下移：只在存在前/后兄弟时出现（复用 reorderChapter 的「移到该行前」语义） */}
          {onMoveUp && (
            <Tooltip title={t('writingTree.moveUp')}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp();
                }}
                aria-label={t('writingTree.moveUp')}
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
                aria-label={t('writingTree.moveDown')}
              >
                <KeyboardArrowDownRoundedIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Tooltip>
          )}
          {structureKind === 'poem' && <PoemFormChip chapter={chapter} />}
          {structureKind === 'script' && <ScriptStructChip chapter={chapter} />}
          <Tooltip title={t('writingDesign.addChild')}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onAddChild();
              }}
              aria-label={t('writingDesign.addChild')}
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
            aria-label={t('writing.moveToVolume')}
          >
            <DriveFileMoveRoundedIcon sx={{ fontSize: 13 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDialog({ kind: 'rename-chapter', chapterId: chapter.id }, chapter.title);
            }}
            aria-label={t('writing.renameChapterTitle', unitTermParams(genre))}
          >
            <EditRoundedIcon sx={{ fontSize: 13 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDialog({ kind: 'delete-chapter', chapterId: chapter.id });
            }}
            aria-label={t('writing.deleteChapterTitle', unitTermParams(genre))}
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
    onChapterOpened,
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
          // 容器给「N 章」，叶章给自身字数——各自最能说明规模的那个数（与作品目录树同口径）。
          // ㉓-1：量词按体裁取，日记的年/月节点该说「12 天」而不是「12 章」。
          meta={
            hasKids
              ? t(surfaceKeyForGenre(genre, 'childCount'), { n: kids })
              : // ㉕ 日记条目把「哪天」排在字数前面。旧数据没有日期、别的体裁也没有，
                // 空串被 filter 掉之后再 join，所以非日记体裁的输出与改造前**逐字相同**（不多一个分隔符）。
                [
                  diaryDateShort(parseDiaryDate(ch.extra)),
                  ch.wordCount > 0 ? t('writing.words', { n: ch.wordCount }) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
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
            // 点章 = 打开这一章来写（右栏落正文）。2026-09-29 那版「点章即开章详情」已废：
            // 它让作者每次点章都先翻过一页说明书，再点一次才摸到正文。
            onChapterOpened?.(ch.id);
          }}
          onOpenDialog={openDialog}
          structureKind={structureInspectorForGenre(genre)}
          genre={genre}
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
          onNestDrop={(nestId) => {
            void reparentNode(nestId, ch.id).catch((err) => {
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
          chapterIndexById={chapterIndexById}
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

/**
 * 「诗歌形式」行内控件（2026-11-09 ⑫）：一枚窄徽标 + 锚点浮层。
 *
 * 为什么不把 20 个形式摊在行里：这行本来就有 引导线 + 折叠尖角 + 状态点 + 层级徽章 +
 * 封面缩略 + 标题 + 尾注 + 4 枚动作按钮，再塞一个 Select 必然把标题挤成省略号 ——
 * 李先生为"体量一大布局就乱"报修过一回，不再犯第二次。清单在浮层里，行上只留一枚
 * `maxWidth: 96` 的徽标，颜色就是判定结果（合式 / 出格 / 未判定）。
 *
 * 动作走 `useWritingStore.getState()`：只在点击回调里取一次，**不建订阅**，
 * 所以本文件顶部那套「props 全为稳定引用 → memo 浅比较命中」的约定一点没破。
 */
/**
 * 剧本行尾的「幕场 / 对白」读数（⑯-1）。
 * 三条边界：① 只读不算账 —— 不改正文、不碰排版（排版是承载层，未批）；
 * ② 色调只挂**硬事实**（有没有幕场标题、是不是整段叙述），长台词那种经验阈值不进色调；
 * ③ 没正文就说没正文，不谎报「没结构」。
 */
function ScriptStructChip({ chapter }: { chapter: WritingChapter }) {
  const s = useMemo(() => analyzeScriptStructure(chapter.content ?? ''), [chapter.content]);
  const badge = scriptStructureBadge(s);
  const tone = scriptStructureTone(s);
  const lines = scriptStructureCorpusLines(s).zh;
  const toneSx =
    tone === 'ok'
      ? { color: 'success.main', borderColor: 'success.main' }
      : tone === 'empty'
        ? { color: 'text.disabled' }
        : { color: 'warning.main', borderColor: 'warning.main' };
  return (
    <Tooltip
      title={
        <Box sx={{ maxWidth: 300 }}>
          {lines.length > 0
            ? lines.map((l, i) => (
                <Box key={i} sx={{ fontSize: 11 }}>
                  {l}
                </Box>
              ))
            : t('writing.scriptStructUI.empty')}
        </Box>
      }
    >
      <Chip
        size="small"
        label={t(badge.key, badge.params)}
        onClick={(e) => e.stopPropagation()}
        sx={{ height: 18, fontSize: 10.5, maxWidth: 138, ...toneSx }}
      />
    </Tooltip>
  );
}

function PoemFormChip({ chapter }: { chapter: WritingChapter }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const groups = useMemo(() => poetryGroupsForLang(getLang()), []);
  const view = poemFormView(chapter.content ?? '', chapter.extra);
  const formId = readPoemForm(chapter.extra);
  const label = view ? t(view.labelKey) : t('writing.poemFormUI.formNone');
  const toneSx =
    view?.tone === 'ok'
      ? { color: 'success.main', borderColor: 'success.main' }
      : view?.tone === 'bad'
        ? { color: 'warning.main', borderColor: 'warning.main' }
        : view?.tone === 'skip'
          ? { color: 'text.disabled' }
          : {};
  const tip = !view
    ? t('writing.poemFormUI.formNone')
    : view.notMeasured
      ? `${t(view.labelKey)} · ${t('writing.poemFormUI.formNone')}`
      : t(view.messageKey, view.messageParams as never);

  const pick = (id: string) => {
    setAnchorEl(null);
    void useWritingStore.getState().setChapterPoemForm(chapter.id, id);
  };

  return (
    <>
      <Tooltip title={tip}>
        <Chip
          size="small"
          clickable
          label={label}
          onClick={(e) => setAnchorEl(e.currentTarget as HTMLElement)}
          sx={{ height: 17, fontSize: 9.5, maxWidth: 96, flexShrink: 0, ...toneSx }}
        />
      </Tooltip>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={() => pick('')} sx={{ fontSize: 12, fontStyle: 'italic' }}>
          {t('writing.poemFormUI.formClear')}
        </MenuItem>
        {groups.map((g) => (
          <Fragment key={g.tradition}>
            <ListSubheader sx={{ fontSize: 10.5, lineHeight: '20px', mt: 0.5 }}>{t(POETRY_TRADITION_KEYS[g.tradition])}</ListSubheader>
            {g.forms.map((f) => (
              <MenuItem key={f.id} selected={f.id === formId} onClick={() => pick(f.id)} sx={{ fontSize: 12, py: 0.25 }}>
                {t(f.labelKey)}
              </MenuItem>
            ))}
          </Fragment>
        ))}
      </Menu>
    </>
  );
}
