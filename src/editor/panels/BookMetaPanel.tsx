// 书属性卡（右栏「详情」tab · 书场景无选中分支，2026-09-14；编辑面扩展 2026-10-31 第十四轮）
//
// 封面是**书的属性**（一张图），不是画布对象、不是题材内容、更不是动作 ——
// 所以落属性面板：选中实体显示实体属性，无选中显示书属性（本组件），职责正交。
// 数据零迁移：素材库 assets/writing/covers-{bookId}/ 下存图，**有文件=有封面**，
// writing_books 表不加列（复用既有 asset.rs 命令，后端零新增）。
//
// 第十四轮：从「近乎只读、仅封面可改」升级为创作者「规划本书」的完整编辑面。
// 立项一本书时最想随手调的元信息 —— 书名 / 简介 / 体裁·载体 / 连载·完结 / 日更目标 ——
// 此前在工作室一律改不动，得跳写作台书设置弹窗。本卡补齐就地编辑，但**不另造写逻辑**：
//   · 书名 → renameBook（与写作台/L1 页签改名同一 setter）
//   · 体裁·载体 → BookMetaDialog + setBookMeta（与书架 hover 同一共享对话框、同一 setter）
//   · 简介·状态 → setBookMeta（本轮扩展承载 description/status）
//   · 日更目标 → setDailyGoal（写作台同 setter）
// 全部单一权威 setter，工作室与写作台零口径漂移（前几轮反复踩的跨视图一致性坑）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {
  assetApi,
  writingApi,
  writingStatsApi,
  isChapterDeleted,
  parseBookGoal,
  type AssetInfo,
  type WritingChapter,
  type WritingDailyStat,
} from '../../services/tauri';
import { useWritingStore } from '../../store/writingStore';
import { useToastStore } from '../../store/toastStore';
import Tooltip from '@mui/material/Tooltip';
import { t } from '../../i18n';
import logger from '../../utils/logger';
import { BOOK_STATUSES, bookStatusDef, genreLabelKey, mediumLabelKey } from '../../utils/writingSchema';
import { BookMetaDialog } from '../../pages/BookMetaDialog';
import {
  deriveBookGoalProgress,
  derivePaceProjection,
  formatPaceCorpus,
  resolveBookGoalInput,
  deadlineToInput,
  diffDailyStats,
  goalProgress,
  WINDOW_DAYS,
  type DailyDelta,
} from '../../utils/writingStats';
import { uiFontSize } from '../../theme/appearanceScales';

/** 素材库分类约定：插画走 writing/illustrations，封面走 writing/covers-{bookId}（一书一目录） */
const CATEGORY = 'writing';
const coverSub = (bookId: string) => `covers-${bookId}`;

/** 封面预览（懒加载 data_url，失败回退占位块） */
function CoverPreview({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    assetApi
      .thumbnail(path, 480)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [path]);
  if (failed || !url) return <Box sx={{ width: '100%', height: '100%', bgcolor: 'action.hover' }} />;
  return (
    <img
      src={url}
      alt={t('studio.cover.title')}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}

/** 小节标题（uppercase caption，与卡内既有「作品信息 / 作品封面」同一视觉语言） */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      sx={{
        fontSize: uiFontSize(11),
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: 'text.secondary',
        mt: 2,
        mb: 0.75,
      }}
    >
      {children}
    </Typography>
  );
}

