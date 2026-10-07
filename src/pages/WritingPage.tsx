import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Fab from '@mui/material/Fab';
import Snackbar from '@mui/material/Snackbar';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Menu from '@mui/material/Menu';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import CircularProgress from '@mui/material/CircularProgress';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded';
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import AutoModeRoundedIcon from '@mui/icons-material/AutoModeRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import NavigateBeforeRoundedIcon from '@mui/icons-material/NavigateBeforeRounded';
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded';
import ChromeReaderModeRoundedIcon from '@mui/icons-material/ChromeReaderModeRounded';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import NoteAddRoundedIcon from '@mui/icons-material/NoteAddRounded';
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded';
import NotesRoundedIcon from '@mui/icons-material/NotesRounded';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import ChecklistRoundedIcon from '@mui/icons-material/ChecklistRounded';
import FindInPageRoundedIcon from '@mui/icons-material/FindInPageRounded';
import SpellcheckRoundedIcon from '@mui/icons-material/SpellcheckRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import KeyboardRoundedIcon from '@mui/icons-material/KeyboardRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded';
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded';
import FormatStrikethroughRoundedIcon from '@mui/icons-material/FormatStrikethroughRounded';
import HighlightRoundedIcon from '@mui/icons-material/HighlightRounded';
import FormatUnderlinedRoundedIcon from '@mui/icons-material/FormatUnderlinedRounded';
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded';
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded';
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import PhotoRoundedIcon from '@mui/icons-material/PhotoRounded';
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import FormatSizeRoundedIcon from '@mui/icons-material/FormatSizeRounded';
import ClearIcon from '@mui/icons-material/Clear';
import Popover from '@mui/material/Popover';
import Switch from '@mui/material/Switch';
import Slider from '@mui/material/Slider';
import { useTheme } from '@mui/material/styles';
import { loadTypography, saveTypography, type BookTypography } from '../utils/typography';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { WritingAnnotation as WritingAnnotationExtension } from '../editor/extensions/writingAnnotation';
import { WritingImage, insertIllustrationIntoEditor, illustrationAssetRef } from '../editor/extensions/writingImage';
import { CoverThumb } from '../components/CoverThumb';
import { save as saveDialog, open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { emit, listen } from '@tauri-apps/api/event';
import { useLocation, useNavigate } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WRITING_DESK_FOCUS_EVENT, isWritingDeskWindow, type WritingDeskFocus } from '../utils/writingDeskWindow';
import { deleteBookWithScene } from '../utils/studioBook';
import { useWritingStore } from '../store/writingStore';
import {
  saveTextFile,
  saveWritingEpub,
  saveWritingDocx,
  saveWritingPdf,
  backupWritingBook,
  restoreWritingBook,
  writingScanApi,
  writingSnapshotsApi,
  writingAnnotationsApi,
  parseSettingExtra,
  chapterDeletedAt,
  type WritingAnnotation,
  WORLDBUILDING_TYPE_KEYS,
  type WritingSettingExtra,
  type WritingSettingProfile,
  type WritingWorldbuildingProfile,
  type WritingTimelineEvent,
  type AiAgent,
  type AssetInfo,
} from '../services/tauri';
import { parseBookGoal } from '../services/writing';
import { settingCompleteness } from '../utils/writingOutline';
import { useToastStore } from '../store/toastStore';
import { useProjectStore } from '../store/projectStore';
import { useAssetPickerStore } from '../store/assetPickerStore';
import { analyzerRegistry } from '../editor/analyzer/analyzerRegistry';
import { useAgentStore } from '../store/agentStore';
import WritingStatsDialog from './WritingStatsDialog';
import WritingAppearanceMatrix from './WritingAppearanceMatrix';
import { ChapterTreePanel } from './ChapterTreePanel';
import { SaveIndicator, type SaveState } from './SaveIndicator';
import { ChapterMetaControls } from './ChapterMetaControls';
import { ChapterQuickJump } from './ChapterQuickJump';
import { ChapterSnapshotsDialog } from './ChapterSnapshotsDialog';
import { WritingTodayChip } from './WritingTodayChip';
import { emitWritingSaved } from '../utils/writingSavedEvent';
import { WritingInsightsDialog } from './WritingInsightsDialog';
import { WritingAiChatDialog } from './WritingAiChatDialog';
import { WritingBookSearchDialog } from './WritingBookSearchDialog';
import { WritingNotesDialog } from './WritingNotesDialog';
import { WritingImportTxtDialog } from './WritingImportTxtDialog';
import { NewBookDialog, type NewBookResult } from './NewBookDialog';
import { textToChapterHtml, countChapterWords, type ParsedChapter } from '../utils/writingImport';
import { AssetLibraryDialog } from '../editor/panels/AssetLibraryDialog';
import { aiContextRegistry } from '../ai/contextRegistry';
import { WRITING_MODULE_ID } from '../ai/providers/writingContextProvider';
import { launchModuleAnalysis } from '../ai/analysisRunner';
import {
  runInlineWritingTask,
  textToParagraphHtml,
  tailOf,
  POLISH_CONTEXT_CHARS,
  type InlineWritingKind,
  type PolishStyle,
} from '../ai/writingAssistant';
import { L } from '../ai/aiLang';
import { AutoAnalysisPanel } from '../ai/AutoAnalysisPanel';

import { pickLang, t } from '../i18n';
import { genreLabelKey, mediumLabelKey } from '../utils/writingSchema';
import { GenreMediumFields } from './GenreMediumFields';
import { logger } from '../utils/logger';
import { chaptersOfSetting, ideasOfChapter, parseChapterCover, castOfChapter } from '../utils/writingOutline';
import { buildTree, chapterPathLabels, type TreeNode } from '../utils/writingTree';
import { buildCharactersCorpus, buildCatalogCorpus } from '../utils/writingAiCorpus';
import { buildWorldBibleCorpus } from '../utils/writingCorpus';
import { CHAT_CONTEXT_PROFILE } from '../utils/writingCorpusBudget';
import { foreshadowingsPayableIn } from '../utils/writingForeshadowing';
import { beatEventText, beatImported } from '../utils/writingTimeline';
import { beatPlantedAsForeshadowing } from '../utils/writingInspiration';
import { chapterTextIssues } from '../utils/writingProofread';
import {
  ForeshadowReminder,
  InspirationReminder,
  ProofreadReminder,
  StatsReminder,
} from '../editor/components/writingReminders';

import { LeftTab, RightTab } from './writingPage/types';
import { ChapterDetailsPanel } from './ChapterDetailsPanel';
import { SAVE_DEBOUNCE_MS } from './writingPage/constants';
import {
  saveDraftSnap,
  loadDraftSnap,
  clearDraftSnap,
  clearExpiredDrafts,
  draftKey,
  DRAFT_SNAP_INTERVAL_MS,
  type WritingDraftSnap,
} from '../utils/writingCrashRecovery';
import { useExportActions } from './writingPage/useExportActions';
import { ExportCountBadge } from './writingPage/ExportCountBadge';
import { useAiActions } from './writingPage/useAiActions';
import { useDialogActions } from './writingPage/useDialogActions';
import { useBatchOperations } from './writingPage/useBatchOperations';
import { AiReviewDialog } from './writingPage/AiReviewDialog';
import { InlineAiDialog } from './writingPage/InlineAiDialog';
import { useToolbarButtons } from './writingPage/useToolbarButtons';
import { FindReplaceDialog } from './writingPage/FindReplaceDialog';
import { ShortcutsDialog } from './writingPage/ShortcutsDialog';
import { InlineAiResultDialog } from './writingPage/InlineAiResultDialog';
import { TypographyPopover } from './writingPage/TypographyPopover';
import { AnnotationCreateDialog } from './writingPage/AnnotationCreateDialog';
import { AnnotationViewDialog } from './writingPage/AnnotationViewDialog';
import { turndown } from './writingPage/turndown';
import { chapterWordCount, chapterWordCountFromHtml, findMatches, replaceAllMatches } from './writingPage/editorUtils';
import { buildEditorBodySx } from './writingPage/editorSx';
import { runProofread, type ProofreadIssue } from '../editor/proofread/proofreadEngine';
import { buildTextIndex, textRangeToPos } from '../editor/proofread/locate';
import { ProofreadPanel } from './writingPage/ProofreadPanel';

