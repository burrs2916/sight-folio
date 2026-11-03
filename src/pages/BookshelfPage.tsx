// 书架（左侧导航第一项 · 首页）：创作者的作品卡片墙。
//
// 定位（2026-09-21 用户拍板）：这一页**只做书卡展示**——封面、分类、完结状态、
// 卷/章/字数、最近更新。跨维度分析（KPI / 风险预警 / 日更趋势）是工作室《全书总览》
// 仪表盘的职责，这里不重复。
//
// 布局（2026-09-21 二次返工）：竖版海报卡（封面在上 3:4、信息在下）auto-fill 网格，
// 整卡点击 = 打开工作室，写作台入口在封面 hover 动作层（去掉每卡一行按钮的笨重感）。
// 外层内容壳已带 24px padding，本页不再叠加横向 padding / maxWidth（修双重边距）。
//
// 数据口径：
// - 封面：素材库 assets/writing/covers-{bookId}/（与工作室书属性卡 BookMetaPanel
//   同一条链路，**有文件=有封面**，零后端改动）；无封面回退 coverColor 色块 + 书名首字。
// - 完结状态：book.status 四态口径（唯一词表见 utils/writingSchema BOOK_STATUSES），
//   书卡这枚 Chip **可点直接改**（2026-11-03 插单六：此前书架只展示、写作台从未实现
//   承诺的编辑入口，导致状态实际只能在画布工作台右栏改，等于改不动）。
// - 分类：book.genre 经 genreDef 本地化（不再显示原始 id）。
// - 卷/章/字数：逐书 listChapters 元数据（不碰正文内容）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import { useWritingStore } from '../store/writingStore';
import { assetApi, writingApi, type WritingBook } from '../services/tauri';
import { genreDef } from '../utils/writingSchema';
import { uiFontSize } from '../theme/appearanceScales';
import { BookStatusChip } from './BookStatusControl';
import { openBookInStudio, createBookNamed } from '../utils/studioBook';
import { NewBookDialog, type NewBookResult } from './NewBookDialog';
import { BookInfoDialog } from './BookInfoDialog';
import { useToastStore } from '../store/toastStore';
import { t, getLang } from '../i18n';
import { openWritingDesk as openWritingDeskWindow } from '../utils/writingDeskWindow';
import { formatBigCount } from '../utils/formatCount';
import { resolveVolumeResolver, contentChapters, volumeNameOf } from '../utils/writingStats';

interface BookStats {
  chapterCount: number;
  wordCount: number;
  volumeCount: number;
  lastUpdated: number;
}

const chipSx = { height: 17, fontSize: 9, '& .MuiChip-label': { px: 0.6 } } as const;

