/**
 * WritingBookInsights —— AI 助手空态下的「当前书籍洞察摘要」。
 *
 * 为什么需要它（呼应 P2 写作与 AI 契合）：
 * 用户从写作台切到 /ai 全页助手时，右侧空态此前只有代码分析洞察（AiInsightsPanel，
 * scope 是 activeAnalysisId，跟写作毫无关系）。T5 把它替换为：当写作台有激活书籍时，
 * 空态直接展示这本书的实时写作画像 —— 大纲评估（章节结构/体量/预警）、人物关系
 * （人设卡与关联）、续写历史（最近更新的章节与该书相关对话数），
 * 让 AI 页面在第一屏就「知道用户在写什么书」，也为欢迎页的续写/润色/分析快捷入口
 * 提供数据底座。
 *
 * 设计立场：
 *   ① 数据 100% 复用 utils/writingOverview.buildBookOverview —— 与右栏《全书总览》
 *      仪表盘、AI 全书语料同一份口径，严禁在这里重算 KPI/预警（避免第三份事实）。
 *   ② 只读：组件不写任何 store/后端，只触发按需加载（books/chapters/settings 等
 *      在写作台窗口已加载；跨窗口冷启动时补拉一次，幂等）。
 *   ③ 无激活书籍时返回 null，空态退回原 AiInsightsPanel（代码分析场景不受影响）。
 */
import { useCallback, useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import GroupsIcon from '@mui/icons-material/Groups';
import HistoryIcon from '@mui/icons-material/History';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useWritingStore } from '../store/writingStore';
import { useAgentStore } from '../store/agentStore';
import { buildBookOverview } from '../utils/writingOverview';
import { parseSettingExtra } from '../services/writing';
import { getLang, t } from '../i18n';
import { logger } from '../utils/logger';
import { cellCount } from '../utils/countFormat';
import { kpiLabelKeys, surfaceKeyForGenre, volumeSummaryKey } from '../utils/writingSchema';
import { AI_GRADIENT, AI_COLOR, AI_COLOR_END } from './aiBrand';

/**
 * 窄栏里 chip 的省略号写法：chip 的 label 默认不折行也不截断，
 * 卷名/人名一长就把整颗 chip 撑到容器外面（外层 overflowX:hidden → 直接被裁）。
 * 统一给它一个"最宽不超容器、超出显示省略号"的形状。
 */
const chipEllipsis = {
  maxWidth: '100%',
  '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
} as const;

/** 章节状态：completed = 已完稿（后端 status 语义，与语料库/总览同口径） */
const isCompleted = (status: string) => status === 'completed';

/** 相对时间：「x 分钟前 / x 小时前 / x 天前」——与 AiInsightsPanel.relTime 同风格 */
function relTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diffSec < 3600) return t('time.minutesAgo', { n: Math.max(1, Math.floor(diffSec / 60)) });
  if (diffSec < 86400) return t('time.hoursAgo', { n: Math.floor(diffSec / 3600) });
  return t('time.daysAgo', { n: Math.floor(diffSec / 86400) });
}

