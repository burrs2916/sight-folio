// 作品目录树（书场景左栏「目录树」页签）
//
// 按 writing_chapters.parentId 的**父子关系缩进**渲染这本书的结构树（卷 › 章 › 节 …
// 层级名是创作者自填的 kind，系统不预设）；单击任意节点即在工作室里定位，右栏
// 「要素 / 详情」随选中自动到位（SceneEditor 的两栏分派见下）。
//
// ─── 为什么不用 CanvasEntityTreeTab（代码场景那棵）───
// 它读 editorStore.components，而那是**当前视图的画布卡片**——editorStore.switchView 会把
// components 整体换成目标视图的组件，所以它永远不是「这本书的结构」；且该组件体内
// isBookScene 出现 0 次 → 书场景会漏出「实体 1 / 图层 1 / writing-studio-pane」这类代码
// 分析词汇。故本组件只在书场景替换该页签，代码场景原样走 CanvasEntityTreeTab（零回归）。
//
// ─── 数据与算法全部复用（零新表 / 零新存储 / 零 Rust）───
//   树形        → utils/writingTree.buildTree（与「卷部管理」对话框同一份）
//   子树章数    → utils/writingOutline.subtreeAccount（树口径：容器不算内容，只数叶章）
//   状态点      → components/ChapterStatusDot（与大纲 / 设计视图同一枚）
//   折叠态      → writingStore.collapsedNodeIds（与大纲视图共用一份，不落库）
//   定位动线    → studioBook.openChapterCarrierView（与大纲树 NodeRow 的 open() 同一动线：
//                 切正文容器视图 + 开该章页签 → 右栏「要素」给本章节拍 / 时间线 / 挂线 /
//                 伏笔，「详情」给该章正文档案卡）
//
// ─── 缩进口径与大纲树一致 ───
// 引导线 / elbow / 折叠尖角 / 徽章 / 尾注统一走 editor/components/TreeRowShared
// （与写作台章节树同一份基元）：左栏目录树与大纲树看起来是同一个系统，
// 而不是两套各画各的树。