export default function BookshelfPage() {
  const navigate = useNavigate();
  const showToast = useToastStore((s) => s.showToast);
  const books = useWritingStore((s) => s.books);
  const booksLoading = useWritingStore((s) => s.booksLoading);
  const loadBooks = useWritingStore((s) => s.loadBooks);

  const [stats, setStats] = useState<Record<string, BookStats>>({});
  const [covers, setCovers] = useState<Record<string, string | null>>({});
  const [opening, setOpening] = useState<string | null>(null);
  // 「作品信息」对话框（插单七）：状态 + 体裁×载体一次改完。
  // 插单六那枚可点 chip 被李先生驳回为「没人知道能点」，故补常驻文字按钮当主入口。
  const [infoBook, setInfoBook] = useState<WritingBook | null>(null);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  // 逐书拉章节汇总（书数量级是个位数到两位数，串行拉取足够快；
  // 只取 wordCount/status/volume 元数据，不碰正文内容）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, BookStats> = {};
      for (const b of books) {
        try {
          const chapters = await writingApi.listChapters(b.id);
          if (cancelled) return;
          const r = resolveVolumeResolver(chapters);
          const content = contentChapters(r, chapters);
          const volumes = new Set(content.map((c) => volumeNameOf(r, c)).filter(Boolean));
          next[b.id] = {
            chapterCount: content.length,
            wordCount: content.reduce((sum, c) => sum + (c.wordCount || 0), 0),
            volumeCount: volumes.size,
            lastUpdated: chapters.reduce((max, c) => Math.max(max, c.updatedAt || 0), b.updatedAt || 0),
          };
        } catch {
          if (cancelled) return;
          next[b.id] = { chapterCount: 0, wordCount: 0, volumeCount: 0, lastUpdated: b.updatedAt || 0 };
        }
      }
      if (!cancelled) setStats(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [books]);

  // 逐书取封面：素材库 covers-{bookId} 第一个文件 → 缩略图（有文件=有封面，无则回退占位）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string | null> = {};
      for (const b of books) {
        try {
          const assets = await assetApi.list('writing', `covers-${b.id}`);
          if (cancelled) return;
          const first = assets[0];
          next[b.id] = first ? await assetApi.thumbnail(first.path, 480) : null;
        } catch {
          if (cancelled) return;
          next[b.id] = null;
        }
      }
      if (!cancelled) setCovers(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [books]);

  const totals = useMemo(
    () => ({
      bookCount: books.length,
      chapterCount: Object.values(stats).reduce((s, x) => s + x.chapterCount, 0),
      wordCount: Object.values(stats).reduce((s, x) => s + x.wordCount, 0),
    }),
    [books, stats],
  );

  const openStudio = useCallback(
    async (book: WritingBook) => {
      setOpening(book.id);
      try {
        await openBookInStudio(book.id, book.title);
        navigate('/analyzer');
      } catch (e) {
        showToast(t('dashboard.openFail', { msg: String(e) }), 'error');
      } finally {
        setOpening(null);
      }
    },
    [navigate, showToast],
  );

  const openWritingDesk = useCallback(async (book: WritingBook) => {
    // 写作台 = 独立窗口：定位参数由窗口内部消费（焦点事件/query），主窗无需先 setActiveBook
    await openWritingDeskWindow({ bookId: book.id });
  }, []);

  // 羽化 P：显式「新建作品」入口改走命名向导，消除「新建作品 N」丑默认名
  const [newBookOpen, setNewBookOpen] = useState(false);
  const handleBookCreated = useCallback(
    (b: NewBookResult) => {
      showToast(t('dashboard.createdBook', { title: b.title }), 'success');
    },
    [showToast],
  );
  const handleBookCreateError = useCallback(
    (e: unknown) => showToast(t('dashboard.createFail', { msg: String(e) }), 'error'),
    [showToast],
  );

  const fmtDate = (ts: number) =>
    ts > 0 ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

  return (
    <Box sx={{ py: 0.5 }}>
      {/* 头部：标题 + 合计一行（新建/导入入口在空态引导与工作室 L1 栏，头部不放按钮） */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 19, fontWeight: 700 }}>{t('dashboard.welcome')}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1, minWidth: 120 }}>
          {t('dashboard.totals', {
            b: totals.bookCount,
            c: totals.chapterCount,
            w: totals.wordCount.toLocaleString(),
          })}
        </Typography>
      </Box>

      {/* 书架：竖版海报卡 auto-fill 网格 */}
      {booksLoading ? null : books.length === 0 ? (
        <Box sx={{ py: 10, textAlign: 'center' }}>
          <MenuBookRoundedIcon sx={{ fontSize: 52, color: 'text.disabled', mb: 1 }} />
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.secondary' }}>
            {t('dashboard.emptyTitle')}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'text.disabled', mb: 2 }}>{t('dashboard.emptyDesc')}</Typography>
          <Button size="small" variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setNewBookOpen(true)}>
            {t('studio.newBook')}
          </Button>
        </Box>
      ) : (
        <Box
          sx={{
            mt: 2.5,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(164px, 1fr))',
            gap: 2,
          }}
        >
          {books.map((b) => {
            const st = stats[b.id];
            const cover = covers[b.id];
            const gd = genreDef(b.genre);
            return (
              <Box
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => void openStudio(b)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') void openStudio(b);
                }}
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  cursor: opening === b.id ? 'wait' : 'pointer',
                  transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    borderColor: b.coverColor || 'primary.main',
                    boxShadow: 3,
                    '& .shelf-cover-actions': { opacity: 1 },
                  },
                }}
              >
                {/* 封面 3:4（无封面回退 coverColor + 书名首字） */}
                <Box
                  sx={{
                    position: 'relative',
                    width: '100%',
                    aspectRatio: '3 / 4',
                    bgcolor: b.coverColor || 'primary.main',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {cover ? (
                    <img
                      src={cover}
                      alt={b.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <Typography
                      sx={{
                        fontSize: 36,
                        fontWeight: 800,
                        color: 'common.white',
                        textShadow: '0 1px 6px rgba(0,0,0,0.35)',
                      }}
                    >
                      {(b.title || '?').slice(0, 1)}
                    </Typography>
                  )}
                  {/* hover 动作层：工作室 / 写作台（避免每卡一行按钮） */}
                  <Box
                    className="shelf-cover-actions"
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1,
                      bgcolor: 'rgba(15,20,30,0.45)',
                      opacity: 0,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <Tooltip title={t('dashboard.openStudio')}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openStudio(b);
                        }}
                        sx={{ bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
                        aria-label={t('dashboard.openStudio')}
                      >
                        <DashboardRoundedIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('dashboard.openWritingDesk')}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openWritingDesk(b);
                        }}
                        sx={{ bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
                        aria-label={t('dashboard.openWritingDesk')}
                      >
                        <EditRoundedIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('writing.bookInfo.title')}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setInfoBook(b);
                        }}
                        sx={{ bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
                        aria-label={t('writing.bookInfo.title')}
                      >
                        <LocalOfferRoundedIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
                {/* 信息区 */}
                <Box sx={{ p: 1.25 }}>
                  <Typography noWrap title={b.title} sx={{ fontSize: 13, fontWeight: 600 }}>
                    {b.title}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                    {gd && <Chip size="small" label={t(gd.labelKey)} sx={chipSx} />}
                    <BookStatusChip bookId={b.id} status={b.status} chipSx={chipSx} />
                  </Box>
                  <Typography sx={{ fontSize: 10.5, color: 'text.secondary', mt: 0.6 }}>
                    {st
                      ? t('dashboard.bookStats', {
                          v: st.volumeCount,
                          c: st.chapterCount,
                          w: formatBigCount(st.wordCount, getLang()),
                        })
                      : t('dashboard.loadingStats')}
                  </Typography>
                  <Typography sx={{ fontSize: 9.5, color: 'text.disabled', mt: 0.25 }}>
                    {st && st.lastUpdated > 0 ? t('dashboard.lastUpdated', { d: fmtDate(st.lastUpdated) }) : ''}
                  </Typography>
                  {/* 插单七主入口：**常驻**带文字按钮（不是 hover 才出现的图标、也不是一枚看着像徽章的 chip）。
                      李先生的原话是「悬浮到连载中上面再去改，谁知道该怎么改」——入口必须自己写着它干什么。 */}
                  <Button
                    size="small"
                    startIcon={<TuneRoundedIcon sx={{ fontSize: uiFontSize(14) }} />}
                    onClick={(e) => {
                      e.stopPropagation();
                      setInfoBook(b);
                    }}
                    sx={{
                      mt: 0.5,
                      mb: -0.5,
                      px: 0.5,
                      ml: -0.5,
                      minHeight: 0,
                      textTransform: 'none',
                      fontSize: uiFontSize(10.5),
                      color: 'text.secondary',
                      '&:hover': { color: 'primary.main', bgcolor: 'transparent' },
                    }}
                  >
                    {t('writing.bookInfo.title')}
                  </Button>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
      <NewBookDialog
        open={newBookOpen}
        onClose={() => setNewBookOpen(false)}
        onCreate={createBookNamed}
        onCreated={handleBookCreated}
        onError={handleBookCreateError}
      />
      {infoBook && <BookInfoDialog book={infoBook} onClose={() => setInfoBook(null)} />}
    </Box>
  );
}
