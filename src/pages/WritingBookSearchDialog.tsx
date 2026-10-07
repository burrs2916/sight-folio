// 写作台全书查找替换对话框（骨架走查 P1-G1 → P0 跨章替换 → T3 正则/大小写/历史）
//
// 原有：只查不换，v1 注释「跨章替换风险大、章内已有」——但改人设名/统一称呼是
// 创作者改稿期最痛的高频刚需，故升级为「逐章确认式替换」。
//
// 模式切换：顶部 Tab [查找] / [查找替换]；默认查找（保持现有行为）。
// 安全机制：
//   - 单章替换：即时替换 + 父层 saveChapterContent 落库 + Toast
//   - 全部替换：二次确认弹窗（"X 章 Y 处"）
//   - 替换后不自动关闭对话框，结果列表自动刷新（chapters prop 变更触发重搜）
// 技术策略：DOMParser 解析 HTML → 只替换 TEXT_NODE → 保留标签结构；
//           T3 增强：正则/区分大小写双开关（searchBookInChapters 同口径）+ 搜索历史（localStorage）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import CircularProgress from '@mui/material/CircularProgress';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import FindReplaceRoundedIcon from '@mui/icons-material/FindReplaceRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import ClearRoundedIcon from '@mui/icons-material/ClearRounded';
import Chip from '@mui/material/Chip';
import type { WritingChapter } from '../services/tauri';
import {
  searchBookInChapters,
  replaceTextInHtml,
  type BookSearchHit,
  type BookSearchOptions,
} from '../utils/writingSearch';
import { t } from '../i18n';
import { useToastStore } from '../store/toastStore';
import { logger } from '../utils/logger';

export interface WritingBookSearchDialogProps {
  open: boolean;
  onClose: () => void;
  /** 本书全部章（含正文）；由调用方从 writingStore 取，组件保持纯展示 */
  chapters: Pick<WritingChapter, 'id' | 'title' | 'content'>[];
  /** 点结果行 → 切章（写作台语境 = setActiveChapter + 关对话框） */
  onPick: (chapterId: string) => void;
  /** 替换回调：父层执行 saveChapterContent 落库 */
  onReplaceChapter?: (chapterId: string, newContent: string) => Promise<void>;
}

/** 搜索历史项（localStorage 记忆：最近 N 条） */
type SearchHistoryItem = {
  query: string;
  caseSensitive: boolean;
  useRegex: boolean;
  ts: number;
};

const HISTORY_KEY = 'sightFolio.writingBookSearch.history';
const HISTORY_MAX = 8;

/** 读搜索历史（容错：坏 JSON / 非数组 / 缺字段一律丢弃） */
function loadHistory(): SearchHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is SearchHistoryItem =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as SearchHistoryItem).query === 'string' &&
          typeof (x as SearchHistoryItem).caseSensitive === 'boolean' &&
          typeof (x as SearchHistoryItem).useRegex === 'boolean',
      )
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

/** 写搜索历史：新项置顶、同 query+选项 去重、截断 N 条 */
function saveHistoryItem(item: SearchHistoryItem) {
  try {
    const next = [
      item,
      ...loadHistory().filter(
        (h) => !(h.query === item.query && h.caseSensitive === item.caseSensitive && h.useRegex === item.useRegex),
      ),
    ].slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* localStorage 不可用时静默忽略（历史仅锦上添花） */
  }
}