export default function WritingPage() {
  const books = useWritingStore((s) => s.books);
  const booksLoading = useWritingStore((s) => s.booksLoading);
  const activeBookId = useWritingStore((s) => s.activeBookId);
  const activeChapterId = useWritingStore((s) => s.activeChapterId);
  const chapters = useWritingStore((s) => s.chapters);
  const chaptersLoading = useWritingStore((s) => s.chaptersLoading);
  // 结构树（2026-09-22）：左栏章节 tab 树形化所需——折叠态与大纲视图共用一份（不落库），
  // 加子级 / 挂载复用 store 既有 action（零新数据模型）。
  const collapsedNodeIds = useWritingStore((s) => s.collapsedNodeIds);
  const toggleNodeCollapse = useWritingStore((s) => s.toggleNodeCollapse);
  const createChildNode = useWritingStore((s) => s.createChildNode);
  const reparentNode = useWritingStore((s) => s.reparentNode);
  const settings = useWritingStore((s) => s.settings);
  const activeSettingId = useWritingStore((s) => s.activeSettingId);
  const outlines = useWritingStore((s) => s.outlines);

  const setChapterVolume = useWritingStore((s) => s.setChapterVolume);
  const setDailyGoal = useWritingStore((s) => s.setDailyGoal);
  const setBookGoal = useWritingStore((s) => s.setBookGoal);
  const loadBooks = useWritingStore((s) => s.loadBooks);
  const createBook = useWritingStore((s) => s.createBook);
  const setBookMeta = useWritingStore((s) => s.setBookMeta);
  const renameBook = useWritingStore((s) => s.renameBook);
  const setActiveBook = useWritingStore((s) => s.setActiveBook);
  const createChapter = useWritingStore((s) => s.createChapter);
  const renameChapter = useWritingStore((s) => s.renameChapter);
  const setChapterStatus = useWritingStore((s) => s.setChapterStatus);
  const renameNodeKind = useWritingStore((s) => s.renameNodeKind);
  const deleteChapter = useWritingStore((s) => s.deleteChapter);
  const deletedChapters = useWritingStore((s) => s.deletedChapters);
  const restoreChapter = useWritingStore((s) => s.restoreChapter);
  const permanentlyDeleteChapter = useWritingStore((s) => s.permanentlyDeleteChapter);
  const setActiveChapter = useWritingStore((s) => s.setActiveChapter);
  const saveChapterContent = useWritingStore((s) => s.saveChapterContent);
  const createSetting = useWritingStore((s) => s.createSetting);
  const updateSetting = useWritingStore((s) => s.updateSetting);
  const deleteSetting = useWritingStore((s) => s.deleteSetting);
  const setActiveSetting = useWritingStore((s) => s.setActiveSetting);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const createTimelineEvent = useWritingStore((s) => s.createTimelineEvent);
  const updateTimelineEvent = useWritingStore((s) => s.updateTimelineEvent);
  const deleteTimelineEvent = useWritingStore((s) => s.deleteTimelineEvent);

  // P2 性能：saveState 下沉 SaveIndicator——原先挂在顶层，每 800ms 自动保存翻转一次 state，
  // 触发整个 WritingPage（约 2900 行）重渲染，是写作台重渲染的根因。现在保存链路经 ref 句柄
  // 写入指示器内部 state，翻转只重渲染指示器本身；函数式更新语义原样保留。
  const setSaveStateRef = useRef<Dispatch<SetStateAction<SaveState>>>(() => {});
  const registerSaveIndicator = useCallback((fn: Dispatch<SetStateAction<SaveState>>) => {
    setSaveStateRef.current = fn;
  }, []);
  const [leftTab, setLeftTab] = useState<LeftTab>('chapters');
  // 右栏面板：正文（编辑器/设定卡）或 章详情（该章封面+人物+叙事索引）
  const [rightTab, setRightTab] = useState<RightTab>('body');
  // 专注模式（路线 A）：收起左栏，编辑区铺满；工具栏 ☰ 随时退出。
  const [focusMode, setFocusMode] = useState<'normal' | 'focus' | 'zen'>('normal');
  // 禅模式打字机滚动用：聚焦模式下光标所在段落自动滚动居中（编辑器回调闭包读到的最新值）
  const focusModeRef = useRef<'normal' | 'focus' | 'zen'>('normal');
  focusModeRef.current = focusMode;
  const navigate = useNavigate();

  // 打开 AI 设置：写作台独立窗口（standalone 分支）没有 /ai 路由，直接 navigate
  // 会把沉浸窗口打回主布局形态且丢 desk=1 标记——emit open-ai-settings 让主窗口
  // 接管导航（同 WorkbenchAiPanel 先例）；主窗口 /writing 保持原路由跳转。
  const goAiSettings = useCallback(() => {
    if (isWritingDeskWindow()) {
      void emit('open-ai-settings');
    } else {
      // T7：写作台跳转 /ai 时自动携带当前书籍/章节参数，锁定上下文
      const qp = activeBookId ? `?book=${activeBookId}${activeChapterId ? '&chapter=' + activeChapterId : ''}` : '';
      navigate(`/ai${qp}`);
    }
  }, [navigate, activeBookId, activeChapterId]);

  // ─── P3 正文排版：per-book 持久化（localStorage），切书即换排版 ───
  const theme = useTheme();
  const [typo, setTypoState] = useState<BookTypography>(() => loadTypography(null));
  const [typoAnchor, setTypoAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTypoState(loadTypography(activeBookId));
  }, [activeBookId]);
  const setTypo = (patch: Partial<BookTypography>) => {
    setTypoState((prev) => {
      const next = { ...prev, ...patch };
      saveTypography(activeBookId, next);
      return next;
    });
  };
  const editorBodySx = buildEditorBodySx(typo, theme.palette.mode === 'dark');

  // ─── 自动审阅规则（P3）：复用模块通用的 AutoAnalysisPanel ───
  const [autoDialogOpen, setAutoDialogOpen] = useState(false);

  // ─── 写作统计（P4） ───
  const [statsOpen, setStatsOpen] = useState(false);
  // D 对话式 AI：聊天面板 + agent 记忆（同窗口内记住上次选择，修「agent 不重选不记忆」缺口）
  const [bookSearchOpen, setBookSearchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // T4：灵感/快速笔记收集器
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  // ─── T5 崩溃恢复：localStorage 兜底草稿 + 恢复提示 ───
  // 语义见 utils/writingCrashRecovery.ts：草稿存在 ⟺ 最后一次入库后仍有未确认输入。
  const lastDraftSnapAtRef = useRef(0);
  // 同一章同一次会话只提示一次，避免「恢复后继续写作」期间反复弹条
  const seenDraftKeysRef = useRef<Set<string>>(new Set());
  const activeBookIdRef = useRef<string | null>(activeBookId);
  useEffect(() => {
    activeBookIdRef.current = activeBookId;
  }, [activeBookId]);
  const [recoverDraft, setRecoverDraft] = useState<{
    chapterId: string;
    chapterTitle: string;
    snap: WritingDraftSnap;
  } | null>(null);
  // 启动清扫过期草稿（TTL 7 天），防 localStorage 膨胀；纯数据操作，失败无害
  useEffect(() => {
    clearExpiredDrafts();
  }, []);

  // ─── 人物出场图谱（原实体图鉴迁入）：全书 × 设定出场热力矩阵 ───
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  // ─── 批次③ 效率：⌘K 跳章 / 快捷键速查 / 导出收纳 / 版本快照（批次④） ───
  const [quickJumpOpen, setQuickJumpOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  // 选区字数（底栏显示）：跟随编辑器 selectionUpdate/transaction 刷新
  const [selectedChars, setSelectedChars] = useState(0);

  // ─── 章节拖拽排序（P3）：原生 HTML5 DnD，零新依赖 ───
  const reorderChapter = useWritingStore((s) => s.reorderChapter);
  const dragChapterIdRef = useRef<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // ─── 对话框状态（新建/重命名/删除 书、章、设定 共用一套）───
  // 已抽离到 useDialogActions hook（dialog/dialogText/recycleBin/wizard/回收站统一管理）
  const [annotationDraft, setAnnotationDraft] = useState<{ excerpt: string } | null>(null);
  const [annotationText, setAnnotationText] = useState('');
  const [annotationView, setAnnotationView] = useState<WritingAnnotation | null>(null);
  const [chapterAnnotations, setChapterAnnotations] = useState<WritingAnnotation[]>([]);
  // 表格操作菜单锚点：光标落在表格内时，表格按钮点击弹出增删行/列菜单
  const [tableMenuAnchor, setTableMenuAnchor] = useState<HTMLElement | null>(null);
  // 多色高亮色板
  const [highlightAnchor, setHighlightAnchor] = useState<HTMLElement | null>(null);
  const [highlightOpen, setHighlightOpen] = useState(false);

  // 羽化 P：新建作品走共享命名向导（NewBookDialog），与书架/代码场景入口同一组件
  const [newBookOpen, setNewBookOpen] = useState(false);

  // ─── P1 创作体系：建书向导（体裁+载体）与已有书体裁编辑的选中态 ───
  const [wizardGenre, setWizardGenre] = useState('');
  const [wizardMedium, setWizardMedium] = useState('');

  // ─── 全文检索（P5）：标题/正文过滤章节列表 ───
  const [chapterQuery, setChapterQuery] = useState('');

  // ─── 批量章节管理（P9）：多选 → 移卷 / 删除（状态机抽离到 hook） ───
  const { selectionMode, setSelectionMode, selectedChapterIds, setSelectedChapterIds, toggleSelectionMode } =
    useBatchOperations();

  // ─── 查找替换（P9）：当前章节内 ───
  const [frOpen, setFrOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  // ─── 校对（批次③ T5）：错别字/重复用词/敏感词检测 + 编辑器内定位 ───
  const [proofreadOpen, setProofreadOpen] = useState(false);
  const [proofreadIssues, setProofreadIssues] = useState<ProofreadIssue[]>([]);
  const [activeProofreadKey, setActiveProofreadKey] = useState<string>('');
  // 输入防抖后重检的 timer
  const proofreadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proofreadTextRef = useRef<string>('');
  const runProofreadDebounced = useCallback(() => {
    if (proofreadTimerRef.current) {
      clearTimeout(proofreadTimerRef.current);
    }
    proofreadTimerRef.current = setTimeout(() => {
      const text = proofreadTextRef.current;
      if (!text.trim()) {
        setProofreadIssues([]);
        setActiveProofreadKey('');
        return;
      }
      setProofreadIssues(runProofread(text));
      // 定位高亮在点选条目时设置；重检后清掉旧高亮，避免指向失效区间
      setActiveProofreadKey('');
    }, 1200);
  }, []);

  useEffect(() => {
    loadBooks().catch(() => {});
  }, [loadBooks]);

  // ─── P1 跳转语义：定位到具体章节/设定 ───
  // 三路入口共用 focusWritingTarget：
  // ① location.state —— 主窗口内兜底路由（react-router state）
  // ② query 参数 —— 写作台独立窗口冷启动（WebviewWindow 传不了 state，走 /writing?desk=1&book=..&chapter=..）
  // ③ writing-desk-focus 事件 —— 独立窗口已存在时，入口侧 emit 让窗口内部切章/设定
  const location = useLocation();
  // 定位目标统一用 react-router state 的 focus* 命名（历史约定）；
  // 窗口事件载荷是 WritingDeskFocus（bookId/chapterId/settingId），入口处翻译。
  interface FocusTarget {
    focusBook?: string | null;
    focusChapter?: string | null;
    focusSetting?: string | null;
  }
  const focusWritingTarget = useCallback(
    async (focus: FocusTarget | null) => {
      if (!focus || (!focus.focusChapter && !focus.focusSetting)) return;
      logger.info('WritingPage', 'focus consumed', {
        focusBook: focus.focusBook ?? null,
        focusChapter: focus.focusChapter ?? null,
        focusSetting: focus.focusSetting ?? null,
        currentActiveBookId: useWritingStore.getState().activeBookId,
      });
      try {
        if (focus.focusBook && focus.focusBook !== useWritingStore.getState().activeBookId) {
          await setActiveBook(focus.focusBook);
        }
        if (focus.focusChapter) {
          setLeftTab('chapters');
          setActiveChapter(focus.focusChapter);
        } else if (focus.focusSetting) {
          setLeftTab('settings');
          setActiveSetting(focus.focusSetting);
        }
      } catch (e) {
        logger.warn('WritingPage', 'focus target apply failed', { error: String(e) });
      }
    },
    [setActiveBook, setActiveChapter, setActiveSetting],
  );

  // ① location.state：一次性消费，定位完成后立即清空（replace），避免后退/重挂载时重复跳定位。
  useEffect(() => {
    const st = (location.state ?? null) as FocusTarget | null;
    if (!st || (!st.focusChapter && !st.focusSetting)) return;
    void focusWritingTarget(st).finally(() => {
      navigate(location.pathname, { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, focusWritingTarget]);

  // ② query 参数：写作台独立窗口冷启动定位，消费后立即清 query。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('desk') && !params.has('book') && !params.has('chapter') && !params.has('setting')) return;
    const focus: FocusTarget = {
      focusBook: params.get('book'),
      focusChapter: params.get('chapter'),
      focusSetting: params.get('setting'),
    };
    void focusWritingTarget(focus).finally(() => {
      // 清定位参数但保留 desk=1 标记：独立窗口沉浸判定（App.isWritingDeskWindow）依赖它，
      // 清掉会闪回主布局（侧边栏+导航栏）
      navigate(params.has('desk') ? { pathname: location.pathname, search: '?desk=1' } : location.pathname, {
        replace: true,
      });
    });
    // 仅冷启动跑一次；navigate replace 后定位参数已清，effect 不再命中
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusWritingTarget]);

  // ③ 事件联动：独立窗口已存在时，入口侧 emit writing-desk-focus，窗口内部切章/设定。
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<WritingDeskFocus>(WRITING_DESK_FOCUS_EVENT, (e) => {
      logger.info('WritingPage', 'desk focus event received', { payload: e.payload });
      void focusWritingTarget({
        focusBook: e.payload.bookId,
        focusChapter: e.payload.chapterId,
        focusSetting: e.payload.settingId,
      });
    }).then((u) => (un = u));
    return () => un?.();
  }, [focusWritingTarget]);

  const activeBook = books.find((b) => b.id === activeBookId) ?? null;
  const activeChapter = chapters.find((c) => c.id === activeChapterId) ?? null;
  const activeSetting = settings.find((x) => x.id === activeSettingId) ?? null;
  const genre = activeBook?.genre ?? '';

  // ─── 章级提醒条（与正文纸面卡同一口径口径，禁第二份）───
  const payableForeshadowings = useMemo(
    () =>
      activeChapterId
        ? foreshadowingsPayableIn(foreshadowings, activeChapterId).filter((f) => f.status === 'pending')
        : [],
    [foreshadowings, activeChapterId],
  );
  const inspirationReminders = useMemo(() => {
    if (!activeChapterId) return [];
    const chapterIdeas = ideasOfChapter(outlines, activeChapterId);
    return chapterIdeas.filter(
      (b) => !beatImported(timelineEvents, beatEventText(b)) && !beatPlantedAsForeshadowing(foreshadowings, b),
    );
  }, [outlines, timelineEvents, foreshadowings, activeChapterId]);
  const proofreadReminders = useMemo(() => {
    if (!activeChapter) return [];
    return chapterTextIssues(activeChapter);
  }, [activeChapter]);

  // ─── 章间导航（路线 A）：基于当前书 chapters（sortOrder 顺序），严格不跨书 ───
  const activeChapterIdx = activeChapterId ? chapters.findIndex((c) => c.id === activeChapterId) : -1;
  const hasPrevChapter = activeChapterIdx > 0;
  const hasNextChapter = activeChapterIdx >= 0 && activeChapterIdx < chapters.length - 1;
  const goPrevChapter = useCallback(() => {
    if (hasPrevChapter) setActiveChapter(chapters[activeChapterIdx - 1].id);
  }, [hasPrevChapter, activeChapterIdx, chapters, setActiveChapter]);
  const goNextChapter = useCallback(() => {
    if (hasNextChapter) setActiveChapter(chapters[activeChapterIdx + 1].id);
  }, [hasNextChapter, activeChapterIdx, chapters, setActiveChapter]);

  // ─── 快捷键：⌘[ / ⌘] 章间导航（macOS 上 ⌘[ 默认是浏览器后退，必须 preventDefault） ───
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '[') {
        e.preventDefault();
        goPrevChapter();
      } else if (e.key === ']') {
        e.preventDefault();
        goNextChapter();
      } else if (e.key === 'f' || e.key === 'F') {
        // ⌘F 查找替换：接住浏览器默认查找，统一走编辑器内替换
        e.preventDefault();
        if (activeChapter) setFrOpen(true);
      } else if (e.key === 'k' || e.key === 'K') {
        // ⌘K 章节快速跳转
        e.preventDefault();
        if (activeBook) setQuickJumpOpen(true);
      }
      // ⌘S 需要 flushSave（声明在下方）——放在其后独立的 keydown effect 里
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPrevChapter, goNextChapter, activeChapter, activeBook]);

  // ─── P1 性能：章列表过滤 / 下标 memo 化（避免每渲染重扫整书正文、O(n²) 查下标） ───
  const chapterSearchQuery = chapterQuery.trim().toLowerCase();
  const chapterIndexById = useMemo(() => {
    const m = new Map<string, number>();
    chapters.forEach((c, i) => m.set(c.id, i));
    return m;
  }, [chapters]);
  const visibleChapters = useMemo(
    () =>
      chapterSearchQuery.length > 0
        ? chapters.filter(
            (c) =>
              c.title.toLowerCase().includes(chapterSearchQuery) ||
              (c.content || '')
                .replace(/<[^>]*>/g, '')
                .toLowerCase()
                .includes(chapterSearchQuery),
          )
        : chapters,
    [chapters, chapterSearchQuery],
  );

  // 章节树用于落章下拉（仅章详情面板使用，与左栏旧大纲无直接耦合）
  const chapterRowsForBind = useMemo(() => {
    const rows: { id: string; title: string; depth: number }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        rows.push({ id: n.node.id, title: n.node.title, depth: n.depth });
        walk(n.children);
      }
    };
    walk(buildTree(chapters));
    return rows;
  }, [chapters]);

  // ─── 正文自动保存：pending 快照 + 防抖 timer ───
  const pendingRef = useRef<{ chapterId: string; html: string; wordCount: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChapterIdRef = useRef<string | null>(activeChapterId);
  // 保存失败 toast 节流（10s 内最多弹一次）
  const lastSaveFailToastRef = useRef(0);
  useEffect(() => {
    activeChapterIdRef.current = activeChapterId;
  }, [activeChapterId]);

  const flushSave = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    setSaveStateRef.current('saving');
    try {
      await saveChapterContent(pending.chapterId, pending.html, pending.wordCount);
      // T5：入库成功即清草稿——草稿存在 ⟺ 有未确认输入（崩溃恢复的判定根基）
      if (activeBookIdRef.current) clearDraftSnap(activeBookIdRef.current, pending.chapterId);
      // 若期间没有产生新的脏内容才标 saved；否则保持 dirty
      setSaveStateRef.current(() => (pendingRef.current ? 'dirty' : 'saved'));
      // 通知底栏「今日新增」等监听方刷新（本地 CustomEvent，零 store 重渲染）
      emitWritingSaved();
    } catch (e) {
      logger.warn('WritingPage', 'auto save failed', { error: e });
      // 失败不丢稿：把待存快照放回 pending——下一次输入/切章/关窗会自动重试
      if (!pendingRef.current) pendingRef.current = pending;
      setSaveStateRef.current('dirty');
      // 失败必须可见（静默失败=用户误以为已保存）：10s 节流，避免连续输入时弹屏
      const now = Date.now();
      if (now - lastSaveFailToastRef.current > 10_000) {
        lastSaveFailToastRef.current = now;
        useToastStore.getState().error(t('writing.saveFailed'));
      }
    }
  }, [saveChapterContent]);

  const scheduleSave = useCallback(
    (chapterId: string, html: string, wordCount: number) => {
      pendingRef.current = { chapterId, html, wordCount };
      setSaveStateRef.current('dirty');
      // T5：节流写 localStorage 崩溃兜底草稿（15s 窗口，不随每次按键落盘）
      const now = Date.now();
      if (now - lastDraftSnapAtRef.current >= DRAFT_SNAP_INTERVAL_MS) {
        lastDraftSnapAtRef.current = now;
        if (activeBookIdRef.current) {
          saveDraftSnap(activeBookIdRef.current, chapterId, html, wordCount, 'auto');
        }
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  // ⌘S 立即保存：不等 800ms 防抖（关窗拦截之外的第二道保险，也给用户确定感）。
  // flushSave 声明在其上方，故独立成 effect（避免 used-before-declaration）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        void flushSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flushSave]);

  // 卸载前 flush（丢给 async，不阻塞卸载）
  useEffect(() => {
    return () => {
      const pending = pendingRef.current;
      if (pending) {
        void useWritingStore
          .getState()
          .saveChapterContent(pending.chapterId, pending.html, pending.wordCount)
          .then(() => {
            // T5：正常退出且入库成功 → 清草稿，避免下次打开误报恢复
            if (activeBookIdRef.current) clearDraftSnap(activeBookIdRef.current, pending.chapterId);
          })
          .catch((e) => logger.warn('WritingPage', 'flush on unmount failed', { error: e }));
      }
      const settingPending = settingPendingRef.current;
      if (settingPending) {
        void useWritingStore
          .getState()
          .updateSetting(settingPending.settingId, settingPending.patch)
          .catch((e) => logger.warn('WritingPage', 'flush setting on unmount failed', { error: e }));
      }
    };
  }, []);

  const editor = useEditor({
    // P3：Placeholder 给空章节引导（tiptap v3 的非核心扩展统一在 @tiptap/extensions 包）
    // 批次② T4：扩展格式（高亮/下划线/超链接/表格）+ 章内批注引用 mark
    extensions: [
      StarterKit,
      Highlight.configure({ multicolor: true }),
      Underline,
      Link.configure({ openOnClick: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      WritingAnnotationExtension,
      Placeholder.configure({ placeholder: t('writing.placeholder') }),
      WritingImage,
    ],
    content: '',
    onUpdate: ({ editor }) => {
      const chapterId = activeChapterIdRef.current;
      if (!chapterId) return;
      scheduleSave(chapterId, editor.getHTML(), chapterWordCount(editor));
      // 批次③ T5：正文输入防抖后自动复检错别字/重复词/敏感词
      proofreadTextRef.current = editor.getText();
      runProofreadDebounced();
    },
    // 禅模式打字机滚动：光标所在块级元素自动滚动到视窗中部
    onSelectionUpdate: ({ editor }) => {
      if (focusModeRef.current !== 'zen') return;
      const scrollEl = editorScrollRef.current;
      if (!scrollEl) return;
      const sel = editor.state.selection;
      if (sel.empty === false) return;
      const dom = editor.view.domAtPos(sel.from);
      // 向上找块级元素（段落/标题/列表项），键盘导航时跳动最小
      let node: HTMLElement | null = dom.node as HTMLElement | null;
      while (node && node !== scrollEl && node.parentElement !== scrollEl) {
        node = node.parentElement;
      }
      if (!node || node === scrollEl) return;
      const rect = node.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const viewH = scrollEl.clientHeight;
      const currentCenter = rect.top - scrollRect.top + rect.height / 2;
      const offsetFromCenter = currentCenter - viewH / 2;
      // 距视窗中部超过 1/4 视高才滚动，避免打字时光标微移导致频繁跳动
      if (Math.abs(offsetFromCenter) < viewH / 4) return;
      scrollEl.scrollTop += offsetFromCenter;
    },
  });

  // 切章：先 flush 上一章未保存内容，再装载新章内容（emitUpdate=false 不触发保存）。
  // 批次④：上一章本轮有改动时，落库的同时**自动存一份版本快照**（恢复点）；
  // 批次③：离开/进入章节时记忆并还原正文滚动位置（长文来回翻不丢位置）。
  const loadedChapterIdRef = useRef<string | null>(null);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollTopByChapterRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!editor) return;
    if (activeChapterId === loadedChapterIdRef.current) return;
    const prevId = loadedChapterIdRef.current;
    if (prevId && editorScrollRef.current) {
      scrollTopByChapterRef.current.set(prevId, editorScrollRef.current.scrollTop);
    }
    // 本轮有未落库改动（pending 未清）才自动存快照——已落库的切章不制造重复检查点；
    // 主动的阶段性存档走工具栏「版本快照」手动入口
    const wasDirty = prevId !== null && pendingRef.current !== null;
    const prevSnapshot = wasDirty
      ? {
          id: `snap_${crypto.randomUUID().replace(/-/g, '')}`,
          chapterId: prevId as string,
          bookId: chapters.find((c) => c.id === prevId)?.bookId ?? '',
          content: editor.getHTML(),
          wordCount: chapterWordCount(editor),
          origin: 'auto',
          createdAt: Math.floor(Date.now() / 1000),
        }
      : null;
    void flushSave();
    if (prevSnapshot) {
      void writingSnapshotsApi.save(prevSnapshot).catch((e) => {
        logger.warn('WritingPage', 'auto snapshot on switch failed', { error: e });
      });
    }
    loadedChapterIdRef.current = activeChapterId;
    const content = activeChapter?.content ?? '';
    editor.commands.setContent(content, { emitUpdate: false });
    setSaveStateRef.current('idle');
    // T5 崩溃恢复：该章存在未确认草稿且本会话未提示过 → 弹恢复条（见 utils/writingCrashRecovery.ts）
    if (activeChapterId && activeBookIdRef.current) {
      const bkId = activeBookIdRef.current;
      const cId = activeChapterId;
      const key = draftKey(bkId, cId);
      if (!seenDraftKeysRef.current.has(key)) {
        const snap = loadDraftSnap(bkId, cId);
        if (snap) {
          seenDraftKeysRef.current.add(key);
          setRecoverDraft({ chapterId: cId, chapterTitle: chapters.find((c) => c.id === cId)?.title ?? '', snap });
        }
      }
    }
    // 批次③ T5：切章后对新内容立即重检（setContent 不触发 onUpdate，需手动）
    proofreadTextRef.current = editor.getText();
    runProofreadDebounced();
    const restored = activeChapterId ? scrollTopByChapterRef.current.get(activeChapterId) : undefined;
    if (restored !== undefined) {
      requestAnimationFrame(() => {
        if (editorScrollRef.current) editorScrollRef.current.scrollTop = restored;
      });
    }
    // 刻意只依赖 id：装载后章节对象更新（保存回写）不应重置编辑器内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeChapterId, flushSave]);

  // 卸载/切章清理校对防抖 timer
  useEffect(() => {
    return () => {
      if (proofreadTimerRef.current) {
        clearTimeout(proofreadTimerRef.current);
        proofreadTimerRef.current = null;
      }
    };
  }, []);

  // ─── 批次② 底栏：选区字数（跟随选择/输入刷新，范围小、开销可忽略） ───
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      setSelectedChars(empty ? 0 : editor.state.doc.textBetween(from, to, ' ', ' ').replace(/\s/g, '').length);
    };
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  // ─── 批次④ 版本快照：手动快照 / 恢复（编辑器实例在本层，恢复动线在这里收口） ───
  const handleManualSnapshot = useCallback(async () => {
    if (!editor || !activeChapterId || !activeChapter) return;
    try {
      await writingSnapshotsApi.save({
        id: `snap_${crypto.randomUUID().replace(/-/g, '')}`,
        chapterId: activeChapterId,
        bookId: activeChapter.bookId,
        content: editor.getHTML(),
        wordCount: chapterWordCount(editor),
        origin: 'manual',
        createdAt: Math.floor(Date.now() / 1000),
      });
      useToastStore.getState().success(t('writing.snapshots.saved'));
    } catch (e) {
      logger.warn('WritingPage', 'manual snapshot failed', { error: e });
      useToastStore.getState().error(String(e));
    }
  }, [editor, activeChapterId, activeChapter]);

  const handleRestoreSnapshot = useCallback(
    (content: string, wordCount: number) => {
      if (!editor || !activeChapterId || !activeChapter) return;
      // 恢复可逆：先把当前正文自动存一份快照，随时可以恢复回来
      void writingSnapshotsApi
        .save({
          id: `snap_${crypto.randomUUID().replace(/-/g, '')}`,
          chapterId: activeChapterId,
          bookId: activeChapter.bookId,
          content: editor.getHTML(),
          wordCount: chapterWordCount(editor),
          origin: 'auto',
          createdAt: Math.floor(Date.now() / 1000),
        })
        .catch((e) => logger.warn('WritingPage', 'pre-restore snapshot failed', { error: e }));
      editor.commands.setContent(content, { emitUpdate: false });
      void saveChapterContent(activeChapterId, content, wordCount).catch((e) => {
        logger.warn('WritingPage', 'restore snapshot save failed', { error: e });
        useToastStore.getState().error(String(e));
      });
      setSaveStateRef.current('idle');
      setSnapshotsOpen(false);
      useToastStore.getState().success(t('writing.snapshots.restored'));
    },
    [editor, activeChapterId, activeChapter, saveChapterContent],
  );

  // ─── T5 崩溃恢复：恢复 / 放弃 ───
  const handleRecoverDraft = useCallback(() => {
    if (!editor || !recoverDraft) return;
    const { chapterId, snap } = recoverDraft;
    editor.commands.setContent(snap.html, { emitUpdate: false });
    // 恢复即入库：确认草稿内容（若入库失败草稿保留，下次仍可恢复）
    void saveChapterContent(chapterId, snap.html, snap.wordCount)
      .then(() => {
        if (activeBookIdRef.current) clearDraftSnap(activeBookIdRef.current, chapterId);
      })
      .catch((e) => logger.warn('WritingPage', 'recover draft save failed', { error: e }));
    setSaveStateRef.current('idle');
    setRecoverDraft(null);
    useToastStore.getState().success(t('writing.draftRecovered'));
  }, [editor, recoverDraft, saveChapterContent]);

  const handleDiscardDraft = useCallback(() => {
    if (!recoverDraft) return;
    if (activeBookIdRef.current) clearDraftSnap(activeBookIdRef.current, recoverDraft.chapterId);
    setRecoverDraft(null);
    useToastStore.getState().info(t('writing.draftDiscarded'));
  }, [recoverDraft]);

  // ─── 章内批注（批次② T4）：切章加载批注（点击批注高亮处时从缓存取，避免逐次查库） ───
  useEffect(() => {
    if (!activeChapterId) {
      setChapterAnnotations([]);
      return;
    }
    let alive = true;
    void writingAnnotationsApi
      .list(activeChapterId)
      .then((rows) => {
        if (alive) setChapterAnnotations(rows);
      })
      .catch((e) => logger.warn('WritingPage', 'load annotations failed', { error: e }));
    return () => {
      alive = false;
    };
  }, [activeChapterId]);

  /** 保存新批注：先落库（拿 id），再把 mark 挂到当前选中文本上 */
  const handleSaveAnnotation = useCallback(async () => {
    if (!editor || !activeChapterId || !activeChapter || !annotationDraft) return;
    const text = annotationText.trim();
    if (!text) {
      useToastStore.getState().error(t('writing.annotationNoText'));
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const ann: WritingAnnotation = {
      id: `ann_${crypto.randomUUID().replace(/-/g, '')}`,
      chapterId: activeChapterId,
      bookId: activeChapter.bookId,
      text,
      excerpt: annotationDraft.excerpt,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await writingAnnotationsApi.save(ann);
      editor.chain().focus().setWritingAnnotation(ann.id).run();
      setChapterAnnotations((prev) => [ann, ...prev]);
      setAnnotationDraft(null);
      setAnnotationText('');
      useToastStore.getState().success(t('writing.annotationAdded'));
    } catch (e) {
      logger.warn('WritingPage', 'save annotation failed', { error: e });
      useToastStore.getState().error(String(e));
    }
  }, [editor, activeChapterId, activeChapter, annotationDraft, annotationText]);

  /** 删除批注：正文剥离 mark + 库删除同步 */
  const handleDeleteAnnotation = useCallback(async () => {
    if (!editor || !annotationView) return;
    const target = annotationView;
    try {
      await writingAnnotationsApi.delete(target.id);
      editor.commands.unsetWritingAnnotation(target.id);
      setChapterAnnotations((prev) => prev.filter((a) => a.id !== target.id));
      setAnnotationView(null);
      useToastStore.getState().success(t('writing.annotationDeleted'));
    } catch (e) {
      logger.warn('WritingPage', 'delete annotation failed', { error: e });
      useToastStore.getState().error(String(e));
    }
  }, [editor, annotationView]);

  // 工具栏「批注」：有选中文本才允许添加；否则轻提示
  const handleStartAnnotation = useCallback(() => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      useToastStore.getState().error(t('writing.annotationSelectFirst'));
      return;
    }
    const excerpt = editor.state.doc.textBetween(from, to, ' ', ' ');
    setAnnotationText('');
    setAnnotationDraft({ excerpt: excerpt.slice(0, 140) });
  }, [editor]);

  // 点击正文中的批注高亮 → 打开查看弹窗
  const handleEditorClickForAnnotation = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as HTMLElement).closest('span[data-annotation-id]');
      if (!el) return;
      const id = el.getAttribute('data-annotation-id');
      if (!id) return;
      const ann = chapterAnnotations.find((a) => a.id === id);
      if (ann) setAnnotationView(ann);
    },
    [chapterAnnotations],
  );

  // ─── 设定卡编辑：本地副本 + 防抖落库 ───
  // P4：extra 从纯透传字符串升级为结构化编辑（relations/timeline），落库时序列化回 JSON
  interface SettingDraftShape {
    name: string;
    subtitle: string;
    description: string;
    extra: WritingSettingExtra;
  }
  const [settingDraft, setSettingDraft] = useState<SettingDraftShape>({
    name: '',
    subtitle: '',
    description: '',
    extra: {},
  });
  const settingPendingRef = useRef<{
    settingId: string;
    patch: { name: string; subtitle: string; description: string; extra: string };
  } | null>(null);
  const settingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSettingSave = useCallback(async () => {
    if (settingTimerRef.current) {
      clearTimeout(settingTimerRef.current);
      settingTimerRef.current = null;
    }
    const pending = settingPendingRef.current;
    if (!pending) return;
    settingPendingRef.current = null;
    try {
      await updateSetting(pending.settingId, pending.patch);
    } catch (e) {
      logger.warn('WritingPage', 'setting auto save failed', { error: e });
    }
  }, [updateSetting]);

  // ─── AI 写作（审视/对话/内联续写润色）统一抽离到 useAiActions hook ───
  // 依赖 flushSave/flushSettingSave/editor/activeBook 等都已在上面声明，此处调用安全。
  const {
    handleOpenAiDialog,
    handleLaunchAi,
    handleAnalyzeBook,
    buildChatContext,
    openInlineDialog,
    buildInlineContext,
    handleRunInline,
    handleApplyInlineResult,
    aiDialogOpen,
    setAiDialogOpen,
    aiPresetKey,
    setAiPresetKey,
    aiAgentId,
    setAiAgentId,
    aiLaunching,
    chatOpen,
    setChatOpen,
    chatAgentId,
    setChatAgentId,
    insightsDialogOpen,
    setInsightsDialogOpen,
    inlineDialogOpen,
    setInlineDialogOpen,
    inlineKind,
    setInlineKind,
    inlineAgentId,
    setInlineAgentId,
    inlineRunning,
    inlineStreamText,
    inlineResult,
    setInlineResult,
    inlineSelChars,
    inlineWords,
    setInlineWords,
    inlineDirective,
    setInlineDirective,
    inlineStyle,
    setInlineStyle,
    agents,
    writingPresets,
    streamPreviewRef,
    inlineSelectionRef,
  } = useAiActions(
    activeBook,
    activeChapter,
    editor,
    settings,
    outlines,
    chapters,
    timelineEvents,
    flushSave,
    flushSettingSave,
    () => setAppearanceOpen(true),
  );

  // ─── 对话框状态机（新建/重命名/删除/移卷/批量/回收站）统一抽离到 useDialogActions hook ───
  const {
    dialog,
    setDialog,
    dialogText,
    setDialogText,
    recycleBinOpen,
    setRecycleBinOpen,
    permanentDeleteTarget,
    setPermanentDeleteTarget,
    openDialog,
    handleDialogConfirm,
    handleRestoreChapter,
    handlePermanentDelete,
    dialogTitle,
    isDeleteDialog,
    dialogBody,
  } = useDialogActions({
    editor,
    activeBookId,
    selectedChapterIds,
    setSelectionMode,
    setSelectedChapterIds,
  });

  // ─── 关窗保稿（批次①）：窗口关闭先 flush 未保存正文/设定卡再放行 ───
  // 卸载 flush 是 fire-and-forget，Tauri 关窗即销毁 webview，IPC 可能没跑完——
  // 必须拦下 close 事件、等 flush 落库完成后再销毁窗口。800ms 防抖窗口内关窗不再丢稿。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closing = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (closing) return;
        if (!pendingRef.current && !settingPendingRef.current) return; // 无脏内容：放行默认关闭
        event.preventDefault();
        closing = true;
        try {
          await flushSave();
          await flushSettingSave();
        } catch (e) {
          logger.warn('WritingPage', 'flush on close failed', { error: e });
        }
        await getCurrentWindow().destroy();
      })
      .then((u) => {
        unlisten = u;
      });
    return () => unlisten?.();
  }, [flushSave, flushSettingSave]);

  // 切换设定卡：flush 上一张，装载新卡
  const loadedSettingIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeSettingId === loadedSettingIdRef.current) return;
    void flushSettingSave();
    loadedSettingIdRef.current = activeSettingId;
    if (activeSetting) {
      setSettingDraft({
        name: activeSetting.name,
        subtitle: activeSetting.subtitle,
        description: activeSetting.description,
        extra: parseSettingExtra(activeSetting.extra),
      });
    }
    // 刻意只依赖 id：保存回写不应覆盖正在编辑的本地副本
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSettingId, flushSettingSave]);

  /** 整草稿编辑 + 防抖落库（extra 序列化为 JSON 透传） */
  const editSettingDraft = (next: SettingDraftShape) => {
    setSettingDraft(next);
    if (!activeSetting) return;
    settingPendingRef.current = {
      settingId: activeSetting.id,
      patch: {
        name: next.name,
        subtitle: next.subtitle,
        description: next.description,
        extra: JSON.stringify(next.extra),
      },
    };
    if (settingTimerRef.current) clearTimeout(settingTimerRef.current);
    settingTimerRef.current = setTimeout(() => {
      void flushSettingSave();
    }, SAVE_DEBOUNCE_MS);
  };

  const handleSettingFieldChange = (field: 'name' | 'subtitle' | 'description', value: string) => {
    editSettingDraft({ ...settingDraft, [field]: value });
  };

  // ─── 关系 / 时间线（P4，仅人设卡）：extra 内的行编辑 ───
  const updateExtra = (mutate: (e: WritingSettingExtra) => void) => {
    const next: WritingSettingExtra = { ...settingDraft.extra };
    mutate(next);
    editSettingDraft({ ...settingDraft, extra: next });
  };
  const setRelationRow = (idx: number, field: 'target' | 'type' | 'targetId', value: string) => {
    updateExtra((e) => {
      const arr = [...(e.relations ?? [])];
      const cur = arr[idx] ?? { target: '', type: '' };
      const next = { ...cur, [field]: value };
      if (field === 'targetId' && value) {
        const picked = settings.find((s) => s.id === value);
        next.target = picked?.name ?? '';
      }
      arr[idx] = next;
      e.relations = arr;
    });
  };
  const addRelation = () =>
    updateExtra((e) => {
      e.relations = [...(e.relations ?? []), { target: '', type: '' }];
    });
  const removeRelation = (idx: number) =>
    updateExtra((e) => {
      e.relations = (e.relations ?? []).filter((_, i) => i !== idx);
    });
  const setTimelineRow = (eventId: string, field: 'at' | 'event' | 'chapterId', value: string) => {
    const patch: Partial<Pick<WritingTimelineEvent, 'at' | 'event' | 'chapterId'>> =
      field === 'chapterId' ? { chapterId: value || null } : { [field]: value };
    void updateTimelineEvent(eventId, patch);
  };

  /** 人设档案（结构化字段）：写入 / 清空 extra.profile，空对象则删除键，零迁移 */
  const setProfileField = (field: keyof WritingSettingProfile, value: string) => {
    updateExtra((e) => {
      const profile: WritingSettingProfile = { ...(e.profile ?? {}) };
      if (value) profile[field] = value;
      else delete profile[field];
      if (Object.keys(profile).length > 0) e.profile = profile;
      else delete e.profile;
    });
  };
  /** 世界观档案（结构化字段）：写入 / 清空 extra.worldbuildingProfile，零迁移（与 setProfileField 并列） */
  const setWbProfileField = (field: keyof WritingWorldbuildingProfile, value: string) => {
    updateExtra((e) => {
      const wb: WritingWorldbuildingProfile = { ...(e.worldbuildingProfile ?? {}) };
      if (value) wb[field] = value;
      else delete wb[field];
      if (Object.keys(wb).length > 0) e.worldbuildingProfile = wb;
      else delete e.worldbuildingProfile;
    });
  };
  const addTimeline = () => {
    void createTimelineEvent({ settingId: activeSettingId, at: '', event: '' });
  };
  // 全书级事件（settingId=null）：修复「全书」lane 无创建入口的缺口
  const addBookTimeline = () => {
    void createTimelineEvent({ settingId: null, at: '', event: '' });
  };
  const removeTimeline = (eventId: string) => {
    void deleteTimelineEvent(eventId);
  };

  // ─── 导出与备份恢复（T7）：统一抽离到 useExportActions hook ───
  const exportActions = useExportActions(activeBook, flushSave, flushSettingSave, loadBooks);
  const {
    handleExportMarkdown,
    handleExportEpub,
    handleExportHtml,
    handleExportText,
    handleExportDocx,
    handleExportPdf,
    handleBackupBook,
    handleRestoreBook,
  } = exportActions;

  // ─── 写作统计（P4）：先 flush 未保存内容，让今天的快照是最新的 ───
  const handleOpenStats = useCallback(async () => {
    await flushSave();
    await flushSettingSave();
    setStatsOpen(true);
  }, [flushSave, flushSettingSave]);

  // ─── 人物出场图谱：先 flush 未保存内容，再打开图谱（数据来自最后一次扫描） ───
  const handleOpenAppearance = useCallback(async () => {
    await flushSave();
    await flushSettingSave();
    setAppearanceOpen(true);
  }, [flushSave, flushSettingSave]);

  // 骨架走查 P2-G3：TXT 批量导入——分章已在对话框内完成，此处逐章建章+落正文
  const handleImportTxt = useCallback(
    async (parsed: ParsedChapter[]) => {
      let created = 0;
      for (const c of parsed) {
        const ch = await createChapter(c.title);
        if (!ch) continue;
        await saveChapterContent(ch.id, textToChapterHtml(c.body), countChapterWords(c.body));
        created++;
      }
      useToastStore.getState().success(t('writing.importTxtDone', { n: created }));
      setImportOpen(false);
    },
    [createChapter, saveChapterContent],
  );

  // ─── 羽化 P：新建作品（共享命名向导）—— 写作台新建后**停留在写作台**（不跳工作室）───
  const createBookInDesk = useCallback(
    async (name: string, genre: string, medium: string): Promise<NewBookResult> => {
      const book = await createBook(name, genre, medium);
      await setActiveBook(book.id);
      useToastStore.getState().success(t('dashboard.createdBook', { title: book.title }));
      return { id: book.id, title: book.title };
    },
    [createBook, setActiveBook],
  );
  const handleNewBookError = useCallback((e: unknown) => {
    useToastStore.getState().error(t('dashboard.createFail', { msg: String(e) }));
  }, []);

  // ─── 工具栏按钮 ───
  const { toolButtons, toolbarBtnSx } = useToolbarButtons({
    editor,
    openDialog,
    handleStartAnnotation,
    setTableMenuAnchor,
  });

  const characters = settings.filter((x) => x.kind === 'character');
  const worldbuilding = settings.filter((x) => x.kind === 'worldbuilding');

  /** 设定条目行（人设卡 / 世界观共用） */
  const renderSettingRow = (setting: (typeof settings)[number]) => {
    const selected = setting.id === activeSettingId;
    return (
      <Box
        key={setting.id}
        onClick={() => setActiveSetting(setting.id)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.6,
          borderRadius: 1.5,
          cursor: 'pointer',
          bgcolor: selected ? 'rgba(74,51,143,0.08)' : 'transparent',
          '&:hover': { bgcolor: 'action.hover' },
          '& .row-actions': { opacity: 0 },
          '&:hover .row-actions': { opacity: 1 },
        }}
      >
        <Box sx={{ flexShrink: 0, display: 'flex', color: selected ? 'primary.main' : 'text.disabled' }}>
          {setting.kind === 'character' ? (
            <PersonRoundedIcon sx={{ fontSize: 15 }} />
          ) : (
            <PublicRoundedIcon sx={{ fontSize: 15 }} />
          )}
        </Box>
        <Typography noWrap sx={{ fontSize: 12.5, fontWeight: selected ? 600 : 400, flex: 1, minWidth: 0 }}>
          {setting.name}
          {setting.subtitle && (
            <Box component="span" sx={{ color: 'text.disabled', ml: 0.75, fontSize: 11 }}>
              {setting.subtitle}
            </Box>
          )}
        </Typography>
        <Box className="row-actions" sx={{ display: 'flex', transition: 'opacity 0.15s' }}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              openDialog({ kind: 'rename-setting', settingId: setting.id }, setting.name);
            }}
            aria-label={t('writing.renameSettingTitle')}
          >
            <EditRoundedIcon sx={{ fontSize: 13 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              openDialog({ kind: 'delete-setting', settingId: setting.id });
            }}
            aria-label={t('writing.deleteSettingTitle')}
          >
            <DeleteOutlineRoundedIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0, height: '100%' }}>
      {/* ─── 左栏：书架 + 章节数/设定 双 tab ─── */}
      <Paper
        variant="outlined"
        sx={{
          width: 280,
          flexShrink: 0,
          display: focusMode !== 'normal' ? 'none' : 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{ px: 1.5, pt: 1.5, pb: 0.75, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.5,
              color: 'text.secondary',
              textTransform: 'uppercase',
            }}
          >
            {t('writing.title')}
          </Typography>
          <Box sx={{ display: 'flex' }}>
            <Tooltip title={t('writing.analyze')}>
              <span>
                <IconButton
                  size="small"
                  disabled={!activeBook}
                  onClick={() => void handleAnalyzeBook()}
                  aria-label={t('writing.analyze')}
                >
                  <HubRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.stats')}>
              <span>
                <IconButton
                  size="small"
                  disabled={!activeBook}
                  onClick={() => void handleOpenStats()}
                  aria-label={t('writing.stats')}
                >
                  <InsightsRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.appearanceMap.title')}>
              <span>
                <IconButton
                  size="small"
                  disabled={!activeBook}
                  onClick={() => void handleOpenAppearance()}
                  aria-label={t('writing.appearanceMap.title')}
                >
                  <GroupsRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.recycleBin')}>
              <span>
                <IconButton
                  size="small"
                  disabled={!activeBook}
                  onClick={() => setRecycleBinOpen(true)}
                  aria-label={t('writing.recycleBin')}
                >
                  <DeleteSweepRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.newBook')}>
              <IconButton
                size="small"
                color="primary"
                onClick={() => setNewBookOpen(true)}
                aria-label={t('writing.newBook')}
              >
                <AddRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        <Box sx={{ overflowY: 'auto', flexShrink: 0, maxHeight: '45%', px: 1, pb: 1 }}>
          {books.length === 0 && !booksLoading && (
            <Box sx={{ textAlign: 'center', px: 2, py: 5 }}>
              <MenuBookRoundedIcon sx={{ fontSize: 34, color: 'text.disabled', mb: 1 }} />
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.secondary' }}>
                {t('writing.emptyBooks')}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 0.5 }}>
                {t('writing.emptyBooksHint')}
              </Typography>
            </Box>
          )}
          {books.map((book) => {
            const selected = book.id === activeBookId;
            return (
              <Box
                key={book.id}
                onClick={() => void setActiveBook(book.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  py: 0.75,
                  borderRadius: 1.5,
                  cursor: 'pointer',
                  bgcolor: selected ? 'rgba(74,51,143,0.08)' : 'transparent',
                  '&:hover': { bgcolor: 'action.hover' },
                  '& .row-actions': { opacity: 0 },
                  '&:hover .row-actions': { opacity: 1 },
                }}
              >
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: book.coverColor, flexShrink: 0 }} />
                <Typography noWrap sx={{ fontSize: 13, fontWeight: selected ? 600 : 400, flex: 1, minWidth: 0 }}>
                  {book.title}
                </Typography>
                {/* P1 创作体系：体裁/载体一眼可见（未设置显示「未设置」引导补选） */}
                <Chip
                  size="small"
                  label={t(genreLabelKey(book.genre))}
                  sx={{ height: 16, fontSize: 9, flexShrink: 0, '& .MuiChip-label': { px: 0.5 } }}
                />
                {book.medium && (
                  <Chip
                    size="small"
                    label={t(mediumLabelKey(book.medium))}
                    sx={{ height: 16, fontSize: 9, flexShrink: 0, '& .MuiChip-label': { px: 0.5 } }}
                  />
                )}
                <Box className="row-actions" sx={{ display: 'flex', transition: 'opacity 0.15s' }}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDialog({ kind: 'edit-book-meta', bookId: book.id });
                    }}
                    aria-label={t('writing.editBookMeta')}
                  >
                    <CategoryRoundedIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDialog({ kind: 'rename-book', bookId: book.id }, book.title);
                    }}
                    aria-label={t('writing.renameBookTitle')}
                  >
                    <EditRoundedIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDialog({ kind: 'delete-book', bookId: book.id });
                    }}
                    aria-label={t('writing.deleteBookTitle')}
                  >
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              </Box>
            );
          })}
        </Box>

        {focusMode === 'normal' && activeBook && (
          <>
            <Divider />
            <Tabs
              value={leftTab}
              onChange={(_, v: LeftTab) => setLeftTab(v)}
              variant="fullWidth"
              sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, fontSize: 12.5 } }}
            >
              <Tab value="chapters" label={t('writing.tabChapters')} />
              <Tab value="settings" label={t('writing.tabSettings')} />
              <Tab value="notes" label={t('writing.tabNotes')} />
            </Tabs>
            <Box sx={{ overflowY: 'auto', flex: 1, minHeight: 0, px: 1, pb: 1 }}>
              {leftTab === 'chapters' && (
                <>
                  <Box
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5, px: 0.5 }}
                  >
                    <Tooltip title={t('writing.dragSort')}>
                      <Typography
                        sx={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 0.5,
                          color: 'text.disabled',
                          textTransform: 'uppercase',
                        }}
                      >
                        {t('writing.tabChapters')}
                      </Typography>
                    </Tooltip>
                    <Box sx={{ display: 'flex' }}>
                      <Tooltip title={t('writing.bookSearchTitle')}>
                        <IconButton
                          size="small"
                          onClick={() => setBookSearchOpen(true)}
                          aria-label={t('writing.bookSearchTitle')}
                        >
                          <SearchRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('writing.importTxtTitle')}>
                        <IconButton
                          size="small"
                          onClick={() => setImportOpen(true)}
                          aria-label={t('writing.importTxtTitle')}
                        >
                          <NoteAddRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('writing.batchManage')}>
                        <IconButton
                          size="small"
                          color={selectionMode ? 'primary' : 'default'}
                          onClick={toggleSelectionMode}
                          aria-label={t('writing.batchManage')}
                        >
                          <ChecklistRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('writing.newChapter')}>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => openDialog({ kind: 'new-chapter' })}
                          aria-label={t('writing.newChapter')}
                        >
                          <AddRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                  {/* 全文检索（P5）：标题/正文即时过滤；检索中禁用拖拽（索引语义不同） */}
                  <Box sx={{ px: 0.5, pb: 0.75 }}>
                    <TextField
                      fullWidth
                      size="small"
                      placeholder={t('writing.searchChapters')}
                      value={chapterQuery}
                      onChange={(e) => setChapterQuery(e.target.value)}
                      slotProps={{
                        input: {
                          startAdornment: <SearchRoundedIcon sx={{ fontSize: 15, color: 'text.disabled', mr: 0.75 }} />,
                          sx: { fontSize: 12.5, '& .MuiInputBase-input': { fontSize: 12.5, py: 0.5 } },
                        },
                      }}
                    />
                  </Box>
                  {/* P1 性能：章列表抽为 React.memo 组件——saveState 每 800ms 翻转时 props 全为稳定引用，跳过重渲染。
                      2026-09-22 起改为**树形**渲染（按 parentId 父子关系缩进，与工作室「作品目录树」同一口径）：
                      行身拖动 = 移到该行之前（原语义），⠿ 手柄拖动 = 挂为其子级，行尾 ＋ = 加子级。 */}
                  <ChapterTreePanel
                    chapters={chapters}
                    visibleChapters={visibleChapters}
                    chapterIndexById={chapterIndexById}
                    activeChapterId={activeChapterId}
                    chapterQuery={chapterQuery}
                    chapterSearchQuery={chapterSearchQuery}
                    selectionMode={selectionMode}
                    selectedChapterIds={selectedChapterIds}
                    setSelectedChapterIds={setSelectedChapterIds}
                    setActiveSetting={setActiveSetting}
                    setActiveChapter={setActiveChapter}
                    onOpenChapterDetails={(id) => {
                      setActiveSetting(null);
                      setActiveChapter(id);
                      setRightTab('details');
                    }}
                    dragChapterIdRef={dragChapterIdRef}
                    flushSave={flushSave}
                    setDropIndex={setDropIndex}
                    reorderChapter={reorderChapter}
                    reparentNode={reparentNode}
                    dropIndex={dropIndex}
                    openDialog={openDialog}
                    outlines={outlines}
                    genre={activeBook?.genre ?? ''}
                    collapsedNodeIds={collapsedNodeIds}
                    toggleNodeCollapse={toggleNodeCollapse}
                    createChildNode={createChildNode}
                  />
                  {/* 批量操作栏（P9） */}
                  {selectionMode && selectedChapterIds.length > 0 && (
                    <Box
                      sx={{
                        px: 1,
                        py: 0.75,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        borderTop: 1,
                        borderColor: 'divider',
                      }}
                    >
                      <Typography sx={{ fontSize: 11, color: 'text.secondary', flex: 1 }}>
                        {t('writing.batchSelected', { n: selectedChapterIds.length })}
                      </Typography>
                      <Tooltip title={t('writing.batchMove')}>
                        <IconButton
                          size="small"
                          onClick={() => openDialog({ kind: 'move-volume-batch' })}
                          aria-label={t('writing.batchMove')}
                        >
                          <DriveFileMoveRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('nav.delete')}>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => openDialog({ kind: 'delete-chapters-batch' })}
                          aria-label={t('nav.delete')}
                        >
                          <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                </>
              )}

              {leftTab === 'settings' && (
                <>
                  {/* 人设卡分组 */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      px: 0.5,
                      pt: 0.75,
                      pb: 0.5,
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                        color: 'text.disabled',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('writing.characters')}
                    </Typography>
                    <Tooltip title={t('writing.newCharacter')}>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => openDialog({ kind: 'new-setting', settingKind: 'character' })}
                        aria-label={t('writing.newCharacter')}
                      >
                        <AddRoundedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {characters.map(renderSettingRow)}
                  {/* 世界观分组 */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      px: 0.5,
                      pt: 1.25,
                      pb: 0.5,
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                        color: 'text.disabled',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('writing.worldbuilding')}
                    </Typography>
                    <Tooltip title={t('writing.newWorldbuilding')}>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => openDialog({ kind: 'new-setting', settingKind: 'worldbuilding' })}
                        aria-label={t('writing.newWorldbuilding')}
                      >
                        <AddRoundedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {worldbuilding.map(renderSettingRow)}
                  {settings.length === 0 && (
                    <Typography sx={{ fontSize: 11.5, color: 'text.disabled', textAlign: 'center', py: 2 }}>
                      {t('writing.emptySettings')}
                    </Typography>
                  )}
                </>
              )}

              {leftTab === 'notes' && (
                <>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      px: 0.5,
                      pt: 0.75,
                      pb: 0.5,
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                        color: 'text.disabled',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('writing.tabNotes')}
                    </Typography>
                    <Tooltip title={t('writing.noteAdd')}>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => {
                          setNoteDraft('');
                          setNotesOpen(true);
                        }}
                        aria-label={t('writing.noteAdd')}
                      >
                        <AddRoundedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Box sx={{ px: 1.5, py: 2.5, textAlign: 'center' }}>
                    <StickyNote2RoundedIcon sx={{ fontSize: 32, color: 'text.disabled', mb: 1 }} />
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5, lineHeight: 1.6 }}>
                      {t('writing.notesListHint')}
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        setNoteDraft('');
                        setNotesOpen(true);
                      }}
                      data-testid="open-notes-btn"
                    >
                      {t('writing.notesOpenBtn')}
                    </Button>
                  </Box>
                </>
              )}
            </Box>
          </>
        )}
      </Paper>

      {/* ─── 右栏：正文编辑器 / 设定卡编辑 / 章详情（双 tab：正文 | 章详情） ─── */}
      <Paper
        variant="outlined"
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <Tabs
          value={rightTab}
          onChange={(_, v: RightTab) => setRightTab(v)}
          sx={{
            minHeight: 34,
            px: 1,
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTab-root': { minHeight: 34, fontSize: 12, py: 0 },
          }}
        >
          <Tab value="body" label={t('writing.tabBody')} />
          <Tab value="details" label={t('writing.tabChapterDetails')} disabled={!activeBook} />
        </Tabs>
        {rightTab === 'details' ? (
          <ChapterDetailsPanel
            chapter={activeChapter}
            book={activeBook}
            chapters={chapters}
            outlines={outlines}
            settings={settings}
            timelineEvents={timelineEvents}
            onManageCast={() => {
              setLeftTab('settings');
              setActiveSetting(null);
              setRightTab('body');
            }}
          />
        ) : activeSetting ? (
          <>
            <Box
              sx={{
                px: { xs: 2, md: 4 },
                pt: 2.5,
                maxWidth: 760,
                width: '100%',
                mx: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
              }}
            >
              <Box
                sx={{ color: activeSetting.kind === 'character' ? 'primary.main' : 'secondary.main', display: 'flex' }}
              >
                {activeSetting.kind === 'character' ? (
                  <PersonRoundedIcon sx={{ fontSize: 22 }} />
                ) : (
                  <PublicRoundedIcon sx={{ fontSize: 22 }} />
                )}
              </Box>
              <Typography sx={{ fontSize: 12, color: 'text.disabled', flex: 1 }}>
                {activeSetting.kind === 'character' ? t('writing.characters') : t('writing.worldbuilding')}
              </Typography>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 2, md: 4 }, py: 2 }}>
              <Box sx={{ maxWidth: 760, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  size="small"
                  label={t('writing.settingName')}
                  value={settingDraft.name}
                  onChange={(e) => handleSettingFieldChange('name', e.target.value)}
                />
                <TextField
                  size="small"
                  label={activeSetting.kind === 'character' ? t('writing.settingRole') : t('writing.settingCategory')}
                  value={settingDraft.subtitle}
                  onChange={(e) => handleSettingFieldChange('subtitle', e.target.value)}
                />
                <TextField
                  multiline
                  minRows={12}
                  label={t('writing.settingDescription')}
                  value={settingDraft.description}
                  onChange={(e) => handleSettingFieldChange('description', e.target.value)}
                />

                {/* ─── 人物档案（仅人设卡；结构化字段，落 extra.profile，零迁移） ─── */}
                {(() => {
                  if (activeSetting.kind !== 'character') return null;
                  const missing = settingCompleteness('character', settingDraft.extra).missingKeys.map((k) => t(k));
                  return (
                    <Box>
                      <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
                        {t('writing.profile')}
                      </Typography>
                      {missing.length > 0 && (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                            mb: 1,
                            px: 1,
                            py: 0.5,
                            borderRadius: 1,
                            bgcolor: 'rgba(217,130,43,0.12)',
                            color: 'warning.main',
                            fontSize: 11.5,
                            lineHeight: 1.4,
                          }}
                        >
                          <Box
                            component="span"
                            sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0 }}
                          />
                          {t('writing.wbIncompleteHint', { fields: missing.join('、') })}
                        </Box>
                      )}
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        <TextField
                          size="small"
                          label={t('writing.appearance')}
                          value={settingDraft.extra.profile?.appearance ?? ''}
                          onChange={(e) => setProfileField('appearance', e.target.value)}
                        />
                        <TextField
                          size="small"
                          label={t('writing.personality')}
                          value={settingDraft.extra.profile?.personality ?? ''}
                          onChange={(e) => setProfileField('personality', e.target.value)}
                        />
                        <TextField
                          size="small"
                          label={t('writing.motivation')}
                          value={settingDraft.extra.profile?.motivation ?? ''}
                          onChange={(e) => setProfileField('motivation', e.target.value)}
                        />
                        <TextField
                          size="small"
                          label={t('writing.catchphrase')}
                          value={settingDraft.extra.profile?.catchphrase ?? ''}
                          onChange={(e) => setProfileField('catchphrase', e.target.value)}
                        />
                        <TextField
                          size="small"
                          multiline
                          minRows={3}
                          label={t('writing.notes')}
                          value={settingDraft.extra.profile?.notes ?? ''}
                          onChange={(e) => setProfileField('notes', e.target.value)}
                        />
                      </Box>
                    </Box>
                  );
                })()}

                {/* ─── 世界观档案（仅世界观设定；结构化字段，落 extra.worldbuildingProfile，零迁移） ─── */}
                {(() => {
                  if (activeSetting.kind !== 'worldbuilding') return null;
                  const missing = settingCompleteness('worldbuilding', settingDraft.extra).missingKeys.map((k) => t(k));
                  return (
                    <Box>
                      <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
                        {t('writing.wbProfile')}
                      </Typography>
                      {missing.length > 0 && (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                            mb: 1,
                            px: 1,
                            py: 0.5,
                            borderRadius: 1,
                            bgcolor: 'rgba(217,130,43,0.12)',
                            color: 'warning.main',
                            fontSize: 11.5,
                            lineHeight: 1.4,
                          }}
                        >
                          <Box
                            component="span"
                            sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0 }}
                          />
                          {t('writing.wbIncompleteHint', { fields: missing.join('、') })}
                        </Box>
                      )}
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        <TextField
                          size="small"
                          select
                          label={t('writing.wbType')}
                          value={settingDraft.extra.worldbuildingProfile?.type ?? ''}
                          onChange={(e) => setWbProfileField('type', e.target.value)}
                          sx={{ minWidth: 160 }}
                        >
                          <MenuItem value="">{t('writing.wbTypeNone')}</MenuItem>
                          {WORLDBUILDING_TYPE_KEYS.map((k) => (
                            <MenuItem key={k} value={k}>
                              {t(`writing.wbTypeOptions.${k}`)}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          label={t('writing.wbRules')}
                          value={settingDraft.extra.worldbuildingProfile?.rules ?? ''}
                          onChange={(e) => setWbProfileField('rules', e.target.value)}
                        />
                        <TextField
                          size="small"
                          label={t('writing.wbExceptions')}
                          value={settingDraft.extra.worldbuildingProfile?.exceptions ?? ''}
                          onChange={(e) => setWbProfileField('exceptions', e.target.value)}
                        />
                        <TextField
                          size="small"
                          label={t('writing.wbLinkedTo')}
                          value={settingDraft.extra.worldbuildingProfile?.linkedTo ?? ''}
                          onChange={(e) => setWbProfileField('linkedTo', e.target.value)}
                        />
                        <TextField
                          size="small"
                          multiline
                          minRows={3}
                          label={t('writing.notes')}
                          value={settingDraft.extra.worldbuildingProfile?.notes ?? ''}
                          onChange={(e) => setWbProfileField('notes', e.target.value)}
                        />
                      </Box>
                    </Box>
                  );
                })()}

                {/* ─── 出场章（读 outline.extra，与大纲/要素面板同一份口径；绑定在章侧或大纲完成） ─── */}
                {(() => {
                  const isChar = activeSetting.kind === 'character';
                  const related = chaptersOfSetting(
                    outlines,
                    chapters,
                    activeSetting.id,
                    isChar ? 'character' : 'worldbuilding',
                  );
                  return (
                    <Box>
                      <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
                        {t(
                          isChar
                            ? 'editor.writing.inspector.appearChapters'
                            : 'editor.writing.inspector.relatedChapters',
                        )}
                      </Typography>
                      {related.length === 0 ? (
                        <Typography sx={{ fontSize: 11.5, color: 'text.disabled', lineHeight: 1.7 }}>
                          {t('editor.writing.inspector.bindHint')}
                        </Typography>
                      ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                          {related.map((c) => (
                            <Typography
                              key={c.id}
                              sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.7 }}
                              noWrap
                            >
                              {c.title}
                            </Typography>
                          ))}
                        </Box>
                      )}
                    </Box>
                  );
                })()}

                {/* ─── P4 结构化扩展：人物关系 + 时间线（人设卡与世界观设定通用，relations/timeline 本就零迁移） ─── */}
                {(activeSetting.kind === 'character' || activeSetting.kind === 'worldbuilding') && (
                  <>
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary' }}>
                          {t('writing.relations')}
                        </Typography>
                        <Button size="small" startIcon={<AddRoundedIcon sx={{ fontSize: 14 }} />} onClick={addRelation}>
                          {t('writing.addRelation')}
                        </Button>
                      </Box>
                      {(settingDraft.extra.relations ?? []).map((rel, idx) => (
                        <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                          <TextField
                            size="small"
                            select
                            fullWidth
                            label={t('writing.relationTargetSetting')}
                            value={rel.targetId ?? ''}
                            onChange={(e) => setRelationRow(idx, 'targetId', e.target.value)}
                          >
                            <MenuItem value="">{t('writing.relationTargetNone')}</MenuItem>
                            {settings
                              .filter((s) => s.bookId === activeSetting!.bookId && s.id !== activeSetting!.id)
                              .map((s) => (
                                <MenuItem key={s.id} value={s.id}>
                                  {s.name || t('writingWorkbench.untitled')}
                                </MenuItem>
                              ))}
                          </TextField>
                          <TextField
                            size="small"
                            fullWidth
                            label={t('writing.relationType')}
                            value={rel.type}
                            onChange={(e) => setRelationRow(idx, 'type', e.target.value)}
                          />
                          <IconButton size="small" onClick={() => removeRelation(idx)} aria-label="remove relation">
                            <CloseRoundedIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Box>
                      ))}
                    </Box>
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary' }}>
                          {t('writing.timeline')}
                        </Typography>
                        <Button size="small" startIcon={<AddRoundedIcon sx={{ fontSize: 14 }} />} onClick={addTimeline}>
                          {t('writing.addTimeline')}
                        </Button>
                      </Box>
                      {timelineEvents
                        .filter((e) => e.settingId === activeSettingId)
                        .map((ev) => (
                          <Box key={ev.id} sx={{ mb: 1 }}>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                              <TextField
                                size="small"
                                fullWidth
                                label={t('writing.timelineEvent')}
                                value={ev.event}
                                onChange={(e) => setTimelineRow(ev.id, 'event', e.target.value)}
                              />
                              <IconButton
                                size="small"
                                onClick={() => removeTimeline(ev.id)}
                                aria-label="remove timeline event"
                              >
                                <CloseRoundedIcon sx={{ fontSize: 15 }} />
                              </IconButton>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
                              <TextField
                                size="small"
                                sx={{ width: 140, flexShrink: 0 }}
                                label={t('writing.timelineAt')}
                                value={ev.at}
                                onChange={(e) => setTimelineRow(ev.id, 'at', e.target.value)}
                              />
                              <TextField
                                size="small"
                                select
                                fullWidth
                                label={t('writing.timelineChapter')}
                                value={ev.chapterId ?? ''}
                                onChange={(e) => setTimelineRow(ev.id, 'chapterId', e.target.value)}
                              >
                                <MenuItem value="">{t('writing.relationTargetNone')}</MenuItem>
                                {chapters
                                  .filter((c) => c.bookId === activeSetting!.bookId)
                                  .map((c) => (
                                    <MenuItem key={c.id} value={c.id}>
                                      {c.title || t('writingWorkbench.untitled')}
                                    </MenuItem>
                                  ))}
                              </TextField>
                            </Box>
                          </Box>
                        ))}
                    </Box>
                    {/* 全书级时间线：settingId=null 的事件，修复「全书」lane 无创建入口的缺口 */}
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary' }}>
                          {t('writing.bookLevelTimeline')}
                        </Typography>
                        <Button
                          size="small"
                          startIcon={<AddRoundedIcon sx={{ fontSize: 14 }} />}
                          onClick={addBookTimeline}
                        >
                          {t('writing.addTimeline')}
                        </Button>
                      </Box>
                      {timelineEvents
                        .filter((e) => e.settingId === null)
                        .map((ev) => (
                          <Box key={ev.id} sx={{ mb: 1 }}>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                              <TextField
                                size="small"
                                fullWidth
                                label={t('writing.timelineEvent')}
                                value={ev.event}
                                onChange={(e) => setTimelineRow(ev.id, 'event', e.target.value)}
                              />
                              <IconButton
                                size="small"
                                onClick={() => removeTimeline(ev.id)}
                                aria-label="remove book-level timeline event"
                              >
                                <CloseRoundedIcon sx={{ fontSize: 15 }} />
                              </IconButton>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
                              <TextField
                                size="small"
                                sx={{ width: 140, flexShrink: 0 }}
                                label={t('writing.timelineAt')}
                                value={ev.at}
                                onChange={(e) => setTimelineRow(ev.id, 'at', e.target.value)}
                              />
                              <TextField
                                size="small"
                                select
                                fullWidth
                                label={t('writing.timelineChapter')}
                                value={ev.chapterId ?? ''}
                                onChange={(e) => setTimelineRow(ev.id, 'chapterId', e.target.value)}
                              >
                                <MenuItem value="">{t('writing.relationTargetNone')}</MenuItem>
                                {chapters
                                  .filter((c) => c.bookId === activeSetting!.bookId)
                                  .map((c) => (
                                    <MenuItem key={c.id} value={c.id}>
                                      {c.title || t('writingWorkbench.untitled')}
                                    </MenuItem>
                                  ))}
                              </TextField>
                            </Box>
                          </Box>
                        ))}
                    </Box>
                  </>
                )}
              </Box>
            </Box>
          </>
        ) : activeChapter && editor ? (
          <>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1.5,
                py: 0.75,
                borderBottom: 1,
                borderColor: 'divider',
                flexWrap: 'wrap',
              }}
            >
              {toolButtons.map((btn, i) => (
                <Tooltip key={i} title={btn.label}>
                  <IconButton
                    size="small"
                    onClick={(e) => btn.onClick(e)}
                    sx={toolbarBtnSx(btn.active)}
                    aria-label={btn.label}
                  >
                    {btn.icon}
                  </IconButton>
                </Tooltip>
              ))}
              <Menu anchorEl={tableMenuAnchor} open={Boolean(tableMenuAnchor)} onClose={() => setTableMenuAnchor(null)}>
                <MenuItem
                  onClick={() => {
                    editor?.chain().focus().addRowAfter().run();
                    setTableMenuAnchor(null);
                  }}
                >
                  {t('writing.tableInsertRowAfter')}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    editor?.chain().focus().addColumnAfter().run();
                    setTableMenuAnchor(null);
                  }}
                >
                  {t('writing.tableInsertColumnAfter')}
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    editor?.chain().focus().deleteRow().run();
                    setTableMenuAnchor(null);
                  }}
                >
                  {t('writing.tableDeleteRow')}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    editor?.chain().focus().deleteColumn().run();
                    setTableMenuAnchor(null);
                  }}
                >
                  {t('writing.tableDeleteColumn')}
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    editor?.chain().focus().deleteTable().run();
                    setTableMenuAnchor(null);
                  }}
                >
                  {t('writing.tableDeleteTable')}
                </MenuItem>
              </Menu>
              {/* 多色高亮色板 */}
              <Tooltip title={t('writing.fmtHighlightColor')}>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    setHighlightAnchor(e.currentTarget);
                    setHighlightOpen(true);
                  }}
                  sx={toolbarBtnSx(editor?.isActive('highlight') ?? false)}
                  aria-label={t('writing.fmtHighlightColor')}
                >
                  <HighlightRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Popover
                open={highlightOpen}
                anchorEl={highlightAnchor}
                onClose={() => setHighlightOpen(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                transformOrigin={{ vertical: 'top', horizontal: 'center' }}
              >
                <Box sx={{ display: 'flex', gap: 0.75, p: 1 }}>
                  {[
                    { color: '#fde047', label: t('writing.highlightYellow') },
                    { color: '#86efac', label: t('writing.highlightGreen') },
                    { color: '#93c5fd', label: t('writing.highlightBlue') },
                    { color: '#f9a8d4', label: t('writing.highlightPink') },
                    { color: '#d8b4fe', label: t('writing.highlightPurple') },
                  ].map((c) => (
                    <Tooltip key={c.color} title={c.label}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          editor?.chain().focus().toggleHighlight({ color: c.color }).run();
                          setHighlightOpen(false);
                        }}
                        sx={{
                          width: 24,
                          height: 24,
                          bgcolor: c.color,
                          border: 1,
                          borderColor: 'divider',
                          '&:hover': { opacity: 0.8 },
                        }}
                      />
                    </Tooltip>
                  ))}
                  <Tooltip title={t('writing.highlightClear')}>
                    <IconButton
                      size="small"
                      onClick={() => {
                        editor?.chain().focus().unsetHighlight().run();
                        setHighlightOpen(false);
                      }}
                      sx={{ width: 24, height: 24, color: 'text.disabled' }}
                    >
                      <ClearIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Popover>
              <Tooltip title={t('writing.typography.title')}>
                <IconButton
                  size="small"
                  onClick={(e) => setTypoAnchor(e.currentTarget)}
                  sx={toolbarBtnSx(false)}
                  aria-label={t('writing.typography.title')}
                >
                  <FormatSizeRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <Tooltip title={t('writing.prevChapter')}>
                <span>
                  <IconButton
                    size="small"
                    disabled={!hasPrevChapter}
                    onClick={goPrevChapter}
                    sx={toolbarBtnSx(false)}
                    aria-label={t('writing.prevChapter')}
                  >
                    <NavigateBeforeRoundedIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('writing.nextChapter')}>
                <span>
                  <IconButton
                    size="small"
                    disabled={!hasNextChapter}
                    onClick={goNextChapter}
                    sx={toolbarBtnSx(false)}
                    aria-label={t('writing.nextChapter')}
                  >
                    <NavigateNextRoundedIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip
                title={
                  focusMode === 'zen'
                    ? t('writing.exitZen')
                    : focusMode === 'focus'
                      ? t('writing.exitFocus')
                      : t('writing.focusMode')
                }
              >
                <IconButton
                  size="small"
                  onClick={() =>
                    setFocusMode((v) => {
                      if (v === 'normal') return 'focus';
                      if (v === 'focus') return 'zen';
                      return 'normal';
                    })
                  }
                  sx={toolbarBtnSx(focusMode !== 'normal')}
                  aria-label={
                    focusMode === 'zen'
                      ? t('writing.exitZen')
                      : focusMode === 'focus'
                        ? t('writing.exitFocus')
                        : t('writing.focusMode')
                  }
                >
                  <ChromeReaderModeRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              {/* P2 性能：saveState 下沉本组件，800ms 翻转只重渲染这里 */}
              <SaveIndicator register={registerSaveIndicator} />
              {/* T4 灵感/快速笔记：写作中随时速记，不中断心流 */}
              <Tooltip title={t('writing.noteFab')}>
                <IconButton
                  size="small"
                  disabled={!activeBook}
                  onClick={() => {
                    setNoteDraft('');
                    setNotesOpen(true);
                  }}
                  sx={toolbarBtnSx(false)}
                  aria-label={t('writing.noteFab')}
                >
                  <StickyNote2RoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.snapshots.title')}>
                <IconButton
                  size="small"
                  disabled={!activeChapter}
                  onClick={() => setSnapshotsOpen(true)}
                  sx={toolbarBtnSx(false)}
                  aria-label={t('writing.snapshots.title')}
                >
                  <HistoryRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              {/* 导出收纳（批次③）：4 个导出动作收进一个菜单，给工具栏瘦身 */}
              <Tooltip title={t('writing.export')}>
                <IconButton
                  size="small"
                  disabled={!activeBook}
                  onClick={(e) => setExportAnchor(e.currentTarget)}
                  sx={toolbarBtnSx(false)}
                  aria-label={t('writing.export')}
                >
                  <DownloadRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Menu anchorEl={exportAnchor} open={!!exportAnchor} onClose={() => setExportAnchor(null)}>
                <MenuItem
                  onClick={() => {
                    setExportAnchor(null);
                    void handleExportMarkdown();
                  }}
                >
                  {t('writing.exportMarkdown')}
                  <ExportCountBadge bookId={activeBook?.id ?? ''} format="md" />
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setExportAnchor(null);
                    void handleExportEpub();
                  }}
                >
                  {t('writing.exportEpub')}
                  <ExportCountBadge bookId={activeBook?.id ?? ''} format="epub" />
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setExportAnchor(null);
                    void handleExportHtml();
                  }}
                >
                  {t('writing.exportHtml')}
                  <ExportCountBadge bookId={activeBook?.id ?? ''} format="html" />
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setExportAnchor(null);
                    void handleExportText();
                  }}
                >
                  {t('writing.exportText')}
                  <ExportCountBadge bookId={activeBook?.id ?? ''} format="txt" />
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    setExportAnchor(null);
                    void handleExportDocx();
                  }}
                >
                  {t('writing.exportDocx')}
                  <ExportCountBadge bookId={activeBook?.id ?? ''} format="docx" />
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setExportAnchor(null);
                    void handleExportPdf();
                  }}
                >
                  {t('writing.exportPdf')}
                  <ExportCountBadge bookId={activeBook?.id ?? ''} format="pdf" />
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    setExportAnchor(null);
                    void handleBackupBook();
                  }}
                >
                  {t('writing.backupBook')}
                  <ExportCountBadge bookId={activeBook?.id ?? ''} format="backup" />
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setExportAnchor(null);
                    void handleRestoreBook();
                  }}
                >
                  {t('writing.restoreBook')}
                </MenuItem>
              </Menu>
              <Tooltip title={t('writing.shortcutsTitle')}>
                <IconButton
                  size="small"
                  onClick={() => setHelpOpen(true)}
                  sx={toolbarBtnSx(false)}
                  aria-label={t('writing.shortcutsTitle')}
                >
                  <KeyboardRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.aiReview')}>
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => void handleOpenAiDialog()}
                  aria-label={t('writing.aiReview')}
                >
                  <AutoAwesomeRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.aiChatTitle')}>
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => setChatOpen(true)}
                  aria-label={t('writing.aiChatTitle')}
                >
                  <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.autoReview')}>
                <IconButton
                  size="small"
                  disabled={!activeBook}
                  onClick={() => setAutoDialogOpen(true)}
                  aria-label={t('writing.autoReview')}
                >
                  <AutoModeRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.findReplace')}>
                <IconButton
                  size="small"
                  disabled={!activeChapter}
                  onClick={() => setFrOpen(true)}
                  aria-label={t('writing.findReplace')}
                >
                  <FindInPageRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.proofreadTitle')}>
                <IconButton
                  size="small"
                  disabled={!activeChapter}
                  color={proofreadIssues.length > 0 ? 'warning' : 'default'}
                  onClick={() => {
                    // 打开面板时用最新正文同步重检一次，避免防抖窗口内看到过期/空态
                    if (editor) {
                      const text = editor.getText();
                      proofreadTextRef.current = text;
                      setProofreadIssues(text.trim() ? runProofread(text) : []);
                      setActiveProofreadKey('');
                    }
                    setProofreadOpen(true);
                  }}
                  aria-label={t('writing.proofreadTitle')}
                >
                  <SpellcheckRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.inlineContinue')}>
                <IconButton
                  size="small"
                  disabled={!activeBook || !activeChapter}
                  onClick={() => openInlineDialog('continue')}
                  aria-label={t('writing.inlineContinue')}
                >
                  <NotesRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.inlinePolish')}>
                <IconButton
                  size="small"
                  disabled={!activeBook || !activeChapter}
                  onClick={() => openInlineDialog('polish')}
                  aria-label={t('writing.inlinePolish')}
                >
                  <AutoFixHighRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
            </Box>
            {focusMode === 'normal' && activeChapter && (
              <>
                <ForeshadowReminder foreshadowings={payableForeshadowings} genre={genre} />
                <InspirationReminder inspirations={inspirationReminders} genre={genre} />
                <ProofreadReminder issues={proofreadReminders} genre={genre} />
                <StatsReminder chapter={activeChapter} chapters={chapters} genre={genre} />
              </>
            )}
            <Box sx={{ px: { xs: 2, md: 6 }, pt: 2, maxWidth: typo.pageWidth, mx: 'auto' }}>
              {/* 批次② 写作动线：标题点击即改名（原对话框入口），状态/层级徽章就地切换 */}
              <Typography
                onClick={() => openDialog({ kind: 'rename-chapter', chapterId: activeChapter.id }, activeChapter.title)}
                title={t('writing.renameChapterTitle')}
                sx={{
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  cursor: 'pointer',
                  '&:hover': { color: 'primary.main' },
                }}
              >
                {activeChapter.title}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                {activeChapter.volume && (
                  <Chip
                    size="small"
                    label={activeChapter.volume}
                    onClick={() =>
                      openDialog({ kind: 'move-volume', chapterId: activeChapter.id }, activeChapter.volume)
                    }
                    sx={{ fontSize: 11, height: 22 }}
                  />
                )}
                <ChapterMetaControls
                  chapter={activeChapter}
                  onStatusChange={setChapterStatus}
                  onKindChange={renameNodeKind}
                />
              </Box>
            </Box>
            <Box
              ref={editorScrollRef}
              sx={{
                ...editorBodySx,
                ...(focusMode === 'zen'
                  ? {
                      maxWidth: 680,
                      mx: 'auto',
                      bgcolor: 'background.paper',
                      minHeight: '100vh',
                      px: { xs: 3, md: 5 },
                      pt: 6,
                      pb: 10,
                      boxShadow: (th) => th.shadows[1],
                    }
                  : {}),
                ...(focusMode === 'focus'
                  ? {
                      px: { xs: 3, md: 8 },
                    }
                  : {}),
              }}
              onClick={handleEditorClickForAnnotation}
            >
              <EditorContent editor={editor} />
            </Box>
            <Box
              sx={{
                px: 2,
                py: 0.75,
                borderTop: 1,
                borderColor: 'divider',
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 2,
              }}
            >
              {selectedChars > 0 && (
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                  {t('writing.selectedWords', { n: selectedChars })}
                </Typography>
              )}
              <WritingTodayChip
                bookId={activeBook?.id ?? null}
                goal={activeBook?.dailyGoal ?? 0}
                onOpenStats={() => setStatsOpen(true)}
              />
              <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
                {t('writing.words', { n: chapterWordCount(editor) })}
              </Typography>
            </Box>
          </>
        ) : (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1.5,
            }}
          >
            <MenuBookRoundedIcon sx={{ fontSize: 42, color: 'text.disabled' }} />
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              {activeBook ? t('writing.selectChapter') : t('writing.emptyBooksHint')}
            </Typography>
            {booksLoading || chaptersLoading
              ? null
              : activeBook && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddRoundedIcon />}
                    onClick={() => openDialog({ kind: 'new-chapter' })}
                  >
                    {t('writing.newChapter')}
                  </Button>
                )}
          </Box>
        )}
        {/* T4 浮动速记 FAB：normal 模式随时采灵感（focus/zen 沉浸时不打扰） */}
        {activeBook && focusMode === 'normal' && (
          <Fab
            size="small"
            color="primary"
            aria-label={t('writing.noteFab')}
            onClick={() => {
              setNoteDraft('');
              setNotesOpen(true);
            }}
            sx={{ position: 'absolute', right: 16, bottom: 40, zIndex: 5 }}
          >
            <StickyNote2RoundedIcon sx={{ fontSize: 20 }} />
          </Fab>
        )}
      </Paper>

      {/* ─── T5 崩溃恢复：残留草稿恢复条（首次打开该章时弹出，恢复/放弃后消失） ─── */}
      <Snackbar
        open={!!recoverDraft}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={
          <Box sx={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <span>{t('writing.draftRecoverHint', { title: recoverDraft?.chapterTitle ?? '' })}</span>
            {recoverDraft && (
              <Typography component="span" sx={{ fontSize: 11, opacity: 0.75, flexShrink: 0 }}>
                {new Date(recoverDraft.snap.savedAt * 1000).toLocaleTimeString()}
              </Typography>
            )}
          </Box>
        }
        action={
          <>
            <Button color="inherit" size="small" onClick={handleDiscardDraft}>
              {t('writing.draftDiscard')}
            </Button>
            <Button color="primary" size="small" onClick={handleRecoverDraft}>
              {t('writing.draftRecover')}
            </Button>
          </>
        }
      />

      {/* ─── 新建/重命名/删除对话框 ─── */}
      <Dialog open={dialog !== null} onClose={() => setDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15 }}>{dialogTitle}</DialogTitle>
        <DialogContent>{dialogBody}</DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setDialog(null)}>
            {t('nav.cancel')}
          </Button>
          <Button
            size="small"
            variant={isDeleteDialog ? 'text' : 'contained'}
            color={isDeleteDialog ? 'error' : 'primary'}
            onClick={() => void handleDialogConfirm()}
          >
            {isDeleteDialog ? t('nav.delete') : t('nav.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* ─── 回收站（2026-09-29）：查看/恢复/永久删除软删章节 ─── */}
      <Dialog open={recycleBinOpen} onClose={() => setRecycleBinOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 1 }}>
          <DeleteSweepRoundedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          {t('writing.recycleBin')}
          {deletedChapters.length > 0 && (
            <Chip size="small" label={t('writing.deletedChapterCount', { n: deletedChapters.length })} />
          )}
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, maxHeight: 400, overflowY: 'auto' }}>
          {deletedChapters.length === 0 ? (
            <Box sx={{ textAlign: 'center', px: 2, py: 6 }}>
              <DeleteSweepRoundedIcon sx={{ fontSize: 34, color: 'text.disabled', mb: 1 }} />
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{t('writing.recycleBinEmpty')}</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 0.5 }}>
                {t('writing.recycleBinHint')}
              </Typography>
            </Box>
          ) : (
            deletedChapters.map((ch) => {
              const book = books.find((b) => b.id === ch.bookId);
              return (
                <Box
                  key={ch.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 1,
                    '& + &': { borderTop: '1px solid', borderColor: 'divider' },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: 13,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ch.title}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
                      {book ? `${book.title} · ` : ''}
                      {t('writing.deletedAt', { time: new Date(chapterDeletedAt(ch) * 1000).toLocaleString() })}
                    </Typography>
                  </Box>
                  <Tooltip title={t('writing.restoreChapter')}>
                    <IconButton
                      size="small"
                      onClick={() => void handleRestoreChapter(ch)}
                      aria-label={t('writing.restoreChapter')}
                    >
                      <RestoreRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('writing.permanentDeleteChapter')}>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => setPermanentDeleteTarget(ch)}
                      aria-label={t('writing.permanentDeleteChapter')}
                    >
                      <DeleteForeverRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              );
            })
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setRecycleBinOpen(false)}>
            {t('nav.cancel')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* ─── 回收站：永久删除二次确认 ─── */}
      <Dialog
        open={permanentDeleteTarget !== null}
        onClose={() => setPermanentDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 15 }}>{t('writing.permanentDeleteChapter')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            {t('writing.permanentDeleteConfirm', { title: permanentDeleteTarget?.title ?? '' })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setPermanentDeleteTarget(null)}>
            {t('nav.cancel')}
          </Button>
          <Button size="small" color="error" variant="contained" onClick={() => void handlePermanentDelete()}>
            {t('writing.permanentDeleteChapter')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* ─── 校对面板（批次③ T5）：问题列表 + 编辑器内定位 ─── */}
      <ProofreadPanel
        open={proofreadOpen}
        onClose={() => setProofreadOpen(false)}
        issues={proofreadIssues}
        activeKey={activeProofreadKey}
        onLocate={(issue) => {
          if (!editor) return;
          const index = buildTextIndex(editor.state.doc);
          const range = textRangeToPos(index, issue.start, issue.end);
          if (!range) return;
          setActiveProofreadKey(`${issue.kind}:${issue.start}:${issue.end}`);
          editor.chain().focus().setTextSelection(range).scrollIntoView().run();
        }}
        labels={{
          title: t('writing.proofreadTitle'),
          empty: t('writing.proofreadEmpty'),
          hint: t('writing.proofreadHint'),
          typo: t('writing.proofreadTypo'),
          repeat: t('writing.proofreadRepeat'),
          sensitive: t('writing.proofreadSensitive'),
          count: t('writing.proofreadCount'),
          locate: t('writing.proofreadLocate'),
        }}
      />
      {/* ─── AI 审视对话框：预设 + Agent 均由用户选择 ─── */}
      <AiReviewDialog
        open={aiDialogOpen}
        onClose={() => setAiDialogOpen(false)}
        presetKey={aiPresetKey}
        onPresetChange={setAiPresetKey}
        writingPresets={writingPresets}
        agentId={aiAgentId}
        onAgentChange={setAiAgentId}
        agents={agents}
        onGoSettings={() => {
          setAiDialogOpen(false);
          goAiSettings();
        }}
        onLaunch={() => void handleLaunchAi()}
        launching={aiLaunching}
        bookAvailable={!!activeBook}
        onViewInsights={() => {
          setAiDialogOpen(false);
          setInsightsDialogOpen(true);
        }}
      />
      {/* ─── D 对话式 AI：自由问答（per 书复用会话，首轮自动注入写作上下文） ─── */}
      <WritingAiChatDialog
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        chatTitle={`${t('writing.aiChatTitle')} · ${activeBook?.title ?? ''}`}
        buildContextBlock={buildChatContext}
        agentId={chatAgentId}
        onAgentChange={setChatAgentId}
        onOpenSettings={() => {
          setChatOpen(false);
          goAiSettings();
        }}
      />
      {/* ─── 骨架走查 P1-G1：全书跨章搜索（结果点行切章） ─── */}
      <WritingBookSearchDialog
        open={bookSearchOpen}
        onClose={() => setBookSearchOpen(false)}
        chapters={chapters.filter((c) => c.bookId === activeBook?.id)}
        onPick={(chapterId) => {
          setActiveChapter(chapterId);
          setBookSearchOpen(false);
        }}
        onReplaceChapter={async (chapterId, newContent) => {
          const wc = chapterWordCountFromHtml(newContent);
          await saveChapterContent(chapterId, newContent, wc);
        }}
      />
      {/* ─── 骨架走查 P2-G3：TXT 批量导入（粘贴分章 → 建章落正文） ─── */}
      <WritingImportTxtDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        fallbackTitle={t('writing.importTxtFallback')}
        onImport={handleImportTxt}
      />
      {/* ─── 羽化 P：新建作品（共享命名向导；写作台新建后停留写作台，不跳工作室） ─── */}
      <NewBookDialog
        open={newBookOpen}
        onClose={() => setNewBookOpen(false)}
        onCreate={createBookInDesk}
        onError={handleNewBookError}
      />
      {/* ─── A-2 审阅闭环：该书 AI 审阅结论（发射后自动打开 / AI 对话框「查看结果」入口） ─── */}
      <WritingInsightsDialog
        open={insightsDialogOpen}
        bookId={activeBook?.id ?? null}
        onClose={() => setInsightsDialogOpen(false)}
      />
      {/* ─── 写作统计（P4）：快照差分出每日新增，纯 div 柱状图 ─── */}
      <WritingStatsDialog
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        bookId={activeBook?.id ?? null}
        bookTitle={activeBook?.title ?? ''}
        chapterCount={chapters.length}
        chapterTotalWords={chapters.reduce((sum, c) => sum + c.wordCount, 0)}
        dailyGoal={activeBook?.dailyGoal ?? 0}
        onGoalChange={(goal) => {
          if (activeBook) {
            void setDailyGoal(activeBook.id, goal).catch((err) => {
              logger.warn('WritingPage', 'set daily goal failed', { error: err });
              useToastStore.getState().error(String(err));
            });
          }
        }}
        bookGoal={parseBookGoal(activeBook?.extra)}
        onBookGoalChange={(goal) => {
          if (activeBook) {
            void setBookGoal(activeBook.id, goal).catch((err) => {
              logger.warn('WritingPage', 'set book goal failed', { error: err });
              useToastStore.getState().error(String(err));
            });
          }
        }}
      />
      {/* ─── 批次③ ⌘K 章节快速跳转 ─── */}
      <ChapterQuickJump
        open={quickJumpOpen}
        onClose={() => setQuickJumpOpen(false)}
        chapters={chapters}
        activeChapterId={activeChapterId}
        onPick={(id) => {
          setActiveSetting(null);
          setActiveChapter(id);
        }}
      />
      {/* ─── 批次③ 快捷键速查 ─── */}
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      {/* ─── 批次④ 章节版本快照：切章自动存 + 手动存，可恢复 + diff 对比 + 重命名 ─── */}
      <ChapterSnapshotsDialog
        open={snapshotsOpen}
        onClose={() => setSnapshotsOpen(false)}
        chapterId={activeChapterId}
        currentContent={editor?.getHTML() ?? ''}
        currentWordCount={editor ? chapterWordCount(editor) : 0}
        onManualSnapshot={handleManualSnapshot}
        onRestore={handleRestoreSnapshot}
      />
      {/* ─── 人物出场图谱（原实体图鉴迁入）：章节 × 设定出场热力矩阵，点击跳正文 ─── */}
      <Dialog open={appearanceOpen} onClose={() => setAppearanceOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1.5 }}>
          <Typography variant="h6" sx={{ fontSize: 15, fontWeight: 700 }}>
            {t('writing.appearanceMap.title')}
          </Typography>
          <IconButton size="small" onClick={() => setAppearanceOpen(false)} aria-label={t('workbench.close')}>
            <CloseRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 1.5, pt: 1 }}>
          <WritingAppearanceMatrix />
        </DialogContent>
      </Dialog>
      {/* ─── 正文插画（批次 1）：选图插入到编辑器光标处 ─── */}
      <AssetLibraryDialog
        onPick={(asset: AssetInfo) => {
          const inserter = useAssetPickerStore.getState().editorInserter;
          if (inserter) {
            inserter(asset);
            useToastStore.getState().showToast(t('studio.illustration.inserted'), 'success');
            return;
          }
          // 批次 2（封面）：选中的素材设为目标封面（章/卷/节拍），闭包内已捕获具体目标 id
          const coverSetter = useAssetPickerStore.getState().coverSetter;
          if (coverSetter) {
            coverSetter.apply(asset);
            useToastStore.getState().showToast(t('studio.illustration.coverSet'), 'success');
          }
        }}
      />
      {/* ─── 自动审阅规则（P3）：模块通用的 AutoAnalysisPanel + 写作域 moduleId ─── */}
      <Dialog open={autoDialogOpen} onClose={() => setAutoDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 15 }}>{t('writing.autoReview')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>{t('writing.autoReviewHint')}</Typography>
          {activeBook && <AutoAnalysisPanel moduleId={WRITING_MODULE_ID} scopeId={activeBook.id} />}
        </DialogContent>
      </Dialog>
      {/* ─── 内联 AI 写作（P7）：模式 + Agent 均由用户选择 ─── */}
      <InlineAiDialog
        open={inlineDialogOpen}
        onClose={() => {
          if (!inlineRunning) setInlineDialogOpen(false);
        }}
        kind={inlineKind}
        onKindChange={setInlineKind}
        selChars={inlineSelChars}
        agents={agents}
        agentId={inlineAgentId}
        onAgentChange={setInlineAgentId}
        onGoSettings={() => {
          setInlineDialogOpen(false);
          goAiSettings();
        }}
        words={inlineWords}
        onWordsChange={setInlineWords}
        directive={inlineDirective}
        onDirectiveChange={setInlineDirective}
        style={inlineStyle}
        onStyleChange={setInlineStyle}
        running={inlineRunning}
        streamText={inlineStreamText}
        streamPreviewRef={streamPreviewRef}
        onStop={() => useAgentStore.getState().requestInterrupt()}
        onRun={() => void handleRunInline()}
      />
      {/* ─── 查找替换（P9）：当前章节内，替换全部走一次事务（触发既有防抖自动保存） ─── */}
      <FindReplaceDialog
        open={frOpen}
        onClose={() => setFrOpen(false)}
        editor={editor}
        findText={findText}
        onFindTextChange={setFindText}
        replaceText={replaceText}
        onReplaceTextChange={setReplaceText}
      />
      {/* ─── 内联 AI 结果预览：用户确认后才动正文，绝无静默改写 ─── */}
      <InlineAiResultDialog
        result={inlineResult}
        onClose={() => setInlineResult(null)}
        onApply={handleApplyInlineResult}
      />
      {/* ─── P3 排版面板：字号/行距/段距/首行缩进/页宽/纸色，per-book 持久化 ─── */}
      <TypographyPopover anchorEl={typoAnchor} onClose={() => setTypoAnchor(null)} typo={typo} onChange={setTypo} />
      {/* ─── 章内批注（批次② T4）：新增批注 — 选中文本 → 弹窗录入并保存 ─── */}
      <AnnotationCreateDialog
        draft={annotationDraft}
        onClose={() => setAnnotationDraft(null)}
        text={annotationText}
        onTextChange={setAnnotationText}
        onSave={() => void handleSaveAnnotation()}
      />
      {/* ─── 章内批注：查看/删除 — 点击正文批注高亮处弹出 ─── */}
      <AnnotationViewDialog
        annotation={annotationView}
        onClose={() => setAnnotationView(null)}
        onDelete={() => void handleDeleteAnnotation()}
      />
      {/* ─── T4 灵感/快速笔记：全局跨章、浮动速记不中断心流 ─── */}
      <WritingNotesDialog
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        bookId={activeBook?.id ?? ''}
        chapters={chapters}
        activeChapterId={activeChapterId}
        onGotoChapter={(chapterId) => {
          setActiveSetting(null);
          setActiveChapter(chapterId);
          setNotesOpen(false);
        }}
        draftContent={noteDraft || undefined}
        onClearDraft={() => setNoteDraft('')}
      />
    </Box>
  );
}
