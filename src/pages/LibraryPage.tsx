// 语料库（Sight Folio）：外部参考作品导入 + 全文检索。
//
// 数据链路：txt 导入（Rust 侧 GBK/UTF-8 解码 → 章/段/句切分）→ FTS5 trigram 倒排索引
// → 句子级 KWIC 检索（≥3 字符 MATCH+BM25，<3 字符 LIKE 回退，分流在后端）。
// 命中高亮在前端做（拿原始 query 对句子做大小写不敏感子串标注，避免后端拼标记标签）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LocalLibraryRoundedIcon from '@mui/icons-material/LocalLibraryRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { open } from '@tauri-apps/plugin-dialog';
import {
  corpusApi,
  type CorpusBook,
  type CorpusSearchHit,
  type DuplicateHit,
  type DuplicateReport,
} from '../services/tauri';
import { useToastStore } from '../store/toastStore';
import { t } from '../i18n';

/** 语料库支持的导入格式（单一数据源：文件选择器过滤、扩展名校验、界面提示共用）。 */
const CORPUS_FORMATS: ReadonlyArray<{ label: string; exts: string[] }> = [
  { label: 'TXT / Markdown', exts: ['txt', 'text', 'md'] },
  { label: 'EPUB', exts: ['epub'] },
  { label: 'Word (DOCX)', exts: ['docx'] },
  { label: 'FictionBook (FB2)', exts: ['fb2'] },
  { label: 'HTML', exts: ['html', 'htm'] },
  { label: 'Kindle (MOBI / AZW3)', exts: ['mobi', 'azw3'] },
];
/** 全部可导入扩展名（小写，含 text / htm 别名）。 */
const CORPUS_EXTENSIONS: string[] = CORPUS_FORMATS.flatMap((f) => f.exts);

