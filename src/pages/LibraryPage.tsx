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
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CleaningServicesRoundedIcon from '@mui/icons-material/CleaningServicesRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import FilterAltRoundedIcon from '@mui/icons-material/FilterAltRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LocalLibraryRoundedIcon from '@mui/icons-material/LocalLibraryRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import {
  corpusApi,
  type CorpusBook,
  type CorpusSearchHit,
  type CorpusStorageReport,
  type DuplicateHit,
  type DuplicateReport,
  type RebuildReport,
} from '../services/tauri';
import { useToastStore } from '../store/toastStore';
import { ThemeProvider, createTheme, useTheme, alpha } from '@mui/material/styles';
import { buildColorSchemes } from '../theme/themePresets';
import { useThemeStore, resolveModeWithSystem } from '../store/themeStore';
import { t, getLang } from '../i18n';
import { CORPUS_CATEGORIES, CORPUS_TAG_GROUPS, isCorpusCategory, isCorpusTag } from '../utils/librarySchema';
import { avgSentenceLen, formatBigCount } from '../utils/formatCount';
import { highlight } from '../utils/corpusHighlight';
import { currentScrollBehavior } from '../utils/reducedMotion';
import { uiFontSize } from '../theme/appearanceScales';

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

/** 字节 → 可读体积（报告展示用：<1KB 显示 B，<1MB 显示 KB，其余 MB）。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 文件名去扩展名（选定文件后书名留空时用于预填书名，连续导入免重复输入）。 */
function fileNameFromPath(p: string): string {
  return (
    p
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? ''
  );
}

/** 分类单选标签组（chip 单选，可再点取消留空为未分类；枚举值即存储值，直接以中文值点选）。
 *  默认收起只显示当前选择，展开后才列出全部 30 项——避免常驻挤占对话框高度。 */
function CategoryChipPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 30 }}>
        {value ? (
          <Chip
            label={value}
            size="small"
            color="primary"
            variant="filled"
            onDelete={() => onChange('')}
            sx={{ height: 26, fontSize: uiFontSize(12.5) }}
          />
        ) : (
          <Typography sx={{ fontSize: uiFontSize(12), color: 'text.disabled' }}>{t('library.categoryNone')}</Typography>
        )}
        <Button
          size="small"
          onClick={() => setOpen((o) => !o)}
          sx={{ ml: 'auto', fontSize: uiFontSize(11.5), textTransform: 'none', flexShrink: 0 }}
        >
          {open ? t('library.categoryCollapse') : t('library.categoryExpand')}
        </Button>
      </Box>
      {open && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1, maxHeight: 148, overflowY: 'auto' }}>
          {CORPUS_CATEGORIES.map((c) => {
            const selected = value === c;
            return (
              <Chip
                key={c}
                label={c}
                size="small"
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                onClick={() => onChange(selected ? '' : c)}
                sx={{ height: 26, fontSize: uiFontSize(12.5) }}
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/** 标签多选标签组（chip 多选 0~N 项，按统一清单四组分组展示；枚举值即存储值）。
 *  默认收起只显示已选（可逐个移除），展开后按四组点选。 */
function TagChipPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const toggle = (tag: string, selected: boolean) =>
    onChange(selected ? value.filter((x) => x !== tag) : [...value, tag]);
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 30 }}>
        {value.length > 0 ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, flex: 1, minWidth: 0 }}>
            {value.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                size="small"
                color="secondary"
                variant="filled"
                onDelete={() => toggle(tag, true)}
                sx={{ height: 24, fontSize: uiFontSize(11.5) }}
              />
            ))}
          </Box>
        ) : (
          <Typography sx={{ fontSize: uiFontSize(12), color: 'text.disabled' }}>{t('library.tagsNone')}</Typography>
        )}
        <Button
          size="small"
          onClick={() => setOpen((o) => !o)}
          sx={{ ml: 'auto', fontSize: uiFontSize(11.5), textTransform: 'none', flexShrink: 0 }}
        >
          {open ? t('library.tagsCollapse') : t('library.tagsExpand')}
        </Button>
      </Box>
      {open && (
        <Box sx={{ mt: 1 }}>
          {CORPUS_TAG_GROUPS.map((g) => (
            <Box key={g.key} sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: uiFontSize(11.5), fontWeight: 700, color: 'text.secondary', mb: 0.75 }}>
                {t(g.labelKey)}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {g.tags.map((tag) => {
                  const selected = value.includes(tag);
                  return (
                    <Chip
                      key={tag}
                      label={tag}
                      size="small"
                      color={selected ? 'secondary' : 'default'}
                      variant={selected ? 'filled' : 'outlined'}
                      onClick={() => toggle(tag, selected)}
                      sx={{ height: 26, fontSize: uiFontSize(12.5) }}
                    />
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function LibraryPage() {
  const [books, setBooks] = useState<CorpusBook[]>([]);
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
  /** 详情对话框目标书（重构后）：点击书卡主体打开完整元数据面板；null = 关闭 */
  const [detailTarget, setDetailTarget] = useState<CorpusBook | null>(null);
  // 导入对话框本地草稿
  const [draftTitle, setDraftTitle] = useState('');
  const [draftAuthor, setDraftAuthor] = useState('');
  const [draftLang, setDraftLang] = useState('zh');
  /** 导入分类（单选枚举，可空 = 未分类）；导入标签（统一枚举多选 0~N 项）。chip 点选，不再自由填写 */
  const [draftCategory, setDraftCategory] = useState('');
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  /** 导入进度（`corpus-import-progress` 事件实时刷新）：阶段 + percent，索引阶段含 done/total 句子数 */
  const [importProgress, setImportProgress] = useState<{
    phase: string;
    percent: number;
    title: string;
    done: number;
    total: number;
  } | null>(null);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  /** 单本重建进行中（P1-4 并发互斥：与全量重建/导入/删除/压缩互斥，进行中禁用相关入口；
   *  独立于 rebuilding，避免全量重建的进度弹窗被单本重建误触发） */
  const [singleRebuilding, setSingleRebuilding] = useState(false);
  /** 删除进行中（P1-4 并发互斥：删除与导入/重建/压缩互斥，进行中禁用相关入口） */
  const [deleting, setDeleting] = useState(false);
  // P1-3 重建体验：逐本进度（事件实时刷新）+ 完成后的 per-book 明细矩阵
  const [rebuildProgress, setRebuildProgress] = useState<{ current: number; total: number; title: string } | null>(
    null,
  );
  const [rebuildReport, setRebuildReport] = useState<RebuildReport | null>(null);
  // 导入前查重（提示，不阻断）
  const [dupHits, setDupHits] = useState<DuplicateHit[]>([]);
  // 全库查重报告
  const [dupOpen, setDupOpen] = useState(false);
  const [dupScanning, setDupScanning] = useState(false);
  const [dupReport, setDupReport] = useState<DuplicateReport | null>(null);
  // 空间回收报告（P0 迁移：FTS5 rebuild + VACUUM，回收旧库倒排残留）
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeReport, setOptimizeReport] = useState<CorpusStorageReport | null>(null);
  // 标题/作者的最新高值：查重 effect 只依赖 draftPath（避免每次键入都触发一次读文件查重）。
  // 声明顺序在查重 effect 之前 → 每次 draftPath 变化时 ref 已是新值。
  const draftMetaRef = useRef({ title: '', author: '' });
  useEffect(() => {
    draftMetaRef.current = { title: draftTitle, author: draftAuthor };
  }, [draftTitle, draftAuthor]);

  // 编辑对话框（元数据：书名/作者/语言/标签）
  const [editTarget, setEditTarget] = useState<CorpusBook | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editLang, setEditLang] = useState('zh');
  // 编辑对话框：分类单选 + 标签多选（统一枚举）；legacy = 存量不在统一清单内的标签，
  // 只读展示可移除，保存前必须清空（后端白名单校验会拒绝超集值，避免静默丢失或改写）
  const [editCategory, setEditCategory] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editLegacyTags, setEditLegacyTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  /** 标签分组视图（重构后）：已展开的分组 key 集合（key = 28 项标签枚举；'__uncategorized__' 为未分类兜底组）。
   *  分组默认全部收起，点击分组头展开其下作品；无作品的分组不渲染。 */
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  /** 左侧分类树当前选中节点 key（'__all__' = 全部作品；其余为分组 tag / '__uncategorized__'） */
  const [selectedGroup, setSelectedGroup] = useState<string>('__all__');
  /** 检索分页：命中超 50 时「加载更多」按 offset 追加（search API limit=50；hasMore = 上一页刚好拉满） */
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 搜索范围：由下方书籍卡片点击设定（可再点取消 / 顶部范围条清除）——
   *  同时作用于主页卡片高亮与检索请求（bookScope），退出搜索后保留，跨视图一致。 */
  const [scopeBookId, setScopeBookId] = useState<number | null>(null);
  /** 进入搜索前的主页滚动位置（退出搜索时恢复，保证回到原页面原状态） */
  const preSearchScrollRef = useRef(0);
  /** 是否已记录进入搜索时的滚动位置（避免 query 每键一次都覆盖记录） */
  const preSearchScrollTakenRef = useRef(false);
  /** 维护操作菜单锚点（查重/重建/压缩空间收进菜单，窄屏不溢出） */
  const [maintenanceAnchor, setMaintenanceAnchor] = useState<HTMLElement | null>(null);
  /** 连续导入：导入成功后在对话框内提示并保持开启，可直接选下一个文件 */
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  /** 书卡标签 chip → 定位分组：先展开目标组，等渲染完成后滚动（effect 替代魔法延时） */
  const revealTargetRef = useRef<string | null>(null);

  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** 从书卡标签 chip 跳转到对应分组：先展开该分组，等渲染完成后再滚动到分组头。 */
  const revealGroup = (key: string) => {
    revealTargetRef.current = key;
    setExpandedGroups((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };
  useEffect(() => {
    const key = revealTargetRef.current;
    if (!key) return;
    revealTargetRef.current = null;
    requestAnimationFrame(() => {
      document
        .getElementById(`corpus-group-${key}`)
        ?.scrollIntoView({ behavior: currentScrollBehavior(), block: 'start' });
    });
  }, [expandedGroups]);

  const toast = useToastStore.getState();

  /** P1-4 并发互斥：任一维护操作进行中时，禁用查重/重建/压缩/导入/删除等入口
   *  （后端同源互斥，前端先行禁用避免并发触发报错） */
  const maintenanceBusy = importing || rebuilding || dupScanning || optimizing || deleting || singleRebuilding;

  /** P1-4 互斥冲突错误本地化：后端返回 "another corpus maintenance operation ({op}) is in progress, started {secs}s ago…" 时，
   *  解析占用操作与已运行时长，转为可读提示；非互斥错误返回 null 由调用方按原样透传。 */
  const maintenanceConflictText = (raw: string): string | null => {
    const m = raw.match(/another corpus maintenance operation \(([a-z_]+)\) is in progress, started (\d+)s ago/);
    if (!m) return null;
    const opLabel =
      m[1] === 'delete'
        ? t('library.delete')
        : m[1] === 'import'
          ? t('library.import')
          : m[1] === 'optimize'
            ? t('library.optimize')
            : t('library.rebuild');
    return t('library.maintenanceBusy', { op: opLabel, secs: m[2] });
  };

  /** P1-4 挂载对账 helper：按后端返回的维护操作名恢复对应前端 busy 标志 */
  const applyBusyOp = (op: string | null) => {
    if (op === 'import') setImporting(true);
    else if (op === 'rebuild') setSingleRebuilding(true);
    else if (op === 'delete') setDeleting(true);
    else if (op === 'optimize') setOptimizing(true);
  };

  /** P1-4 挂载对账 helper：后端互斥释放后复位全部维护 busy 标志 */
  const clearBusyOps = () => {
    setImporting(false);
    setSingleRebuilding(false);
    setDeleting(false);
    setOptimizing(false);
  };

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
    // P1-4 对账：页面重挂载（如路由切走再回来）会丢失前端 busy 态，但后端互斥锁可能仍被持有。
    // 主动查询维护状态，把进行中的维护操作恢复到对应的 busy 标志；随后轮询等待互斥释放，
    // 后端操作结束（如单本/全量重建完成）后自动复位，避免 busy 卡死或误点撞后端锁。
    let poll: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      try {
        const s = await corpusApi.maintenanceStatus();
        if (s.busy) {
          applyBusyOp(s.op);
          poll = setInterval(async () => {
            try {
              const cur = await corpusApi.maintenanceStatus();
              if (!cur.busy) {
                clearBusyOps();
                if (poll) {
                  clearInterval(poll);
                  poll = null;
                }
              }
            } catch {
              // 单次轮询失败忽略，下个周期再试
            }
          }, 2000);
        }
      } catch {
        // 初始状态查询失败不阻塞页面；各命令自身带错误兜底（B2 可用性探针已处理不可用场景）
      }
    })();
    return () => {
      clearTimeout(timer);
      if (poll) clearInterval(poll);
    };
  }, [probeStatus, refreshBooks]);

  // 检索：输入停顿 300ms 后触发（避免每键一次 IPC）；清空结果也走宏任务，
  // 不在 effect 同步路径上 setState（react-hooks/set-state-in-effect）
  // 注：搜索范围由 scopeBookId（主页卡片点击设定的统一范围）决定，主页与搜索视图共用。
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
          const r = await corpusApi.search(q, scopeBookId, 50, 0);
          setBookHits(r.books);
          setHits(r.hits);
          setHasMore(r.hits.length === 50);
          setSearchOffset(50);
          setLoadingMore(false);
          setSearched(true);
        } catch (e) {
          useToastStore.getState().error(t('library.searchFail', { msg: String(e) }));
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [query, scopeBookId]);

  /** 加载更多命中：按当前 offset 追加下一页（书命中不重复刷新）；失败只 toast，不清空已有结果 */
  const loadMoreHits = async () => {
    setLoadingMore(true);
    try {
      const r = await corpusApi.search(query.trim(), scopeBookId, 50, searchOffset);
      setHits((prev) => [...prev, ...r.hits]);
      setHasMore(r.hits.length === 50);
      setSearchOffset((prev) => prev + 50);
    } catch (e) {
      useToastStore.getState().error(t('library.searchFail', { msg: String(e) }));
    } finally {
      setLoadingMore(false);
    }
  };

  /** 退出搜索视图，无损回到主页面：
   *  - 清空搜索框与全部搜索中间态（结果/书命中/分页/展开的重复句）
   *  - 搜索范围 scopeBookId 保留（由卡片设定的跨视图状态，返回后高亮与检索范围一致）
   *  - 恢复进入搜索前的主页滚动位置（preSearchScrollRef）
   *  主页的 selectedGroup / expandedGroups 全程未被搜索写入，天然保持原样。 */
  const exitSearch = () => {
    setQuery('');
    setHits([]);
    setBookHits([]);
    setSearched(false);
    setHasMore(false);
    setLoadingMore(false);
    setSearchOffset(0);
    setExpandedHit(null);
    const scrollTop = preSearchScrollRef.current;
    preSearchScrollTakenRef.current = false;
    // 等 query 清空后的重绘完成再恢复滚动，避免被搜索视图高度打断
    requestAnimationFrame(() => window.scrollTo({ top: scrollTop, behavior: 'auto' }));
  };

  /** 进入搜索视图前记录主页滚动位置（query 从空到非空的第一瞬记录一次） */
  useEffect(() => {
    if (query.trim() !== '' && !preSearchScrollTakenRef.current) {
      preSearchScrollRef.current = window.scrollY || 0;
      preSearchScrollTakenRef.current = true;
    }
  }, [query]);

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
    if (typeof path === 'string') {
      setDraftPath(path);
      // 书名留空时用文件名预填，连续导入免重复输入
      setDraftTitle((prev) => prev || fileNameFromPath(path));
    }
  };

  const doImport = async () => {
    if (!draftPath) return;
    const ext = draftPath.split('.').pop()?.toLowerCase() ?? '';
    if (!CORPUS_EXTENSIONS.includes(ext)) {
      toast.error(t('library.unsupportedFormat', { ext }));
      return;
    }
    setImporting(true);
    setImportProgress({ phase: 'reading', percent: 0, title: '', done: 0, total: 0 });
    const unlisten = await listen<{
      phase: string;
      percent: number;
      title?: string;
      done?: number;
      total?: number;
    }>('corpus-import-progress', (e) => {
      const p = e.payload;
      setImportProgress({
        phase: p.phase,
        percent: p.percent,
        title: p.title ?? '',
        done: p.done ?? 0,
        total: p.total ?? 0,
      });
    });
    try {
      const book = await corpusApi.importFile(
        draftPath,
        draftTitle.trim(),
        draftAuthor.trim(),
        draftLang,
        draftCategory.trim(),
        draftTags,
      );
      toast.success(t('library.importDone', { title: book.title }));
      // 连续导入：不关闭对话框，重置表单并提示，可直接选下一个文件
      setImportSuccess(book.title);
      setDraftTitle('');
      setDraftAuthor('');
      setDraftLang('zh');
      setDraftCategory('');
      setDraftTags([]);
      setDraftPath(null);
      await refreshBooks();
    } catch (e) {
      const msg = String(e);
      // P1-4 互斥冲突先本地化；再处理后端拒绝类错误（大小/格式/不可解码，P1-2 导入防护）；其余透传后端消息
      const conflict = maintenanceConflictText(msg);
      if (conflict) toast.error(conflict);
      else if (msg.includes('file too large')) toast.error(t('library.importTooLarge'));
      else if (msg.includes('unsupported file format'))
        toast.error(t('library.unsupportedFormat', { ext: draftPath.split('.').pop() ?? '' }));
      else if (msg.includes('not decodable')) toast.error(t('library.importUndecodable'));
      else toast.error(t('library.importFail', { msg }));
    } finally {
      await unlisten();
      setImportProgress(null);
      setImporting(false);
    }
  };

  /** 确认删除：清库（触发器同步清 FTS 倒排）+ 清 UI 残留（检索命中/书命中/展开态），
   *  从查重报告进入时重扫刷新报告。 */
  const doDelete = async () => {
    if (!deleteTarget) return;
    const { id, title } = deleteTarget;
    setDeleting(true);
    try {
      await corpusApi.deleteBook(id);
      if (scopeBookId === id) setScopeBookId(null);
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
      const msg = String(e);
      toast.error(maintenanceConflictText(msg) ?? t('library.deleteFail', { msg }));
    } finally {
      setDeleting(false);
    }
  };

  /** P1-3 重建体验：全量重建逐本进度经 `corpus-rebuild-progress` 事件回传，
   *  弹窗内实时刷新进度条，完成后停留展示 per-book 明细矩阵（手动关闭）。 */
  const doRebuild = async () => {
    setRebuilding(true);
    setRebuildProgress({ current: 0, total: 1, title: '' });
    setRebuildReport(null);
    const unlisten = await listen<{ current: number; total: number; title: string }>('corpus-rebuild-progress', (e) =>
      setRebuildProgress(e.payload),
    );
    try {
      const r = await corpusApi.rebuild(null);
      setRebuildReport(r);
      const msg = t('library.rebuildDone', {
        rebuilt: r.rebuilt,
        unchanged: r.unchanged,
        skipped: r.skipped,
        failed: r.failed,
      });
      // 有失败即按错误提示；跳过（源文件缺失）不算失败
      if (r.failed > 0) toast.error(msg);
      else toast.success(msg);
      await refreshBooks();
    } catch (e) {
      const msg = String(e);
      toast.error(maintenanceConflictText(msg) ?? t('library.rebuildFail', { msg }));
    } finally {
      await unlisten();
      setRebuilding(false);
    }
  };

  /** P1-3 单本重建：书卡菜单入口，复用同一命令（bookId 指定单本），完成后 toast 该本结果 */
  const doRebuildOne = async (b: CorpusBook) => {
    const statusLabel = (s: string) =>
      s === 'rebuilt'
        ? t('library.rebuildOk')
        : s === 'unchanged'
          ? t('library.rebuildStatusUnchanged')
          : s === 'skipped'
            ? t('library.rebuildStatusSkipped')
            : t('library.rebuildStatusFailed');
    // P1-4 并发互斥：单本重建也占用后端互斥锁，进行中必须禁用全部维护入口，
    // 避免同时点「重建单本/全量重建/导入/删除/压缩」撞后端 Validation error
    setSingleRebuilding(true);
    try {
      const r = await corpusApi.rebuild(b.id);
      const item = r.items[0];
      const msg = item
        ? t('library.rebuildOneDone', { title: item.title, chunks: item.chunkCount, status: statusLabel(item.status) })
        : t('library.rebuildFail', { msg: 'no result' });
      if (item?.status === 'failed') toast.error(msg);
      else toast.success(msg);
      await refreshBooks();
    } catch (e) {
      const msg = String(e);
      toast.error(maintenanceConflictText(msg) ?? t('library.rebuildFail', { msg }));
    } finally {
      setSingleRebuilding(false);
    }
  };

  /** 打开编辑对话框：把存量标签拆回分类（第一个命中分类枚举的值）+ 枚举内标签多选
   *  + 非枚举存量值（legacy，只读可移除，保存前必须清空）。 */
  const openEdit = (b: CorpusBook) => {
    const tags = b.tags && b.tags.length > 0 ? b.tags : b.category ? [b.category] : [];
    setEditTarget(b);
    setEditTitle(b.title);
    setEditAuthor(b.author);
    setEditLang(b.language || 'zh');
    setEditCategory(tags.find(isCorpusCategory) ?? '');
    setEditTags(tags.filter(isCorpusTag));
    setEditLegacyTags(tags.filter((x) => !isCorpusCategory(x) && !isCorpusTag(x)));
  };

  /** 保存元数据（书名/作者/语言/标签；后端专用 UPDATE 只碰这四列，标签切分为多值入库） */
  const doUpdate = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      const book = await corpusApi.updateBook(
        editTarget.id,
        editTitle.trim(),
        editAuthor.trim(),
        editLang,
        editCategory,
        [...editTags, ...editLegacyTags],
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

  /** 空间回收（P0 迁移）：FTS5 rebuild + VACUUM，回收旧库删除残留的倒排与文件空洞。
   *  幂等可重复执行；先开对话框显示加载态，拿到报告后展示前后体积与 FTS 行数。 */
  const openOptimize = async () => {
    setOptimizeOpen(true);
    setOptimizing(true);
    try {
      setOptimizeReport(await corpusApi.optimizeStorage());
    } catch (e) {
      const msg = String(e);
      toast.error(maintenanceConflictText(msg) ?? t('library.optimizeFail', { msg }));
      setOptimizeOpen(false);
    } finally {
      setOptimizing(false);
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
        <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mb: 0.5 }}>
          {reasonLabel(g.reason)}
          {g.similarity < 100 ? ` · ${g.similarity}%` : ''}
        </Typography>
        {g.books.map((b) => (
          <Box key={b.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography
              sx={{ fontSize: uiFontSize(13), flex: 1, minWidth: 0 }}
              noWrap
              title={`${b.title}${b.author ? ` · ${b.author}` : ''}`}
            >
              {b.title}
              {b.author ? ` · ${b.author}` : ''}
            </Typography>
            <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.disabled', flexShrink: 0 }}>
              {t('library.sentences', { n: b.chunkCount })}
            </Typography>
            <IconButton
              size="small"
              title={t('library.delete')}
              onClick={() => setDeleteTarget({ id: b.id, title: b.title })}
              sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
              aria-label={t('library.delete')}
            >
              <DeleteOutlineRoundedIcon sx={{ fontSize: uiFontSize(16) }} />
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
        <Typography sx={{ fontSize: uiFontSize(13), lineHeight: 1.6 }}>{g.sample}</Typography>
        <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5, alignItems: 'center' }}>
          <Chip
            size="small"
            label={t('library.dupBookCount', { n: g.bookCount })}
            sx={{ height: 18, fontSize: uiFontSize(10) }}
          />
          <Chip
            size="small"
            label={t('library.dupOccurCount', { n: g.chunkCount })}
            sx={{ height: 18, fontSize: uiFontSize(10) }}
          />
          <Typography
            sx={{ fontSize: uiFontSize(11), color: 'text.disabled', minWidth: 0 }}
            noWrap
            title={g.books.join(' / ')}
          >
            {g.books.join(' / ')}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );

  /** 分组数据派生（重构后）：分类（30 项单选）与四组枚举标签均为分组维度；
   *  每个分类/标签仅当有作品时才渲染分组；分类与标签正交——
   *  有分类的书按分类归组、有标签的书按标签归组（可同时归属）；既无分类也无任何
   *  枚举标签的书归入「未分类」兜底组。
   *  注意：后端把分类值镜像写入 corpus_book_tags 真源表，读回 b.tags 含分类值，
   *  因此「只设分类、未设标签」的书能被分类组正确承接，不再误入未分类组。
   *  主页始终展示全部书籍（全量浏览，供卡片选择搜索范围），不再按书过滤分组。 */
  const tagGroups = useMemo(() => {
    // 分类维度（单选，30 项）：仅渲染有作品的分类，置于分组区最前
    const categoryEntries = CORPUS_CATEGORIES.map((category) => ({
      tag: category,
      books: books.filter((b) => (b.tags ?? []).includes(category)),
    })).filter((entry) => entry.books.length > 0);
    const groups = [
      ...(categoryEntries.length > 0
        ? [{ key: 'categories', labelKey: 'library.categoryGroupTitle', tags: categoryEntries }]
        : []),
      ...CORPUS_TAG_GROUPS.map((g) => ({
        key: g.key,
        labelKey: g.labelKey,
        tags: g.tags
          .map((tag) => ({ tag, books: books.filter((b) => (b.tags ?? []).includes(tag)) }))
          .filter((entry) => entry.books.length > 0),
      })).filter((g) => g.tags.length > 0),
    ];
    // 未分类兜底：既无分类也无任何枚举标签（分类与标签互不相交，分开判定等价于合判定）
    const uncategorized = books.filter((b) => !(b.tags ?? []).some((x) => isCorpusCategory(x) || isCorpusTag(x)));
    return { groups, uncategorized };
  }, [books]);

  /** 当前有作品的所有分组 key（含未分类兜底组）：供「全部展开/收起」总控与全收起判断 */
  const allGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const g of tagGroups.groups) for (const t of g.tags) keys.add(t.tag);
    if (tagGroups.uncategorized.length > 0) keys.add('__uncategorized__');
    return keys;
  }, [tagGroups]);
  const allExpanded = allGroupKeys.size > 0 && Array.from(allGroupKeys).every((k) => expandedGroups.has(k));
  const toggleAll = () => setExpandedGroups(allExpanded ? new Set() : allGroupKeys);

  /** 页面级局部主题：与全局主题同源（取同一 preset + 同一明暗解析），
   *  保证设置里选的主题色彩在本页也真正生效，不再内联任何硬编码色值。
   *
   *  为什么仍要「全新构造 + cssVariables:false」：全局主题启用了 cssVariables
   *  （--template-* 变量挂 html 的 :root）+ colorSchemes，若写成
   *  createTheme(appTheme, {...})，MUI 因 appTheme.cssVariables 存在而强制走
   *  WithVars 分支：sx 里的 'primary.main' 会被编译为 var(--template-palette-primary-main)，
   *  指向全局 CSS 变量，嵌套 palette 覆盖只改 JS 主题对象、不改 CSS 变量注入，
   *  所以覆盖无效（已实测）。全新构造 + cssVariables:false + 继承 shape/typography/components，
   *  让 sx 直接解析为 JS 色值。
   *  注意：新主题必须显式传 palette.mode —— cssVariables:false 的主题不再响应
   *  data-mui-color-scheme，只有显式传 mode 才会随暗色模式切换（否则恒为浅色）。 */
  const appTheme = useTheme();
  const themeConfig = useThemeStore((state) => state.config);
  // 系统明暗走 store 读数：跟随档位下操作系统换了明暗，本页局部主题要能重算
  // （渲染期直接读 matchMedia 的话，useMemo 依赖里没有人感知到那次变化）
  const systemMode = useThemeStore((state) => state.systemMode);
  const pageTheme = useMemo(() => {
    const resolvedMode = resolveModeWithSystem(themeConfig.mode, systemMode);
    const scheme = buildColorSchemes(themeConfig.preset, themeConfig.customPrimary)[resolvedMode];
    return createTheme({
      cssVariables: false,
      shape: { borderRadius: appTheme.shape.borderRadius },
      typography: appTheme.typography,
      components: appTheme.components,
      palette: { ...(scheme.palette ?? {}), mode: resolvedMode },
    });
  }, [appTheme, themeConfig.mode, themeConfig.preset, themeConfig.customPrimary, systemMode]);

  /** 左侧分类树分组小节（从 tagGroups 派生：每组标题 + 标签节点 + 数量；未分类组并入） */
  const sidebarSections = (() => {
    const sections: Array<{ key: string; label: string; nodes: Array<{ key: string; label: string; count: number }> }> =
      [];
    for (const g of tagGroups.groups) {
      const nodes = g.tags.map(({ tag, books }) => ({ key: tag, label: tag, count: books.length }));
      if (nodes.length > 0) sections.push({ key: g.key, label: t(g.labelKey), nodes });
    }
    if (tagGroups.uncategorized.length > 0) {
      sections.push({
        key: '__uncat__',
        label: t('library.untaggedGroup'),
        nodes: [{ key: '__uncategorized__', label: t('library.uncategorized'), count: tagGroups.uncategorized.length }],
      });
    }
    return sections;
  })();

  /** 树节点样式：选中 = 靛蓝实底白字（工作台典型高对比选中态），未选中浅色 hover */
  const treeNodeSx = (key: string) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    px: 1.25,
    py: 0.8,
    borderRadius: 1.5,
    cursor: 'pointer',
    bgcolor: selectedGroup === key ? 'primary.main' : 'transparent',
    color: selectedGroup === key ? 'primary.contrastText' : 'text.primary',
    transition: 'background-color 0.15s',
    '&:hover': { bgcolor: selectedGroup === key ? 'primary.main' : 'action.hover' },
  });

  /** 树节点点击：『全部作品』=展开所有分组并选中；分组节点=已展开则收起，否则展开并滚动定位 */
  const handleTreeClick = (key: string, isAll: boolean) => {
    if (query.trim() !== '') exitSearch();
    setSelectedGroup(key);
    if (isAll) {
      setExpandedGroups(allGroupKeys);
      return;
    }
    if (expandedGroups.has(key)) toggleGroup(key);
    else revealGroup(key);
  };

  /** 单本书卡片（分组展开区与未分类组共用）：点击卡片主体 = 切换该书为搜索范围
   *  （再次点击取消；选中态主色边框高亮 + 信息按钮常驻打开详情面板）；
   *  分类以主色徽标展示（仅属性，不参与分组跳转），分类为空时显示灰色「未分类」标识；
   *  枚举标签 chip 点击 → 展开并定位对应标签分组；legacy 标签只读展示。 */
  const renderBookCard = (b: CorpusBook) => {
    const tags = b.tags ?? [];
    // 注意：b.category 是「分类+标签」顿号连接串镜像，不能直接当分类展示。
    // 分类取第一个命中 30 项枚举的值（与 openEdit 口径一致）；其余按标签枚举/legacy 归类。
    const category = tags.find(isCorpusCategory) ?? '';
    const enumTags = tags.filter(isCorpusTag);
    const legacyTags = tags.filter((x) => !isCorpusCategory(x) && !isCorpusTag(x));
    const isScope = scopeBookId === b.id;
    return (
      <Card
        key={`book-${b.id}`}
        sx={{
          position: 'relative',
          cursor: 'pointer',
          height: '100%',
          borderColor: isScope ? 'primary.main' : 'divider',
          borderWidth: isScope ? 1.5 : 1,
          bgcolor: isScope ? (theme) => alpha(theme.palette.primary.main, 0.05) : 'background.paper',
          transition: 'box-shadow 0.15s, border-color 0.15s',
          '&:hover': { boxShadow: 3 },
        }}
        onClick={() => setScopeBookId((prev) => (prev === b.id ? null : b.id))}
        title={isScope ? t('library.scopeCardActive') : t('library.scopeCardIdle')}
      >
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: uiFontSize(14), fontWeight: 700, flex: 1, minWidth: 0 }} noWrap title={b.title}>
              {b.title}
            </Typography>
            {/* 选中态角标：范围书卡片左上角蓝色圆点，强化已选提示 */}
            {isScope && (
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  flexShrink: 0,
                }}
                aria-hidden
              />
            )}
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setDetailTarget(b);
              }}
              title={t('library.viewDetail')}
              sx={{ color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
              aria-label={t('library.viewDetail')}
            >
              <InfoOutlinedIcon sx={{ fontSize: uiFontSize(16) }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(b);
              }}
              title={t('library.edit')}
              sx={{ color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
              aria-label={t('library.edit')}
            >
              <EditRoundedIcon sx={{ fontSize: uiFontSize(16) }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                void doRebuildOne(b);
              }}
              disabled={maintenanceBusy}
              title={t('library.rebuildBook')}
              sx={{ color: 'text.disabled', '&:hover': { color: 'success.main' } }}
              aria-label={t('library.rebuildBook')}
            >
              <RefreshRoundedIcon sx={{ fontSize: uiFontSize(17) }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget({ id: b.id, title: b.title });
              }}
              disabled={maintenanceBusy}
              title={t('library.delete')}
              sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
              aria-label={t('library.delete')}
            >
              <DeleteOutlineRoundedIcon sx={{ fontSize: uiFontSize(17) }} />
            </IconButton>
          </Box>
          {b.author && (
            <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mb: 0.5 }}>{b.author}</Typography>
          )}
          {(category || enumTags.length > 0 || legacyTags.length > 0) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
              {category ? (
                <Chip
                  label={category}
                  size="small"
                  color="primary"
                  variant="filled"
                  onClick={() => revealGroup(category)}
                  title={t('library.revealCategory')}
                  sx={{ height: 18, fontSize: uiFontSize(10), cursor: 'pointer' }}
                />
              ) : (
                <Chip
                  label={t('library.uncategorized')}
                  size="small"
                  variant="outlined"
                  title={t('library.uncategorized')}
                  sx={{ height: 18, fontSize: uiFontSize(10), color: 'text.disabled' }}
                />
              )}
              {enumTags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  size="small"
                  onClick={() => revealGroup(tag)}
                  title={t('library.revealTag')}
                  sx={{ height: 18, fontSize: uiFontSize(10), cursor: 'pointer' }}
                />
              ))}
              {legacyTags.map((tag) => (
                <Chip
                  key={`legacy-${tag}`}
                  label={tag}
                  size="small"
                  variant="outlined"
                  sx={{ height: 18, fontSize: uiFontSize(10), color: 'text.disabled' }}
                />
              ))}
            </Box>
          )}
          <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.disabled' }}>
            {t('library.words', { n: formatBigCount(b.wordCount, getLang()) })} ·{' '}
            {t('library.sentences', { n: formatBigCount(b.chunkCount, getLang()) })}
          </Typography>
        </CardContent>
      </Card>
    );
  };

  return (
    <ThemeProvider theme={pageTheme}>
      <Box
        sx={{
          width: '100%',
          bgcolor: 'background.default',
          minHeight: '100%',
        }}
      >
        {/* ═══ 顶部工具条：品牌 + 合并搜索 + 语料库选择器 + 维护/导入 ═══ */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: { xs: 1.25, md: 1.5 },
            p: { xs: 1.5, md: 2 },
            mb: 2.5,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2.5,
            boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
          }}
        >
          {/* 品牌区：靛蓝图标卡 + 标题 + 副标题 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mr: { xs: 0, md: 1 }, minWidth: 0 }}>
            <Box
              sx={{
                width: 42,
                height: 42,
                borderRadius: 2,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <LocalLibraryRoundedIcon sx={{ fontSize: uiFontSize(24) }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: uiFontSize(16), fontWeight: 800, lineHeight: 1.25 }}>
                {t('library.title')}
              </Typography>
              <Typography
                sx={{
                  fontSize: uiFontSize(11.5),
                  color: 'text.secondary',
                  lineHeight: 1.35,
                  maxWidth: { xs: 170, md: 240 },
                }}
                noWrap
                title={t('library.subtitle')}
              >
                {t('library.subtitle')}
              </Typography>
            </Box>
          </Box>

          {/* 全文搜索（合并进工具条，占主要宽度） */}
          <TextField
            size="small"
            disabled={!!unavailable}
            placeholder={t('library.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ flex: '1 1 220px', minWidth: 200 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon sx={{ fontSize: uiFontSize(19), color: 'text.disabled' }} />
                  </InputAdornment>
                ),
                endAdornment: query && (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={exitSearch}
                      title={t('library.clearSearch')}
                      sx={{ color: 'text.disabled', '&:hover': { color: 'text.primary' } }}
                      aria-label={t('library.clearSearch')}
                    >
                      <CloseRoundedIcon sx={{ fontSize: uiFontSize(16) }} />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />

          {/* 搜索范围（点击下方卡片设定）+ 书架统计 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, minWidth: 0 }}>
            {scopeBookId !== null ? (
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={t('library.scopeCurrent', {
                  title: books.find((b) => b.id === scopeBookId)?.title ?? '',
                })}
                onDelete={() => setScopeBookId(null)}
                title={t('library.scopeClear')}
                sx={{
                  maxWidth: { xs: 180, md: 280 },
                  fontSize: uiFontSize(12),
                  '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                }}
              />
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography
                  sx={{
                    fontSize: uiFontSize(12),
                    color: 'text.secondary',
                    flexShrink: 0,
                    display: { xs: 'none', md: 'block' },
                  }}
                >
                  {t('library.scopeHint')}
                </Typography>
                <Typography
                  sx={{
                    fontSize: uiFontSize(12),
                    color: 'text.secondary',
                    flexShrink: 0,
                    display: { xs: 'none', md: 'block' },
                  }}
                >
                  {t('library.bookTotal', { n: books.length })}
                </Typography>
              </Box>
            )}
          </Box>

          {/* 维护 + 导入 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<TuneRoundedIcon sx={{ fontSize: uiFontSize(16) }} />}
              disabled={!!unavailable || maintenanceBusy}
              onClick={(e) => setMaintenanceAnchor(e.currentTarget)}
            >
              {t('library.maintenance')}
            </Button>
            <Button
              variant="contained"
              size="small"
              disabled={!!unavailable || maintenanceBusy}
              onClick={() => setImportOpen(true)}
            >
              {t('library.import')}
            </Button>
          </Box>
        </Box>

        {/* 维护菜单（查重/重建索引/压缩空间；无作品时禁用查重与重建） */}
        <Menu anchorEl={maintenanceAnchor} open={maintenanceAnchor !== null} onClose={() => setMaintenanceAnchor(null)}>
          <MenuItem
            disabled={books.length === 0 || maintenanceBusy}
            onClick={() => {
              setMaintenanceAnchor(null);
              void openDupScan();
            }}
          >
            <ContentCopyRoundedIcon sx={{ fontSize: uiFontSize(16), mr: 1 }} />
            {t('library.dupScan')}
          </MenuItem>
          <MenuItem
            disabled={books.length === 0 || maintenanceBusy}
            onClick={() => {
              setMaintenanceAnchor(null);
              setRebuildOpen(true);
            }}
          >
            <RefreshRoundedIcon sx={{ fontSize: uiFontSize(16), mr: 1 }} />
            {t('library.rebuild')}
          </MenuItem>
          <MenuItem
            disabled={maintenanceBusy}
            onClick={() => {
              setMaintenanceAnchor(null);
              void openOptimize();
            }}
          >
            <CleaningServicesRoundedIcon sx={{ fontSize: uiFontSize(16), mr: 1 }} />
            {t('library.optimize')}
          </MenuItem>
        </Menu>

        {/* B2 降级：语料库不可用横幅 */}
        {unavailable && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {unavailable}
          </Alert>
        )}

        {/* ═══ 主体：左侧分类树 + 右侧卡片/检索列表 ═══ */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2.5, alignItems: 'flex-start' }}>
          {/* 左栏：分类树（全部作品 + 各分类/标签组节点 + 未分类兜底） */}
          <Box
            component="aside"
            sx={{
              width: { xs: '100%', md: 230 },
              flexShrink: 0,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2.5,
              p: 1.25,
              position: { md: 'sticky' },
              top: 12,
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              <Box onClick={() => handleTreeClick('__all__', true)} sx={treeNodeSx('__all__')}>
                <Typography
                  sx={{ fontSize: uiFontSize(12.5), fontWeight: 600, flex: 1, minWidth: 0 }}
                  noWrap
                  title={t('library.allBooks')}
                >
                  {t('library.allBooks')}
                </Typography>
                <Typography sx={{ fontSize: uiFontSize(11), opacity: 0.75 }}>{books.length}</Typography>
              </Box>
              {sidebarSections.map((sec) => (
                <Box key={sec.key}>
                  <Typography
                    sx={{ fontSize: uiFontSize(11), fontWeight: 700, color: 'text.disabled', px: 1.25, pt: 1, pb: 0.5 }}
                  >
                    {sec.label}
                  </Typography>
                  {sec.nodes.map((n) => (
                    <Box key={n.key} onClick={() => handleTreeClick(n.key, false)} sx={treeNodeSx(n.key)}>
                      <Typography sx={{ fontSize: uiFontSize(12.5), flex: 1, minWidth: 0 }} noWrap title={n.label}>
                        {n.label}
                      </Typography>
                      <Typography sx={{ fontSize: uiFontSize(11), opacity: 0.75 }}>{n.count}</Typography>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          </Box>

          {/* 右栏：检索结果 / 分组卡片列表 / 空态（原全部功能保留） */}
          <Box component="section" sx={{ flex: 1, minWidth: 0 }}>
            {query.trim() !== '' ? (
              <Box>
                {/* 搜索视图返回条：显式退出入口，退出后回到原主页面（分类/展开/滚动均保留） */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <Button
                    size="small"
                    startIcon={<ArrowBackRoundedIcon sx={{ fontSize: uiFontSize(17) }} />}
                    onClick={exitSearch}
                    sx={{ flexShrink: 0 }}
                  >
                    {t('library.backToLibrary')}
                  </Button>
                  <Typography
                    sx={{ fontSize: uiFontSize(13), fontWeight: 700, minWidth: 0 }}
                    noWrap
                    title={t('library.searchResultsTitle', { q: query.trim() })}
                  >
                    {t('library.searchResultsTitle', { q: query.trim() })}
                  </Typography>
                </Box>
                {/* 当前搜索范围上下文：范围在工具条 Chip 常驻显示，此处无需重复提示 */}
                {/* 书命中置顶：书名/作者/分类匹配（点击=按该书过滤正文结果） */}
                {bookHits.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography sx={{ fontSize: uiFontSize(12), color: 'text.disabled', mb: 1 }}>
                      {t('library.bookHits', { n: bookHits.length })}
                    </Typography>
                    {bookHits.map((b) => (
                      <Card
                        key={`bh-${b.id}`}
                        variant="outlined"
                        sx={{ mb: 1, cursor: 'pointer', '&:hover': { boxShadow: 2 } }}
                        onClick={() => setScopeBookId(b.id)}
                      >
                        <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
                          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                            <Typography sx={{ fontSize: uiFontSize(13), fontWeight: 700, flexShrink: 0 }}>
                              《{b.title}》
                            </Typography>
                            <Typography
                              sx={{ fontSize: uiFontSize(12), color: 'text.secondary', flex: 1, minWidth: 0 }}
                              noWrap
                              title={[b.author, b.tags && b.tags.length ? b.tags.join('、') : '']
                                .filter(Boolean)
                                .join(' · ')}
                            >
                              {[b.author, b.tags && b.tags.length ? b.tags.join('、') : ''].filter(Boolean).join(' · ')}
                            </Typography>
                            <Chip
                              label={t('library.filterThis')}
                              size="small"
                              sx={{ height: 18, fontSize: uiFontSize(10), flexShrink: 0 }}
                            />
                          </Box>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                )}
                {hits.length > 0 && (
                  <Typography sx={{ fontSize: uiFontSize(12), color: 'text.disabled', mb: 1 }}>
                    {t('library.hits', { n: hits.length })}
                  </Typography>
                )}
                {hits.map((h) => (
                  <Card key={h.chunkId} sx={{ mb: 1, '&:hover': { boxShadow: 2 } }}>
                    <CardContent sx={{ py: 1.25, px: 2, '&:last-child': { pb: 1.25 } }}>
                      <Box sx={{ display: 'flex', gap: 1, mb: 0.5, alignItems: 'center' }}>
                        <Typography
                          sx={{ fontSize: uiFontSize(11.5), fontWeight: 700, color: 'text.secondary', flexShrink: 0 }}
                        >
                          《{h.bookTitle}》
                        </Typography>
                        {h.chapterTitle && (
                          <Chip
                            label={h.chapterTitle}
                            size="small"
                            title={h.chapterTitle}
                            sx={{ height: 18, fontSize: uiFontSize(10), maxWidth: 200 }}
                          />
                        )}
                        <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled', flexShrink: 0 }}>
                          {t('library.sentenceSeq', { n: h.seq + 1 })}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={() => setScopeBookId(h.bookId)}
                          title={t('library.filterThisBook')}
                          sx={{
                            ml: 'auto',
                            p: 0.5,
                            color: 'text.disabled',
                            '&:hover': { color: 'primary.main' },
                            flexShrink: 0,
                          }}
                          aria-label={t('library.filterThisBook')}
                        >
                          <FilterAltRoundedIcon sx={{ fontSize: uiFontSize(15) }} />
                        </IconButton>
                        {/* 重复句合并：同句只出一条，此处给出出现次数并可展开具体位置 */}
                        {h.occurrenceCount > 1 && (
                          <Chip
                            label={t('library.occurrences', { n: h.occurrenceCount })}
                            size="small"
                            color="primary"
                            variant={expandedHit === h.chunkId ? 'filled' : 'outlined'}
                            onClick={() => setExpandedHit(expandedHit === h.chunkId ? null : h.chunkId)}
                            sx={{ height: 18, fontSize: uiFontSize(10), flexShrink: 0, cursor: 'pointer' }}
                          />
                        )}
                      </Box>
                      <Typography sx={{ fontSize: uiFontSize(13.5), lineHeight: 1.7 }}>
                        {highlight(h.content, query)}
                      </Typography>
                      {h.occurrenceCount > 1 && expandedHit === h.chunkId && (
                        <Box sx={{ mt: 0.75, pt: 0.75, borderTop: 1, borderColor: 'divider' }}>
                          <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled', mb: 0.25 }}>
                            {t('library.occurrencesTitle')}
                          </Typography>
                          {h.occurrences.map((o) => (
                            <Typography
                              key={o.chunkId}
                              sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', lineHeight: 1.6 }}
                            >
                              《{o.bookTitle}》{o.chapterTitle ? ` · ${o.chapterTitle}` : ''} · #{o.seq + 1}
                            </Typography>
                          ))}
                          {h.occurrenceCount > h.occurrences.length && (
                            <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled' }}>
                              {t('library.occurrencesMore', { n: h.occurrences.length })}
                            </Typography>
                          )}
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {hits.length > 0 && hasMore && (
                  <Box sx={{ textAlign: 'center', py: 1.5 }}>
                    <Button size="small" variant="outlined" onClick={() => void loadMoreHits()} disabled={loadingMore}>
                      {loadingMore ? t('library.loadingMore') : t('library.loadMore')}
                    </Button>
                  </Box>
                )}
                {hits.length === 0 && searched && (
                  <Typography sx={{ fontSize: uiFontSize(13), color: 'text.disabled', textAlign: 'center', py: 4 }}>
                    {t('library.noHits')}
                  </Typography>
                )}
              </Box>
            ) : books.length === 0 ? (
              <Box
                sx={{
                  textAlign: 'center',
                  py: 10,
                  bgcolor: 'background.paper',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2.5,
                }}
              >
                <LocalLibraryRoundedIcon sx={{ fontSize: uiFontSize(48), color: 'text.disabled', mb: 1 }} />
                <Typography sx={{ fontSize: uiFontSize(14), fontWeight: 500 }}>{t('library.empty')}</Typography>
                <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.disabled', mt: 0.5 }}>
                  {t('library.emptyHint')}
                </Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* 书架总控：作品统计 + 全部展开/收起 */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary', flex: 1 }}>
                    {t('library.groupStats', { books: books.length, groups: tagGroups.groups.length })}
                  </Typography>
                  <Button
                    size="small"
                    onClick={toggleAll}
                    sx={{ fontSize: uiFontSize(11.5), textTransform: 'none', flexShrink: 0 }}
                  >
                    {allExpanded ? t('library.collapseAll') : t('library.expandAll')}
                  </Button>
                </Box>
                {/* 四组标签分组：仅渲染有作品的分组，点击分组头展开其下作品 */}
                {tagGroups.groups.map((g) => (
                  <Box key={g.key}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                      <Box sx={{ width: 3, height: 14, borderRadius: 1, bgcolor: 'primary.main' }} />
                      <Typography sx={{ fontSize: uiFontSize(13.5), fontWeight: 700 }}>{t(g.labelKey)}</Typography>
                      <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.disabled' }}>
                        {g.key === 'categories'
                          ? t('library.categoryGroupCount', { n: g.tags.length })
                          : t('library.tagGroupCount', { n: g.tags.length })}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {g.tags.map(({ tag, books }) => {
                        const open = expandedGroups.has(tag);
                        return (
                          <Box key={tag}>
                            <Box
                              id={`corpus-group-${tag}`}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                cursor: 'pointer',
                                px: 1,
                                py: 0.75,
                                borderRadius: 1,
                                '&:hover': { bgcolor: 'action.hover' },
                              }}
                              onClick={() => toggleGroup(tag)}
                            >
                              <Chip
                                label={tag}
                                size="small"
                                color={open ? 'secondary' : 'default'}
                                variant={open ? 'filled' : 'outlined'}
                                sx={{ height: 22, fontSize: uiFontSize(12) }}
                              />
                              <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary' }}>
                                {t('library.bookCount', { n: books.length })}
                              </Typography>
                              <ExpandMoreRoundedIcon
                                sx={{
                                  ml: 'auto',
                                  fontSize: uiFontSize(18),
                                  transform: open ? 'rotate(180deg)' : 'none',
                                  transition: 'transform 0.15s',
                                  color: 'text.secondary',
                                }}
                              />
                            </Box>
                            {open && (
                              <Box
                                sx={{
                                  mt: 1,
                                  display: 'grid',
                                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
                                  gap: 2,
                                  alignItems: 'stretch',
                                }}
                              >
                                {books.map(renderBookCard)}
                              </Box>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                ))}
                {/* 未打标签兜底分组：仅当存在无任何枚举标签的作品时渲染 */}
                {tagGroups.uncategorized.length > 0 && (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                      <Box sx={{ width: 3, height: 14, borderRadius: 1, bgcolor: 'text.disabled' }} />
                      <Typography sx={{ fontSize: uiFontSize(13.5), fontWeight: 700 }}>
                        {t('library.untaggedGroup')}
                      </Typography>
                      <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.disabled' }}>
                        {t('library.tagGroupCount', { n: 1 })}
                      </Typography>
                    </Box>
                    <Box
                      id="corpus-group-__uncategorized__"
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        cursor: 'pointer',
                        px: 1,
                        py: 0.75,
                        borderRadius: 1,
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                      onClick={() => toggleGroup('__uncategorized__')}
                    >
                      <Chip
                        label={t('library.uncategorized')}
                        size="small"
                        color={expandedGroups.has('__uncategorized__') ? 'secondary' : 'default'}
                        variant={expandedGroups.has('__uncategorized__') ? 'filled' : 'outlined'}
                        sx={{ height: 22, fontSize: uiFontSize(12) }}
                      />
                      <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary' }}>
                        {t('library.bookCount', { n: tagGroups.uncategorized.length })}
                      </Typography>
                      <ExpandMoreRoundedIcon
                        sx={{
                          ml: 'auto',
                          fontSize: uiFontSize(18),
                          transform: expandedGroups.has('__uncategorized__') ? 'rotate(180deg)' : 'none',
                          transition: 'transform 0.15s',
                          color: 'text.secondary',
                        }}
                      />
                    </Box>
                    {expandedGroups.has('__uncategorized__') && (
                      <Box
                        sx={{
                          mt: 1,
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
                          gap: 2,
                          alignItems: 'stretch',
                        }}
                      >
                        {tagGroups.uncategorized.map(renderBookCard)}
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Box>

        {/* 导入对话框 */}
        <Dialog open={importOpen} onClose={() => !importing && setImportOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ fontSize: uiFontSize(15), fontWeight: 700 }}>{t('library.importTitle')}</DialogTitle>
          <DialogContent>
            {/* 连续导入成功提示：导入完成不关闭对话框，提示可继续添加 */}
            {importSuccess && (
              <Alert severity="success" sx={{ mb: 1.5, py: 0.25 }}>
                {t('library.importSuccessNote', { title: importSuccess })}
              </Alert>
            )}
            <Button variant="outlined" size="small" onClick={pickFile} sx={{ mb: 1 }}>
              {draftPath ? draftPath.split('/').pop() : t('library.pickFile')}
            </Button>
            {/* 支持格式提示：选文件前即可看到哪些格式可被识别切分 */}
            <Box sx={{ mb: 2, px: 1.25, py: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Typography sx={{ fontSize: uiFontSize(11.5), fontWeight: 700, color: 'text.secondary', mb: 0.75 }}>
                {t('library.formatHintTitle')}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {CORPUS_FORMATS.map((f) => (
                  <Chip
                    key={f.label}
                    label={f.label}
                    size="small"
                    variant="outlined"
                    sx={{ height: 20, fontSize: uiFontSize(10.5) }}
                  />
                ))}
              </Box>
              <Typography sx={{ fontSize: uiFontSize(11), color: 'text.disabled', mt: 0.75 }}>
                {t('library.formatHintNote')}
              </Typography>
            </Box>
            {/* 导入前查重预警：只提示，不阻断（用户仍可导入） */}
            {dupHits.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2, py: 0.25, '& .MuiAlert-message': { width: '100%' } }}>
                <Typography sx={{ fontSize: uiFontSize(12.5), fontWeight: 500, mb: 0.25 }}>
                  {t('library.dupWarningTitle')}
                </Typography>
                {dupHits.map((h) => (
                  <Typography key={`${h.kind}-${h.bookId}`} sx={{ fontSize: uiFontSize(12), lineHeight: 1.6 }}>
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
            {/* 分类单选 chip：点选 1 项、再点取消留空（未分类）；不再提供自由文本与下拉 */}
            <Typography
              sx={{ fontSize: uiFontSize(12.5), fontWeight: 700, color: 'text.secondary', mb: 0.75, mt: 1.5 }}
            >
              {t('library.categoryLabel')}
            </Typography>
            <CategoryChipPicker value={draftCategory} onChange={setDraftCategory} />
            {/* 标签多选 chip：统一清单四组，点选 0~N 项 */}
            <Typography sx={{ fontSize: uiFontSize(12.5), fontWeight: 700, color: 'text.secondary', mb: 0.75, mt: 2 }}>
              {t('library.tagsLabel')}
            </Typography>
            <TagChipPicker value={draftTags} onChange={setDraftTags} />
            {/* 导入进度（corpus-import-progress 事件实时刷新）：索引阶段按句子计数推进 */}
            {importing && importProgress && (
              <Box sx={{ mt: 2.5 }}>
                <LinearProgress
                  variant="determinate"
                  value={importProgress.percent}
                  sx={{ borderRadius: 1, height: 6 }}
                />
                <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', mt: 0.75 }}>
                  {importProgress.phase === 'indexing'
                    ? t('library.importPhase_indexing', { done: importProgress.done, total: importProgress.total })
                    : t(`library.importPhase_${importProgress.phase}`)}
                  {' · '}
                  {Math.round(importProgress.percent)}%
                </Typography>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setImportOpen(false);
                setImportSuccess(null);
              }}
              disabled={importing}
            >
              {t('library.done')}
            </Button>
            <Button variant="contained" onClick={doImport} disabled={!draftPath || importing}>
              {importing ? t('library.importing') : t('library.import')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* 作品详情（重构后）：点击书卡打开完整元数据 + 快捷操作（编辑/重建/删除，复用既有弹窗与处理逻辑） */}
        <Dialog open={detailTarget !== null} onClose={() => setDetailTarget(null)} maxWidth="xs" fullWidth>
          {detailTarget && (
            <>
              <DialogTitle
                sx={{
                  fontSize: uiFontSize(15),
                  fontWeight: 700,
                  pr: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  minWidth: 0,
                }}
              >
                <Typography component="span" sx={{ flex: 1, minWidth: 0 }} noWrap title={t('library.detailTitle')}>
                  {t('library.detailTitle')}
                </Typography>
              </DialogTitle>
              <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography sx={{ fontSize: uiFontSize(15), fontWeight: 700 }}>{detailTarget.title}</Typography>
                  {detailTarget.author && (
                    <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary' }}>
                      {t('library.authorLabel')}：{detailTarget.author}
                    </Typography>
                  )}
                  <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary' }}>
                    {t('library.languageLabel')}：
                    {detailTarget.language === 'zh'
                      ? t('library.langZh')
                      : detailTarget.language === 'en'
                        ? t('library.langEn')
                        : detailTarget.language}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(() => {
                      const tgs = detailTarget.tags ?? [];
                      const cat = tgs.find(isCorpusCategory);
                      const tags = tgs.filter(isCorpusTag);
                      const legacy = tgs.filter((x) => !isCorpusCategory(x) && !isCorpusTag(x));
                      return [
                        cat ? (
                          <Chip
                            key={cat}
                            label={cat}
                            size="small"
                            color="primary"
                            variant="filled"
                            sx={{ height: 20, fontSize: uiFontSize(11) }}
                          />
                        ) : (
                          <Chip
                            key="__uncat__"
                            label={t('library.uncategorized')}
                            size="small"
                            variant="outlined"
                            sx={{ height: 20, fontSize: uiFontSize(11), color: 'text.disabled' }}
                          />
                        ),
                        ...tags.map((x) => (
                          <Chip key={x} label={x} size="small" sx={{ height: 20, fontSize: uiFontSize(11) }} />
                        )),
                        ...legacy.map((x) => (
                          <Chip
                            key={`legacy-${x}`}
                            label={x}
                            size="small"
                            variant="outlined"
                            sx={{ height: 20, fontSize: uiFontSize(11), color: 'text.disabled' }}
                          />
                        )),
                      ];
                    })()}
                  </Box>
                  <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary' }}>
                    {t('library.words', { n: formatBigCount(detailTarget.wordCount, getLang()) })} ·{' '}
                    {t('library.sentences', { n: formatBigCount(detailTarget.chunkCount, getLang()) })}
                    {(() => {
                      const avg = avgSentenceLen(detailTarget.wordCount, detailTarget.chunkCount);
                      return avg !== null ? (
                        <>
                          {' · '}
                          {t('library.avgSentenceLen', { n: avg })}
                        </>
                      ) : null;
                    })()}
                  </Typography>
                  {detailTarget.source && (
                    <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary' }}>
                      {t('library.sourceLabel')}：{detailTarget.source}
                    </Typography>
                  )}
                  {detailTarget.sourcePath && (
                    <Typography
                      sx={{
                        fontSize: uiFontSize(12),
                        color: 'text.secondary',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                      title={detailTarget.sourcePath}
                    >
                      {t('library.sourcePathLabel')}：{detailTarget.sourcePath}
                    </Typography>
                  )}
                  {detailTarget.createdAt > 0 && (
                    <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary' }}>
                      {t('library.importedAtLabel')}：
                      {new Date(detailTarget.createdAt * 1000).toLocaleString(
                        getLang() === 'zh-CN' ? 'zh-CN' : 'en-US',
                      )}
                    </Typography>
                  )}
                </Box>
              </DialogContent>
              <DialogActions>
                <Button
                  onClick={() => {
                    setDetailTarget(null);
                    setDeleteTarget({ id: detailTarget.id, title: detailTarget.title });
                  }}
                  disabled={maintenanceBusy}
                  color="error"
                >
                  {t('library.delete')}
                </Button>
                <Button
                  onClick={() => {
                    setDetailTarget(null);
                    void doRebuildOne(detailTarget);
                  }}
                  disabled={maintenanceBusy}
                >
                  {t('library.rebuildBook')}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => {
                    setDetailTarget(null);
                    openEdit(detailTarget);
                  }}
                >
                  {t('library.edit')}
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>

        {/* 删除确认 */}
        <Dialog open={deleteTarget !== null} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="xs">
          <DialogTitle sx={{ fontSize: uiFontSize(15), fontWeight: 700 }}>{t('library.delete')}</DialogTitle>
          <DialogContent>
            <Typography sx={{ fontSize: uiFontSize(13) }}>
              {deleteTarget ? t('library.deleteConfirm', { title: deleteTarget.title }) : ''}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t('nav.cancel')}
            </Button>
            <Button variant="contained" color="error" onClick={doDelete} disabled={deleting}>
              {deleting && <CircularProgress size={13} sx={{ mr: 0.75, color: 'inherit' }} />}
              {deleting ? t('library.deleting') : t('library.delete')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* 编辑元数据：书名/作者/语言/多标签（专用 UPDATE，只碰这几列；标签存 corpus_book_tags 表并回写 category 列） */}
        <Dialog open={editTarget !== null} onClose={() => !saving && setEditTarget(null)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ fontSize: uiFontSize(15), fontWeight: 700 }}>{t('library.editTitle')}</DialogTitle>
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
            {/* 分类单选 chip：点选 1 项、再点取消留空（未分类） */}
            <Typography sx={{ fontSize: uiFontSize(12.5), fontWeight: 700, color: 'text.secondary', mb: 0.75 }}>
              {t('library.categoryLabel')}
            </Typography>
            <CategoryChipPicker value={editCategory} onChange={setEditCategory} />
            {/* 标签多选 chip：统一清单四组，点选 0~N 项 */}
            <Typography sx={{ fontSize: uiFontSize(12.5), fontWeight: 700, color: 'text.secondary', mb: 0.75, mt: 2 }}>
              {t('library.tagsLabel')}
            </Typography>
            <TagChipPicker value={editTags} onChange={setEditTags} />
            {/* 存量非枚举标签：只读可移除；保存前必须清空（后端白名单校验拒绝超集值） */}
            {editLegacyTags.length > 0 && (
              <Box sx={{ mt: 1.5, p: 1.25, borderRadius: 1, bgcolor: 'warning.light' }}>
                <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 700, color: 'warning.dark', mb: 0.75 }}>
                  {t('library.legacyTagsLabel')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {editLegacyTags.map((x) => (
                    <Chip
                      key={x}
                      label={x}
                      size="small"
                      color="warning"
                      variant="outlined"
                      onDelete={() => setEditLegacyTags((v) => v.filter((y) => y !== x))}
                      sx={{ height: 26, fontSize: uiFontSize(12.5) }}
                    />
                  ))}
                </Box>
                <Typography sx={{ fontSize: uiFontSize(11), color: 'warning.dark', mt: 0.75, lineHeight: 1.5 }}>
                  {t('library.legacyTagsHint')}
                </Typography>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditTarget(null)} disabled={saving}>
              {t('nav.cancel')}
            </Button>
            <Button
              variant="contained"
              onClick={doUpdate}
              disabled={saving || !editTitle.trim() || editLegacyTags.length > 0}
            >
              {saving ? t('library.saving') : t('library.save')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* 重建索引：确认 → 逐本进度条（事件实时刷新）→ per-book 明细矩阵（P1-3） */}
        <Dialog open={rebuildOpen} onClose={() => !rebuilding && setRebuildOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ fontSize: uiFontSize(15), fontWeight: 700 }}>{t('library.rebuild')}</DialogTitle>
          <DialogContent dividers>
            {rebuilding && rebuildProgress ? (
              <Box sx={{ py: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={rebuildProgress.total > 0 ? (rebuildProgress.current / rebuildProgress.total) * 100 : 0}
                  sx={{ mb: 1 }}
                />
                <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary' }}>
                  {t('library.rebuildProgress', {
                    current: rebuildProgress.current,
                    total: rebuildProgress.total,
                    title: rebuildProgress.title,
                  })}
                </Typography>
              </Box>
            ) : rebuildReport ? (
              <Box>
                <Typography sx={{ fontSize: uiFontSize(13), mb: 0.75 }}>
                  {t('library.rebuildDone', {
                    rebuilt: rebuildReport.rebuilt,
                    unchanged: rebuildReport.unchanged,
                    skipped: rebuildReport.skipped,
                    failed: rebuildReport.failed,
                  })}
                </Typography>
                <Divider sx={{ my: 1 }} />
                <Typography sx={{ fontSize: uiFontSize(12.5), fontWeight: 700, mb: 0.5 }}>
                  {t('library.rebuildRows')}
                </Typography>
                {rebuildReport.items.length === 0 ? (
                  <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.disabled' }}>
                    {t('library.rebuildNone')}
                  </Typography>
                ) : (
                  <Box sx={{ maxHeight: 280, overflowY: 'auto' }}>
                    {rebuildReport.items.map((it) => (
                      <Box key={it.bookId} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                        <Typography sx={{ fontSize: uiFontSize(12.5), flex: 1, minWidth: 0 }} noWrap title={it.title}>
                          {it.title}
                        </Typography>
                        {it.status === 'failed' && it.reason && (
                          <Typography
                            sx={{
                              fontSize: uiFontSize(11),
                              color: 'text.disabled',
                              maxWidth: '40%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            noWrap
                            title={it.reason}
                          >
                            {it.reason}
                          </Typography>
                        )}
                        <Chip
                          size="small"
                          label={
                            it.status === 'rebuilt'
                              ? t('library.rebuildStatusRebuilt', { n: it.chunkCount })
                              : it.status === 'unchanged'
                                ? t('library.rebuildStatusUnchanged')
                                : it.status === 'skipped'
                                  ? t('library.rebuildStatusSkipped')
                                  : t('library.rebuildStatusFailed')
                          }
                          color={
                            it.status === 'rebuilt'
                              ? 'success'
                              : it.status === 'unchanged'
                                ? 'info'
                                : it.status === 'skipped'
                                  ? 'default'
                                  : 'error'
                          }
                          variant="outlined"
                          sx={{ height: 18, fontSize: uiFontSize(10) }}
                        />
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            ) : (
              <Typography sx={{ fontSize: uiFontSize(13) }}>{t('library.rebuildConfirm')}</Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setRebuildOpen(false);
                setRebuildReport(null);
              }}
              disabled={rebuilding}
            >
              {rebuildReport ? t('library.dupClose') : t('nav.cancel')}
            </Button>
            {!rebuildReport && (
              <Button variant="contained" onClick={doRebuild} disabled={rebuilding}>
                {rebuilding ? t('library.rebuilding') : t('library.rebuild')}
              </Button>
            )}
          </DialogActions>
        </Dialog>

        {/* 查重报告：精确重复 / 高度相似 / 重复语句（只读扫描 + 可逐条删重复书） */}
        <Dialog open={dupOpen} onClose={() => setDupOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ fontSize: uiFontSize(15), fontWeight: 700 }}>{t('library.dupTitle')}</DialogTitle>
          <DialogContent dividers>
            {dupScanning ? (
              <Typography sx={{ fontSize: uiFontSize(13), color: 'text.secondary', py: 4, textAlign: 'center' }}>
                {t('library.dupScanning')}
              </Typography>
            ) : !dupReport ? null : (
              <Box>
                {dupReport.exactGroups.length === 0 &&
                  dupReport.similarGroups.length === 0 &&
                  dupReport.sentenceGroups.length === 0 && (
                    <Typography sx={{ fontSize: uiFontSize(13), color: 'text.secondary', py: 3, textAlign: 'center' }}>
                      {t('library.dupNone')}
                    </Typography>
                  )}

                {dupReport.exactGroups.length > 0 && (
                  <>
                    <Typography sx={{ fontSize: uiFontSize(12.5), fontWeight: 700, mb: 0.75 }}>
                      {t('library.dupExact')}
                    </Typography>
                    {dupReport.exactGroups.map((g, i) => renderBookGroup(g, `e${i}`))}
                    <Divider sx={{ my: 1.5 }} />
                  </>
                )}

                {dupReport.similarGroups.length > 0 && (
                  <>
                    <Typography sx={{ fontSize: uiFontSize(12.5), fontWeight: 700, mb: 0.75 }}>
                      {t('library.dupSimilar')}
                    </Typography>
                    {dupReport.similarGroups.map((g, i) => renderBookGroup(g, `s${i}`))}
                    <Divider sx={{ my: 1.5 }} />
                  </>
                )}

                {dupReport.sentenceGroups.length > 0 && (
                  <>
                    <Typography sx={{ fontSize: uiFontSize(12.5), fontWeight: 700, mb: 0.25 }}>
                      {t('library.dupSentences', { n: dupReport.sentenceGroupTotal })}
                    </Typography>
                    <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled', mb: 0.75 }}>
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

        {/* 空间回收报告：FTS5 rebuild + VACUUM 回收旧库倒排残留（P0 迁移，幂等可重复） */}
        <Dialog open={optimizeOpen} onClose={() => !optimizing && setOptimizeOpen(false)} maxWidth="xs">
          <DialogTitle sx={{ fontSize: uiFontSize(15), fontWeight: 700 }}>{t('library.optimizeTitle')}</DialogTitle>
          <DialogContent dividers>
            {optimizing ? (
              <Typography sx={{ fontSize: uiFontSize(13), color: 'text.secondary', py: 4, textAlign: 'center' }}>
                {t('library.optimizing')}
              </Typography>
            ) : !optimizeReport ? null : (
              <Box>
                {optimizeReport.reclaimedBytes <= 0 ? (
                  <Typography sx={{ fontSize: uiFontSize(13), color: 'text.secondary' }}>
                    {t('library.optimizeNone')}
                  </Typography>
                ) : (
                  <>
                    <Typography sx={{ fontSize: uiFontSize(13), mb: 1 }}>
                      {t('library.optimizeDone', {
                        before: formatBytes(optimizeReport.sizeBefore),
                        after: formatBytes(optimizeReport.sizeAfter),
                      })}
                    </Typography>
                    <Typography sx={{ fontSize: uiFontSize(13), fontWeight: 700, color: 'success.main', mb: 0.5 }}>
                      {t('library.optimizeReclaimed', {
                        amount: formatBytes(optimizeReport.reclaimedBytes),
                      })}
                    </Typography>
                  </>
                )}
                <Divider sx={{ my: 1.5 }} />
                <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary' }}>
                  {t('library.optimizeFts', {
                    before: optimizeReport.ftsRowsBefore,
                    after: optimizeReport.ftsRowsAfter,
                  })}
                </Typography>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOptimizeOpen(false)} disabled={optimizing}>
              {t('library.dupClose')}
            </Button>
            <Button variant="contained" onClick={() => void openOptimize()} disabled={optimizing}>
              {t('library.optimizeAgain')}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
}