import { useEffect, useMemo, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { useWritingStore } from '../../store/writingStore';
import { useWritingDocsStore } from '../../store/writingDocsStore';
import { useSceneStore } from '../../store/sceneStore';
import { buildTree, treeRowIndent, type TreeNode } from '../../utils/writingTree';
import { surfaceKeyForGenre } from '../../utils/writingSchema';
import { subtreeAccount } from '../../utils/writingOutline';
import { openChapterCarrierView } from '../../utils/studioBook';
import { ChapterStatusDot } from '../components/ChapterStatusDot';
import { TreeIndentGuides, TreeChevron, TreeKindBadge, TreeMetaText } from '../components/TreeRowShared';
import { t } from '../../i18n';
import logger from '../../utils/logger';
import type { WritingChapter } from '../../services/tauri';

/** 书场景工作室的 activeBookId 口径与 SceneEditor 一致：场景 projectRoot = writing://<bookId> */
function useStudioBookId(): string {
  return useSceneStore((s) => {
    const root = s.scenes.find((sc) => sc.id === s.activeSceneId)?.projectRoot ?? '';
    return root.startsWith('writing://') ? root.replace(/^writing:\/\//, '').replace(/\/+$/, '') : '';
  });
}

/** 树的一行：引导线 + 折叠尖角 + 状态点 + 层级徽章 + 标题 + 尾注 */
function TreeRow({
  depth,
  title,
  kind,
  meta,
  status,
  genre = '',
  active = false,
  expandable = false,
  expanded = true,
  onToggleExpand,
  onClick,
}: {
  depth: number;
  title: string;
  kind?: string;
  meta?: string;
  status: string;
  genre?: string;
  active?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onClick: () => void;
}) {
  return (
    <Box sx={{ position: 'relative' }}>
      <TreeIndentGuides depth={depth} />
      <Box
        onClick={onClick}
        // 原生 title 而非 MUI Tooltip：本树可达上百行，逐行挂 Tooltip 会多出上百个组件实例；
        // 行标题只作导航识别，省略号 + 悬停全名足够（与作品头那类身份文本的取舍不同）。
        title={title}
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
          bgcolor: active ? 'action.selected' : 'transparent',
          '&:hover': { backgroundColor: active ? 'action.selected' : 'action.hover' },
        }}
      >
        <TreeChevron expandable={expandable} expanded={expanded} onToggleExpand={onToggleExpand} />
        <ChapterStatusDot status={status} depth={depth} genre={genre} />
        {kind && <TreeKindBadge kind={kind} />}
        <Typography
          variant="caption"
          sx={{
            fontSize: 11,
            fontWeight: active ? 600 : 500,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </Typography>
        <TreeMetaText text={meta ?? ''} />
      </Box>
    </Box>
  );
}

export function WritingStructureTreeTab() {
  const bookId = useStudioBookId();

  const books = useWritingStore((s) => s.books);
  const chapters = useWritingStore((s) => s.chapters);
  const collapsedNodeIds = useWritingStore((s) => s.collapsedNodeIds);
  const toggleNodeCollapse = useWritingStore((s) => s.toggleNodeCollapse);
  // 章选中反显：树里能看出「现在正在写哪一章」
  const activeDocChapterId = useWritingDocsStore((s) => s.activeChapterByBook[bookId]);

  // 书接线：从场景直接打开时 writingStore 可能还没接这本书（与 WritingInspectorPanel 同模式）。
  // setActiveBook 一次带全 7 个集合（chapters / settings / outlines / timeline / storylines /
  // foreshadowings / dailyStats）。
  useEffect(() => {
    if (!bookId) return;
    const ws = useWritingStore.getState();
    if (ws.books.length === 0) void ws.loadBooks().catch(() => {});
    if (ws.activeBookId !== bookId) void ws.setActiveBook(bookId).catch(() => {});
  }, [bookId]);

  const book = books.find((b) => b.id === bookId) ?? null;
  const genre = book?.genre ?? '';
  const bookTitle = book?.title ?? '';

  const tree = useMemo(() => buildTree(chapters), [chapters]);
  const collapsed = useMemo(() => new Set(collapsedNodeIds), [collapsedNodeIds]);

  // 子树章数（树口径：容器不算内容，只数叶章）——只缓存数字，文案在渲染期再取，
  // 否则切语言时 memo 不会重算、标签会留在旧语言。
  const subtreeChapters = useMemo(() => {
    const m = new Map<string, number>();
    const walk = (n: TreeNode) => {
      if (n.children.length > 0) {
        m.set(n.node.id, subtreeAccount(chapters, n.node.id).rows.length);
        n.children.forEach(walk);
      }
    };
    tree.forEach(walk);
    return m;
  }, [tree, chapters]);

  const totals = useMemo(() => {
    let count = 0;
    let words = 0;
    for (const r of tree) {
      const acc = subtreeAccount(chapters, r.node.id);
      count += acc.rows.length;
      words += acc.words;
    }
    return { count, words };
  }, [tree, chapters]);

  const locateChapter = (ch: WritingChapter) => {
    try {
      // 与大纲树 NodeRow 的 open() 完全同口径：页签名 =「书名 · 章名」
      openChapterCarrierView(ch.id, bookTitle ? `${bookTitle} · ${ch.title}` : ch.title, genre, bookId);
    } catch (e) {
      logger.warn('WritingTreeTab', 'locateChapter failed', { id: ch.id, error: String(e) });
    }
  };

  // ─── 空态：没打开作品 ───
  if (!bookId || !book) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          p: 3,
          gap: 1,
          color: 'text.secondary',
          textAlign: 'center',
        }}
      >
        <AccountTreeIcon sx={{ fontSize: 40, opacity: 0.3 }} />
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {t('writingTree.noBookTitle')}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.7, lineHeight: 1.5 }}>
          {t('writingTree.noBookHint')}
        </Typography>
      </Box>
    );
  }

  const renderNode = (n: TreeNode): ReactNode => {
    const ch = n.node;
    const hasKids = n.children.length > 0;
    const expanded = !collapsed.has(ch.id);
    const kids = subtreeChapters.get(ch.id) ?? 0;
    return (
      <Box key={ch.id}>
        <TreeRow
          depth={n.depth}
          title={ch.title || t('writingTree.untitledChapter')}
          kind={ch.kind || undefined}
          status={ch.status}
          genre={genre}
          active={activeDocChapterId === ch.id}
          expandable={hasKids}
          expanded={expanded}
          onToggleExpand={() => toggleNodeCollapse(ch.id)}
          onClick={() => locateChapter(ch)}
          // 容器给「N 章」，叶章给自身字数——各自最能说明规模的那个数。
          // ㉗ 容器那句走槽位：日记的容器是年/月，里面数出来的是「天」不是「章」。
          meta={hasKids ? t(surfaceKeyForGenre(genre, 'childCount'), { n: kids }) : t('writing.words', { n: ch.wordCount })}
        />
        {hasKids && expanded && n.children.map(renderNode)}
      </Box>
    );
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pb: 1, '&::-webkit-scrollbar': { width: 4 } }}>
      {/* 作品身份 + 体量：一行读完这本书多大 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.6,
          borderBottom: 1,
          borderColor: 'divider',
          position: 'sticky',
          top: 0,
          zIndex: 1,
          bgcolor: 'background.paper',
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontSize: 11,
            fontWeight: 700,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={bookTitle}
        >
          {bookTitle}
        </Typography>
        <Typography variant="caption" sx={{ fontSize: 9.5, color: 'text.disabled', flexShrink: 0 }}>
          {`${t(surfaceKeyForGenre(genre, 'childCount'), { n: totals.count })} · ${t('writing.words', { n: totals.words })}`}
        </Typography>
      </Box>

      {tree.length === 0 ? (
        <Typography variant="caption" sx={{ display: 'block', fontSize: 10, color: 'text.disabled', px: 1.5, py: 1 }}>
          {t('writingTree.emptyStructure')}
        </Typography>
      ) : (
        tree.map(renderNode)
      )}
    </Box>
  );
}
