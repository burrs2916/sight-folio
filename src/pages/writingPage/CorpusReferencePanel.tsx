// 写作台语料自动参考面板（语料库 → 写作台闭环，自动模式）
//
// 设计要点：
// - 与手动对话框不同，本组件**不需要用户输入关键词**：query 由调用方（WritingPage）
//   在编辑器输入时自动提取（光标所在块的光标前片段）并传入，组件内防抖后检索
//   corpusApi（FTS5 句子级），命中句直接展示在固定区域供参考，随输入实时刷新。
// - 可用性探针：corpus.db 初始化失败时降级为不可用，面板内提示，不打断写作。
// - 插入动作由调用方注入（复用 handleCorpusInsert），本组件不碰编辑器。
// - 无副作用派生：`searching`/`activeQuery` 均为渲染派生值（最近完成检索的
//   query 记忆在 searchedQuery），effect 内只做调度与异步回调 setState，
//   并对过期响应做版本守卫（queryRef），避免慢响应覆盖新结果。
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { alpha, type Theme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Pagination from '@mui/material/Pagination';
import LocalLibraryRoundedIcon from '@mui/icons-material/LocalLibraryRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { corpusApi, type CorpusBook, type CorpusSearchHit } from '../../services/tauri';
import { useToastStore } from '../../store/toastStore';
import { t } from '../../i18n';
import { highlight } from '../../utils/corpusHighlight';
import { analyzeCraft, type CraftTagKey } from '../../utils/craftTags';
import { useDragBodyGuard } from '../../hooks/useDragBodyGuard';
import { uiFontSize } from '../../theme/appearanceScales';

export interface CorpusReferencePanelProps {
  /** 当前输入片段（WritingPage 从编辑器 onUpdate 提取；空串 = 无输入/光标在块首且块空） */
  query: string;
  /** 插入正文回调：由 WritingPage 在编辑器光标处插入命中的句子（本组件不依赖编辑器） */
  onInsertText: (text: string) => void;
  /** 嵌入式模式（创作台右抽屉）：隐藏左缘拖拽手柄、宽度铺满容器；
   *  默认 false = 独立栏形态（左缘手柄可调宽 240-560px 并记忆偏好）。 */
  embedded?: boolean;
}

/** 面板内单页展示上限：参考场景按页取，翻页看更多（与后端 limit 对齐） */
const HIT_LIMIT = 8;
/** 输入停顿防抖（与手动对话框一致的停顿节奏，输入中不打断心流） */
const SEARCH_DEBOUNCE_MS = 300;
/** 面板宽度范围（拖拽手柄可调）：太窄句子换行密集，太宽抢占编辑区心流 */
const PANEL_WIDTH_MIN = 240;
const PANEL_WIDTH_MAX = 560;
/** 默认宽度（未保存过偏好时） */
const PANEL_WIDTH_DEFAULT = 300;
/** 宽度偏好 localStorage 键（跨会话记忆用户拖出来的面板宽度） */
const PANEL_WIDTH_KEY = 'sight-folio:writing.corpusPanelWidth';

/**
 * 卡片「书封色」循环：语料参考如书架，每张卡取一个语义色做书脊与书名点缀，
 * 循环轮换（紫/蓝/绿/金），避免同色卡片堆叠的单调感，贴合创作平台调性。
 */
const COVER_COLORS: Array<'primary' | 'info' | 'success' | 'warning'> = ['primary', 'info', 'success', 'warning'];

/** 参考价值分层 → i18n key（对应后端 reference_tier：high/medium/low） */
const TIER_KEYS: Record<string, string> = {
  high: 'writing.corpusTierHigh',
  medium: 'writing.corpusTierMedium',
  low: 'writing.corpusTierLow',
};

/** 手法标签 → i18n key（写作方案 C1：命中卡片的手法拆解视图） */
const CRAFT_TAG_KEYS: Record<CraftTagKey, string> = {
  sensory: 'writing.craftTagSensory',
  action: 'writing.craftTagAction',
  dialogue: 'writing.craftTagDialogue',
  metaphor: 'writing.craftTagMetaphor',
  'short-beat': 'writing.craftTagShortBeat',
  'long-spread': 'writing.craftTagLongSpread',
  'emotion-told': 'writing.craftTagEmotionTold',
  'emotion-shown': 'writing.craftTagEmotionShown',
};

/** 节奏判断 → 一句话说明（i18n key） */
const CRAFT_RHYTHM_KEYS: Record<string, string> = {
  'short-beat': 'writing.craftRhythmShortBeat',
  steady: 'writing.craftRhythmSteady',
  'long-spread': 'writing.craftRhythmLongSpread',
  mixed: 'writing.craftRhythmMixed',
};

/** 情感逻辑结论 → 一句话说明（i18n key） */
const CRAFT_EMOTION_KEYS: Record<string, string> = {
  told: 'writing.craftEmotionLogicTold',
  shown: 'writing.craftEmotionLogicShown',
  none: 'writing.craftEmotionLogicNone',
};

/** 用词类别 → 板块标题（i18n key） */
const CRAFT_DICTION_KEYS: Record<string, string> = {
  sensory: 'writing.craftDictionSensory',
  action: 'writing.craftDictionAction',
  emotion: 'writing.craftDictionEmotion',
};

/** 取「书封色」的浅 tint 背景（亮色 8%、暗色 22% 透明度），用于卡片 hover 与轻量填充 */
function coverTint(theme: Theme, tone: string) {
  return alpha(tone, theme.palette.mode === 'dark' ? 0.24 : 0.08);
}

/** 从 localStorage 读宽度偏好，非法/缺失回退默认值 */
function readSavedPanelWidth(): number {
  try {
    const raw = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= PANEL_WIDTH_MIN && raw <= PANEL_WIDTH_MAX) return Math.round(raw);
  } catch {
    // 存储不可读（隐私模式等）：回退默认，不影响拖拽功能
  }
  return PANEL_WIDTH_DEFAULT;
}