export function BookMetaPanel({ bookId, onReparse }: { bookId: string | null; onReparse?: () => void }) {
  const book = useWritingStore((s) => s.books.find((b) => b.id === bookId) ?? null);
  const showToast = useToastStore((s) => s.showToast);
  // 体量指纹：当前书「活跃章数:字数实时和」随 store.chapters 变化。本窗口日更（saveChapterContent）
  // 或跨窗口正文同步（content-saved 并入 chapters wordCount）都会让它跳变——补批次2 的 updatedAt
  // 盲区（写正文不改元信息 → updatedAt 不动，面板会停在旧体量）。primitive 字符串只在 n/sum 真变
  // 时才触发重渲染，高频章节改动成本可忽略。
  const liveVolumeSig = useWritingStore((s) => {
    if (!bookId) return '';
    let sum = 0;
    let n = 0;
    for (const c of s.chapters ?? []) {
      if (c.bookId !== bookId || isChapterDeleted(c)) continue;
      sum += c.wordCount || 0;
      n += 1;
    }
    return `${n}:${sum}`;
  });
  const [cover, setCover] = useState<AssetInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 体裁·载体编辑对话框（复用书架同款 BookMetaDialog，单一 setBookMeta 写路径）
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);

  // 就地编辑草稿：书名 / 简介 / 日更目标。bookId 切换即从活 book 记录重新回填，
  // 外部改名（L1 页签 / 写作台）落库后 books[].* 变化也经此同步（草稿仅在未编辑时跟随）。
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftGoal, setDraftGoal] = useState('0');
  // 全书目标（T2）草稿：总字数 / 章节数 / 截止日期（YYYY-MM-DD，空 = 未设）。
  // 达成进度按「本卡 bookId」直查章节与日快照（不依赖 writingStore.activeBookId 接线），
  // 杜绝工作室 activeBookId（场景解析）与 store chapters（按 activeBook 装载）跨书错位。
  const [draftWords, setDraftWords] = useState('');
  const [draftChapters, setDraftChapters] = useState('');
  const [draftDeadline, setDraftDeadline] = useState('');
  const [actual, setActual] = useState<{ words: number; chapters: number; today: number; deltas: DailyDelta[] } | null>(
    null,
  );
  useEffect(() => {
    if (!book) return;
    setDraftTitle(book.title ?? '');
    setDraftDesc(book.description ?? '');
    setDraftGoal(String(book.dailyGoal ?? 0));
    const g = parseBookGoal(book.extra);
    setDraftWords(g.targetWords > 0 ? String(g.targetWords) : '');
    setDraftChapters(g.targetChapters > 0 ? String(g.targetChapters) : '');
    setDraftDeadline(deadlineToInput(g.deadline));
    // 仅在切书时重置草稿；同书内用户正在输入不被外部刷新打断。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // 书接线：从场景直开时 writingStore 可能还没拉书目（与「要素」面板同一模式）
  useEffect(() => {
    if (!bookId) return;
    if (useWritingStore.getState().books.length === 0) {
      void useWritingStore
        .getState()
        .loadBooks()
        .catch(() => {});
    }
  }, [bookId]);

  // 实际体量：writingApi.listChapters 按 bookId 直查（软删章过滤，同写作台 loadChapters 口径）；
  // 总字数优先取最近日快照（end-of-day，比实时章和更贴近落库），无快照退回章实时和（同 WritingStatsDialog）。
  // 切书：立即清空旧书进度（新书装载前不闪现上一本书的数字）。
  useEffect(() => {
    setActual(null);
  }, [bookId]);

  // 装载进度：按 bookId 直查；书元信息被重新规划（本窗口改目标 / 跨窗口同步来 → updatedAt 变）
  // 时一并重拉——让「规划本书」调目标后，进度与节奏预测立刻反映最新，不必等面板重挂。
  // 不在此清空 actual（避免 updatedAt 变化时整块进度/节奏闪烁一下）。
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [chs, stats] = await Promise.all([
          writingApi.listChapters(bookId),
          writingStatsApi.listDailyStats(bookId, WINDOW_DAYS + 1).catch(() => [] as WritingDailyStat[]),
        ]);
        if (cancelled) return;
        const live = chs.filter((c: WritingChapter) => !isChapterDeleted(c));
        const chapterSum = live.reduce((sum: number, c) => sum + (c.wordCount || 0), 0);
        const latest = stats.length > 0 ? stats[stats.length - 1] : null;
        const words = latest && latest.wordCount > 0 ? latest.wordCount : chapterSum;
        // 今日新增：快照明细差分出每日增量，末位即今天（与写作台 WritingStatsDialog 同一口径）
        const deltas = diffDailyStats(stats, new Date());
        const today = deltas.length > 0 ? deltas[deltas.length - 1].delta : 0;
        setActual({ words, chapters: live.length, today, deltas });
      } catch (e) {
        logger.warn('BookMetaPanel', 'load book actuals failed', { error: String(e) });
        if (!cancelled) setActual({ words: 0, chapters: 0, today: 0, deltas: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, book?.updatedAt, liveVolumeSig]);

  // bookGoal 引用仅在 extra 变化时更新（避免每帧新对象击穿 bookGoalProgress 的 memo）
  const bookGoal = useMemo(() => parseBookGoal(book?.extra), [book?.extra]);
  const bookGoalProgress = useMemo(
    () => deriveBookGoalProgress(bookGoal, actual?.words ?? 0, actual?.chapters ?? 0, new Date()),
    [bookGoal, actual],
  );
  // 节奏预测：复用单一权威派生（与统计弹窗 / AI 语料逐字同口径）。无总字数目标 → null 不画。
  const pace = useMemo(
    () => derivePaceProjection(bookGoal, actual?.words ?? 0, actual?.deltas ?? [], new Date()),
    [bookGoal, actual],
  );

  const reload = useCallback(async () => {
    if (!bookId) return;
    setLoading(true);
    try {
      const list = await assetApi.list(CATEGORY, coverSub(bookId));
      setCover(list[0] ?? null);
    } catch (e) {
      logger.warn('BookMetaPanel', 'list cover failed', { error: String(e) });
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ─── 提交：书名（与 L1 页签 / 写作台同 setter）───
  const commitTitle = useCallback(() => {
    if (!book) return;
    const next = draftTitle.trim();
    if (!next || next === book.title) {
      setDraftTitle(book.title); // 空/未变 → 回退原值
      return;
    }
    void useWritingStore
      .getState()
      .renameBook(book.id, next)
      .catch((e) => showToast(t('studio.opFailed', { msg: String(e) }), 'error'));
  }, [book, draftTitle, showToast]);

  // ─── 提交：简介（setBookMeta.description；trim 后与原值同则跳过落库）───
  const commitDesc = useCallback(() => {
    if (!book) return;
    const next = draftDesc.trim();
    if (next === (book.description ?? '')) return;
    void useWritingStore
      .getState()
      .setBookMeta(book.id, { description: next })
      .catch((e) => showToast(t('studio.opFailed', { msg: String(e) }), 'error'));
  }, [book, draftDesc, showToast]);

  // ─── 提交：日更目标（setDailyGoal，0 = 未设）───
  const commitGoal = useCallback(() => {
    if (!book) return;
    const n = Math.max(0, Math.min(1_000_000, Math.round(Number(draftGoal) || 0)));
    if (n === (book.dailyGoal ?? 0)) {
      setDraftGoal(String(n));
      return;
    }
    void useWritingStore
      .getState()
      .setDailyGoal(book.id, n)
      .then(() => setDraftGoal(String(n)))
      .catch((e) => showToast(t('studio.opFailed', { msg: String(e) }), 'error'));
  }, [book, draftGoal, showToast]);

  // ─── 提交：全书目标（setBookGoal，三字段合并送，与写作台统计弹窗同一 setter / 同一派生）───
  const commitBookGoal = useCallback(() => {
    if (!book) return;
    const next = resolveBookGoalInput(draftWords, draftChapters, draftDeadline);
    const cur = parseBookGoal(book.extra);
    if (
      next.targetWords === cur.targetWords &&
      next.targetChapters === cur.targetChapters &&
      next.deadline === cur.deadline
    ) {
      return; // 未变 → 不重复落库
    }
    void useWritingStore
      .getState()
      .setBookGoal(book.id, next)
      .then(() => {
        // 提交后回填规范化串（空/非法 → 空），避免输入框残留「abc」等脏值
        setDraftWords(next.targetWords > 0 ? String(next.targetWords) : '');
        setDraftChapters(next.targetChapters > 0 ? String(next.targetChapters) : '');
        setDraftDeadline(deadlineToInput(next.deadline));
      })
      .catch((e) => showToast(t('studio.opFailed', { msg: String(e) }), 'error'));
  }, [book, draftWords, draftChapters, draftDeadline, showToast]);

  // ─── 即时切换：作品状态四态（setBookMeta.status，词表见 utils/writingSchema BOOK_STATUSES）───
  const commitStatus = useCallback(
    (next: string, nextLabel: string) => {
      if (!book) return;
      // 比对归一后的当前值而非库里原始串：旧书存的是 'draft'，点「连载中」不该触发一次纯无谓落库。
      if (next === bookStatusDef(book.status).id) return;
      void useWritingStore
        .getState()
        .setBookMeta(book.id, { status: next })
        .then(() => showToast(t('dashboard.statusChangedToast', { label: nextLabel }), 'success'))
        .catch((e) => showToast(t('studio.opFailed', { msg: String(e) }), 'error'));
    },
    [book, showToast],
  );

  const handleUpload = async (files: FileList | null) => {
    if (!bookId || !files || files.length === 0) return;
    setUploading(true);
    try {
      const file = files[0];
      const buf = new Uint8Array(await file.arrayBuffer());
      const saved = await assetApi.save(CATEGORY, coverSub(bookId), file.name, buf);
      // 一书一封面：新图落盘成功后再清旧图，失败不影响新封面生效
      if (cover && cover.path !== saved.path) {
        await assetApi.remove(cover.path).catch(() => {});
      }
      setCover(saved);
      showToast(t('studio.cover.saved'), 'success');
    } catch (e) {
      logger.warn('BookMetaPanel', 'save cover failed', { error: String(e) });
      showToast(t('studio.opFailed', { msg: String(e) }), 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleClear = async () => {
    if (!cover) return;
    if (!window.confirm(t('studio.cover.clearConfirm'))) return;
    try {
      await assetApi.remove(cover.path);
      setCover(null);
      showToast(t('studio.cover.cleared'), 'success');
    } catch (e) {
      logger.warn('BookMetaPanel', 'clear cover failed', { error: String(e) });
      showToast(t('studio.opFailed', { msg: String(e) }), 'error');
    }
  };

  if (!bookId || !book) return null;

  const statusValue = bookStatusDef(book.status).id;

  return (
    <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, p: 1.5 }}>
      <Typography
        sx={{
          fontSize: uiFontSize(11),
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'text.secondary',
          mb: 1,
        }}
      >
        {t('studio.cover.meta')}
      </Typography>

      {/* 书名：就地编辑（与 L1 页签改名 / 写作台 renameBook 同一 setter） */}
      <TextField
        size="small"
        fullWidth
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        placeholder={t('studio.bookMeta.title')}
        slotProps={{
          input: {
            startAdornment: <MenuBookRoundedIcon sx={{ fontSize: uiFontSize(16), color: 'text.disabled', mr: 0.75 }} />,
          },
        }}
        sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(14), fontWeight: 700 } }}
      />

      {/* 体裁 · 载体：显示当前值 + 就地编辑（复用 BookMetaDialog + setBookMeta） */}
      <SectionLabel>{t('studio.bookMeta.genreMedium')}</SectionLabel>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.primary' }}>
          {t(genreLabelKey(book.genre))} · {t(mediumLabelKey(book.medium))}
        </Typography>
        <Tooltip title={t('studio.bookMeta.edit')}>
          <IconButton size="small" onClick={() => setMetaDialogOpen(true)} aria-label={t('studio.bookMeta.edit')}>
            <EditOutlinedIcon sx={{ fontSize: uiFontSize(14) }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 创作状态：连载中 / 已完结 / 暂停更新 / 已弃坑（setBookMeta.status，四态词表唯一） */}
      <SectionLabel>{t('studio.bookMeta.status')}</SectionLabel>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={statusValue}
        onChange={(_e, v) => {
          if (typeof v !== 'string') return;
          commitStatus(v, t(bookStatusDef(v).labelKey));
        }}
        sx={{ '& .MuiToggleButton-root': { fontSize: uiFontSize(11), px: 1, textTransform: 'none' } }}
      >
        {BOOK_STATUSES.map((s) => (
          <ToggleButton key={s.id} value={s.id}>
            {t(s.labelKey)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {/* 简介：多行就地编辑（setBookMeta.description） */}
      <SectionLabel>{t('studio.bookMeta.description')}</SectionLabel>
      <TextField
        size="small"
        fullWidth
        multiline
        minRows={3}
        maxRows={8}
        value={draftDesc}
        onChange={(e) => setDraftDesc(e.target.value)}
        onBlur={commitDesc}
        placeholder={t('studio.cover.noDesc')}
        sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5), lineHeight: 1.7 } }}
      />

      {/* 日更目标：数字（setDailyGoal，0 = 未设） */}
      <SectionLabel>{t('studio.bookMeta.dailyGoal')}</SectionLabel>
      <TextField
        size="small"
        type="number"
        value={draftGoal}
        onChange={(e) => setDraftGoal(e.target.value)}
        onBlur={commitGoal}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        slotProps={{ htmlInput: { min: 0, max: 1000000, step: 100 } }}
        sx={{ width: 140, '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) } }}
      />
      {/* 日更今日进度：goalProgress(actual.today, book.dailyGoal)（与写作台同口径：快照差分末位=今日新增） */}
      {(() => {
        const g = goalProgress(actual?.today ?? 0, book.dailyGoal ?? 0);
        if (!g) return null;
        return (
          <Box sx={{ mt: 0.5, width: 200, maxWidth: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
              <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.secondary' }}>
                {t('studio.bookMeta.dailyToday', {
                  today: (actual?.today ?? 0).toLocaleString(),
                  goal: (book.dailyGoal ?? 0).toLocaleString(),
                })}
              </Typography>
              <Typography
                sx={{ fontSize: uiFontSize(10.5), fontWeight: 600, color: g.hit ? 'success.main' : 'text.secondary' }}
              >
                {g.pct}%{g.hit ? ` · ${t('writing.goalReached')}` : ''}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={g.pct}
              color={g.hit ? 'success' : 'primary'}
              sx={{ height: 5, borderRadius: 3 }}
            />
          </Box>
        );
      })()}

      {/* 全书目标（T2）：目标总字数 / 章节数 / 截止日期 + 达成率进度 + 剩余天数。
          setter（setBookGoal）与派生算法（deriveBookGoalProgress）均与写作台统计弹窗同一权威，
          工作室就地设定与写作台零漂移。窄栏布局：每维度纵向堆叠「目标输入 + 进度条」。 */}
      <SectionLabel>{t('studio.bookMeta.bookGoal')}</SectionLabel>
      <Box sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
          <Typography sx={{ fontSize: uiFontSize(11), fontWeight: 700, color: 'text.secondary' }}>
            {t('studio.bookMeta.goalProgress')}
          </Typography>
          {bookGoalProgress.daysLeft !== null && (
            <Typography
              sx={{
                fontSize: uiFontSize(10.5),
                fontWeight: 600,
                color:
                  bookGoalProgress.daysLeft < 0
                    ? 'error.main'
                    : bookGoalProgress.daysLeft <= 7
                      ? 'warning.main'
                      : 'success.main',
              }}
            >
              {bookGoalProgress.daysLeft < 0
                ? t('writing.goalDeadlineOver', { n: Math.abs(bookGoalProgress.daysLeft) })
                : t('writing.goalDaysLeft', { n: bookGoalProgress.daysLeft })}
            </Typography>
          )}
        </Box>

        {/* 目标总字数 + 达成率 */}
        <Box sx={{ mb: 1 }}>
          <TextField
            size="small"
            type="number"
            fullWidth
            label={t('writing.bookTargetWords')}
            value={draftWords}
            onChange={(e) => setDraftWords(e.target.value)}
            onBlur={commitBookGoal}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            slotProps={{
              htmlInput: { min: 0, step: 1000 },
              input: {
                endAdornment: (
                  <Typography sx={{ fontSize: uiFontSize(10), color: 'text.disabled', ml: 0.5 }}>
                    {t('writing.goalWordUnit')}
                  </Typography>
                ),
              },
            }}
            sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) } }}
          />
          {bookGoalProgress.word ? (
            <Box sx={{ mt: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.secondary' }}>
                  {t('writing.bookWordProgress', {
                    words: (actual?.words ?? 0).toLocaleString(),
                    target: bookGoalProgress.word.target.toLocaleString(),
                  })}
                </Typography>
                <Typography
                  sx={{
                    fontSize: uiFontSize(10.5),
                    fontWeight: 600,
                    color: bookGoalProgress.word.hit ? 'success.main' : 'text.secondary',
                  }}
                >
                  {bookGoalProgress.word.pct}%{bookGoalProgress.word.hit ? ` · ${t('writing.goalReached')}` : ''}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={bookGoalProgress.word.pct}
                color={bookGoalProgress.word.hit ? 'success' : 'primary'}
                sx={{ height: 5, borderRadius: 3 }}
              />
            </Box>
          ) : (
            <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled', mt: 0.5 }}>
              {t('writing.bookGoalUnset')}
            </Typography>
          )}
        </Box>

        {/* 目标章节数 + 达成率 */}
        <Box sx={{ mb: 1 }}>
          <TextField
            size="small"
            type="number"
            fullWidth
            label={t('writing.bookTargetChapters')}
            value={draftChapters}
            onChange={(e) => setDraftChapters(e.target.value)}
            onBlur={commitBookGoal}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            slotProps={{ htmlInput: { min: 0, step: 1 } }}
            sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) } }}
          />
          {bookGoalProgress.chapter ? (
            <Box sx={{ mt: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.secondary' }}>
                  {t('writing.bookChapterProgress', {
                    chapters: actual?.chapters ?? 0,
                    target: bookGoalProgress.chapter.target,
                  })}
                </Typography>
                <Typography
                  sx={{
                    fontSize: uiFontSize(10.5),
                    fontWeight: 600,
                    color: bookGoalProgress.chapter.hit ? 'success.main' : 'text.secondary',
                  }}
                >
                  {bookGoalProgress.chapter.pct}%{bookGoalProgress.chapter.hit ? ` · ${t('writing.goalReached')}` : ''}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={bookGoalProgress.chapter.pct}
                color={bookGoalProgress.chapter.hit ? 'success' : 'primary'}
                sx={{ height: 5, borderRadius: 3 }}
              />
            </Box>
          ) : (
            <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled', mt: 0.5 }}>
              {t('writing.bookChapterUnset')}
            </Typography>
          )}
        </Box>

        {/* 截止日期（YYYY-MM-DD，空 = 未设） */}
        <TextField
          size="small"
          type="date"
          fullWidth
          label={t('writing.bookDeadline')}
          value={draftDeadline}
          onChange={(e) => setDraftDeadline(e.target.value)}
          onBlur={commitBookGoal}
          slotProps={{
            input: { sx: { fontSize: uiFontSize(12.5) } },
            inputLabel: { shrink: true, sx: { fontSize: uiFontSize(12) } },
          }}
        />
        {/* 节奏预测（单一权威 derivePaceProjection，与统计弹窗 / AI 语料逐字同口径）：
            回答创作者「按我现在的真实速度，赶不赶得上截稿 / 差多少 / 要提速到多少」。
            advisory 软提示，仅在有总字数目标且能派生时展示；无产出数据时诚实降级提示。 */}
        {pace && (
          <Box sx={{ mt: 0.75, p: 0.75, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
              <Typography sx={{ fontSize: uiFontSize(10.5), fontWeight: 700, color: 'text.secondary' }}>
                {t('studio.bookMeta.pace')}
              </Typography>
              {(() => {
                const tone =
                  pace.verdict === 'done' || pace.verdict === 'ontrack'
                    ? 'success'
                    : pace.verdict === 'behind'
                      ? 'warning'
                      : pace.verdict === 'stalled' || pace.verdict === 'overdue'
                        ? 'error'
                        : 'primary';
                const labelKey = {
                  done: 'studio.bookMeta.paceVerdictDone',
                  ontrack: 'studio.bookMeta.paceVerdictOntrack',
                  behind: 'studio.bookMeta.paceVerdictBehind',
                  stalled: 'studio.bookMeta.paceVerdictStalled',
                  overdue: 'studio.bookMeta.paceVerdictOverdue',
                  noDeadline: 'studio.bookMeta.paceVerdictNoDeadline',
                  notStarted: 'studio.bookMeta.paceVerdictNotStarted',
                }[pace.verdict];
                return (
                  <Typography
                    sx={{
                      fontSize: uiFontSize(10),
                      fontWeight: 700,
                      bgcolor: `${tone}.main`,
                      color: 'common.white',
                      px: 0.75,
                      py: 0.15,
                      borderRadius: 1,
                    }}
                  >
                    {t(labelKey)}
                  </Typography>
                );
              })()}
            </Box>
            {pace.windowDays === 0 ? (
              <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled' }}>
                {t('studio.bookMeta.paceNoOutput')}
              </Typography>
            ) : (
              <>
                {pace.verdict !== 'notStarted' && (
                  <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.secondary' }}>
                    {t('studio.bookMeta.paceAvg', {
                      n: pace.windowDays,
                      avg: Math.round(pace.avgPerDay).toLocaleString(),
                      d: pace.producedDays,
                    })}
                  </Typography>
                )}
                {pace.verdict === 'behind' && pace.requiredPerDay !== null && (
                  <Typography sx={{ fontSize: uiFontSize(10.5), fontWeight: 600, color: 'warning.main' }}>
                    {t('studio.bookMeta.paceNeed', { need: pace.requiredPerDay.toLocaleString() })}
                    {pace.projectedGap !== null && pace.projectedGap < 0
                      ? ` · ${t('studio.bookMeta.paceMissBy', { n: Math.abs(pace.projectedGap).toLocaleString() })}`
                      : ''}
                  </Typography>
                )}
                {pace.verdict === 'stalled' && pace.requiredPerDay !== null && (
                  <Typography sx={{ fontSize: uiFontSize(10.5), fontWeight: 600, color: 'error.main' }}>
                    {t('studio.bookMeta.paceNeed', { need: pace.requiredPerDay.toLocaleString() })}
                  </Typography>
                )}
                {/* 还没动笔：中性语气给起步参考，不甩红色断更警告（创作者主权：新书≠失职）。 */}
                {pace.verdict === 'notStarted' && pace.requiredPerDay !== null && (
                  <Typography sx={{ fontSize: uiFontSize(10.5), color: 'primary.main' }}>
                    {t('studio.bookMeta.paceStart', { need: pace.requiredPerDay.toLocaleString() })}
                  </Typography>
                )}
                {pace.verdict === 'overdue' && (
                  <Typography sx={{ fontSize: uiFontSize(10.5), fontWeight: 600, color: 'error.main' }}>
                    {t('studio.bookMeta.paceMissBy', { n: pace.remainingWords.toLocaleString() })}
                  </Typography>
                )}
                {pace.verdict === 'noDeadline' && pace.projectedDaysToFinish !== null && (
                  <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.secondary' }}>
                    {t('studio.bookMeta.paceFinishIn', { n: pace.projectedDaysToFinish })}
                  </Typography>
                )}
              </>
            )}
          </Box>
        )}
        {/* 当前体量小结：即便未设目标也让创作者一眼看到进度基线 */}
        {actual && (
          <Typography sx={{ fontSize: uiFontSize(10), color: 'text.disabled', mt: 0.75 }}>
            {t('studio.bookMeta.currentTally', { chapters: actual.chapters, words: actual.words.toLocaleString() })}
          </Typography>
        )}
      </Box>

      {/* 方案 A：解析全书从顶栏迁入书属性卡（书级动作归书属性位）。可选 prop，
          未接回调（如单测挂载）时不渲染，行为与此前完全一致 */}
      {onReparse && (
        <Tooltip title={t('editorPage.parseBookTip')}>
          <Button
            size="small"
            variant="outlined"
            fullWidth
            onClick={onReparse}
            sx={{ mt: 2, textTransform: 'none', fontSize: uiFontSize(11) }}
          >
            {t('editorPage.parseBook')}
          </Button>
        </Tooltip>
      )}

      <SectionLabel>{t('studio.cover.title')}</SectionLabel>
      <Box
        sx={{
          width: 132,
          height: 176,
          borderRadius: 1.5,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          bgcolor: 'action.hover',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {loading ? (
          <CircularProgress size={20} />
        ) : cover ? (
          <CoverPreview path={cover.path} />
        ) : (
          <Box sx={{ textAlign: 'center', color: 'text.disabled', px: 1 }}>
            <MenuBookRoundedIcon sx={{ fontSize: uiFontSize(30), opacity: 0.4 }} />
            <Typography sx={{ fontSize: uiFontSize(10.5), mt: 0.5 }}>{t('studio.cover.empty')}</Typography>
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Button
          size="small"
          variant={cover ? 'outlined' : 'contained'}
          startIcon={
            uploading ? (
              <CircularProgress size={12} color="inherit" />
            ) : (
              <UploadFileRoundedIcon sx={{ fontSize: uiFontSize(14) }} />
            )
          }
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
        >
          {cover ? t('studio.cover.replace') : t('studio.cover.set')}
        </Button>
        {cover && (
          <Button
            size="small"
            color="inherit"
            startIcon={<DeleteOutlineRoundedIcon sx={{ fontSize: uiFontSize(14) }} />}
            onClick={() => void handleClear()}
            sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
          >
            {t('studio.cover.clear')}
          </Button>
        )}
      </Box>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(e) => void handleUpload(e.target.files)}
      />

      {/* 体裁·载体对话框：与书架同一组件、同一 setBookMeta 写路径 */}
      <BookMetaDialog
        open={metaDialogOpen}
        initialGenre={book.genre}
        initialMedium={book.medium}
        onClose={() => setMetaDialogOpen(false)}
        onSave={(genre, medium) => useWritingStore.getState().setBookMeta(book.id, { genre, medium })}
        onSaved={() => showToast(t('studio.bookMeta.saved'), 'success')}
        onError={(e) => showToast(t('studio.opFailed', { msg: String(e) }), 'error')}
      />
    </Box>
  );
}
