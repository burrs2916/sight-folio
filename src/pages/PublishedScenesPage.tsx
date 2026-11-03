// ═══════════════════════════════════════════════════════════════════════
//  完结作品页（B5a 重做：需求 §7 的两级结构）
//
//  旧病灶（需求 §1.1）：本页曾是「产物登记表 completed_works 的可视化」，
//  和「书被标成已完结」零关联 → 用户标完结后在这里看不到自己的书。
//  新模型（需求 §2，D1）：书 → 锁定版本 → 导出产物。一级是**书卡片**
//  （书名一律从 writing_books 现取，不存副本，改名即刻生效），二级是
//  **版本时间线**（work_versions 快照明细）。「已标完结 · 尚无版本」的书
//  同样成卡可见并直接给「去写作台锁定一版」出口（R1 / §9 验收 1）。
//
//  B4b 接线完成：导出弹窗（格式多选→入队）、导出任务面板（轮询 + 原地重试 + 移除）、
//  产物区（取回 / 复制到其他位置 / 按版本重新生成 / 缺失如实呈现）。
//  旧产物登记表的导入/移动/批量操作随旧表在 B6 退役，本页不再挂接。
// ═══════════════════════════════════════════════════════════════════════
import { useState, useMemo, useCallback, useEffect } from 'react';
import { alpha } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Skeleton from '@mui/material/Skeleton';
import CircularProgress from '@mui/material/CircularProgress';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LockIcon from '@mui/icons-material/Lock';
import DeleteIcon from '@mui/icons-material/Delete';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import CloseIcon from '@mui/icons-material/Close';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { t, getLang } from '../i18n';
import { useToastStore } from '../store/toastStore';
import { useWritingStore } from '../store/writingStore';
import { workVersionApi, type ArtifactView, type ExportArtifact, type WorkVersion, type WorkVersionChapter, type WorksLibraryRootInfo } from '../services/workVersion';
import ExportVersionDialog from './publishedPage/ExportVersionDialog';
import { invoke } from '../services/core';
import { logger } from '../utils/logger';
import { uiFontSize } from '../theme/appearanceScales';
import { isBookFinished } from '../utils/writingSchema';
import { openWritingDesk } from '../utils/writingDeskWindow';
import type { WritingBook } from '../services/writing';

// ─── 小工具（页面私有呈现层） ───