export function WritingBookInsights() {
  const books = useWritingStore((s) => s.books);
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);
  const outlines = useWritingStore((s) => s.outlines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const storylines = useWritingStore((s) => s.storylines);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const activeBookId = useWritingStore((s) => s.activeBookId);
  const activeChapterId = useWritingStore((s) => s.activeChapterId);
  const booksLoading = useWritingStore((s) => s.booksLoading);

  const loadBooks = useWritingStore((s) => s.loadBooks);
  const loadChapters = useWritingStore((s) => s.loadChapters);
  const loadSettings = useWritingStore((s) => s.loadSettings);
  const loadOutlines = useWritingStore((s) => s.loadOutlines);
  const loadTimelineEvents = useWritingStore((s) => s.loadTimelineEvents);
  const loadStorylines = useWritingStore((s) => s.loadStorylines);
  const loadForeshadowings = useWritingStore((s) => s.loadForeshadowings);

  // 该书相关会话数：会话标题在 T2 起自动带「书名 › 章名」前缀
  const conversations = useAgentStore((s) => s.conversations);

  // 冷启动自足：无书籍则先拉书架；有激活书但子域未加载（跨窗口冷启）则补拉，幂等。
  useEffect(() => {
    if (books.length === 0 && !booksLoading) {
      loadBooks().catch(() => {});
    }
    if (activeBookId) {
      void loadChapters(activeBookId).catch(() => {});
      void loadSettings().catch(() => {});
      void loadOutlines().catch(() => {});
      void loadTimelineEvents().catch(() => {});
      void loadStorylines().catch(() => {});
      void loadForeshadowings().catch(() => {});
    }
    // 只依赖激活书 id：books.length 为 0 的冷启动由 loadBooks 完成，不重入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBookId]);

  const currentBook = useMemo(
    () => (activeBookId ? (books.find((b) => b.id === activeBookId) ?? null) : null),
    [books, activeBookId],
  );

  const overview = useMemo(() => {
    if (!currentBook) return null;
    return buildBookOverview({
      bookTitle: currentBook.title,
      chapters: chapters.filter((c) => c.bookId === currentBook.id),
      settings: settings.filter((s) => s.bookId === currentBook.id),
      outlines: outlines.filter((o) => o.bookId === currentBook.id),
      timelineEvents: timelineEvents.filter((e) => e.bookId === currentBook.id),
      storylines: storylines.filter((l) => l.bookId === currentBook.id),
      foreshadowings: foreshadowings.filter((f) => f.bookId === currentBook.id),
      // ㉬ N-21：语料侧体裁闸（缺这行 = 给模型递一本日记的「伏笔逾期未回收」）
      genre: currentBook.genre ?? '',
    });
  }, [currentBook, chapters, settings, outlines, timelineEvents, storylines, foreshadowings]);

  // 章节进度：已完稿 / 总数（与总览 kpis.chapterCount 同口径 = 内容章）
  const progress = useMemo(() => {
    if (!currentBook || !overview) return { done: 0, total: 0, pct: 0 };
    const bookChapters = chapters.filter((c) => c.bookId === currentBook.id);
    const done = bookChapters.filter((c) => isCompleted(c.status)).length;
    const total = overview.kpis.chapterCount;
    return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook, chapters, overview?.kpis.chapterCount]);

  // 续写历史：最近更新的章节（updatedAt 降序前 3）
  const recentChapters = useMemo(() => {
    if (!currentBook) return [];
    return chapters
      .filter((c) => c.bookId === currentBook.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3);
  }, [currentBook, chapters]);

  // 人物关系：人设卡（前 6 张）+ 关联条数；孤立设定预警数量给到 warning 行
  const characterRows = useMemo(() => {
    if (!currentBook) return [];
    return settings
      .filter((s) => s.bookId === currentBook.id && s.kind === 'character')
      .slice(0, 6)
      .map((c) => {
        const extra = parseSettingExtra(c.extra);
        const relCount = extra.relations?.length ?? 0;
        return { id: c.id, name: c.name, subtitle: c.subtitle, relCount };
      });
  }, [currentBook, settings]);

  // 风险预警行（与《全书总览》同口径，点按提示去写作台对应题材面）
  const warnings = useMemo(() => {
    if (!overview) return [];
    const list: { label: string; count: number }[] = [];
    if (overview.timeline.conflicts > 0)
      list.push({ label: t('writing.overviewWarn.timelineConflict'), count: overview.timeline.conflicts });
    if (overview.foreshadowings.overdue > 0)
      list.push({ label: t('writing.overviewWarn.foreshadowOverdue'), count: overview.foreshadowings.overdue });
    if (overview.settingOrphan > 0)
      list.push({ label: t('writing.overviewWarn.orphanSetting'), count: overview.settingOrphan });
    if (overview.looseBeats > 0) list.push({ label: t('writing.overviewWarn.looseBeat'), count: overview.looseBeats });
    if (overview.proofread.issues > 0)
      list.push({ label: t('writing.overviewWarn.proofread'), count: overview.proofread.issues });
    return list;
  }, [overview]);

  const bookTitle = currentBook?.title ?? null;
  const relatedChats = useMemo(
    () => (bookTitle ? conversations.filter((c) => c.title.includes(bookTitle)).length : 0),
    [conversations, bookTitle],
  );

  const reload = useCallback(async () => {
    if (!activeBookId) return;
    try {
      await Promise.all([
        loadBooks(),
        loadChapters(activeBookId),
        loadSettings(),
        loadOutlines(),
        loadTimelineEvents(),
        loadStorylines(),
        loadForeshadowings(),
      ]);
    } catch (e) {
      logger.warn('WritingBookInsights', 'reload failed', { error: e });
    }
  }, [
    activeBookId,
    loadBooks,
    loadChapters,
    loadSettings,
    loadOutlines,
    loadTimelineEvents,
    loadStorylines,
    loadForeshadowings,
  ]);

  // 空态回退：无激活书籍 → 不渲染（由上层继续展示 AiInsightsPanel）
  if (!currentBook) return null;

  const kpis = overview?.kpis;
  // 章节数 / 平均章长 这类名词按体裁换：诗集里既没有章也没有卷
  const bookGenre = currentBook?.genre ?? "";
  const kk = kpiLabelKeys(bookGenre);
  // ㉞ T-F″：「无组那一组」的兜底名同源取词——小说说卷、散文诗说分组、剧本说幕、日记说年月。
  // 数据层 utils/writingOverview 已改为原样透传 ''，成品文案只在渲染层生成。
  const ungroupedLabel = t(surfaceKeyForGenre(bookGenre, 'bandUncategorized'));

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* 标题栏 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: AI_GRADIENT,
            flexShrink: 0,
          }}
        >
          <MenuBookIcon sx={{ fontSize: 17, color: '#fff' }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>
            {t('aiPanel.bookInsights.title')}
          </Typography>
          <Typography noWrap sx={{ fontSize: 11, color: 'text.secondary' }}>
            {currentBook.title}
          </Typography>
        </Box>
        <Tooltip title={t('aiPanel.bookInsights.refresh')}>
          <span>
            <IconButton size="small" onClick={() => void reload()} aria-label={t('aiPanel.bookInsights.refresh')}>
              <RefreshIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* ① 大纲评估 */}
      <Box
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.5,
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <AutoStoriesIcon sx={{ fontSize: 14, color: 'primary.main' }} />
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary' }}>
            {t('aiPanel.bookInsights.outline')}
          </Typography>
        </Box>
        {!overview ? (
          <Typography sx={{ fontSize: 11, color: 'text.disabled', py: 0.5 }}>
            {t('aiPanel.bookInsights.loading')}
          </Typography>
        ) : (
          <>
            {/* KPI 三格：章节 / 字数 / 平均。
                两处为"大体量"专门做的：
                ① `minmax(0, 1fr)` 而不是 `1fr` —— `1fr` 的最小尺寸是**内容宽**，
                   一千二百万字这种不可折行的数会把轨道顶开，外层是 overflowX:hidden，
                   结果不是换行而是被裁掉；minmax(0,…) 才允许格子收缩。
                ② 数字交给 cellCount —— 装得下写准数，装不下写紧凑形态（123.5万/1.2M），
                   准数留在 title 里，不丢信息。 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.5 }}>
              {[
                { label: t(kk.count), count: cellCount(kpis?.chapterCount ?? 0) },
                { label: t('writing.totalWords'), count: cellCount(kpis?.totalWords ?? 0) },
                { label: t(kk.avg), count: cellCount(kpis?.avgWords ?? 0) },
              ].map((c) => (
                <Box
                  key={c.label}
                  sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 0.75, py: 0.5, minWidth: 0 }}
                >
                  <Typography noWrap sx={{ fontSize: 9, color: 'text.secondary' }}>
                    {c.label}
                  </Typography>
                  <Typography
                    noWrap
                    title={c.count.exact ?? undefined}
                    sx={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {c.count.text}
                  </Typography>
                </Box>
              ))}
            </Box>

            {/* 进度条：已完稿 / 总数 */}
            {(progress.total > 0 || progress.done > 0) && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                  <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
                    {t('aiPanel.bookInsights.progress', { done: progress.done, total: progress.total })}
                  </Typography>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'primary.main' }}>{progress.pct}%</Typography>
                </Box>
                <Box sx={{ height: 5, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
                  <Box
                    sx={{
                      height: '100%',
                      borderRadius: 3,
                      background: `linear-gradient(90deg, ${AI_COLOR}, ${AI_COLOR_END})`,
                      width: `${progress.pct}%`,
                      transition: 'width 0.3s',
                    }}
                  />
                </Box>
              </Box>
            )}

            {/* 风险预警 */}
            {warnings.length > 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                <Typography
                  sx={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: 'warning.main',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.25,
                  }}
                >
                  <WarningAmberIcon sx={{ fontSize: 12 }} />
                  {t('writing.overviewWarnings')} · {warnings.length}
                </Typography>
                {/* 只摆前 3 条，剩下的收进「+N」（悬停看全）。
                    标题后面的 · N 仍是**总条数**：折叠的是展示，不是事实。 */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25 }}>
                  {warnings.slice(0, 3).map((w) => (
                    <Chip
                      key={w.label}
                      size="small"
                      color="warning"
                      variant="outlined"
                      label={`${w.label} · ${w.count.toLocaleString(getLang())}`}
                      sx={{ height: 18, fontSize: 9.5, ...chipEllipsis }}
                    />
                  ))}
                  {warnings.length > 3 && (
                    <Tooltip title={warnings.slice(3).map((w) => `${w.label} · ${w.count}`).join('、')}>
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        label={`+${warnings.length - 3}`}
                        sx={{ height: 18, fontSize: 9.5 }}
                      />
                    </Tooltip>
                  )}
                </Box>
              </Box>
            )}

            {/* 卷分布：卷名 · 章数 · 字数 */}
            {overview.volumes.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25 }}>
                {overview.volumes.slice(0, 4).map((v) => {
                  // 卷名可能很长（"第 123 卷 · 星海篇"），字数在长篇里能到七位数：
                  // 两个都会把 chip 撑出容器，所以字数走 cellCount、chip 允许省略号，
                  // 完整一行放 title。
                  const words = cellCount(v.words);
                  // '' = 无组那一组：名字按体裁取（改造前这枚文案硬编码在数据层）
                  const volName = v.volume || ungroupedLabel;
                  return (
                    <Tooltip
                      key={v.volume || '__ungrouped__'}
                      title={t(volumeSummaryKey(bookGenre), {
                        volume: volName,
                        chapters: v.chapters,
                        words: v.words.toLocaleString(getLang()),
                      })}
                    >
                      <Chip
                        size="small"
                        label={t(volumeSummaryKey(bookGenre), {
                          volume: volName,
                          chapters: v.chapters,
                          words: words.text,
                        })}
                        sx={{ height: 18, fontSize: 9.5, bgcolor: 'transparent', ...chipEllipsis }}
                      />
                    </Tooltip>
                  );
                })}
                {overview.volumes.length > 4 && (
                  <Tooltip
                    title={overview.volumes.slice(4).map((v) => `${v.volume || ungroupedLabel} · ${v.chapters}`).join('、')}
                  >
                    <Chip size="small" label={`+${overview.volumes.length - 4}`} sx={{ height: 18, fontSize: 9.5 }} />
                  </Tooltip>
                )}
              </Box>
            )}
          </>
        )}
      </Box>

      {/* ② 人物关系 */}
      <Box
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.5,
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <GroupsIcon sx={{ fontSize: 14, color: 'primary.main' }} />
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary' }}>
            {t('aiPanel.bookInsights.characters')}
          </Typography>
          <Typography sx={{ fontSize: 10, color: 'text.disabled', ml: 'auto' }}>
            {t('aiPanel.bookInsights.charCount', { n: overview?.characters ?? 0 })}
          </Typography>
        </Box>
        {characterRows.length === 0 ? (
          <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
            {t('aiPanel.bookInsights.noCharacters')}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25 }}>
            {characterRows.map((c) => {
              // 副标题/关联原先只在"有副标题"时才做 tooltip，只有关联数的人设什么也不显示；
              // 这里拼一次，两样都在（都是数据里有的东西，不是编的）
              const tip = [
                c.subtitle || undefined,
                c.relCount > 0 ? t('aiPanel.bookInsights.relCount', { n: c.relCount }) : undefined,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <Tooltip key={c.id} title={tip.length > 0 ? `${c.name} · ${tip}` : undefined}>
                  <Chip
                    size="small"
                    label={c.name}
                    sx={{
                      height: 20,
                      fontSize: 10,
                      bgcolor: 'rgb(var(--template-palette-primary-mainChannel) / 0.08)',
                      ...chipEllipsis,
                    }}
                  />
                </Tooltip>
              );
            })}
            {/* 人多时只显示前 6 张，但**必须说还剩几个**：右上角总数讲的是全量，
                不写这一句，看到的就是"这本书只有 6 个人"这种错事实 */}
            {(overview?.characters ?? 0) > characterRows.length && (
              <Chip
                size="small"
                label={`+${(overview?.characters ?? 0) - characterRows.length}`}
                sx={{ height: 20, fontSize: 10 }}
              />
            )}
          </Box>
        )}
      </Box>

      {/* ③ 续写历史 */}
      <Box
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.5,
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <HistoryIcon sx={{ fontSize: 14, color: 'primary.main' }} />
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary' }}>
            {t('aiPanel.bookInsights.history')}
          </Typography>
          {relatedChats > 0 && (
            <Chip
              size="small"
              label={t('aiPanel.bookInsights.relatedChats', { n: relatedChats })}
              sx={{ height: 16, fontSize: 9, ml: 'auto' }}
            />
          )}
        </Box>
        {recentChapters.length === 0 ? (
          <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>{t('aiPanel.bookInsights.noChapters')}</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {recentChapters.map((c) => {
              const w = cellCount(c.wordCount ?? 0);
              return (
              <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <Typography
                  noWrap
                  title={`${c.volume ? `${c.volume} · ` : ''}${c.title}`}
                  sx={{
                    flex: 1,
                    // flex 子项要能截断，minWidth:0 是必须的（否则长章名把字数/时间顶出去）
                    minWidth: 0,
                    fontSize: 10.5,
                    fontWeight: c.id === activeChapterId ? 700 : 400,
                    color: c.id === activeChapterId ? 'primary.main' : 'text.primary',
                  }}
                >
                  {c.volume ? `${c.volume} · ` : ''}
                  {c.title}
                </Typography>
                {/* 「字」这个单位以前是硬编码中文，英文界面会露出中文字：走 i18n */}
                <Typography
                  title={w.exact ?? undefined}
                  sx={{ fontSize: 9, color: 'text.secondary', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
                >
                  {t('writing.words', { n: w.text })}
                </Typography>
                <Typography
                  sx={{ fontSize: 9, color: 'text.disabled', flexShrink: 0, minWidth: 40, textAlign: 'right' }}
                >
                  {relTime(c.updatedAt)}
                </Typography>
              </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default WritingBookInsights;