export function CorpusReferencePanel({ query, onInsertText, embedded = false }: CorpusReferencePanelProps) {
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [hits, setHits] = useState<CorpusSearchHit[]>([]);
  /** 书命中（书名/作者/分类层命中，置顶展示；旧服务端缺失时为空） */
  const [bookHits, setBookHits] = useState<CorpusBook[]>([]);
  /** 当前展开「重复句出处」的卡片 chunkId（null = 全部收起） */
  const [expandedSources, setExpandedSources] = useState<number | null>(null);
  /** 当前展开「手法拆解」的卡片 chunkId（null = 全部收起；与出处展开互斥，避免卡片纵向叠太厚） */
  const [expandedCraft, setExpandedCraft] = useState<number | null>(null);
  /** 面板宽度（左缘拖拽手柄可调；拖拽结束时写入 localStorage 记忆偏好） */
  const [panelWidth, setPanelWidth] = useState(readSavedPanelWidth);
  /** 是否正在拖拽（手柄按下 → 高亮成主色，松开复位；双击重置宽度时的即时反馈） */
  const [dragActive, setDragActive] = useState(false);
  /** 拖拽会话起点：x 与起始宽度（拖拽中每帧据此算新宽度，避免累加漂移） */
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
  /** 拖拽期间禁用选文的全局副作用守卫：正常松手复位，拖拽中途被卸载（切章详情/收抽屉）也复位 */
  const { begin: beginBodyDrag, release: releaseBodyDrag } = useDragBodyGuard();
  /** 是否已完成过至少一次检索（驱动空态/计数栏渲染） */
  const [hasSearched, setHasSearched] = useState(false);
  /** 最近一次完成检索的原文 query（与当前输入比对以派生 searching 态） */
  const [searchedQuery, setSearchedQuery] = useState('');
  /** 全部句子命中数（合并重复句后；分页器用它算总页数），旧服务端缺失时兜底取 hits.length */
  const [totalHits, setTotalHits] = useState(0);
  /** 当前页码（0 基；query 变化自动回 0） */
  const [page, setPage] = useState(0);
  /** 刚插入正文的命中句 chunkId：短暂高亮反馈（1.2s 后复原；
   *  GlobalToast 按用户反馈全局过滤 success 类型，插入成功改由卡片就地高亮提示） */
  const [justInsertedId, setJustInsertedId] = useState<number | null>(null);
  /** 高亮复位计时器（连续插入时先清旧计时，避免提前熄灭） */
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashInserted = useCallback((chunkId: number) => {
    setJustInsertedId(chunkId);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setJustInsertedId(null), 1200);
  }, []);

  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );
  const mountedRef = useRef(true);
  /** 结果列表滚动容器（翻页后回到顶部，避免停在列表中部看新页） */
  const listRef = useRef<HTMLDivElement | null>(null);
  /** 最近一次输入（q）变化时刻：翻页若紧接输入，补齐剩余防抖窗口，避免击穿输入节奏 */
  const lastInputAtRef = useRef(0);
  /** 版本守卫：只接受「发起检索的 query 与页码 === 当前状态」的响应，丢弃过期响应
   *  （防慢响应覆盖新结果：输入变化、快速翻页都会使旧请求过期） */
  const reqIdRef = useRef(0);
  /** 上次已处理的 query：q 变化时页码重置回第 1 页再检索 */
  const prevQueryRef = useRef('');
  /** 保留旧 query 比较句：来自父组件的实时输入（trim 前） */
  const queryRef = useRef('');

  // 可用性探针：挂载即弹一次；不可用则面板整体提示（探针失败按可用，后续命令各自报错）
  useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      try {
        const s = await corpusApi.status();
        if (mountedRef.current) setUnavailable(s.available ? null : s.error || t('writing.corpusUnavailableUnknown'));
      } catch {
        // 探针本身失败：按可用处理，后续命令各自报错
        if (mountedRef.current) setUnavailable(null);
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const q = query.trim();
  // 检索中 = 有输入 且 结果还不是当前输入的结果（派生，无 effect 内同步 setState）
  const searching = q.length > 0 && searchedQuery !== q;

  // 输入停顿防抖自动检索：query 变化 → 300ms 后拉取 → 渲染命中；
  // query 为空时清空并回到「输入即有参考」提示态（不保留旧结果误导用户）。
  // query 变化自动回第 1 页；翻页只改 page，同 query 带新 offset 重查。
  useEffect(() => {
    queryRef.current = q;
    const qChanged = prevQueryRef.current !== q;
    if (qChanged) {
      prevQueryRef.current = q;
      lastInputAtRef.current = Date.now();
    }
    // query 变化时页码归 0；若当前已在第 0 页则直接按第 0 页检索，否则先同步页码再走下一页渲染
    const targetPage = qChanged ? 0 : page;
    if (qChanged && page !== 0) {
      setPage(0);
      return;
    }
    // 防抖窗口：输入变化固定走 300ms 停顿防抖；翻页（q 未变）立即拉取——
    // 但若翻页紧跟输入（q 变化后页码重置带来的第二次渲染），补齐剩余防抖，
    // 避免连续打字的每次按键都立即发请求、击穿输入节奏。
    const delay = qChanged
      ? SEARCH_DEBOUNCE_MS
      : Math.max(0, SEARCH_DEBOUNCE_MS - (Date.now() - lastInputAtRef.current));
    const timer = setTimeout(() => {
      if (!q) {
        if (mountedRef.current) {
          setHits([]);
          setBookHits([]);
          setTotalHits(0);
          setPage(0);
          setHasSearched(false);
          setSearchedQuery('');
        }
        return;
      }
      const reqId = ++reqIdRef.current;
      void (async () => {
        try {
          const r = await corpusApi.search(q, null, HIT_LIMIT, targetPage * HIT_LIMIT);
          if (!mountedRef.current || reqIdRef.current !== reqId) return;
          setHits(r.hits);
          setBookHits(r.books ?? []);
          setTotalHits(Math.max(r.total ?? r.hits.length, r.hits.length));
          setHasSearched(true);
          setSearchedQuery(q);
        } catch (e) {
          if (!mountedRef.current || reqIdRef.current !== reqId) return;
          useToastStore.getState().error(t('writing.corpusSearchFail', { msg: String(e) }));
          setHits([]);
          setBookHits([]);
          setTotalHits(0);
          setHasSearched(true);
          setSearchedQuery(q);
        }
      })();
    }, delay);
    return () => clearTimeout(timer);
  }, [q, page]);

  /** 复制命中句子原文到剪贴板（参考场景：抄写/改写前先副本更稳） */
  const copyHit = useCallback(async (h: CorpusSearchHit) => {
    try {
      await navigator.clipboard.writeText(h.content);
      useToastStore.getState().success(t('writing.corpusCopied'));
    } catch {
      useToastStore.getState().error(t('writing.corpusCopyFail'));
    }
  }, []);

  /** 拖拽手柄按下：记录起始位置与宽度（然后交给 window 级 move/up 处理），手柄进入高亮态 */
  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragStartRef.current = { x: e.clientX, width: panelWidth };
      setDragActive(true);
      // 拖拽期间禁止选中文本，避免拖动时高亮选中的卡片文字
      beginBodyDrag();
    },
    [panelWidth, beginBodyDrag],
  );

  /** 拖拽移动（window 级）：手柄在面板左缘，向左拖 = 变宽，向右拖 = 变窄 */
  const onResizeMove = useCallback((e: PointerEvent) => {
    const s = dragStartRef.current;
    if (!s) return;
    const next = s.width - (e.clientX - s.x);
    setPanelWidth(Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(next))));
  }, []);

  /** 拖拽结束：写偏好 + 清理拖拽态 */
  const onResizeEnd = useCallback(() => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    setDragActive(false);
    releaseBodyDrag();
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
    } catch {
      // 存储不可写（隐私模式等）：本次会话内宽度仍生效，不再重试
    }
  }, [panelWidth, releaseBodyDrag]);

  /** 双击手柄：宽度一键复位为默认值（适合误拖后快速回到原始布局），并记忆偏好 */
  const onResizeReset = useCallback(() => {
    dragStartRef.current = null;
    setDragActive(false);
    releaseBodyDrag();
    setPanelWidth(PANEL_WIDTH_DEFAULT);
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(PANEL_WIDTH_DEFAULT));
    } catch {
      // 存储不可写（隐私模式等）：本次会话内宽度立即生效即可
    }
  }, [releaseBodyDrag]);

  // 拖拽监听挂在 window：移出面板/iframe 边界仍持续跟手，松开即停
  useEffect(() => {
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', onResizeEnd);
    window.addEventListener('pointercancel', onResizeEnd);
    return () => {
      window.removeEventListener('pointermove', onResizeMove);
      window.removeEventListener('pointerup', onResizeEnd);
      window.removeEventListener('pointercancel', onResizeEnd);
    };
  }, [onResizeMove, onResizeEnd]);

  const showEmptyHint = !unavailable && !searching && !hasSearched && !q;
  // 总页数（分页器/页信息共用；hits 为空时仍可能因 total 残留而 >1，需兜底为 0）
  const pageCount = Math.ceil(totalHits / HIT_LIMIT);

  /**
   * ←/→ 方向键翻页：监听挂在面板根容器上，事件只从面板内部可聚焦元素
   * （分页器/卡片按钮）冒泡而来——正文编辑器焦点在面板外，方向键天然
   * 保留给光标移动，互不冲突。带修饰键（Cmd/Ctrl/Alt/Shift）的方向键
   * 放行给上层（如系统级切换），避免劫持。多页时拦截，边界页不越界。
   */
  const onPanelKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (step === 0 || pageCount <= 1) return;
      e.preventDefault();
      listRef.current?.scrollTo?.({ top: 0 });
      setPage((p) => Math.min(Math.max(p + step, 0), pageCount - 1));
    },
    [pageCount],
  );

  return (
    <Box
      onKeyDown={onPanelKeyDown}
      sx={{ display: 'flex', flexShrink: 0, minHeight: 0, ...(embedded ? { flex: 1, width: '100%' } : {}) }}
    >
      {/* 左缘拖拽手柄：hover/拖拽中高亮成主色；按下横向调宽、宽度偏好持久化；双击复位默认宽（嵌入式模式隐藏） */}
      {!embedded && (
        <Box
          component="div"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('writing.corpusResizeHint')}
          title={t('writing.corpusResizeHint')}
          onPointerDown={onResizeStart}
          onDoubleClick={onResizeReset}
          data-corpus-dragging={dragActive || undefined}
          sx={{
            width: 6,
            flexShrink: 0,
            cursor: 'col-resize',
            touchAction: 'none',
            alignSelf: 'stretch',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            '&::after': {
              content: '""',
              width: 2,
              height: 36,
              borderRadius: 1,
              bgcolor: 'divider',
              transition: 'background-color 0.15s, box-shadow 0.15s',
            },
            '&:hover::after': { bgcolor: 'primary.main' },
            '&[data-corpus-dragging]::after': {
              bgcolor: 'primary.main',
              boxShadow: (theme) => `0 0 0 1.5px ${alpha(theme.palette.primary.main, 0.35)}`,
            },
          }}
        />
      )}
      <Box
        sx={{
          borderLeft: embedded ? 0 : 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          width: embedded ? '100%' : panelWidth,
          minHeight: 0,
          bgcolor: 'background.paper',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.75,
            borderBottom: hasSearched || hits.length > 0 ? 1 : 0,
            borderColor: 'divider',
          }}
        >
          <LocalLibraryRoundedIcon sx={{ fontSize: uiFontSize(15), color: 'primary.main' }} />
          <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 700, color: 'primary.main' }}>
            {t('writing.corpusTitle')}
          </Typography>
          {!searching && q && hits.length > 0 && (
            <Chip
              size="small"
              label={t('writing.corpusHits', { n: totalHits })}
              sx={(theme) => ({
                height: 18,
                fontSize: uiFontSize(10.5),
                ml: 'auto',
                maxWidth: 150,
                fontWeight: 600,
                color: theme.palette.info.main,
                bgcolor: coverTint(theme, theme.palette.info.main),
                border: `1px solid ${alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.5 : 0.3)}`,
              })}
            />
          )}
          {searching && (
            <Typography sx={{ fontSize: uiFontSize(11), color: 'text.disabled', ml: 'auto' }}>
              {t('writing.corpusSearching')}
            </Typography>
          )}
        </Box>
        {unavailable !== null ? (
          <Box
            sx={{
              px: 1.5,
              py: 1,
              bgcolor: 'error.light',
              color: 'error.contrastText',
            }}
          >
            <Typography sx={{ fontSize: uiFontSize(12.5) }}>{unavailable}</Typography>
          </Box>
        ) : (
          <>
            <Box ref={listRef} sx={{ px: 1.5, py: 1, overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {/* 书命中（书名/作者/分类层命中）：置顶展示，与句子命中互补——提示信息要全，
                书名层命中即使句子未落到该页也先让用户知道语料里有哪几本书与输入相关 */}
              {bookHits.length > 0 && !searching && (
                <Box
                  sx={(theme) => ({
                    mb: 1,
                    borderRadius: 1,
                    border: `1px dashed ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.4 : 0.28)}`,
                    bgcolor: coverTint(theme, theme.palette.primary.main),
                    px: 1.25,
                    py: 0.75,
                  })}
                >
                  <Typography sx={{ fontSize: uiFontSize(10.5), fontWeight: 700, color: 'text.secondary', mb: 0.4 }}>
                    {t('writing.corpusBookHits', { n: bookHits.length })}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {bookHits.map((b) => (
                      <Chip
                        key={b.id}
                        size="small"
                        label={`《${b.title}》${b.author || ''}`}
                        sx={(theme) => ({
                          height: 20,
                          fontSize: uiFontSize(10.5),
                          fontWeight: 600,
                          color: theme.palette.primary.main,
                          bgcolor: coverTint(theme, theme.palette.primary.main),
                          border: `1px solid ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.5 : 0.3)}`,
                        })}
                      />
                    ))}
                  </Box>
                </Box>
              )}
              {hits.map((h, idx) => {
                const coverKey = COVER_COLORS[idx % COVER_COLORS.length];
                // C1：命中句手法拆解（纯规则层，一次性缓存进渲染流，无副作用）
                const craft = analyzeCraft(h.content);
                return (
                  <Card
                    key={h.chunkId}
                    sx={(theme) => ({
                      mb: 1,
                      position: 'relative',
                      overflow: 'hidden',
                      transition: 'box-shadow 0.15s ease, background-color 0.15s ease',
                      ...(h.chunkId === justInsertedId && {
                        boxShadow: 4,
                        outline: `1.5px solid ${theme.palette.primary.main}`,
                        bgcolor: coverTint(theme, theme.palette.primary.main),
                      }),
                      '&:hover': {
                        boxShadow: 3,
                        bgcolor: coverTint(theme, theme.palette[coverKey].main),
                      },
                    })}
                  >
                    {/* 书脊色条：每张卡循环取紫/蓝/绿/金，语料如书架，避免同色堆叠 */}
                    <Box
                      data-corpus-bookspine={coverKey}
                      sx={(theme) => ({
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 3.5,
                        bgcolor: theme.palette[coverKey].main,
                        opacity: theme.palette.mode === 'dark' ? 0.7 : 1,
                      })}
                    />
                    <CardContent sx={{ py: 1, px: 1.5, pl: 1.75, '&:last-child': { pb: 1 } }}>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 0.25, alignItems: 'center' }}>
                        <Typography
                          sx={(theme) => ({
                            fontSize: uiFontSize(11),
                            fontWeight: 700,
                            color: theme.palette[coverKey].main,
                            flexShrink: 1,
                            minWidth: 0,
                            maxWidth: 140,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          })}
                        >
                          《{h.bookTitle}》
                        </Typography>
                        {h.chapterTitle && (
                          <Chip
                            label={h.chapterTitle}
                            size="small"
                            sx={{ height: 16, fontSize: uiFontSize(9.5), maxWidth: 100 }}
                          />
                        )}
                        <Typography sx={{ fontSize: uiFontSize(10), color: 'text.disabled', flexShrink: 0 }}>
                          {t('writing.corpusSentenceSeq', { n: h.seq + 1 })}
                        </Typography>
                        {h.occurrenceCount > 1 && (
                          <Chip
                            size="small"
                            label={t('writing.corpusOccurrence', { n: h.occurrenceCount })}
                            sx={(theme) => ({
                              height: 16,
                              fontSize: uiFontSize(9.5),
                              fontWeight: 600,
                              color: theme.palette.success.main,
                              bgcolor: coverTint(theme, theme.palette.success.main),
                              border: `1px solid ${alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.5 : 0.3)}`,
                            })}
                          />
                        )}
                        <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5, flexShrink: 0 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<ContentCopyRoundedIcon sx={{ fontSize: uiFontSize(12) }} />}
                            onClick={() => void copyHit(h)}
                            sx={{ minWidth: 0, px: 0.75, fontSize: uiFontSize(10.5) }}
                          >
                            {t('writing.corpusCopy')}
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<InsertDriveFileOutlinedIcon sx={{ fontSize: uiFontSize(12) }} />}
                            onClick={() => {
                              onInsertText(h.content);
                              flashInserted(h.chunkId);
                            }}
                            sx={{ minWidth: 0, px: 0.75, fontSize: uiFontSize(10.5) }}
                          >
                            {t('writing.corpusInsert')}
                          </Button>
                        </Box>
                      </Box>
                      <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.6 }}>
                        {highlight(h.content, q)}
                      </Typography>
                      {h.referenceTier && TIER_KEYS[h.referenceTier] && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.65 }}>
                          <Chip
                            label={t(TIER_KEYS[h.referenceTier])}
                            size="small"
                            sx={(theme) => ({
                              height: 18,
                              fontSize: uiFontSize(10),
                              fontWeight: 700,
                              color: h.referenceTier === 'high' ? theme.palette.primary.main : 'text.secondary',
                              bgcolor:
                                h.referenceTier === 'high'
                                  ? coverTint(theme, theme.palette.primary.main)
                                  : theme.palette.mode === 'dark'
                                    ? 'action.hover'
                                    : 'background.default',
                              border:
                                h.referenceTier === 'high'
                                  ? `1px solid ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.5 : 0.3)}`
                                  : '1px solid',
                              borderColor: h.referenceTier === 'high' ? undefined : 'divider',
                            })}
                          />
                        </Box>
                      )}
                      {h.analysis && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.65, alignItems: 'center' }}>
                          <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled', mr: 0.25 }}>
                            {t('writing.corpusCharCount', {
                              n: h.analysis.charCount,
                              m: h.analysis.tokenCount,
                            })}
                          </Typography>
                        </Box>
                      )}
                      {/* ─── C1 手法拆解：命中句手法标签 + 拆解视图（节奏/用词/情感逻辑/可迁移模板/仿写）─── */}
                      {craft.tags.length > 0 && (
                        <Box sx={{ mt: 0.75 }}>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                            <Button
                              size="small"
                              color={expandedCraft === h.chunkId ? 'primary' : 'inherit'}
                              onClick={() => setExpandedCraft((prev) => (prev === h.chunkId ? null : h.chunkId))}
                              sx={{
                                minWidth: 0,
                                px: 0.5,
                                py: 0.25,
                                fontSize: uiFontSize(10),
                                textTransform: 'none',
                                fontWeight: 700,
                                color: 'text.secondary',
                                '&:hover': { color: 'primary.main' },
                              }}
                            >
                              {expandedCraft === h.chunkId
                                ? t('writing.craftBreakdownHide')
                                : t('writing.craftBreakdown')}
                            </Button>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              {craft.tags.map((tag) => (
                                <Chip
                                  key={tag}
                                  size="small"
                                  label={t(CRAFT_TAG_KEYS[tag])}
                                  sx={{
                                    height: 16,
                                    fontSize: uiFontSize(9),
                                    color: expandedCraft === h.chunkId ? 'primary.main' : 'text.secondary',
                                  }}
                                />
                              ))}
                            </Box>
                          </Box>
                          {expandedCraft === h.chunkId && (
                            <Box
                              sx={(theme) => ({
                                mt: 0.5,
                                px: 1,
                                py: 0.75,
                                borderRadius: 1,
                                bgcolor: coverTint(theme, theme.palette.primary.main),
                                fontSize: uiFontSize(10.5),
                                lineHeight: 1.7,
                                color: 'text.primary',
                              })}
                            >
                              <Box component="div" sx={{ color: 'text.secondary' }}>
                                {t(CRAFT_RHYTHM_KEYS[craft.rhythm])}
                                {' · '}
                                {t(CRAFT_EMOTION_KEYS[craft.emotionLogic])}
                              </Box>
                              {craft.diction.map((d) => (
                                <Box component="div" key={d.kind}>
                                  {t(CRAFT_DICTION_KEYS[d.kind])}
                                  {': '}
                                  {d.words.join(' / ')}
                                </Box>
                              ))}
                              <Box component="div" sx={{ mt: 0.25 }}>
                                {t('writing.craftTemplate')}
                                {': '}
                                <Typography component="span" sx={{ fontWeight: 600 }}>
                                  {craft.template}
                                </Typography>
                              </Box>
                              <Box component="div">
                                {t('writing.craftImitation')}
                                {': '}
                                {craft.imitation}
                              </Box>
                            </Box>
                          )}
                        </Box>
                      )}
                      {h.occurrenceCount > 1 && (
                        <Box sx={{ mt: 0.5 }}>
                          <Button
                            size="small"
                            onClick={() => setExpandedSources((prev) => (prev === h.chunkId ? null : h.chunkId))}
                            sx={{
                              minWidth: 0,
                              px: 0.5,
                              fontSize: uiFontSize(10),
                              textTransform: 'none',
                              color: 'text.secondary',
                            }}
                          >
                            {expandedSources === h.chunkId
                              ? t('writing.corpusOccurrenceLess')
                              : t('writing.corpusOccurrenceMore')}
                          </Button>
                          {expandedSources === h.chunkId && (
                            <Box component="ul" sx={{ m: 0, pl: 2, mt: 0.25 }}>
                              {h.occurrences.map((o, oi) => (
                                <Box
                                  component="li"
                                  key={oi}
                                  sx={{ fontSize: uiFontSize(10.5), color: 'text.secondary', lineHeight: 1.7 }}
                                >
                                  {t('writing.corpusOccurrenceAt', {
                                    chapter: o.chapterTitle || t('writing.corpusUnknownChapter'),
                                    n: o.seq + 1,
                                  })}
                                  {'（'}
                                  {o.bookTitle}
                                  {'）'}
                                </Box>
                              ))}
                            </Box>
                          )}
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              {hasSearched && hits.length === 0 && (
                <Box
                  sx={(theme) => ({
                    mt: 1,
                    borderRadius: 1,
                    bgcolor: coverTint(theme, theme.palette.primary.main),
                    px: 1.5,
                    py: 2,
                  })}
                >
                  <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', textAlign: 'center' }}>
                    {t('writing.corpusNoHits')}
                  </Typography>
                </Box>
              )}
              {showEmptyHint && (
                <Box
                  sx={(theme) => ({
                    mt: 1,
                    borderRadius: 1,
                    border: `1px dashed ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.4 : 0.3)}`,
                    bgcolor: coverTint(theme, theme.palette.primary.main),
                    px: 1.5,
                    py: 2,
                  })}
                >
                  <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', textAlign: 'center' }}>
                    {t('writing.corpusHint')}
                  </Typography>
                </Box>
              )}
            </Box>
            {/* 分页导航：固定在面板底部（不随命中列表滚动），翻页即时拉取 + 自动回列表顶部；
              「第 x / y 页」提示常驻可见，替代埋在列表末尾的分页器 */}
            {!searching && pageCount > 1 && (
              <Box
                sx={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 0.75,
                  px: 1,
                  py: 0.6,
                  borderTop: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled', flexShrink: 0 }}>
                  {t('writing.corpusPageInfo', { cur: page + 1, total: pageCount })}
                </Typography>
                <Pagination
                  page={page + 1}
                  count={pageCount}
                  siblingCount={0}
                  boundaryCount={1}
                  onChange={(_e, value) => {
                    setPage(value - 1);
                    listRef.current?.scrollTo?.({ top: 0 });
                  }}
                  size="small"
                  sx={{
                    '& .MuiPaginationItem-root': { fontSize: uiFontSize(10.5), minWidth: 22, height: 22 },
                  }}
                />
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