function formatWordCount(n: number): string {
  if (n >= 10000) {
    return getLang() === 'en-US'
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k words`
      : `${(n / 10000).toFixed(1)}万字`;
  }
  return getLang() === 'en-US' ? `${n} words` : `${n}字`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 产物字节数呈现（KB/MB 一档就够，成品页不是十六进制查看器） */
function formatFileSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${n} B`;
}

/** 一级卡片数据：书（现取）+ 它的全部锁定版本（可能为空数组 —— R1 要求这样的书也必须出现） */
interface BookCardData {
  book: WritingBook;
  versions: WorkVersion[];
}

type FinalFilter = '' | 'has' | 'none';
type SortKey = 'recent' | 'oldest' | 'name';

const SEARCH_STORAGE_KEY = 'published-search-query';

// ───────────────────────────────────────────────
//  主组件
// ───────────────────────────────────────────────

export default function PublishedScenesPage() {
  const books = useWritingStore((s) => s.books);
  const loadBooks = useWritingStore((s) => s.loadBooks);
  const showToast = useToastStore((s) => s.showToast);

  const [loading, setLoading] = useState(true);
  const [versionsByBook, setVersionsByBook] = useState<Record<string, WorkVersion[]>>({});
  const [rootInfo, setRootInfo] = useState<WorksLibraryRootInfo | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(() => {
    try {
      return localStorage.getItem(SEARCH_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [finalFilter, setFinalFilter] = useState<FinalFilter>('');
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  // 二级视图：非空 = 正在看这本书的版本时间线
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, WorkVersionChapter[]>>({});
  const [snapshotLoadingId, setSnapshotLoadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkVersion | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [finalBusyId, setFinalBusyId] = useState<string | null>(null);
  // ── B4b：导出弹窗 / 任务面板 / 产物读数 ──
  const [exportTarget, setExportTarget] = useState<WorkVersion | null>(null);
  const [jobs, setJobs] = useState<ExportArtifact[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactView[]>([]);
  const [jobBusyId, setJobBusyId] = useState<string | null>(null);

  // ── 数据加载：书 + 每本书的版本清单 ──
  // 版本按书逐本拉（desktop 本地 IPC，量级无碍）；书名一律现取，此处不缓存任何 title 副本。
  const load = useCallback(async () => {
    try {
      await loadBooks().catch((e: unknown) => {
        logger.warn('PublishedScenesPage', 'loadBooks failed', { error: e });
      });
      const latest = useWritingStore.getState().books;
      const entries = await Promise.all(
        latest.map(async (b) => {
          try {
            return [b.id, await workVersionApi.list(b.id)] as const;
          } catch (e) {
            logger.warn('PublishedScenesPage', 'list versions failed', { error: e, bookId: b.id });
            return [b.id, [] as WorkVersion[]] as const;
          }
        }),
      );
      setVersionsByBook(Object.fromEntries(entries));
    } catch (e) {
      logger.warn('PublishedScenesPage', 'load failed', { error: e });
      showToast(t('published.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [loadBooks, showToast]);

  // 作品库根读数：读取失败**如实上屏**（§4 禁静默降级），这里没有任何备用路径可画。
  const loadRoot = useCallback(async () => {
    try {
      setRootInfo(await workVersionApi.getLibraryRoot());
      setRootError(null);
    } catch (e) {
      setRootInfo(null);
      setRootError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // ── B4b：任务与产物读数（声明在挂载/轮询 effect 之前，deps 数组当场取值不吃 TDZ 亏）──
  // 任务表就是产物表（同一张 export_artifacts 的状态视图）。读数失败只记日志：
  // 面板不在场本身就是「暂时看不到」的如实表达，不该拿 toast 打断浏览。
  const loadJobs = useCallback(async () => {
    try {
      setJobs(await workVersionApi.listExportJobs());
    } catch (e) {
      logger.warn('PublishedScenesPage', 'list export jobs failed', { error: e });
    }
  }, []);

  const loadArtifacts = useCallback(async (bookId: string) => {
    try {
      setArtifacts(await workVersionApi.listArtifacts(bookId));
    } catch (e) {
      logger.warn('PublishedScenesPage', 'list artifacts failed', { error: e, bookId });
    }
  }, []);

  useEffect(() => {
    // 挂载首刷走宏任务（本仓口径，见 WritingTodayChip）：setState 全在 await 之后
    const kick = setTimeout(() => {
      void load();
      void loadRoot();
      void loadJobs();
    }, 0);
    return () => clearTimeout(kick);
  }, [load, loadRoot, loadJobs]);

  // 写作台保存/锁定后回来能刷到新版本
  useEffect(() => {
    const onSaved = () => void load();
    window.addEventListener('writing-saved', onSaved);
    return () => window.removeEventListener('writing-saved', onSaved);
  }, [load]);

  // §9-7「任务逐个可见进度」：页面只定频重读，不做进度推算（后端 600ms 一拍，
  // 这里 2.5s 一问已够跟手；导出是重操作，轮询频率不值得再高）。
  useEffect(() => {
    const timer = setInterval(() => {
      void loadJobs();
      if (openBookId) void loadArtifacts(openBookId);
    }, 2500);
    return () => clearInterval(timer);
  }, [loadJobs, loadArtifacts, openBookId]);

  // 搜索词持久化
  useEffect(() => {
    try {
      localStorage.setItem(SEARCH_STORAGE_KEY, searchQuery);
    } catch {
      /* ignore */
    }
  }, [searchQuery]);

  const refreshBookVersions = useCallback(async (bookId: string) => {
    try {
      const versions = await workVersionApi.list(bookId);
      setVersionsByBook((prev) => ({ ...prev, [bookId]: versions }));
    } catch (e) {
      logger.warn('PublishedScenesPage', 'refresh versions failed', { error: e, bookId });
    }
  }, []);

  // ── 一级卡片派生（R1 的落点）──
  // 入选口径：已标完结 **或** 已锁定过版本。「标了完结但 0 版本」必须成卡（§9-1）；
  // 「还在连载但用户随手锁过版」也成卡，版本是既成事实，不该被完结声明遮蔽。
  const cards = useMemo<BookCardData[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = books
      .filter((b) => isBookFinished(b.status) || (versionsByBook[b.id]?.length ?? 0) > 0)
      .map((book) => ({ book, versions: versionsByBook[book.id] ?? [] }))
      .filter(({ book, versions }) => {
        if (q && !book.title.toLowerCase().includes(q)) return false;
        if (finalFilter === 'has' && !versions.some((v) => v.isFinal)) return false;
        if (finalFilter === 'none' && versions.some((v) => v.isFinal)) return false;
        return true;
      });
    const latestTs = (c: BookCardData) =>
      c.versions.reduce((m, v) => Math.max(m, v.lockedAt), 0) || c.book.updatedAt;
    list.sort((a, b) => {
      if (sortBy === 'name') return a.book.title.localeCompare(b.book.title, 'zh-CN');
      const d = sortBy === 'oldest' ? latestTs(a) - latestTs(b) : latestTs(b) - latestTs(a);
      return d !== 0 ? d : a.book.title.localeCompare(b.book.title, 'zh-CN');
    });
    return list;
  }, [books, versionsByBook, searchQuery, finalFilter, sortBy]);

  const openBook = useCallback((bookId: string) => {
    setOpenBookId(bookId);
    setExpandedVersionId(null);
    void loadArtifacts(bookId);
  }, [loadArtifacts]);

  const backToBooks = useCallback(() => {
    setOpenBookId(null);
    setExpandedVersionId(null);
    setArtifacts([]); // 产物读数跟着书走，回一级不留残影
  }, []);

  const openDesk = useCallback((bookId: string) => {
    void openWritingDesk({ bookId }).catch((e: unknown) => {
      logger.warn('PublishedScenesPage', 'open writing desk failed', { error: e, bookId });
    });
  }, []);

  // ── 定稿切换（D6：全书至多一个，后端同事务原子换，前端只管刷回读数）──
  const handleSetFinal = useCallback(
    async (version: WorkVersion) => {
      setFinalBusyId(version.id);
      try {
        await workVersionApi.setFinal(version.bookId, version.id);
        await refreshBookVersions(version.bookId);
        showToast(t('published.setFinalDone', { n: version.seq }), 'success');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('PublishedScenesPage', 'set final failed', { error: e, versionId: version.id });
        showToast(t('published.setFinalFailed', { msg }), 'error');
      } finally {
        setFinalBusyId(null);
      }
    },
    [refreshBookVersions, showToast],
  );

  // ── 删除版本（§5.3：二次确认；本片只断记录，产物文件的勾选删除随 B5b 补）──
  const confirmDeleteVersion = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    try {
      const relPaths = await workVersionApi.delete(target.id);
      await refreshBookVersions(target.bookId);
      // 后端删版本会连带抹产物记录（B1 口径），这边的产物读数也要跟着重取
      if (openBookId === target.bookId) await loadArtifacts(target.bookId);
      await loadJobs();
      setSnapshots((prev) => {
        const n = { ...prev };
        delete n[target.id];
        return n;
      });
      setDeleteTarget(null);
      setExpandedVersionId((cur) => (cur === target.id ? null : cur));
      showToast(t('published.versionDeleted', { n: target.seq }), 'success');
      if (relPaths.length > 0) {
        showToast(t('published.deletedFilesRetainedHint', { n: relPaths.length }), 'info');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('PublishedScenesPage', 'delete version failed', { error: e, versionId: target.id });
      showToast(t('published.deleteVersionFailed', { msg }), 'error');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, refreshBookVersions, showToast, openBookId, loadArtifacts, loadJobs]);

  // ── B4b：任务操作与产物动作 ──
  // 重试/移除走 §5.2 的后端口径（只有 failed 可重试、running 不可移除），前端不另判一套。
  const runJobAction = useCallback(
    async (jobId: string, action: (id: string) => Promise<void>) => {
      setJobBusyId(jobId);
      try {
        await action(jobId);
        await loadJobs();
        if (openBookId) await loadArtifacts(openBookId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(t('published.jobActionFailed', { msg }), 'error');
      } finally {
        setJobBusyId(null);
      }
    },
    [loadJobs, loadArtifacts, openBookId, showToast],
  );

  const handleEnqueued = useCallback(
    (queued: ExportArtifact[]) => {
      void loadJobs();
      if (queued[0]) void loadArtifacts(queued[0].bookId);
    },
    [loadJobs, loadArtifacts],
  );

  const revealArtifact = useCallback(
    async (artifact: ArtifactView) => {
      try {
        await workVersionApi.revealArtifact(artifact.id);
      } catch (e) {
        // §9-10：解析不到就原样上屏（错误带绝对路径）；后端已把记录改判 missing，重取读数
        const msg = e instanceof Error ? e.message : String(e);
        showToast(t('published.retrieveFailed', { msg }), 'error');
        if (openBookId) void loadArtifacts(openBookId);
      }
    },
    [openBookId, showToast, loadArtifacts],
  );

  const copyArtifact = useCallback(
    async (artifact: ArtifactView) => {
      const fileName = artifact.fileRelPath.split('/').pop() || `${artifact.format}.export`;
      let dest: string | null = null;
      try {
        dest = await saveDialog({ defaultPath: fileName });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(t('published.artifactCopyFailed', { msg }), 'error');
        return;
      }
      if (!dest) return; // 用户取消选择：不装成功也不报错
      try {
        await workVersionApi.copyArtifactTo(artifact.id, dest);
        showToast(t('published.artifactCopied', { path: dest }), 'success');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(t('published.artifactCopyFailed', { msg }), 'error');
      }
    },
    [showToast],
  );

  const regenerateArtifact = useCallback(
    async (artifact: ArtifactView) => {
      try {
        const queued = await workVersionApi.enqueueExport(artifact.versionId, [artifact.format]);
        showToast(t('published.exportEnqueued', { formats: queued.map((j) => j.format).join(' / ') }), 'success');
        await loadJobs();
        await loadArtifacts(artifact.bookId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(t('published.exportEnqueueFailed', { msg }), 'error');
      }
    },
    [loadJobs, loadArtifacts, showToast],
  );

  // 任务行要显示「哪本书的 v 几」：版本从已加载的读数反查，书名一律现取（不存副本）
  const versionById = useMemo(() => {
    const m = new Map<string, WorkVersion>();
    Object.values(versionsByBook).forEach((list) => list.forEach((v) => m.set(v.id, v)));
    return m;
  }, [versionsByBook]);

  // ── 版本详情：快照章节按需拉一次并缓存（不可变快照，缓存永远新鲜）──
  const toggleVersionDetail = useCallback(
    async (versionId: string) => {
      if (expandedVersionId === versionId) {
        setExpandedVersionId(null);
        return;
      }
      setExpandedVersionId(versionId);
      if (snapshots[versionId]) return;
      setSnapshotLoadingId(versionId);
      try {
        const chapters = await workVersionApi.snapshot(versionId);
        setSnapshots((prev) => ({ ...prev, [versionId]: chapters }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('PublishedScenesPage', 'load snapshot failed', { error: e, versionId });
        showToast(t('published.snapshotFailed', { msg }), 'error');
      } finally {
        setSnapshotLoadingId(null);
      }
    },
    [expandedVersionId, snapshots, showToast],
  );

  const revealRoot = useCallback(async () => {
    if (!rootInfo) return;
    try {
      await invoke('reveal_in_file_manager', { path: rootInfo.path });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('PublishedScenesPage', 'reveal library root failed', { error: e });
      showToast(t('published.rootOpenFailed', { msg }), 'error');
    }
  }, [rootInfo, showToast]);

  // 二级视图的书目现取：即使被一级搜索滤掉，已打开的书也不该从标题栏消失
  const openBookData = openBookId ? books.find((b) => b.id === openBookId) ?? null : null;
  const openVersions = useMemo(
    () => (openBookId ? [...(versionsByBook[openBookId] ?? [])].sort((a, b) => b.seq - a.seq) : []),
    [openBookId, versionsByBook],
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── 页头：一级=标题+作品库指示；二级=返回+书名（一律现取） ── */}
      <Box sx={{ px: 3, pt: 3, pb: 1.5, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {openBookId && (
            <IconButton size="small" onClick={backToBooks} aria-label={t('published.backToBooks')} data-testid="published-back">
              <ArrowBackIcon sx={{ fontSize: uiFontSize(20) }} />
            </IconButton>
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: uiFontSize(18), fontWeight: 700 }} noWrap data-testid="published-page-title">
              {openBookData ? openBookData.title : t('published.title')}
            </Typography>
            {!openBookId && (
              <Typography sx={{ fontSize: uiFontSize(12) }} color="text.secondary">
                {t('published.subtitleV2')}
              </Typography>
            )}
          </Box>
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            {rootInfo && (
              <Tooltip title={rootInfo.path}>
                <Chip
                  size="small"
                  variant="outlined"
                  data-testid="published-root-chip"
                  label={t('published.rootChipLabel', { path: rootInfo.path })}
                  onClick={() => void revealRoot()}
                  sx={{ maxWidth: 360, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }}
                />
              </Tooltip>
            )}
            {rootInfo && (
              <Tooltip title={t('published.rootOpen')}>
                <IconButton size="small" onClick={() => void revealRoot()} data-testid="published-root-open">
                  <FolderOpenIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t('published.refresh')}>
              <IconButton size="small" onClick={() => { void load(); void loadRoot(); void loadJobs(); }} data-testid="published-refresh">
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        {rootError && (
          <Typography
            data-testid="published-root-error"
            sx={{ fontSize: uiFontSize(11.5), color: 'error.main', mt: 0.75, display: 'block', wordBreak: 'break-all' }}
          >
            {t('published.rootLoadFailed', { reason: rootError })}
          </Typography>
        )}
      </Box>

      {/* ── 导出任务面板（B4b，§5.2-1：入队后页面照常写作，任务逐个可见进度）── */}
      {jobs.length > 0 && (
        <Box
          data-testid="published-jobs"
          sx={{
            mx: 3,
            mb: 1.5,
            p: 1.25,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'primary.light',
            bgcolor: 'background.paper',
            flexShrink: 0,
          }}
        >
          <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 700, mb: 0.5 }}>
            {t('published.jobsPanelTitle', { n: jobs.length })}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {jobs.map((job) => {
              const v = versionById.get(job.versionId);
              const book = books.find((b) => b.id === job.bookId);
              return (
                <Box key={job.id} data-testid={`published-job-${job.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Chip
                    size="small"
                    label={`${book?.title ?? '—'} · ${v ? `v${v.seq}` : '—'} · ${job.format.toUpperCase()}`}
                    sx={{ height: 20, fontSize: uiFontSize(11), maxWidth: 340 }}
                  />
                  {job.status === 'queued' && (
                    <Chip size="small" variant="outlined" label={t('published.jobQueued')} sx={{ height: 20, fontSize: uiFontSize(10.5) }} />
                  )}
                  {job.status === 'running' && (
                    <Chip size="small" variant="outlined" color="primary" label={t('published.jobRunning')} sx={{ height: 20, fontSize: uiFontSize(10.5) }} />
                  )}
                  {job.status === 'failed' && (
                    <>
                      <Chip size="small" color="error" label={t('published.jobFailed')} sx={{ height: 20, fontSize: uiFontSize(10.5) }} data-testid={`published-job-failed-${job.id}`} />
                      <Typography title={job.error} noWrap sx={{ fontSize: uiFontSize(10.5), color: 'error.main', maxWidth: 320 }}>
                        {job.error}
                      </Typography>
                      <Button size="small" disabled={jobBusyId === job.id} onClick={() => void runJobAction(job.id, workVersionApi.retryExportJob)} data-testid={`published-job-retry-${job.id}`}>
                        {t('published.jobRetry')}
                      </Button>
                    </>
                  )}
                  {(job.status === 'queued' || job.status === 'failed') && (
                    <Tooltip title={t('published.jobDismiss')}>
                      <IconButton size="small" disabled={jobBusyId === job.id} onClick={() => void runJobAction(job.id, workVersionApi.dismissExportJob)} data-testid={`published-job-dismiss-${job.id}`}>
                        <CloseIcon sx={{ fontSize: uiFontSize(15) }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* ── 一级筛选栏 ── */}
      {!openBookId && (
        <Box sx={{ px: 3, pb: 2, flexShrink: 0, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder={t('published.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ minWidth: 200, flex: 1, maxWidth: 320 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: uiFontSize(18), color: 'text.secondary' }} />
                  </InputAdornment>
                ),
              },
            }}
          />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <Select
              value={finalFilter}
              onChange={(e) => setFinalFilter(e.target.value as FinalFilter)}
              data-testid="published-final-filter"
            >
              <MenuItem value="">{t('published.filterFinalAll')}</MenuItem>
              <MenuItem value="has">{t('published.filterHasFinal')}</MenuItem>
              <MenuItem value="none">{t('published.filterNoFinal')}</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
              <MenuItem value="recent">{t('published.sortRecent')}</MenuItem>
              <MenuItem value="oldest">{t('published.sortOldest')}</MenuItem>
              <MenuItem value="name">{t('published.sortName')}</MenuItem>
            </Select>
          </FormControl>
          <Chip size="small" label={t('published.bookCount', { n: cards.length })} sx={{ ml: 'auto', fontWeight: 500 }} />
        </Box>
      )}
      {/* ── 内容区 ── */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 3, pb: 3 }}>
        {openBookId ? (
          openVersions.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, pt: 8 }}>
              <WarningAmberIcon sx={{ fontSize: uiFontSize(34), color: 'warning.main' }} />
              <Typography sx={{ fontSize: uiFontSize(13), color: 'text.secondary', textAlign: 'center' }}>
                {t('published.timelineEmpty')}
              </Typography>
              <Button
                variant="contained"
                size="small"
                onClick={() => openDesk(openBookId)}
                startIcon={<LockIcon sx={{ fontSize: uiFontSize(15) }} />}
                data-testid="published-l2-lock"
              >
                {t('published.goLockVersion')}
              </Button>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, maxWidth: 860 }}>
              {openVersions.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  expanded={expandedVersionId === v.id}
                  snapshot={snapshots[v.id]}
                  snapshotLoading={snapshotLoadingId === v.id}
                  finalBusy={finalBusyId === v.id}
                  artifacts={artifacts.filter((a) => a.versionId === v.id)}
                  jobBusyId={jobBusyId}
                  onToggleDetail={() => void toggleVersionDetail(v.id)}
                  onSetFinal={() => void handleSetFinal(v)}
                  onDelete={() => setDeleteTarget(v)}
                  onExport={() => setExportTarget(v)}
                  onReveal={(a) => void revealArtifact(a)}
                  onCopy={(a) => void copyArtifact(a)}
                  onRegenerate={(a) => void regenerateArtifact(a)}
                  onJobAction={(jobId, action) => void runJobAction(jobId, action)}
                />
              ))}
            </Box>
          )
        ) : loading ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rounded" height={132} sx={{ bgcolor: 'action.hover' }} />
            ))}
          </Box>
        ) : cards.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, pt: 10 }}>
            <LibraryBooksIcon sx={{ fontSize: uiFontSize(44), color: 'text.disabled' }} />
            <Typography sx={{ fontSize: uiFontSize(15), fontWeight: 650 }}>{t('published.emptyTitleV2')}</Typography>
            <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary', textAlign: 'center', maxWidth: 420, lineHeight: 1.7 }}>
              {t('published.emptyHintV2')}
            </Typography>
            {(searchQuery || finalFilter) && (
              <Button
                size="small"
                onClick={() => {
                  setSearchQuery('');
                  setFinalFilter('');
                }}
              >
                {t('published.clearFilters')}
              </Button>
            )}
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
            {cards.map((c) => (
              <BookWorksCard key={c.book.id} card={c} onOpen={openBook} onLock={openDesk} />
            ))}
          </Box>
        )}
      </Box>

      {/* ── 删除版本二次确认（§5.3）── */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: uiFontSize(15.5), fontWeight: 650 }}>
          {t('published.confirmDeleteVersion', { n: deleteTarget?.seq ?? '' })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: uiFontSize(12.5) }}>{t('published.confirmDeleteVersionDesc')}</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button size="small" onClick={() => setDeleteTarget(null)} disabled={deleting}>
            {t('published.cancel')}
          </Button>
          <Button size="small" color="error" variant="contained" onClick={() => void confirmDeleteVersion()} disabled={deleting} data-testid="published-delete-confirm">
            {deleting ? <CircularProgress size={14} sx={{ mr: 0.75, color: 'inherit' }} /> : null}
            {t('published.deleteVersion')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── 导出弹窗（B4b）：多选格式 → 入队，任务面板接后续进度 ── */}
      <ExportVersionDialog version={exportTarget} onClose={() => setExportTarget(null)} onEnqueued={handleEnqueued} />
    </Box>
  );
}

// ═══════════════════════════════════════════════════
//  一级：书卡片
// ═══════════════════════════════════════════════════

function BookWorksCard({
  card,
  onOpen,
  onLock,
}: {
  card: BookCardData;
  onOpen: (bookId: string) => void;
  onLock: (bookId: string) => void;
}) {
  const { book, versions } = card;
  const latest = versions.reduce<WorkVersion | null>((m, v) => (!m || v.seq > m.seq ? v : m), null);
  const finalVersion = versions.find((v) => v.isFinal) ?? null;
  const finished = isBookFinished(book.status);

  return (
    <Box
      onClick={() => onOpen(book.id)}
      data-testid={`published-book-card-${book.id}`}
      sx={{
        p: 2,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        cursor: 'pointer',
        transition: 'border-color .15s ease, box-shadow .15s ease',
        '&:hover': { borderColor: 'primary.light', boxShadow: 2 },
        display: 'flex',
        gap: 1.5,
        alignItems: 'flex-start',
      }}
    >
      {/* 封面色块：与书架同一份 coverColor，不是本页存的书目副本 */}
      <Box
        sx={{
          width: 44,
          height: 58,
          borderRadius: 1,
          flexShrink: 0,
          bgcolor: book.coverColor ? alpha(book.coverColor, 0.85) : 'primary.light',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MenuBookIcon sx={{ fontSize: uiFontSize(22), color: '#fff' }} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: uiFontSize(14), fontWeight: 650 }} noWrap title={book.title}>
          {book.title}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.6, mt: 0.6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip size="small" variant="outlined" label={finished ? t('published.cardFinishedChip') : t('published.cardLockedChip')} color={finished ? 'success' : 'default'} sx={{ height: 20, fontSize: uiFontSize(11) }} />
          {latest && (
            <Chip size="small" label={t('published.latestVersionN', { n: latest.seq })} sx={{ height: 20, fontSize: uiFontSize(11) }} data-testid={`published-card-latest-${book.id}`} />
          )}
          {finalVersion && (
            <Chip
              size="small"
              color="primary"
              icon={<CheckCircleIcon sx={{ fontSize: uiFontSize(14) }} />}
              label={t('published.finalTag')}
              sx={{ height: 20, fontSize: uiFontSize(11) }}
              data-testid={`published-card-final-${book.id}`}
            />
          )}
          {versions.length > 0 && (
            <Typography sx={{ fontSize: uiFontSize(11), color: 'text.secondary' }}>
              {t('published.versionCountN', { n: versions.length })}
            </Typography>
          )}
        </Box>
        {versions.length === 0 ? (
          <Box sx={{ mt: 1.2 }}>
            <Typography sx={{ fontSize: uiFontSize(12) }} color="text.secondary" data-testid={`published-card-empty-${book.id}`}>
              {t('published.noVersionYet')}
            </Typography>
            <Button
              size="small"
              variant="contained"
              sx={{ mt: 0.75, textTransform: 'none', fontSize: uiFontSize(12) }}
              startIcon={<LockIcon sx={{ fontSize: uiFontSize(14) }} />}
              onClick={(e) => {
                e.stopPropagation();
                onLock(book.id);
              }}
              data-testid={`published-card-lock-${book.id}`}
            >
              {t('published.goLockVersion')}
            </Button>
          </Box>
        ) : (
          <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
            <Typography sx={{ fontSize: uiFontSize(11.5) }}>
              {t('published.lockedOn', { date: formatDate(latest ? latest.lockedAt : 0) })}
            </Typography>
            <ChevronRightIcon sx={{ fontSize: uiFontSize(15) }} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════════
//  二级：版本时间线行（需求 §7）
// ═══════════════════════════════════════════════════

function VersionRow({
  version,
  expanded,
  snapshot,
  snapshotLoading,
  finalBusy,
  artifacts,
  jobBusyId,
  onToggleDetail,
  onSetFinal,
  onDelete,
  onExport,
  onReveal,
  onCopy,
  onRegenerate,
  onJobAction,
}: {
  version: WorkVersion;
  expanded: boolean;
  snapshot?: WorkVersionChapter[];
  snapshotLoading: boolean;
  finalBusy: boolean;
  artifacts: ArtifactView[];
  jobBusyId: string | null;
  onToggleDetail: () => void;
  onSetFinal: () => void;
  onDelete: () => void;
  onExport: () => void;
  onReveal: (artifact: ArtifactView) => void;
  onCopy: (artifact: ArtifactView) => void;
  onRegenerate: (artifact: ArtifactView) => void;
  onJobAction: (jobId: string, action: (id: string) => Promise<void>) => void;
}) {
  return (
    <Box
      data-testid={`published-version-${version.seq}`}
      sx={{
        border: '1px solid',
        borderColor: version.isFinal ? 'primary.light' : 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ p: 1.75, display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: uiFontSize(14.5), fontWeight: 750 }} data-testid={`published-version-seq-${version.seq}`}>
          v{version.seq}
        </Typography>
        {version.label && (
          <Chip size="small" variant="outlined" label={version.label} sx={{ height: 20, fontSize: uiFontSize(11) }} />
        )}
        {version.isFinal && (
          <Chip
            size="small"
            color="primary"
            icon={<CheckCircleIcon sx={{ fontSize: uiFontSize(13) }} />}
            label={t('published.finalTag')}
            sx={{ height: 20, fontSize: uiFontSize(11) }}
            data-testid={`published-version-final-${version.seq}`}
          />
        )}
        <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary' }}>
          {t('published.chaptersWords', { chapters: version.chapterCount, words: formatWordCount(version.wordCount) })}
        </Typography>
        <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.disabled' }}>
          {formatDate(version.lockedAt)}
        </Typography>
        {/* §7 版式：ready 产物以格式 chip 直接挂在版本行上 */}
        {artifacts
          .filter((a) => a.status === 'ready')
          .map((a) => (
            <Chip
              key={a.id}
              size="small"
              color="primary"
              variant="outlined"
              label={a.format.toUpperCase()}
              data-testid={`published-artifact-chip-${a.id}`}
              sx={{ height: 20, fontSize: uiFontSize(10.5) }}
            />
          ))}

        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {/* B4b 接线：导出走快照流水线（enqueue → 后台队列），不接旧「另存为」链路 */}
          <Button size="small" variant="outlined" onClick={onExport} data-testid={`published-version-export-${version.seq}`}>
            {t('published.exportBtn')}
          </Button>
          {!version.isFinal && (
            <Button size="small" onClick={onSetFinal} disabled={finalBusy} data-testid={`published-version-setfinal-${version.seq}`}>
              {t('published.setFinal')}
            </Button>
          )}
          {version.isFinal && (
            <Chip size="small" label={t('published.alreadyFinal')} sx={{ height: 20, fontSize: uiFontSize(10.5) }} variant="outlined" />
          )}
          <Tooltip title={t('published.deleteVersion')}>
            <IconButton size="small" onClick={onDelete} sx={{ color: 'text.secondary' }} data-testid={`published-version-delete-${version.seq}`}>
              <DeleteIcon sx={{ fontSize: uiFontSize(17) }} />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onToggleDetail} data-testid={`published-version-detail-${version.seq}`}>
            {expanded ? <ExpandMoreIcon sx={{ fontSize: uiFontSize(18) }} /> : <ChevronRightIcon sx={{ fontSize: uiFontSize(18) }} />}
          </IconButton>
        </Box>
      </Box>

      {expanded && (
        <Box sx={{ px: 1.75, pb: 1.5, borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
          {version.note && (
            <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mb: 0.75, whiteSpace: 'pre-wrap' }}>
              {version.note}
            </Typography>
          )}
          <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled', fontFamily: 'monospace', mb: 1 }}>
            {t('published.fingerprintLabel', { hash: version.contentHash })}
          </Typography>

          {/* ── 产物区（B4b）：产物必然挂版本下（D1），状态机全量呈现 ── */}
          <Box sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: uiFontSize(11.5), fontWeight: 650, mb: 0.5 }}>
              {t('published.artifactsLabel', { n: artifacts.length })}
            </Typography>
            {artifacts.length === 0 && (
              <Typography sx={{ fontSize: uiFontSize(11), color: 'text.disabled' }} data-testid={`published-artifacts-empty-${version.seq}`}>
                {t('published.artifactsEmpty')}
              </Typography>
            )}
            {artifacts.map((a) => (
              <Box key={a.id} data-testid={`published-artifact-${a.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', py: 0.25 }}>
                <Typography sx={{ fontSize: uiFontSize(11.5), fontWeight: 650 }}>{a.format.toUpperCase()}</Typography>
                {a.status === 'ready' && (
                  <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.secondary' }}>
                    {formatFileSize(a.fileSize)} · {formatDate(a.createdAt)}
                  </Typography>
                )}
                {a.status === 'queued' && <Chip size="small" variant="outlined" label={t('published.jobQueued')} sx={{ height: 18, fontSize: uiFontSize(10) }} />}
                {a.status === 'running' && <Chip size="small" variant="outlined" color="primary" label={t('published.jobRunning')} sx={{ height: 18, fontSize: uiFontSize(10) }} />}
                {a.status === 'missing' && (
                  <Chip size="small" color="warning" label={t('published.artifactMissing')} data-testid={`published-artifact-missing-${a.id}`} sx={{ height: 18, fontSize: uiFontSize(10) }} />
                )}
                {a.status === 'failed' && (
                  <>
                    <Chip size="small" color="error" label={t('published.jobFailed')} sx={{ height: 18, fontSize: uiFontSize(10) }} />
                    <Typography title={a.error} noWrap sx={{ fontSize: uiFontSize(10.5), color: 'error.main', maxWidth: 260 }}>
                      {a.error}
                    </Typography>
                    <Button size="small" disabled={jobBusyId === a.id} onClick={() => onJobAction(a.id, workVersionApi.retryExportJob)} data-testid={`published-artifact-retry-${a.id}`}>
                      {t('published.jobRetry')}
                    </Button>
                  </>
                )}
                {(a.status === 'ready' || a.status === 'missing') && (
                  <>
                    <Tooltip title={t('published.artifactReveal')}>
                      <IconButton size="small" onClick={() => onReveal(a)} data-testid={`published-artifact-reveal-${a.id}`}>
                        <MyLocationIcon sx={{ fontSize: uiFontSize(16) }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('published.artifactCopy')}>
                      <IconButton size="small" onClick={() => onCopy(a)} data-testid={`published-artifact-copy-${a.id}`}>
                        <ContentCopyIcon sx={{ fontSize: uiFontSize(15) }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('published.artifactRegenerate')}>
                      <IconButton size="small" onClick={() => onRegenerate(a)} data-testid={`published-artifact-regen-${a.id}`}>
                        <RefreshIcon sx={{ fontSize: uiFontSize(15) }} />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
                <Typography noWrap title={a.fileRelPath} sx={{ fontSize: uiFontSize(10), color: 'text.disabled', fontFamily: 'monospace', maxWidth: 240 }}>
                  {a.fileRelPath}
                </Typography>
              </Box>
            ))}
          </Box>

          {snapshotLoading && <Skeleton variant="text" height={18} sx={{ fontSize: uiFontSize(12) }} />}
          {!snapshotLoading && snapshot && (
            <Box>
              <Typography sx={{ fontSize: uiFontSize(11.5), fontWeight: 650, mb: 0.5 }}>
                {t('published.snapshotChapters', { n: snapshot.length })}
              </Typography>
              <Box sx={{ maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {snapshot.map((c) => (
                  <Box key={`${c.versionId}-${c.sortOrder}`} sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
                    <Typography sx={{ fontSize: uiFontSize(11.5), flex: 1, minWidth: 0 }} noWrap title={c.title}>
                      {c.title || t('published.untitledChapter')}
                    </Typography>
                    <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled', flexShrink: 0 }}>
                      {formatWordCount(c.wordCount)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