export function WritingBookSearchDialog({
  open,
  onClose,
  chapters,
  onPick,
  onReplaceChapter,
}: WritingBookSearchDialogProps) {
  const [mode, setMode] = useState<'find' | 'replace'>('find');
  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [hits, setHits] = useState<BookSearchHit[]>([]);
  const [ran, setRan] = useState(false);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);

  const canReplace = !!onReplaceChapter && mode === 'replace';
  const totalMatches = useMemo(() => hits.reduce((n, h) => n + h.count, 0), [hits]);

  // Dialog 打开时装载搜索历史（宏任务包装，避免同步 setState 级联渲染）
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => setHistory(loadHistory()), 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // 搜索选项（与 searchBookInChapters / replaceTextInHtml 共用口径）
  const searchOpts: BookSearchOptions = useMemo(() => ({ caseSensitive, useRegex }), [caseSensitive, useRegex]);

  const runSearch = useCallback(() => {
    setHits(searchBookInChapters(chapters, query, searchOpts));
    setRan(true);
    if (query.trim()) saveHistoryItem({ query: query.trim(), caseSensitive, useRegex, ts: Date.now() });
    setHistory(loadHistory());
  }, [chapters, query, caseSensitive, useRegex, searchOpts]);

  // 清理态：Dialog 关闭后（open 从 true→false）用宏任务重置，避免同步 setState 级联渲染
  const prevOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (wasOpen && !open) {
      const timer = setTimeout(() => {
        setQuery('');
        setReplaceText('');
        setHits([]);
        setRan(false);
        setReplacingId(null);
        setConfirmAllOpen(false);
        setMode('find');
        setCaseSensitive(false);
        setUseRegex(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // chapters prop 变更时（如替换后父层重新加载）自动刷新搜索
  // 用宏任务包装 setHits 避免同步 setState（react-hooks/set-state-in-effect）
  useEffect(() => {
    if (ran && query.trim()) {
      const timer = setTimeout(() => setHits(searchBookInChapters(chapters, query, searchOpts)), 0);
      return () => clearTimeout(timer);
    }
  }, [chapters, ran, query, searchOpts]);

  /** 单章替换 */
  const handleReplaceChapter = useCallback(
    async (chapterId: string) => {
      if (!canReplace) return;
      const chapter = chapters.find((c) => c.id === chapterId);
      if (!chapter) return;

      setReplacingId(chapterId);
      try {
        const newContent = replaceTextInHtml(chapter.content || '', query, replaceText, searchOpts);
        await onReplaceChapter!(chapterId, newContent);
        const hitCount = hits.find((h) => h.chapterId === chapterId)?.count ?? 0;
        useToastStore.getState().success(t('writing.bookSearchReplaced', { n: hitCount }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('WritingBookSearchDialog', 'replace chapter failed', { error: e });
        useToastStore.getState().error(t('writing.bookSearchReplaceFailed', { msg }));
      } finally {
        setReplacingId(null);
      }
    },
    [canReplace, chapters, query, replaceText, onReplaceChapter, hits, searchOpts],
  );

  /** 全部替换（逐章顺序执行） */
  const handleReplaceAll = useCallback(async () => {
    if (!canReplace || hits.length === 0) return;
    setReplacingId('__all__');
    let replacedCount = 0;
    let chapterCount = 0;
    try {
      for (const h of hits) {
        const chapter = chapters.find((c) => c.id === h.chapterId);
        if (!chapter) continue;
        const newContent = replaceTextInHtml(chapter.content || '', query, replaceText, searchOpts);
        await onReplaceChapter!(h.chapterId, newContent);
        replacedCount += h.count;
        chapterCount++;
      }
      useToastStore
        .getState()
        .success(t('writing.bookSearchReplacedInChapters', { n: chapterCount, m: replacedCount }));
      // 全部替换后清空结果（再搜也不会有命中）
      setHits([]);
      setRan(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingBookSearchDialog', 'replace all failed', { error: e });
      useToastStore.getState().error(t('writing.bookSearchReplaceFailed', { msg }));
    } finally {
      setReplacingId(null);
      setConfirmAllOpen(false);
    }
  }, [canReplace, hits, chapters, query, replaceText, onReplaceChapter, searchOpts]);

  /** 点历史项：回填查询与选项并立即搜索 */
  const handleHistoryPick = useCallback(
    (item: SearchHistoryItem) => {
      setQuery(item.query);
      setCaseSensitive(item.caseSensitive);
      setUseRegex(item.useRegex);
      // 选项 setState 异步生效，直接按项构造本次搜索避免口径漂移
      setHits(
        searchBookInChapters(chapters, item.query, { caseSensitive: item.caseSensitive, useRegex: item.useRegex }),
      );
      setRan(true);
    },
    [chapters],
  );

  /** 清空搜索历史 */
  const handleHistoryClear = useCallback(() => {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* 忽略 */
    }
    setHistory([]);
  }, []);

  const isBusy = replacingId !== null;

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 0.5 }}>
          {mode === 'find' ? t('writing.bookSearchTitle') : t('writing.bookSearchReplaceTitle')}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {/* 模式切换 */}
          <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ minHeight: 32 }}>
            <Tab value="find" label={t('writing.bookSearchModeFind')} sx={{ minHeight: 32, fontSize: 12, py: 0.5 }} />
            <Tab
              value="replace"
              label={t('writing.bookSearchModeReplace')}
              sx={{ minHeight: 32, fontSize: 12, py: 0.5 }}
            />
          </Tabs>

          {/* 查找/替换输入区 */}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <TextField
              fullWidth
              size="small"
              autoFocus
              placeholder={t('writing.bookSearchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch();
              }}
              slotProps={{ htmlInput: { 'data-testid': 'book-search-input' } }}
            />
            {mode === 'replace' && (
              <TextField
                fullWidth
                size="small"
                placeholder={t('writing.bookSearchReplaceWith')}
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
                slotProps={{ htmlInput: { 'data-testid': 'book-search-replace-input' } }}
              />
            )}
            <Button
              variant="contained"
              size="small"
              startIcon={<SearchRoundedIcon />}
              onClick={runSearch}
              disabled={isBusy}
              data-testid="book-search-run"
            >
              {t('writing.bookSearchRun')}
            </Button>
          </Box>

          {/* 搜索选项：正则 / 区分大小写 */}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Button
              size="small"
              variant={useRegex ? 'contained' : 'text'}
              color={useRegex ? 'primary' : 'inherit'}
              onClick={() => setUseRegex((v) => !v)}
              data-testid="book-search-regex-toggle"
              sx={{ minWidth: 0, px: 1.5, fontSize: 12, textTransform: 'none' }}
            >
              {t('writing.bookSearchUseRegex')}
            </Button>
            <Button
              size="small"
              variant={caseSensitive ? 'contained' : 'text'}
              color={caseSensitive ? 'primary' : 'inherit'}
              onClick={() => setCaseSensitive((v) => !v)}
              data-testid="book-search-case-toggle"
              sx={{ minWidth: 0, px: 1.5, fontSize: 12, textTransform: 'none' }}
            >
              {t('writing.bookSearchCaseSensitive')}
            </Button>
          </Box>

          {/* 搜索历史（最近若干条，点击回填并搜索） */}
          {history.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
              <HistoryRoundedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
              {history.map((h, i) => (
                <Chip
                  key={`${h.query}-${h.caseSensitive ? 'cs' : 'ci'}-${h.useRegex ? 're' : 'lt'}-${i}`}
                  label={h.query}
                  size="small"
                  variant="outlined"
                  onClick={() => handleHistoryPick(h)}
                  onDelete={() => {
                    const next = history.filter((_, j) => j !== i);
                    setHistory(next);
                    try {
                      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
                    } catch {
                      /* 忽略 */
                    }
                  }}
                  deleteIcon={<ClearRoundedIcon sx={{ fontSize: 12 }} />}
                  data-testid="book-search-history-chip"
                  sx={{
                    maxWidth: 220,
                    fontSize: 11,
                    '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                  }}
                  title={`${h.query}${h.caseSensitive ? ' · Aa' : ''}${h.useRegex ? ' · .*' : ''}`}
                />
              ))}
              <Button
                size="small"
                onClick={handleHistoryClear}
                sx={{ fontSize: 11, minWidth: 0, px: 0.5 }}
                data-testid="book-search-history-clear"
              >
                {t('writing.bookSearchHistoryClear')}
              </Button>
            </Box>
          )}

          {/* 搜索结果统计 */}
          {ran && hits.length === 0 && (
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', textAlign: 'center', py: 3 }}>
              {t('writing.bookSearchEmpty')}
            </Typography>
          )}
          {ran && hits.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                {t('writing.bookSearchHitCount', { n: hits.length, m: totalMatches })}
              </Typography>
              {canReplace && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<FindReplaceRoundedIcon />}
                  onClick={() => setConfirmAllOpen(true)}
                  disabled={isBusy}
                  data-testid="book-search-replace-all"
                >
                  {t('writing.bookSearchReplaceAll', { n: totalMatches })}
                </Button>
              )}
            </Box>
          )}

          {/* 命中列表 */}
          {hits.map((h) => {
            const isReplacingThis = replacingId === h.chapterId;
            return (
              <Box key={h.chapterId} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
                    {h.chapterTitle || t('writingWorkbench.untitled')} ·{' '}
                    {t('writing.bookSearchMatchCount', { n: h.count })}
                  </Typography>
                  {canReplace && (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => handleReplaceChapter(h.chapterId)}
                      disabled={isBusy}
                      data-testid="book-search-replace-chapter"
                    >
                      {isReplacingThis ? <CircularProgress size={14} sx={{ mr: 0.5 }} /> : null}
                      {isReplacingThis ? t('writing.bookSearchReplacing') : t('writing.bookSearchReplaceChapter')}
                    </Button>
                  )}
                </Box>
                {h.snippets.map((s, i) => (
                  <Box
                    key={i}
                    component="button"
                    type="button"
                    onClick={() => onPick(h.chapterId)}
                    title={t('writing.bookSearchJump')}
                    data-testid="book-search-row"
                    sx={{
                      cursor: 'pointer',
                      width: '100%',
                      textAlign: 'left',
                      fontSize: 11.5,
                      p: '3px 6px',
                      mt: 0.5,
                      borderRadius: 1,
                      border: 1,
                      borderColor: 'divider',
                      bgcolor: 'transparent',
                      color: 'text.primary',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      display: 'block',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    …{s.before}
                    <Box component="span" sx={{ fontWeight: 700, color: 'primary.main' }}>
                      {s.match}
                    </Box>
                    {s.after}…
                  </Box>
                ))}
              </Box>
            );
          })}
        </DialogContent>
      </Dialog>

      {/* 全部替换二次确认 */}
      <Dialog open={confirmAllOpen} onClose={() => setConfirmAllOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 14 }}>{t('writing.bookSearchReplaceAllConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12 }}>
            {t('writing.bookSearchReplaceAllConfirm', { n: hits.length, m: totalMatches })}
          </Typography>
        </DialogContent>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 2, pb: 2 }}>
          <Button size="small" onClick={() => setConfirmAllOpen(false)} disabled={isBusy}>
            {t('ui.cancel')}
          </Button>
          <Button
            size="small"
            variant="contained"
            color="primary"
            onClick={handleReplaceAll}
            disabled={isBusy}
            data-testid="book-search-replace-all-confirm"
          >
            {replacingId === '__all__' ? <CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> : null}
            {t('writing.bookSearchReplaceAllConfirmBtn')}
          </Button>
        </Box>
      </Dialog>
    </>
  );
}
