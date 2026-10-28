import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTheme, alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { SvgIconProps } from '@mui/material/SvgIcon';
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
import Checkbox from '@mui/material/Checkbox';
import SearchIcon from '@mui/icons-material/Search';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import DescriptionIcon from '@mui/icons-material/Description';
import LanguageIcon from '@mui/icons-material/Language';
import SaveIcon from '@mui/icons-material/Save';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import BookIcon from '@mui/icons-material/Book';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import ClearIcon from '@mui/icons-material/Clear';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { save as saveDialog, open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { t, getLang } from '../i18n';
import { useToastStore } from '../store/toastStore';
import { useWritingStore } from '../store/writingStore';
import { completedWorksApi, type CompletedWork as WorkRecord, type CompletedWorkFormat } from '../services/tauri';
import { invoke } from '../services/core';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════
//  类型
// ═══════════════════════════════════════════════════

type WorkFormat = CompletedWorkFormat;

/** 页面视图模型：源自后端 completed_works 记录（pageCount 已随 schema 移除，规格以字数/章数呈现） */
interface CompletedWork extends WorkRecord {
  pageCount?: number;
}

type SortKey = 'recent' | 'oldest' | 'name' | 'size';
type ViewMode = 'grid' | 'list';

// ═══════════════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════════════

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatWordCount(n: number): string {
  if (n >= 10000) {
    const k = (n / 1000).toFixed(1).replace(/\.0$/, '');
    return getLang() === 'en-US' ? `${k}k words` : `${(n / 10000).toFixed(1)}万字`;
  }
  return getLang() === 'en-US' ? `${n} words` : `${n}字`;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

const STORAGE_KEY = 'published-search-query';

// ═══════════════════════════════════════════════════
//  格式元数据
// ═══════════════════════════════════════════════════

const FORMAT_META: Record<WorkFormat, { label: string; Icon: React.ComponentType<SvgIconProps> }> = {
  pdf: { label: 'PDF', Icon: PictureAsPdfIcon },
  epub: { label: 'EPUB', Icon: MenuBookIcon },
  docx: { label: 'DOCX', Icon: DescriptionIcon },
  html: { label: 'HTML', Icon: LanguageIcon },
  md: { label: 'MD', Icon: DescriptionIcon },
  txt: { label: 'TXT', Icon: DescriptionIcon },
  backup: { label: t('scene.backupLabel'), Icon: SaveIcon },
};

/**
 * 格式徽章配色：从主题语义色派生（浅色柔和、深色自适配），替代硬编码 Material 旧色板。
 * 保持原「一格式一色相」的辨识度：pdf 红 / epub 蓝 / docx 深蓝 / html 橙 / md 紫 / txt 灰 / backup 绿。
 */
function formatPalette(theme: Theme, format: WorkFormat): { color: string; bg: string } {
  const p = theme.palette;
  switch (format) {
    case 'pdf':
      return { color: p.error.main, bg: alpha(p.error.main, 0.1) };
    case 'epub':
      return { color: p.info.main, bg: alpha(p.info.main, 0.1) };
    case 'docx':
      return { color: '#1a4f9c', bg: alpha(p.info.main, 0.12) };
    case 'html':
      return { color: p.warning.dark, bg: alpha(p.warning.dark, 0.1) };
    case 'md':
      return { color: '#7b1fa2', bg: alpha('#7b1fa2', 0.1) };
    case 'txt':
      return { color: p.text.secondary, bg: alpha(p.text.secondary, 0.09) };
    case 'backup':
      return { color: p.success.main, bg: alpha(p.success.main, 0.1) };
  }
}

// ═══════════════════════════════════════════════════
//  主组件
// ═══════════════════════════════════════════════════

export default function PublishedScenesPage() {
  const [works, setWorks] = useState<CompletedWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [selectedBook, setSelectedBook] = useState<string>('');
  const [selectedFormat, setSelectedFormat] = useState<WorkFormat | ''>('');
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  // 按书名聚合折叠视图：默认折叠组头，展开后显示组内各格式记录
  const [groupByBook, setGroupByBook] = useState(false);
  const [collapsedBookIds, setCollapsedBookIds] = useState<Set<string>>(new Set());
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removingWork, setRemovingWork] = useState<CompletedWork | null>(null);

  // ── 批量操作 ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRemoveDialogOpen, setBulkRemoveDialogOpen] = useState(false);
  const [allSelected, setAllSelected] = useState(false);

  // ── 导入已有文件 ──
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importBookId, setImportBookId] = useState('');
  const [importFilePaths, setImportFilePaths] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const books = useWritingStore((s) => s.books);
  const loadBooks = useWritingStore((s) => s.loadBooks);

  const showToast = useToastStore((s) => s.showToast);

  // ── 加载真实记录（后端 completed_works） ──
  const loadWorks = useCallback(async () => {
    try {
      const records = await completedWorksApi.list();
      setWorks(records);
    } catch (e) {
      logger.warn('PublishedScenesPage', 'load completed works failed', { error: e });
      showToast(t('published.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    // 挂载首刷走宏任务：loadWorks 内 setWorks/setLoading 全在 await 之后，
    // 移出 effect 同步调用链以避免级联渲染（react-hooks/set-state-in-effect）
    const kick = setTimeout(() => void loadWorks(), 0);
    return () => clearTimeout(kick);
  }, [loadWorks]);

  // ── 搜索关键词持久化 ──
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, searchQuery);
    } catch {
      /* ignore */
    }
  }, [searchQuery]);

  // ── 导出/备份成功后自动刷新 ──
  useEffect(() => {
    const onSaved = () => void loadWorks();
    window.addEventListener('writing-saved', onSaved);
    return () => window.removeEventListener('writing-saved', onSaved);
  }, [loadWorks]);

  // ── 派生筛选数据 ──
  const bookOptions = useMemo(() => {
    const map = new Map<string, string>();
    works.forEach((w) => map.set(w.bookId, w.bookTitle));
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [works]);

  const formatOptions: WorkFormat[] = ['epub', 'pdf', 'docx', 'html', 'md', 'txt', 'backup'];

  const filteredWorks = useMemo(() => {
    let result = works.slice();

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((w) => w.bookTitle.toLowerCase().includes(q));
    }

    if (selectedBook) {
      result = result.filter((w) => w.bookId === selectedBook);
    }

    if (selectedFormat) {
      result = result.filter((w) => w.format === selectedFormat);
    }

    switch (sortBy) {
      case 'recent':
        result.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'oldest':
        result.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'name':
        result.sort((a, b) => a.bookTitle.localeCompare(b.bookTitle, 'zh-CN'));
        break;
      case 'size':
        result.sort((a, b) => b.fileSize - a.fileSize);
        break;
    }

    return result;
  }, [works, searchQuery, selectedBook, selectedFormat, sortBy]);

  // ── 按书名分组（列表视图聚合）：保持 filteredWorks 排序，组内按原序 ──
  const bookGroups = useMemo(() => {
    const groups = new Map<string, { bookId: string; bookTitle: string; works: CompletedWork[] }>();
    filteredWorks.forEach((w) => {
      let g = groups.get(w.bookId);
      if (!g) {
        g = { bookId: w.bookId, bookTitle: w.bookTitle, works: [] };
        groups.set(w.bookId, g);
      }
      g.works.push(w);
    });
    return Array.from(groups.values());
  }, [filteredWorks]);

  const toggleBookGroup = useCallback((bookId: string) => {
    setCollapsedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) {
        next.delete(bookId);
      } else {
        next.add(bookId);
      }
      return next;
    });
  }, []);

  const expandAllGroups = useCallback(() => setCollapsedBookIds(new Set()), []);

  // ── 操作 ──
  /** 取回：在文件管理器中定位导出产物（记录丢失/文件被删时提示）。 */
  const handleRetrieve = useCallback(
    async (work: CompletedWork) => {
      try {
        await invoke('reveal_in_file_manager', { path: work.filePath });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('PublishedScenesPage', 'reveal failed', { error: e, path: work.filePath });
        showToast(t('published.retrieveFailed', { msg }), 'error');
      }
    },
    [showToast],
  );

  const handleRemove = useCallback((work: CompletedWork) => {
    setRemovingWork(work);
    setRemoveDialogOpen(true);
  }, []);

  const confirmRemove = useCallback(async () => {
    if (!removingWork) return;
    const target = removingWork;
    try {
      await completedWorksApi.delete(target.id);
      setWorks((prev) => prev.filter((w) => w.id !== target.id));
      setSelectedIds((prev) => {
        const n = new Set(prev);
        n.delete(target.id);
        return n;
      });
      showToast(t('published.revoked', { name: target.bookTitle }), 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('PublishedScenesPage', 'remove record failed', { error: e, id: target.id });
      showToast(t('published.removeFailed', { msg }), 'error');
    } finally {
      setRemoveDialogOpen(false);
      setRemovingWork(null);
    }
  }, [removingWork, showToast]);

  // ── 批量操作 ──
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const toggleAllSelection = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
      setAllSelected(false);
    } else {
      const ids = filteredWorks.map((w) => w.id);
      setSelectedIds(new Set(ids));
      setAllSelected(true);
    }
  }, [filteredWorks, allSelected]);

  const handleBulkRemoveClick = useCallback(() => {
    if (selectedIds.size === 0) return;
    setBulkRemoveDialogOpen(true);
  }, [selectedIds]);

  const confirmBulkRemove = useCallback(async () => {
    const ids = Array.from(selectedIds);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await completedWorksApi.delete(id);
        ok++;
      } catch {
        fail++;
      }
    }
    setWorks((prev) => prev.filter((w) => !selectedIds.has(w.id)));
    setSelectedIds(new Set());
    setAllSelected(false);
    setBulkRemoveDialogOpen(false);
    if (ok > 0) showToast(t('published.bulkRevoked', { count: ok }), 'success');
    if (fail > 0) showToast(t('published.bulkRemoveFailed', { count: fail }), 'error');
  }, [selectedIds, showToast]);

  // ── 刷新按钮 ──
  const handleRefresh = useCallback(() => {
    setLoading(true);
    void loadWorks();
  }, [loadWorks]);

  // ── 改名/改目录：saveDialog 选新路径 → 后端物理移动并更新记录 ──
  const handleMove = useCallback(
    async (work: CompletedWork) => {
      try {
        // defaultPath: 沿用当前文件名（含扩展名），让用户可直接选新目录/改新名字
        const fileName = work.filePath.split('/').pop() || work.filePath;
        const newPath = await saveDialog({
          title: t('published.moveDialogTitle'),
          defaultPath: fileName,
          filters: [
            { name: 'All files', extensions: ['*'] },
            ...(work.format === 'backup' ? [{ name: 'SQLite', extensions: ['db'] }] : []),
            ...(work.format && work.format !== 'backup'
              ? [{ name: work.format.toUpperCase(), extensions: [work.format] }]
              : []),
          ],
        });
        if (!newPath) return; // 用户取消
        await completedWorksApi.move(work.id, newPath);
        showToast(t('published.moved', { name: work.bookTitle }), 'success');
        void loadWorks();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('PublishedScenesPage', 'move work failed', { error: e, id: work.id });
        showToast(t('published.moveFailed', { msg }), 'error');
      }
    },
    [showToast, loadWorks],
  );

  // ── 导入已有文件：选书（写作台书目）→ 多选文件 → 去重导入 ──
  const openImportDialog = useCallback(() => {
    setImportBookId('');
    setImportFilePaths([]);
    setImportDialogOpen(true);
    // 首次打开时预热书目（写作台 loadBooks 失败静默，不阻塞导入主流程）
    if (useWritingStore.getState().books.length === 0) {
      void loadBooks().catch(() => undefined);
    }
  }, [loadBooks]);

  const handlePickImportFiles = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        multiple: true,
        filters: [
          {
            name: t('published.importPickLabel'),
            extensions: ['epub', 'pdf', 'docx', 'html', 'htm', 'md', 'markdown', 'txt', 'db'],
          },
        ],
      });
      if (!selected) return;
      const paths = (Array.isArray(selected) ? selected : [selected]).filter((p) => typeof p === 'string');
      setImportFilePaths(paths);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('PublishedScenesPage', 'pick import files failed', { error: e });
      showToast(t('published.importPickFailed', { msg }), 'error');
    }
  }, [showToast]);

  const confirmImport = useCallback(async () => {
    if (!importBookId) {
      showToast(t('published.importNeedBook'), 'warning');
      return;
    }
    if (importFilePaths.length === 0) {
      showToast(t('published.importNeedFiles'), 'warning');
      return;
    }
    const book = books.find((b) => b.id === importBookId);
    if (!book) return;
    setImporting(true);
    try {
      const [imported, skipped] = await completedWorksApi.importWorks(book.id, book.title, importFilePaths);
      setImportDialogOpen(false);
      showToast(t('published.importDone', { imported, skipped }), 'success');
      void loadWorks();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('PublishedScenesPage', 'import works failed', { error: e });
      showToast(t('published.importFailed', { msg }), 'error');
    } finally {
      setImporting(false);
    }
  }, [importBookId, importFilePaths, books, showToast, loadWorks]);

  // ═══════════════════════════════════════════════════
  //  渲染
  // ═══════════════════════════════════════════════════

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── 标题区 ── */}
      <Box sx={{ px: 3, pt: 3, pb: 2, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
              {t('published.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('published.subtitle')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={t('published.import')}>
              <IconButton size="small" onClick={openImportDialog} color="default">
                <UploadFileIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('published.refresh')}>
              <IconButton size="small" onClick={handleRefresh} color="default">
                <FolderOpenIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('published.listView')}>
              <IconButton
                size="small"
                onClick={() => setViewMode('list')}
                color={viewMode === 'list' ? 'primary' : 'default'}
              >
                <ViewListIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('published.groupByBook')}>
              <IconButton
                size="small"
                onClick={() => {
                  setGroupByBook((v) => !v);
                  if (viewMode !== 'list') setViewMode('list');
                }}
                color={groupByBook ? 'primary' : 'default'}
              >
                <GroupWorkIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('published.gridView')}>
              <IconButton
                size="small"
                onClick={() => setViewMode('grid')}
                color={viewMode === 'grid' ? 'primary' : 'default'}
              >
                <ViewModuleIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      {/* ── 批量操作栏 ── */}
      {selectedIds.size > 0 && (
        <Box
          sx={{
            px: 3,
            pb: 1,
            flexShrink: 0,
            display: 'flex',
            gap: 1.5,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Checkbox
              checked={selectedIds.size > 0 && allSelected}
              indeterminate={selectedIds.size > 0 && !allSelected}
              onChange={toggleAllSelection}
              size="small"
            />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {t('published.selectedCount', { count: selectedIds.size })}
            </Typography>
          </Box>
          <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
            <Tooltip title={t('published.bulkRemove')}>
              <IconButton size="small" onClick={handleBulkRemoveClick} color="error">
                <DeleteIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('published.cancelSelection')}>
              <IconButton
                size="small"
                onClick={() => {
                  setSelectedIds(new Set());
                  setAllSelected(false);
                }}
              >
                <ClearIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      )}

      {/* ── 筛选工具栏 ── */}
      <Box
        sx={{
          px: 3,
          pb: 2,
          flexShrink: 0,
          display: 'flex',
          gap: 1.5,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
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
                  <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                </InputAdornment>
              ),
            },
          }}
        />

        <FormControl size="small" sx={{ minWidth: 140 }}>
          <Select
            value={selectedBook}
            onChange={(e) => setSelectedBook(e.target.value as string)}
            displayEmpty
            renderValue={(v) => (v ? bookOptions.find((b) => b.id === v)?.title : t('published.allBooks'))}
          >
            <MenuItem value="">{t('published.allBooks')}</MenuItem>
            {bookOptions.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.title}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 130 }}>
          <Select
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value as WorkFormat | '')}
            displayEmpty
            renderValue={(v) => (v ? FORMAT_META[v as WorkFormat].label : t('published.allFormats'))}
          >
            <MenuItem value="">{t('published.allFormats')}</MenuItem>
            {formatOptions.map((f) => (
              <MenuItem key={f} value={f}>
                {FORMAT_META[f].label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 130 }}>
          <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
            <MenuItem value="recent">{t('published.sortRecent')}</MenuItem>
            <MenuItem value="oldest">{t('published.sortOldest')}</MenuItem>
            <MenuItem value="name">{t('published.sortName')}</MenuItem>
            <MenuItem value="size">{t('published.sortSize')}</MenuItem>
          </Select>
        </FormControl>

        <Chip
          size="small"
          label={t('published.count', { n: filteredWorks.length })}
          sx={{ ml: 'auto', fontWeight: 500 }}
        />
      </Box>

      {/* ── 内容区 ── */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 3, pb: 3 }}>
        {loading ? (
          <LoadingSkeleton viewMode={viewMode} />
        ) : filteredWorks.length === 0 ? (
          <EmptyState
            isFiltered={Boolean(searchQuery || selectedBook || selectedFormat)}
            onClear={() => {
              setSearchQuery('');
              setSelectedBook('');
              setSelectedFormat('');
            }}
          />
        ) : viewMode === 'grid' ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2 }}>
            {filteredWorks.map((work) => (
              <WorkCard
                key={work.id}
                work={work}
                isSelected={selectedIds.has(work.id)}
                onToggleSelect={toggleSelection}
                onRetrieve={handleRetrieve}
                onMove={handleMove}
                onRemove={handleRemove}
              />
            ))}
          </Box>
        ) : viewMode === 'list' && groupByBook ? (
          <BookGroupList
            groups={bookGroups}
            collapsedIds={collapsedBookIds}
            selectedIds={selectedIds}
            onToggleGroup={toggleBookGroup}
            onExpandAll={expandAllGroups}
            onToggleSelect={toggleSelection}
            onRetrieve={handleRetrieve}
            onMove={handleMove}
            onRemove={handleRemove}
          />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filteredWorks.map((work) => (
              <WorkRow
                key={work.id}
                work={work}
                isSelected={selectedIds.has(work.id)}
                onToggleSelect={toggleSelection}
                onRetrieve={handleRetrieve}
                onMove={handleMove}
                onRemove={handleRemove}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* ── 移除确认对话框 ── */}
      <Dialog open={removeDialogOpen} onClose={() => setRemoveDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('published.confirmRemove')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('published.confirmRemoveDesc')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveDialogOpen(false)}>{t('ui.cancel')}</Button>
          <Button onClick={confirmRemove} color="error" variant="contained">
            {t('ui.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── 批量移除确认对话框 ── */}
      <Dialog open={bulkRemoveDialogOpen} onClose={() => setBulkRemoveDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('published.confirmBulkRemove')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('published.confirmBulkRemoveDesc', { count: selectedIds.size })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkRemoveDialogOpen(false)}>{t('ui.cancel')}</Button>
          <Button onClick={confirmBulkRemove} color="error" variant="contained">
            {t('ui.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── 导入已有文件对话框 ── */}
      <Dialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('published.importDialogTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <DialogContentText>{t('published.importDialogDesc')}</DialogContentText>

          <FormControl size="small" fullWidth>
            <Select
              value={importBookId}
              onChange={(e) => setImportBookId(e.target.value as string)}
              displayEmpty
              renderValue={(v) => (v ? books.find((b) => b.id === v)?.title : t('published.importSelectBook'))}
            >
              {books.length === 0 ? (
                <MenuItem value="" disabled>
                  {t('published.importNoBooks')}
                </MenuItem>
              ) : (
                books.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.title}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="outlined" size="small" startIcon={<UploadFileIcon />} onClick={handlePickImportFiles}>
              {t('published.importPickFiles')}
            </Button>
            <Typography variant="body2" color="text.secondary">
              {importFilePaths.length > 0
                ? t('published.importPickedCount', { n: importFilePaths.length })
                : t('published.importNonePicked')}
            </Typography>
          </Box>
          {importFilePaths.length > 0 && (
            <Box sx={{ maxHeight: 160, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {importFilePaths.map((p) => (
                <Typography key={p} variant="caption" sx={{ opacity: 0.75, wordBreak: 'break-all' }}>
                  {p}
                </Typography>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportDialogOpen(false)}>{t('ui.cancel')}</Button>
          <Button onClick={confirmImport} variant="contained" disabled={importing}>
            {importing ? t('published.importing') : t('published.import')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ═══════════════════════════════════════════════════
//  空态：原生空 vs 筛选后空
// ═══════════════════════════════════════════════════

function EmptyState({ isFiltered, onClear }: { isFiltered: boolean; onClear: () => void }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'text.secondary',
        gap: 2.5,
      }}
    >
      <Box
        sx={{
          width: 72,
          height: 72,
          borderRadius: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: (th) => `${th.palette.primary.main}10`,
        }}
      >
        <BookIcon sx={{ fontSize: 36, color: 'primary.main', opacity: 0.5 }} />
      </Box>
      <Box sx={{ textAlign: 'center', maxWidth: 380 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, opacity: 0.7, mb: 1 }}>
          {isFiltered ? t('published.noResults') : t('published.noneTitle')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.45, lineHeight: 1.6, mb: isFiltered ? 2 : 0 }}>
          {isFiltered ? t('published.noResultsHint') : t('published.noneHint')}
        </Typography>
        {isFiltered && (
          <Button variant="outlined" size="small" onClick={onClear}>
            {t('published.clearFilters')}
          </Button>
        )}
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════════
//  骨架屏：按视图模式区分网格/列表，与实态 1:1 布局
// ═══════════════════════════════════════════════════

function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }) {
  return (
    <Box sx={{ flex: 1, overflow: 'auto', px: 3, pb: 3 }}>
      {viewMode === 'grid' ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Box
              key={i}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Skeleton variant="rounded" width={40} height={40} sx={{ flexShrink: 0 }} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="80%" sx={{ mb: 0.5 }} />
                  <Skeleton variant="text" width="40%" />
                </Box>
              </Box>
              <Skeleton variant="rounded" width="50%" height={22} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 'auto', pt: 0.5 }}>
                <Skeleton variant="text" width="35%" />
                <Skeleton variant="rounded" width={72} height={28} />
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Box
              key={i}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 1.5,
                borderRadius: 1.5,
                border: 1,
                borderColor: 'divider',
              }}
            >
              <Skeleton variant="rounded" width={36} height={36} sx={{ flexShrink: 0 }} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="30%" sx={{ mb: 0.5 }} />
                <Skeleton variant="text" width="50%" />
              </Box>
              <Skeleton variant="text" width={90} />
              <Skeleton variant="rounded" width={72} height={28} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ═══════════════════════════════════════════════════
//  按书名聚合折叠列表（列表视图 + 分组模式）
// ═══════════════════════════════════════════════════

interface BookGroup {
  bookId: string;
  bookTitle: string;
  works: CompletedWork[];
}

function BookGroupList({
  groups,
  collapsedIds,
  selectedIds,
  onToggleGroup,
  onExpandAll,
  onToggleSelect,
  onRetrieve,
  onMove,
  onRemove,
}: {
  groups: BookGroup[];
  collapsedIds: Set<string>;
  selectedIds: Set<string>;
  onToggleGroup: (bookId: string) => void;
  onExpandAll: () => void;
  onToggleSelect: (id: string) => void;
  onRetrieve: (w: CompletedWork) => void;
  onMove: (w: CompletedWork) => void;
  onRemove: (w: CompletedWork) => void;
}) {
  const theme = useTheme();
  const selectedInGroup = groups.filter((g) => g.works.some((w) => selectedIds.has(w.id))).length;

  // 组内去掉折叠/展开按钮重复占用空间：行首用 Chevron/Expand 指示，整行可点击切换
  const renderGroup = (g: BookGroup) => {
    const collapsed = collapsedIds.has(g.bookId);
    // 组内各格式数量：同一书多次导出同格式时显示「PDF ×2」
    const formatCounts = new Map<CompletedWorkFormat, number>();
    g.works.forEach((w) => {
      const f = w.format as CompletedWorkFormat;
      formatCounts.set(f, (formatCounts.get(f) ?? 0) + 1);
    });
    const formatChips = Array.from(formatCounts.entries());
    const groupSelected = g.works.filter((w) => selectedIds.has(w.id)).length;
    return (
      <Box key={g.bookId} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* 组头 */}
        <Box
          role="button"
          tabIndex={0}
          onClick={() => onToggleGroup(g.bookId)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleGroup(g.bookId);
            }
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 1.5,
            py: 1,
            borderRadius: 1.5,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            cursor: 'pointer',
            transition: 'background-color 0.15s, border-color 0.15s',
            '&:hover': {
              bgcolor: (th) => alpha(th.palette.primary.main, 0.06),
              borderColor: (th) => alpha(th.palette.primary.main, 0.3),
            },
          }}
        >
          <IconButton size="small" sx={{ p: 0.25, flexShrink: 0 }} tabIndex={-1}>
            {collapsed ? <ChevronRightIcon sx={{ fontSize: 20 }} /> : <ExpandMoreIcon sx={{ fontSize: 20 }} />}
          </IconButton>
          <Tooltip title={g.bookTitle}>
            <Typography
              sx={{
                fontWeight: 600,
                fontSize: 14,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 320,
              }}
            >
              {g.bookTitle}
            </Typography>
          </Tooltip>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', minWidth: 0 }}>
            {formatChips.map(([f, n]) => {
              const fmtPal = formatPalette(theme, f);
              return (
                <Chip
                  key={f}
                  size="small"
                  label={n > 1 ? `${FORMAT_META[f].label} ×${n}` : FORMAT_META[f].label}
                  sx={{ fontSize: 11, height: 22, bgcolor: fmtPal.bg, color: fmtPal.color, fontWeight: 600 }}
                />
              );
            })}
          </Box>
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            {groupSelected > 0 && (
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={t('published.groupSelected', { n: groupSelected })}
                sx={{ fontSize: 11, height: 22 }}
              />
            )}
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {t('published.groupCount', { n: g.works.length })}
            </Typography>
          </Box>
        </Box>
        {/* 组内记录 */}
        {!collapsed && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pl: 1.5 }}>
            {g.works.map((work) => (
              <WorkRow
                key={work.id}
                work={work}
                isSelected={selectedIds.has(work.id)}
                onToggleSelect={onToggleSelect}
                onRetrieve={onRetrieve}
                onMove={onMove}
                onRemove={onRemove}
              />
            ))}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {groups.length > 1 && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Button size="small" variant="text" onClick={onExpandAll} sx={{ fontSize: 12 }}>
            {t('published.expandAll')}
          </Button>
          <Button
            size="small"
            variant="text"
            onClick={() =>
              groups.forEach((g) => {
                if (!collapsedIds.has(g.bookId)) onToggleGroup(g.bookId);
              })
            }
            sx={{ fontSize: 12 }}
          >
            {t('published.collapseAll')}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            {selectedInGroup > 0
              ? t('published.groupSelectedTotal', { n: selectedInGroup })
              : t('published.groupTotal', { n: groups.length })}
          </Typography>
        </Box>
      )}
      {groups.map(renderGroup)}
    </Box>
  );
}

// ═══════════════════════════════════════════════════
//  网格卡片
// ═══════════════════════════════════════════════════

function WorkCard({
  work,
  isSelected,
  onToggleSelect,
  onRetrieve,
  onMove,
  onRemove,
}: {
  work: CompletedWork;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onRetrieve: (w: CompletedWork) => void;
  onMove: (w: CompletedWork) => void;
  onRemove: (w: CompletedWork) => void;
}) {
  const theme = useTheme();
  const meta = FORMAT_META[work.format];
  const pal = formatPalette(theme, work.format);
  const { Icon } = meta;

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        transition: 'box-shadow 0.2s, transform 0.2s, border-color 0.2s, background-color 0.2s',
        bgcolor: 'background.paper',
        position: 'relative',
        '&:hover': {
          boxShadow: (th) => th.shadows[2],
          transform: 'translateY(-2px)',
          borderColor: (th) => alpha(th.palette.primary.main, 0.35),
          bgcolor: (th) => alpha(th.palette.primary.main, 0.03),
        },
      }}
    >
      {/* 复选框（悬浮层左上） */}
      <Checkbox
        checked={isSelected}
        onChange={() => onToggleSelect(work.id)}
        size="small"
        sx={{ position: 'absolute', top: 8, right: 8, p: 0.5, zIndex: 1 }}
      />
      {/* 格式徽章 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: pal.bg,
          }}
        >
          <Icon sx={{ fontSize: 22, color: pal.color }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {work.bookTitle}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {meta.label} · {formatFileSize(work.fileSize)}
          </Typography>
        </Box>
      </Box>

      {/* 规格 */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          label={t('published.chaptersWords', {
            chapters: work.chapterCount,
            words: formatWordCount(work.wordCount),
          })}
          sx={{ fontSize: 11, height: 22 }}
        />
        {work.isFileMissing && (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            icon={<WarningAmberIcon sx={{ fontSize: 14 }} />}
            label={t('published.fileMissing')}
            sx={{ fontSize: 11, height: 22 }}
          />
        )}
      </Box>

      {/* 日期 + 操作 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 'auto', pt: 0.5 }}>
        <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
          {t('published.exportedOn', { date: formatDate(work.createdAt) })}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title={work.isFileMissing ? t('published.fileMissingHint') : t('published.reDownload')}>
            <IconButton
              size="small"
              onClick={() => onRetrieve(work)}
              disabled={work.isFileMissing}
              sx={{ color: 'primary.main' }}
            >
              <DownloadIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('published.move')}>
            <IconButton size="small" onClick={() => onMove(work)} sx={{ color: 'text.secondary' }}>
              <DriveFileMoveIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('published.revoke')}>
            <IconButton size="small" onClick={() => onRemove(work)} sx={{ color: 'text.secondary' }}>
              <DeleteIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════════
//  列表行
// ═══════════════════════════════════════════════════

function WorkRow({
  work,
  isSelected,
  onToggleSelect,
  onRetrieve,
  onMove,
  onRemove,
}: {
  work: CompletedWork;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onRetrieve: (w: CompletedWork) => void;
  onMove: (w: CompletedWork) => void;
  onRemove: (w: CompletedWork) => void;
}) {
  const theme = useTheme();
  const meta = FORMAT_META[work.format];
  const pal = formatPalette(theme, work.format);
  const { Icon } = meta;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        p: 1.5,
        borderRadius: 1.5,
        border: 1,
        borderColor: isSelected ? (th) => alpha(th.palette.primary.main, 0.35) : 'divider',
        bgcolor: isSelected ? (th) => alpha(th.palette.primary.main, 0.06) : 'background.paper',
        transition: 'box-shadow 0.15s, background-color 0.2s, border-color 0.2s',
        '&:hover': {
          boxShadow: (th) => th.shadows[1],
          borderColor: (th) => alpha(th.palette.primary.main, 0.3),
        },
      }}
    >
      {/* 复选框（列表行左起） */}
      <Checkbox
        checked={isSelected}
        onChange={() => onToggleSelect(work.id)}
        size="small"
        sx={{ p: 0.5, flexShrink: 0 }}
      />
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: pal.bg,
          flexShrink: 0,
        }}
      >
        <Icon sx={{ fontSize: 20, color: pal.color }} />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Typography
          sx={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {work.bookTitle}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {meta.label} · {formatFileSize(work.fileSize)}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {t('published.chaptersWords', {
              chapters: work.chapterCount,
              words: formatWordCount(work.wordCount),
            })}
          </Typography>
          {work.pageCount && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{work.pageCount}页</Typography>}
        </Box>
      </Box>

      <Typography sx={{ fontSize: 12, color: 'text.disabled', flexShrink: 0, minWidth: 90 }}>
        {formatDate(work.createdAt)}
      </Typography>

      <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
        {work.isFileMissing && (
          <Tooltip title={t('published.fileMissingHint')}>
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              icon={<WarningAmberIcon sx={{ fontSize: 14 }} />}
              label={t('published.fileMissing')}
              sx={{ fontSize: 11, height: 24, mr: 0.5 }}
            />
          </Tooltip>
        )}
        <Tooltip title={work.isFileMissing ? t('published.fileMissingHint') : t('published.reDownload')}>
          <IconButton
            size="small"
            onClick={() => onRetrieve(work)}
            disabled={work.isFileMissing}
            sx={{ color: 'primary.main' }}
          >
            <DownloadIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('published.move')}>
          <IconButton size="small" onClick={() => onMove(work)} sx={{ color: 'text.secondary' }}>
            <DriveFileMoveIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('published.revoke')}>
          <IconButton size="small" onClick={() => onRemove(work)} sx={{ color: 'text.secondary' }}>
            <DeleteIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