/** 大小写不敏感子串高亮：把 query 命中段包成主色片段（query 空则原样返回） */
function highlight(content: string, query: string) {
  const q = query.trim();
  if (!q) return content;
  const lower = content.toLowerCase();
  const needle = q.toLowerCase();
  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  let idx = lower.indexOf(needle);
  while (idx >= 0 && needle.length > 0) {
    if (idx > cursor) parts.push({ text: content.slice(cursor, idx), hit: false });
    parts.push({ text: content.slice(idx, idx + needle.length), hit: true });
    cursor = idx + needle.length;
    idx = lower.indexOf(needle, cursor);
  }
  if (cursor < content.length) parts.push({ text: content.slice(cursor), hit: false });
  return parts.map((p, i) =>
    p.hit ? (
      <Box key={i} component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>
        {p.text}
      </Box>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}

export default function LibraryPage() {
  const [books, setBooks] = useState<CorpusBook[]>([]);
  const [bookFilter, setBookFilter] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CorpusSearchHit[]>([]);
  /** 检索的书命中（书名/作者/分类匹配，置顶展示；点击=按该书过滤正文结果） */
  const [bookHits, setBookHits] = useState<CorpusBook[]>([]);
  const [searched, setSearched] = useState(false);
  /** B2 降级：语料库不可用（corpus.db 初始化失败）——非空时展示横幅并禁用入口 */
  const [unavailable, setUnavailable] = useState<string | null>(null);
  /** 已展开「出现位置」的命中（按 chunkId；重复句合并后才有多处可展开） */
  const [expandedHit, setExpandedHit] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  /** 待确认删除的作品（书卡与查重报告两个入口共用一个确认弹窗） */
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);
  // 导入对话框本地草稿
  const [draftTitle, setDraftTitle] = useState('');
  const [draftAuthor, setDraftAuthor] = useState('');
  const [draftLang, setDraftLang] = useState('zh');
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  // 导入前查重（提示，不阻断）
  const [dupHits, setDupHits] = useState<DuplicateHit[]>([]);
  // 全库查重报告
  const [dupOpen, setDupOpen] = useState(false);
  const [dupScanning, setDupScanning] = useState(false);
  const [dupReport, setDupReport] = useState<DuplicateReport | null>(null);
  // 标题/作者的最新高值：查重 effect 只依赖 draftPath（避免每次键入都触发一次读文件查重）。
  // 声明顺序在查重 effect 之前 → 每次 draftPath 变化时 ref 已是新值。
  const draftMetaRef = useRef({ title: '', author: '' });
  useEffect(() => {
    draftMetaRef.current = { title: draftTitle, author: draftAuthor };
  }, [draftTitle, draftAuthor]);

  // 编辑对话框（元数据：书名/作者/语言/分类）
  const [editTarget, setEditTarget] = useState<CorpusBook | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editLang, setEditLang] = useState('zh');
  const [editCategory, setEditCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const toast = useToastStore.getState();

  /** B2 可用性探针：不可用则展示横幅、跳过首刷（各命令也会返回统一错误兜底） */
  const probeStatus = useCallback(async () => {
    try {
      const s = await corpusApi.status();
      setUnavailable(s.available ? null : s.error || t('library.unavailableUnknown'));
      return s.available;
    } catch {
      // 探针本身失败：按可用处理，后续命令各自报错
      setUnavailable(null);
      return true;
    }
  }, []);

  const refreshBooks = useCallback(async () => {
    try {
      setBooks(await corpusApi.listBooks());
    } catch (e) {
      toast.error(t('library.loadFail', { msg: String(e) }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 挂载首刷走宏任务（refreshBooks 内含 setState，移出 effect 同步调用链）
    const timer = setTimeout(() => {
      void (async () => {
        const ok = await probeStatus();
        if (ok) await refreshBooks();
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [probeStatus, refreshBooks]);

  // 检索：输入停顿 300ms 后触发（避免每键一次 IPC）；清空结果也走宏任务，
  // 不在 effect 同步路径上 setState（react-hooks/set-state-in-effect）
  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(() => {
      if (!q) {
        setHits([]);
        setBookHits([]);
        setSearched(false);
        return;
      }
      void (async () => {
        try {
          const r = await corpusApi.search(q, bookFilter, 50, 0);
          setBookHits(r.books);
          setHits(r.hits);
          setSearched(true);
        } catch (e) {
          useToastStore.getState().error(t('library.searchFail', { msg: String(e) }));
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [query, bookFilter]);

  // 导入前查重：选定文件后停顿 300ms 查询已存在的相同/近似作品（只提示，不阻断）。
  // setState 全在宏任务内，避免 react-hooks/set-state-in-effect 的同步路径。
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!importOpen || !draftPath) {
        setDupHits((prev) => (prev.length === 0 ? prev : []));
        return;
      }
      const { title, author } = draftMetaRef.current;
      void (async () => {
        try {
          setDupHits(await corpusApi.checkDuplicate(draftPath, title.trim(), author.trim()));
        } catch {
          // 查重失败不阻断导入：静默清空提示
          setDupHits((prev) => (prev.length === 0 ? prev : []));
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [importOpen, draftPath]);

  const pickFile = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: t('library.fileFilter'), extensions: CORPUS_EXTENSIONS }],
    });
    if (typeof path === 'string') setDraftPath(path);
  };

  const doImport = async () => {
    if (!draftPath) return;
    const ext = draftPath.split('.').pop()?.toLowerCase() ?? '';
    if (!CORPUS_EXTENSIONS.includes(ext)) {
      toast.error(t('library.unsupportedFormat', { ext }));
      return;
    }
    setImporting(true);
    try {
      const book = await corpusApi.importFile(draftPath, draftTitle.trim(), draftAuthor.trim(), draftLang);
      toast.success(t('library.importDone', { title: book.title }));
      setImportOpen(false);
      setDraftTitle('');
      setDraftAuthor('');
      setDraftPath(null);
      await refreshBooks();
    } catch (e) {
      toast.error(t('library.importFail', { msg: String(e) }));
    } finally {
      setImporting(false);
    }
  };

  /** 确认删除：清库（触发器同步清 FTS 倒排）+ 清 UI 残留（检索命中/书命中/展开态），
   *  从查重报告进入时重扫刷新报告。 */
  const doDelete = async () => {
    if (!deleteTarget) return;
    const { id, title } = deleteTarget;
    try {
      await corpusApi.deleteBook(id);
      if (bookFilter === id) setBookFilter(null);
      // 清 UI 脏数据：属于该书的结果立即移除，不留已删书的残留展示
      setHits((prev) => prev.filter((h) => h.bookId !== id));
      setBookHits((prev) => prev.filter((b) => b.id !== id));
      setExpandedHit(null);
      toast.success(t('library.deleteDone', { title }));
      setDeleteTarget(null);
      await refreshBooks();
      // 查重报告开着时删除（报告内入口）：重扫保持报告与库一致
      if (dupOpen) setDupReport(await corpusApi.scanDuplicates());
    } catch (e) {
      toast.error(t('library.deleteFail', { msg: String(e) }));
    }
  };

  const doRebuild = async () => {
    setRebuilding(true);
    try {
      const r = await corpusApi.rebuild(null);
      const msg = t('library.rebuildDone', { rebuilt: r.rebuilt, skipped: r.skipped, failed: r.failed });
      // 有失败即按错误提示；跳过（源文件缺失）不算失败
      if (r.failed > 0) toast.error(msg);
      else toast.success(msg);
      setRebuildOpen(false);
      await refreshBooks();
    } catch (e) {
      toast.error(t('library.rebuildFail', { msg: String(e) }));
    } finally {
      setRebuilding(false);
    }
  };

  /** 打开编辑对话框：预填当前元数据 */
  const openEdit = (b: CorpusBook) => {
    setEditTarget(b);
    setEditTitle(b.title);
    setEditAuthor(b.author);
    setEditLang(b.language || 'zh');
    setEditCategory(b.category || '');
  };

  /** 保存元数据（书名/作者/语言/分类；后端专用 UPDATE 只碰这四列） */
  const doUpdate = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      const book = await corpusApi.updateBook(
        editTarget.id,
        editTitle.trim(),
        editAuthor.trim(),
        editLang,
        editCategory.trim(),
      );
      toast.success(t('library.updateDone', { title: book.title }));
      setEditTarget(null);
      await refreshBooks();
    } catch (e) {
      toast.error(t('library.updateFail', { msg: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  /** 打开查重报告（先开对话框显示加载态，再取结果） */
  const openDupScan = async () => {
    setDupOpen(true);
    setDupScanning(true);
    try {
      setDupReport(await corpusApi.scanDuplicates());
    } catch (e) {
      toast.error(t('library.dupFail', { msg: String(e) }));
      setDupOpen(false);
    } finally {
      setDupScanning(false);
    }
  };

  /** 导入前查重的命中分级文案 */
  const hitLabel = (h: DuplicateHit) =>
    h.kind === 'exact_path'
      ? t('library.dupKindPath')
      : h.kind === 'exact_content'
        ? t('library.dupKindContent')
        : h.kind === 'similar'
          ? t('library.dupKindSimilar', { n: h.similarity })
          : t('library.dupKindMeta');

  /** 报告分组原因文案 */
  const reasonLabel = (reason: string) =>
    reason === 'content_hash'
      ? t('library.dupReasonContent')
      : reason === 'source_path'
        ? t('library.dupReasonPath')
        : t('library.dupReasonSimilar');

  /** 一组重复作品（报告内） */
  const renderBookGroup = (g: DuplicateReport['exactGroups'][number], key: string) => (
    <Card key={key} variant="outlined" sx={{ mb: 1 }}>
      <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
          {reasonLabel(g.reason)}
          {g.similarity < 100 ? ` · ${g.similarity}%` : ''}
        </Typography>
        {g.books.map((b) => (
          <Box key={b.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
              {b.title}
              {b.author ? ` · ${b.author}` : ''}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: 'text.disabled', flexShrink: 0 }}>
              {t('library.sentences', { n: b.chunkCount })}
            </Typography>
            <IconButton
              size="small"
              title={t('library.delete')}
              onClick={() => setDeleteTarget({ id: b.id, title: b.title })}
              sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
            >
              <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        ))}
      </CardContent>
    </Card>
  );

  /** 一组重复语句（报告内） */
  const renderSentenceGroup = (g: DuplicateReport['sentenceGroups'][number], key: string) => (
    <Card key={key} variant="outlined" sx={{ mb: 1 }}>
      <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
        <Typography sx={{ fontSize: 13, lineHeight: 1.6 }}>{g.sample}</Typography>
        <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5, alignItems: 'center' }}>
          <Chip
            size="small"
            label={t('library.dupBookCount', { n: g.bookCount })}
            sx={{ height: 18, fontSize: 10 }}
          />
          <Chip
            size="small"
            label={t('library.dupOccurCount', { n: g.chunkCount })}
            sx={{ height: 18, fontSize: 10 }}
          />
          <Typography sx={{ fontSize: 11, color: 'text.disabled', minWidth: 0 }} noWrap>
            {g.books.join(' / ')}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );

  const filteredBooks = useMemo(
    () => (bookFilter === null ? books : books.filter((b) => b.id === bookFilter)),
    [books, bookFilter],
  );

  return (
    <Box sx={{ py: 3, px: { xs: 2, md: 4 }, maxWidth: 1200, mx: 'auto', width: '100%' }}>
      {/* 头部：标题 + 导入 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
        <LocalLibraryRoundedIcon sx={{ color: 'primary.main' }} />
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
          {t('library.title')}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<ContentCopyRoundedIcon sx={{ fontSize: 16 }} />}
          disabled={!!unavailable || books.length === 0}
          onClick={() => void openDupScan()}
        >
          {t('library.dupScan')}
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<RefreshRoundedIcon sx={{ fontSize: 16 }} />}
          disabled={!!unavailable || books.length === 0}
          onClick={() => setRebuildOpen(true)}
        >
          {t('library.rebuild')}
        </Button>
        <Button
          variant="contained"
          size="small"
          disabled={!!unavailable}
          onClick={() => setImportOpen(true)}
        >
          {t('library.import')}
        </Button>
      </Box>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 2 }}>{t('library.subtitle')}</Typography>

      {/* B2 降级：语料库不可用横幅（corpus.db 初始化失败，应用其余功能不受影响） */}
      {unavailable && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {unavailable}
        </Alert>
      )}

      {/* 搜索框 + 书过滤 */}
      <TextField
        fullWidth
        size="small"
        disabled={!!unavailable}
        placeholder={t('library.searchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ mb: 1.5 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon sx={{ fontSize: 19, color: 'text.disabled' }} />
              </InputAdornment>
            ),
          },
        }}
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2.5 }}>
        <Chip
          size="small"
          label={t('library.allBooks')}
          color={bookFilter === null ? 'primary' : 'default'}
          variant={bookFilter === null ? 'filled' : 'outlined'}
          onClick={() => setBookFilter(null)}
        />
        {books.map((b) => (
          <Chip
            key={b.id}
            size="small"
            label={b.title}
            color={bookFilter === b.id ? 'primary' : 'default'}
            variant={bookFilter === b.id ? 'filled' : 'outlined'}
            onClick={() => setBookFilter(bookFilter === b.id ? null : b.id)}
          />
        ))}
      </Box>

      {/* 检索结果区 */}
      {query.trim() !== '' ? (
        <Box>
          {/* 书命中置顶：书名/作者/分类匹配（点击=按该书过滤正文结果） */}
          {bookHits.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography sx={{ fontSize: 12, color: 'text.disabled', mb: 1 }}>
                {t('library.bookHits', { n: bookHits.length })}
              </Typography>
              {bookHits.map((b) => (
                <Card
                  key={`bh-${b.id}`}
                  variant="outlined"
                  sx={{ mb: 1, cursor: 'pointer', '&:hover': { boxShadow: 2 } }}
                  onClick={() => setBookFilter(b.id)}
                >
                  <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                        《{b.title}》
                      </Typography>
                      <Typography
                        sx={{ fontSize: 12, color: 'text.secondary', flex: 1, minWidth: 0 }}
                        noWrap
                      >
                        {[b.author, b.category].filter(Boolean).join(' · ')}
                      </Typography>
                      <Chip
                        label={t('library.filterThis')}
                        size="small"
                        sx={{ height: 18, fontSize: 10, flexShrink: 0 }}
                      />
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
          {hits.length > 0 && (
            <Typography sx={{ fontSize: 12, color: 'text.disabled', mb: 1 }}>
              {t('library.hits', { n: hits.length })}
            </Typography>
          )}
          {hits.map((h) => (
            <Card key={h.chunkId} sx={{ mb: 1, '&:hover': { boxShadow: 2 } }}>
              <CardContent sx={{ py: 1.25, px: 2, '&:last-child': { pb: 1.25 } }}>
                <Box sx={{ display: 'flex', gap: 1, mb: 0.5, alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'text.secondary', flexShrink: 0 }}>
                    《{h.bookTitle}》
                  </Typography>
                  {h.chapterTitle && (
                    <Chip label={h.chapterTitle} size="small" sx={{ height: 18, fontSize: 10, maxWidth: 200 }} />
                  )}
                  {/* 重复句合并：同句只出一条，此处给出出现次数并可展开具体位置 */}
                  {h.occurrenceCount > 1 && (
                    <Chip
                      label={t('library.occurrences', { n: h.occurrenceCount })}
                      size="small"
                      color="primary"
                      variant={expandedHit === h.chunkId ? 'filled' : 'outlined'}
                      onClick={() => setExpandedHit(expandedHit === h.chunkId ? null : h.chunkId)}
                      sx={{ height: 18, fontSize: 10, flexShrink: 0, cursor: 'pointer' }}
                    />
                  )}
                </Box>
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.7 }}>{highlight(h.content, query)}</Typography>
                {h.occurrenceCount > 1 && expandedHit === h.chunkId && (
                  <Box sx={{ mt: 0.75, pt: 0.75, borderTop: 1, borderColor: 'divider' }}>
                    <Typography sx={{ fontSize: 10.5, color: 'text.disabled', mb: 0.25 }}>
                      {t('library.occurrencesTitle')}
                    </Typography>
                    {h.occurrences.map((o) => (
                      <Typography
                        key={o.chunkId}
                        sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.6 }}
                      >
                        《{o.bookTitle}》{o.chapterTitle ? ` · ${o.chapterTitle}` : ''} · #{o.seq + 1}
                      </Typography>
                    ))}
                    {h.occurrenceCount > h.occurrences.length && (
                      <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>
                        {t('library.occurrencesMore', { n: h.occurrences.length })}
                      </Typography>
                    )}
                  </Box>
                )}
              </CardContent>
            </Card>
          ))}
          {hits.length === 0 && searched && (
            <Typography sx={{ fontSize: 13, color: 'text.disabled', textAlign: 'center', py: 4 }}>
              {t('library.noHits')}
            </Typography>
          )}
        </Box>
      ) : (
        /* 书架网格 */
        filteredBooks.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 10 }}>
            <LocalLibraryRoundedIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{t('library.empty')}</Typography>
            <Typography sx={{ fontSize: 12.5, color: 'text.disabled', mt: 0.5 }}>{t('library.emptyHint')}</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
            {filteredBooks.map((b) => (
              <Card key={b.id} sx={{ position: 'relative' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 700, flex: 1, flexShrink: 0 }} noWrap>
                      {b.title}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => openEdit(b)}
                      title={t('library.edit')}
                      sx={{ color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
                    >
                      <EditRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => setDeleteTarget({ id: b.id, title: b.title })}
                      title={t('library.delete')}
                      sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                    >
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Box>
                  {b.author && (
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>{b.author}</Typography>
                  )}
                  {b.category && (
                    <Chip
                      label={b.category}
                      size="small"
                      sx={{ height: 18, fontSize: 10, mb: 0.5, alignSelf: 'flex-start' }}
                    />
                  )}
                  <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
                    {t('library.words', { n: b.wordCount })} · {t('library.sentences', { n: b.chunkCount })}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
        )
      )}

      {/* 导入对话框 */}
      <Dialog open={importOpen} onClose={() => !importing && setImportOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>{t('library.importTitle')}</DialogTitle>
        <DialogContent>
          <Button variant="outlined" size="small" onClick={pickFile} sx={{ mb: 1 }}>
            {draftPath ? draftPath.split('/').pop() : t('library.pickFile')}
          </Button>
          {/* 支持格式提示：选文件前即可看到哪些格式可被识别切分 */}
          <Box sx={{ mb: 2, px: 1.25, py: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'text.secondary', mb: 0.75 }}>
              {t('library.formatHintTitle')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {CORPUS_FORMATS.map((f) => (
                <Chip
                  key={f.label}
                  label={f.label}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 10.5 }}
                />
              ))}
            </Box>
            <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 0.75 }}>
              {t('library.formatHintNote')}
            </Typography>
          </Box>
          {/* 导入前查重预警：只提示，不阻断（用户仍可导入） */}
          {dupHits.length > 0 && (
            <Alert
              severity="warning"
              sx={{ mb: 2, py: 0.25, '& .MuiAlert-message': { width: '100%' } }}
            >
              <Typography sx={{ fontSize: 12.5, fontWeight: 500, mb: 0.25 }}>
                {t('library.dupWarningTitle')}
              </Typography>
              {dupHits.map((h) => (
                <Typography key={`${h.kind}-${h.bookId}`} sx={{ fontSize: 12, lineHeight: 1.6 }}>
                  · 《{h.title}》{hitLabel(h)}
                </Typography>
              ))}
            </Alert>
          )}
          <TextField
            fullWidth
            size="small"
            label={t('library.titleLabel')}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            size="small"
            label={t('library.authorLabel')}
            value={draftAuthor}
            onChange={(e) => setDraftAuthor(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            select
            size="small"
            label={t('library.languageLabel')}
            value={draftLang}
            onChange={(e) => setDraftLang(e.target.value)}
          >
            <MenuItem value="zh">中文</MenuItem>
            <MenuItem value="en">English</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportOpen(false)} disabled={importing}>
            {t('nav.cancel')}
          </Button>
          <Button variant="contained" onClick={doImport} disabled={!draftPath || importing}>
            {importing ? t('library.importing') : t('library.import')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} maxWidth="xs">
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>{t('library.delete')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13 }}>
            {deleteTarget ? t('library.deleteConfirm', { title: deleteTarget.title }) : ''}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>{t('nav.cancel')}</Button>
          <Button variant="contained" color="error" onClick={doDelete}>
            {t('library.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 编辑元数据：书名/作者/语言/分类（专用 UPDATE，只碰这四列） */}
      <Dialog open={editTarget !== null} onClose={() => !saving && setEditTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>{t('library.editTitle')}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            size="small"
            label={t('library.bookTitleLabel')}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            size="small"
            label={t('library.authorLabel')}
            value={editAuthor}
            onChange={(e) => setEditAuthor(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            select
            size="small"
            label={t('library.languageLabel')}
            value={editLang}
            onChange={(e) => setEditLang(e.target.value)}
            sx={{ mb: 2 }}
          >
            <MenuItem value="zh">中文</MenuItem>
            <MenuItem value="en">English</MenuItem>
          </TextField>
          <TextField
            fullWidth
            size="small"
            label={t('library.categoryLabel')}
            value={editCategory}
            onChange={(e) => setEditCategory(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditTarget(null)} disabled={saving}>
            {t('nav.cancel')}
          </Button>
          <Button variant="contained" onClick={doUpdate} disabled={saving || !editTitle.trim()}>
            {saving ? t('library.saving') : t('library.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 重建索引确认：重读源文件、重新切分并替换索引 */}
      <Dialog open={rebuildOpen} onClose={() => !rebuilding && setRebuildOpen(false)} maxWidth="xs">
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>{t('library.rebuild')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13 }}>{t('library.rebuildConfirm')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRebuildOpen(false)} disabled={rebuilding}>
            {t('nav.cancel')}
          </Button>
          <Button variant="contained" onClick={doRebuild} disabled={rebuilding}>
            {rebuilding ? t('library.rebuilding') : t('library.rebuild')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 查重报告：精确重复 / 高度相似 / 重复语句（只读扫描 + 可逐条删重复书） */}
      <Dialog open={dupOpen} onClose={() => setDupOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>{t('library.dupTitle')}</DialogTitle>
        <DialogContent dividers>
          {dupScanning ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 4, textAlign: 'center' }}>
              {t('library.dupScanning')}
            </Typography>
          ) : !dupReport ? null : (
            <Box>
              {dupReport.exactGroups.length === 0 &&
                dupReport.similarGroups.length === 0 &&
                dupReport.sentenceGroups.length === 0 && (
                  <Typography
                    sx={{ fontSize: 13, color: 'text.secondary', py: 3, textAlign: 'center' }}
                  >
                    {t('library.dupNone')}
                  </Typography>
                )}

              {dupReport.exactGroups.length > 0 && (
                <>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, mb: 0.75 }}>
                    {t('library.dupExact')}
                  </Typography>
                  {dupReport.exactGroups.map((g, i) => renderBookGroup(g, `e${i}`))}
                  <Divider sx={{ my: 1.5 }} />
                </>
              )}

              {dupReport.similarGroups.length > 0 && (
                <>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, mb: 0.75 }}>
                    {t('library.dupSimilar')}
                  </Typography>
                  {dupReport.similarGroups.map((g, i) => renderBookGroup(g, `s${i}`))}
                  <Divider sx={{ my: 1.5 }} />
                </>
              )}

              {dupReport.sentenceGroups.length > 0 && (
                <>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, mb: 0.25 }}>
                    {t('library.dupSentences', { n: dupReport.sentenceGroupTotal })}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: 'text.disabled', mb: 0.75 }}>
                    {t('library.dupNoiseHint')}
                  </Typography>
                  {dupReport.sentenceGroups.map((g, i) => renderSentenceGroup(g, `t${i}`))}
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDupOpen(false)}>{t('library.dupClose')}</Button>
          <Button variant="contained" onClick={() => void openDupScan()} disabled={dupScanning}>
            {t('library.dupRescan')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
