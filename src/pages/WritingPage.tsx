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
import Select from '@mui/material/Select';
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
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
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
import InfoRoundedIcon from '@mui/icons-material/InfoRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import NavigateBeforeRoundedIcon from '@mui/icons-material/NavigateBeforeRounded';
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded';
import ChromeReaderModeRoundedIcon from '@mui/icons-material/ChromeReaderModeRounded';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded';
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
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
import FormatColorTextRoundedIcon from '@mui/icons-material/FormatColorTextRounded';
import TextIncreaseRoundedIcon from '@mui/icons-material/TextIncreaseRounded';
import TextDecreaseRoundedIcon from '@mui/icons-material/TextDecreaseRounded';
import FormatAlignLeftRoundedIcon from '@mui/icons-material/FormatAlignLeftRounded';
import FormatAlignCenterRoundedIcon from '@mui/icons-material/FormatAlignCenterRounded';
import FormatAlignRightRoundedIcon from '@mui/icons-material/FormatAlignRightRounded';
import FormatAlignJustifyRoundedIcon from '@mui/icons-material/FormatAlignJustifyRounded';
import FormatIndentIncreaseRoundedIcon from '@mui/icons-material/FormatIndentIncreaseRounded';
import FormatIndentDecreaseRoundedIcon from '@mui/icons-material/FormatIndentDecreaseRounded';
import FormatClearRoundedIcon from '@mui/icons-material/FormatClearRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import PhotoRoundedIcon from '@mui/icons-material/PhotoRounded';
import PsychologyRoundedIcon from '@mui/icons-material/PsychologyRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import CameraAltRoundedIcon from '@mui/icons-material/CameraAltRounded';
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import FormatSizeRoundedIcon from '@mui/icons-material/FormatSizeRounded';
import ClearIcon from '@mui/icons-material/Clear';
import Popover from '@mui/material/Popover';
import Switch from '@mui/material/Switch';
import Slider from '@mui/material/Slider';
import { useTheme } from '@mui/material/styles';
import {
  loadTypography,
  saveTypography,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_PRESETS,
  type BookTypography,
  type FontFamilyKey,
} from '../utils/typography';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { WritingAnnotation as WritingAnnotationExtension } from '../editor/extensions/writingAnnotation';
import { WritingImage, insertIllustrationIntoEditor, illustrationAssetRef } from '../editor/extensions/writingImage';
import { TextIndent } from '../editor/extensions/textIndent';
import { CoverThumb } from '../components/CoverThumb';
import { save as saveDialog, open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { emit, listen } from '@tauri-apps/api/event';
import { useLocation, useNavigate } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  WRITING_DESK_FOCUS_EVENT,
  currentDeskBookId,
  isWritingDeskWindow,
  type WritingDeskFocus,
} from '../utils/writingDeskWindow';
import { deleteBookWithScene } from '../utils/studioBook';
// 认知权重的单一口径（维度清单 + 写入语义）：UI 与 AI 上下文共用，避免两处各自漂移
import { COGNITIVE_DIMENSIONS, withCognitiveWeight } from '../utils/writingCognitiveWeights';
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
  type WritingCognitiveWeights,
  type WritingTimelineEvent,
  type AiAgent,
  type AssetInfo,
} from '../services/tauri';
import { parseBookGoal, writingApi, writingNotesApi } from '../services/writing';
import type { WritingNote } from '../services/writing';
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
import { WritingDrawer } from './writingPage/WritingDrawer';
import { extractCorpusQuery } from './writingPage/corpusQuery';

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
  type SettingCardKind,
  type SettingCompletionContext,
} from '../ai/writingAssistant';
import { L } from '../ai/aiLang';
import { AutoAnalysisPanel } from '../ai/AutoAnalysisPanel';

import { pickLang, t } from '../i18n';
import { genreLabelKey, mediumLabelKey } from '../utils/writingSchema';
import { GenreMediumFields } from './GenreMediumFields';
import { logger } from '../utils/logger';
import {
  chaptersOfSetting,
  ideasOfChapter,
  parseChapterCover,
  castOfChapter,
  looseBeats,
  relationTargetName,
  toggleSettingOnChapter,
} from '../utils/writingOutline';
import { buildTree, chapterPathLabels, treeRowIndent, type TreeNode } from '../utils/writingTree';
import { buildCharactersCorpus, buildCatalogCorpus } from '../utils/writingAiCorpus';
import { buildWorldBibleCorpus } from '../utils/writingCorpus';
import { CHAT_CONTEXT_PROFILE } from '../utils/writingCorpusBudget';
import { foreshadowingsPayableIn } from '../utils/writingForeshadowing';
import { beatEventText, beatImported, deriveTimeKeys } from '../utils/writingTimeline';
import { beatPlantedAsForeshadowing } from '../utils/writingInspiration';
import { buildProofreadReport, chapterTextIssues } from '../utils/writingProofread';
import { LeftTab, RightTab } from './writingPage/types';
import { ChapterDetailsPanel } from './ChapterDetailsPanel';
import { ChapterOverviewPanel } from '../editor/panels/ChapterOverviewPanel';
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
import { useEditorScrollMemory } from './writingPage/useEditorScrollMemory';
import { useDialogActions } from './writingPage/useDialogActions';
import { useBatchOperations } from './writingPage/useBatchOperations';
import { AiReviewDialog } from './writingPage/AiReviewDialog';
import { InlineAiDialog } from './writingPage/InlineAiDialog';
import { AiSelectionMenu } from './writingPage/AiSelectionMenu';
import { CommandPalette, type WorkbenchCommand } from '../editor/panels/CommandPalette';
import { useToolbarButtons } from './writingPage/useToolbarButtons';
import { FindReplaceDialog } from './writingPage/FindReplaceDialog';
import { ShortcutsDialog } from './writingPage/ShortcutsDialog';
import { InlineAiResultDialog } from './writingPage/InlineAiResultDialog';
import { SettingAiCompleteDialog } from './writingPage/SettingAiCompleteDialog';
import { SettingHistoryPanel } from './writingPage/SettingHistoryPanel';
import { TypographyPopover } from './writingPage/TypographyPopover';
import { AnnotationCreateDialog } from './writingPage/AnnotationCreateDialog';
import { AnnotationViewDialog } from './writingPage/AnnotationViewDialog';
import { turndown } from './writingPage/turndown';
import { chapterWordCount, chapterWordCountFromHtml, findMatches, replaceAllMatches } from './writingPage/editorUtils';
import { buildEditorBodySx } from './writingPage/editorSx';
import { runProofread, type ProofreadIssue } from '../editor/proofread/proofreadEngine';
import { detectAiFlavor, type AiFlavorIssue } from '../editor/proofread/aiFlavorEngine';
import {
  countCustomEntries,
  getCustomLexicon,
  getCustomLexiconError,
  loadCustomLexicon,
} from '../editor/proofread/lexiconStore';
import { LexiconDialog } from '../editor/proofread/LexiconDialog';
import { buildTextIndex, textRangeToPos, docPosToTextOffset } from '../editor/proofread/locate';
import { ProofreadPanel } from './writingPage/ProofreadPanel';
import { WritingHealthDialog } from './writingPage/WritingHealthDialog';
import { AiFlavorPanel } from './writingPage/AiFlavorPanel';
import { CraftComparePanel } from './writingPage/CraftComparePanel';
import { EmotionArcPanel } from './writingPage/EmotionArcPanel';
import { ShowTellPanel } from './writingPage/ShowTellPanel';
import { InspirationExpandPanel } from './writingPage/InspirationExpandPanel';
import { MaterialAssistDialog } from './writingPage/MaterialAssistDialog';
import { ExternalCaptureDialog } from './writingPage/ExternalCaptureDialog';
import { analyzeEmotionArc, type EmotionArcSegment } from '../utils/emotionArc';
import { detectShowTell, type ShowTellIssue } from '../utils/showTell';
import { filterReferenceHits } from '../utils/craftCompare';
import { corpusApi } from '../services/corpus';

// 左栏（书架 + 章节双 tab）宽度拖拽调节：范围 180–420，默认 240，跨会话持久化
const LEFT_PANEL_WIDTH_MIN = 180;
const LEFT_PANEL_WIDTH_MAX = 420;
const LEFT_PANEL_WIDTH_DEFAULT = 240;
const LEFT_PANEL_WIDTH_KEY = 'sight-folio:writing.leftPanelWidth';

function readSavedLeftPanelWidth(): number {
  try {
    const raw = Number(localStorage.getItem(LEFT_PANEL_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= LEFT_PANEL_WIDTH_MIN && raw <= LEFT_PANEL_WIDTH_MAX) {
      return Math.round(raw);
    }
  } catch {
    // 忽略读取异常，回退默认值
  }
  return LEFT_PANEL_WIDTH_DEFAULT;
}

export default function WritingPage() {
  // 左栏拖拽调宽：手柄在左栏右缘，向右拖 = 变宽；双击复位；宽度跨会话记忆
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(readSavedLeftPanelWidth);
  const leftPanelWidthRef = useRef<number>(leftPanelWidth);
  // 统一经 updateLeftPanelWidth 改宽度：state 与 ref 同步，拖拽结束按 ref 写偏好
  const updateLeftPanelWidth = useCallback((w: number) => {
    leftPanelWidthRef.current = w;
    setLeftPanelWidth(w);
  }, []);
  const leftDragStartRef = useRef<{ x: number; width: number } | null>(null);
  const [leftDragActive, setLeftDragActive] = useState(false);

  const startLeftResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    leftDragStartRef.current = { x: e.clientX, width: leftPanelWidthRef.current };
    setLeftDragActive(true);
    // 拖拽期间禁止选中文本，避免拖动时高亮选中相邻卡片文字
    document.body.style.userSelect = 'none';
  }, []);

  const onLeftResizeMove = useCallback((e: PointerEvent) => {
    const s = leftDragStartRef.current;
    if (!s) return;
    const next = s.width + (e.clientX - s.x);
    updateLeftPanelWidth(Math.min(LEFT_PANEL_WIDTH_MAX, Math.max(LEFT_PANEL_WIDTH_MIN, Math.round(next))));
  }, []);

  const onLeftResizeEnd = useCallback(() => {
    if (!leftDragStartRef.current) return;
    leftDragStartRef.current = null;
    setLeftDragActive(false);
    document.body.style.userSelect = '';
    try {
      localStorage.setItem(LEFT_PANEL_WIDTH_KEY, String(leftPanelWidthRef.current));
    } catch {
      // 存储不可写（隐私模式等）：本次会话内宽度仍生效，不再重试
    }
  }, []);

  /** 双击手柄：宽度一键复位为默认值（误拖后快速回到原始布局），并记忆偏好 */
  const onLeftResizeReset = useCallback(() => {
    leftDragStartRef.current = null;
    setLeftDragActive(false);
    document.body.style.userSelect = '';
    updateLeftPanelWidth(LEFT_PANEL_WIDTH_DEFAULT);
    try {
      localStorage.setItem(LEFT_PANEL_WIDTH_KEY, String(LEFT_PANEL_WIDTH_DEFAULT));
    } catch {
      // 存储不可写（隐私模式等）：本次会话内立即生效即可
    }
  }, []);

  // 拖拽监听挂在 window：移出面板/iframe 边界仍持续跟手，松开即停
  useEffect(() => {
    window.addEventListener('pointermove', onLeftResizeMove);
    window.addEventListener('pointerup', onLeftResizeEnd);
    window.addEventListener('pointercancel', onLeftResizeEnd);
    return () => {
      window.removeEventListener('pointermove', onLeftResizeMove);
      window.removeEventListener('pointerup', onLeftResizeEnd);
      window.removeEventListener('pointercancel', onLeftResizeEnd);
    };
  }, [onLeftResizeMove, onLeftResizeEnd]);

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
  const createOutline = useWritingStore((s) => s.createOutline);
  const updateOutline = useWritingStore((s) => s.updateOutline);

  const setChapterVolume = useWritingStore((s) => s.setChapterVolume);
  const setDailyGoal = useWritingStore((s) => s.setDailyGoal);
  const setBookGoal = useWritingStore((s) => s.setBookGoal);
  const loadBooks = useWritingStore((s) => s.loadBooks);

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
  const storylines = useWritingStore((s) => s.storylines);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const createTimelineEvent = useWritingStore((s) => s.createTimelineEvent);
  const updateTimelineEvent = useWritingStore((s) => s.updateTimelineEvent);
  const assignTimelineTimeKeys = useWritingStore((s) => s.assignTimelineTimeKeys);
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
  // 创作台重设计：书架收窄为「当前作品 + 下拉切换」（章节树获得完整栏高）
  const [bookSwitcherAnchor, setBookSwitcherAnchor] = useState<HTMLElement | null>(null);
  // 语料库集成：写作中输入即自动检索语料库句子供参考（query 由 onUpdate 提取光标前片段）
  const [corpusQuery, setCorpusQuery] = useState('');
  // T4：灵感/快速笔记收集器
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  // 笔记完善（B）：左栏摘要预览 + 弹窗内点击条目聚焦
  const [sidebarNotes, setSidebarNotes] = useState<WritingNote[]>([]);
  const [notesFocusId, setNotesFocusId] = useState<string | null>(null);
  // 打开弹窗时预置的章节筛选（'' = 全部，本章入口用）
  const [notesFilterChapter, setNotesFilterChapter] = useState('');

  // 当前书变化时刷新左栏笔记摘要（供「最近 N 条 + 总数」预览）
  useEffect(() => {
    if (!activeBookId) return;
    let alive = true;
    try {
      void writingNotesApi
        .list(activeBookId)
        .then((rows) => {
          if (alive) setSidebarNotes(rows);
        })
        .catch((e) => {
          logger.warn('WritingPage', 'load sidebar notes failed', { error: e });
        });
    } catch {
      /* 调用抛同步异常时忽略 */
    }
    return () => {
      alive = false;
    };
  }, [activeBookId]);

  /** 打开笔记弹窗：可选聚焦某条笔记（左栏点击）、可选预置章节筛选（本章入口） */
  const openNotesPanel = useCallback((focusId: string | null = null, filterChapter = '') => {
    setNotesFocusId(focusId);
    setNotesFilterChapter(filterChapter);
    setNotesOpen(true);
  }, []);

  // 本章笔记数（正文 meta 行入口徽标）
  const chapterNoteCount = useMemo(
    () => (activeChapterId ? sidebarNotes.filter((n) => n.chapterId === activeChapterId).length : 0),
    [sidebarNotes, activeChapterId],
  );

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
  /** 全书体检面板（批次② 增-1）：七组发现此前只在场景画布可见，写作台里一键直达 */
  const [healthOpen, setHealthOpen] = useState(false);
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
  const [annotationSettingId, setAnnotationSettingId] = useState('');
  const [annotationView, setAnnotationView] = useState<WritingAnnotation | null>(null);
  const [chapterAnnotations, setChapterAnnotations] = useState<WritingAnnotation[]>([]);
  // 多色高亮色板
  const [highlightAnchor, setHighlightAnchor] = useState<HTMLElement | null>(null);
  const [highlightOpen, setHighlightOpen] = useState(false);

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
  // 自定义校对词库（增-6）：面板入口 + 词条数角标
  const [lexiconOpen, setLexiconOpen] = useState(false);
  const [lexiconEntryCount, setLexiconEntryCount] = useState(0);
  // ─── AI 味检测（写作方案 A2·统计层）：模板套话/节奏/长句/情绪直述 + 编辑器内定位 ───
  const [aiFlavorOpen, setAiFlavorOpen] = useState(false);
  const [aiFlavorIssues, setAiFlavorIssues] = useState<AiFlavorIssue[]>([]);
  const [activeAiFlavorKey, setActiveAiFlavorKey] = useState<string>('');
  // A3 情感弧线分析：段落级情感曲线（引擎 analyzeEmotionArc）
  const [emotionArcOpen, setEmotionArcOpen] = useState(false);
  const [emotionArcSegments, setEmotionArcSegments] = useState<EmotionArcSegment[]>([]);
  const [activeEmotionArcKey, setActiveEmotionArcKey] = useState<string>('');
  // B3 Show-not-Tell 顾问：情绪直述句 + 改写方向 + 库内示范句（引擎 detectShowTell）
  const [showTellOpen, setShowTellOpen] = useState(false);
  const [showTellIssues, setShowTellIssues] = useState<ShowTellIssue[]>([]);
  const [activeShowTellKey, setActiveShowTellKey] = useState<string>('');
  // ─── O7 灵感扩写：灵感念头池 → AI 扩写成段落/场景 → 一键插入正文 ───
  const [inspirationExpandOpen, setInspirationExpandOpen] = useState(false);
  // ─── M1 资料辅助创作：选资料目录 → AI 分析 → 选作品/章 → 生成草稿回填 ───
  const [materialOpen, setMaterialOpen] = useState(false);
  // ─── C8 外部素材采集：图片/文本/记事本/链接 → AI 分析 → 素材库（右抽屉 Tab） ───
  const [captureOpen, setCaptureOpen] = useState(false);
  // 素材库刷新信号：对话框保存成功后 +1，触发抽屉内 ExternalCapturePanel 重拉
  const [captureRefreshKey, setCaptureRefreshKey] = useState(0);
  // 跨视图预选：L2 灵感卡「AI 扩写」经 openWritingDesk → 写作台窗口 focus 携带
  // inspirationId，消费后打开面板并预选该念头（inspirationExpandInitialId 消费一次清空）
  const [inspirationExpandInitialId, setInspirationExpandInitialId] = useState<string | null>(null);
  // ─── 写法对照工作台（写作方案 C3）：选中平淡句 ⇄ 语料库召回优质句对照改写 ───
  const [craftCompareOpen, setCraftCompareOpen] = useState(false);
  const [craftSource, setCraftSource] = useState('');
  // 对照改写消息经「对话式 AI」发出：预填通道由 WritingAiChatDialog 消费一次后清空
  const [chatInitial, setChatInitial] = useState('');
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

  // 自定义校对词库：挂载时读一次 KV（幂等，之后都命中模块缓存）。
  // 读完若已有正文就补跑一遍校对——否则首屏那次结果只反映内置词表，
  // 作者会以为自己的词条没生效。读失败必须可见：静默退回内置词表，
  // 作者看到的是"我的词库不灵"，而真实原因是没读到。
  useEffect(() => {
    let alive = true;
    void loadCustomLexicon().then(() => {
      if (!alive) return;
      const err = getCustomLexiconError();
      if (err) {
        useToastStore.getState().showToast(t('writing.lexiconLoadFailed', { msg: err }), 'error');
        return;
      }
      setLexiconEntryCount(countCustomEntries(getCustomLexicon()));
      if (proofreadTextRef.current.trim()) runProofreadDebounced();
    });
    return () => {
      alive = false;
    };
  }, [runProofreadDebounced]);

  useEffect(() => {
    loadBooks().catch((e: unknown) => {
      // 书架取不到，用户只会以为「书没了」。这条必须可见（与正文保存链路同口径）。
      const msg = e instanceof Error ? e.message : String(e);
      useToastStore.getState().showToast(t('writing.loadBooksFailed', { msg }), 'error');
    });
  }, [loadBooks]);

  // ─── P1 跳转语义：定位到具体章节/设定 ───
  // 三路入口共用 focusWritingTarget：
  // ① location.state —— 主窗口内兜底路由（react-router state）
  // ② query 参数 —— 写作台独立窗口冷启动（WebviewWindow 传不了 state，走 /writing?desk=1&book=..&chapter=..）
  // ③ writing-desk-focus 事件 —— 独立窗口已存在时，入口侧 emit 让窗口内部切章/设定
  const location = useLocation();
  // 定位目标统一用 react-router state 的 focus* 命名（历史约定）；
  // 窗口事件载荷是 WritingDeskFocus（bookId/chapterId/settingId/inspirationId），入口处翻译。
  interface FocusTarget {
    focusBook?: string | null;
    focusChapter?: string | null;
    focusSetting?: string | null;
    focusInspiration?: string | null;
  }
  const focusWritingTarget = useCallback(
    async (focus: FocusTarget | null, autoFirstChapter = true) => {
      // L1 书页签转写作台只传 book（无 chapter/setting），必须放行；
      // 仅当所有定位字段全无（如 desk=1 纯空态打开）才跳过。
      if (!focus || (!focus.focusBook && !focus.focusChapter && !focus.focusSetting && !focus.focusInspiration)) return;
      logger.info('WritingPage', 'focus consumed', {
        focusBook: focus.focusBook ?? null,
        focusChapter: focus.focusChapter ?? null,
        focusSetting: focus.focusSetting ?? null,
        focusInspiration: focus.focusInspiration ?? null,
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
          // 跨窗口/提醒跳转打开设定卡同样要复位右栏到正文页签（右栏停在章详情会遮蔽设定卡）
          setRightTab('body');
        } else if (autoFirstChapter) {
          // 仅定位到书（L1 书页签 / 独立窗口冷启动只带 book）：默认进入该书正文——
          // 自动选中第一个「章」节点（无章则取 sortOrder 首节点），让正文编辑器与
          // 右侧语料参考面板一并就位，而不是停在「请选择章节」空态。
          // 已存在窗口的 focus 事件只带 bookId 时传 false：保留当前章节，不打断写作。
          const st = useWritingStore.getState();
          if (st.activeBookId && st.chapters.length > 0) {
            const ordered = [...st.chapters].sort((a, b) => a.sortOrder - b.sortOrder);
            const first = ordered.find((c) => (c.kind || '') === '章') ?? ordered[0];
            setLeftTab('chapters');
            setActiveChapter(first.id);
          }
        }
        // L2 灵感卡「AI 扩写」跨视图定位：书就位后打开扩写面板并预选指定念头
        if (focus.focusInspiration) {
          setInspirationExpandInitialId(focus.focusInspiration);
          setInspirationExpandOpen(true);
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
    if (!st || (!st.focusBook && !st.focusChapter && !st.focusSetting && !st.focusInspiration)) return;
    void focusWritingTarget(st).finally(() => {
      navigate(location.pathname, { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, focusWritingTarget]);

  // ② query 参数：写作台独立窗口冷启动定位，消费后立即清 query。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (
      !params.has('desk') &&
      !params.has('book') &&
      !params.has('chapter') &&
      !params.has('setting') &&
      !params.has('insp')
    )
      return;
    const focus: FocusTarget = {
      focusBook: params.get('book'),
      focusChapter: params.get('chapter'),
      focusSetting: params.get('setting'),
      focusInspiration: params.get('insp'),
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
      // 窗口已存在时的 focus 事件：只带 bookId（如书架「在写作台打开」点击已开窗口的书）
      // 不自动切第一章——保留当前正在写的章节，仅聚焦置前；带 chapter/setting 才切。
      void focusWritingTarget(
        {
          focusBook: e.payload.bookId,
          focusChapter: e.payload.chapterId,
          focusSetting: e.payload.settingId,
          focusInspiration: e.payload.inspirationId,
        },
        false,
      );
    }).then((u) => (un = u));
    return () => un?.();
  }, [focusWritingTarget]);

  const activeBook = books.find((b) => b.id === activeBookId) ?? null;
  const activeChapter = chapters.find((c) => c.id === activeChapterId) ?? null;
  const activeSetting = settings.find((x) => x.id === activeSettingId) ?? null;
  const genre = activeBook?.genre ?? '';

  // 一书一窗：本窗口绑定的书（仅写作台独立窗口且为一书一窗形态时有值；主窗口/单例为 null）
  const deskBookId = useMemo(() => currentDeskBookId(), []);
  // 独立窗口形态（URL 带 desk=1，含单例）：书架列表只属于主窗口 /writing；独立窗口（含无绑定书的单例）一律不渲染书架。
  const isDeskWindow = isWritingDeskWindow();

  // 一书一窗：独立窗口标题跟随绑定书（`书名 · 写作台`），重命名后同步刷新
  useEffect(() => {
    if (!deskBookId) return;
    const win = getCurrentWindow();
    const title = activeBook ? `${activeBook.title} · ${t('writing.title')}` : t('writing.deskWindowTitle');
    void win.setTitle(title);
  }, [deskBookId, activeBook]);

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

  /**
   * 全书体检发现数（抽屉入口角标）。口径 = utils/writingProofread.buildProofreadReport，
   * 与画布校对页签/右栏要素卡同一份，禁止第二份。
   *
   * 刻意不写 useMemo：整本报告要扫全书正文，成本与总字数成正比（百万字级会到几百 ms），
   * 而 chapters 每次自动保存都换引用——挂在渲染路径上会直接拖慢输入。这里 1.5s 去抖，
   * 输入与连续切章期间不重算；面板本体仍由 WritingHealthDialog 打开时自算一次。
   */
  const [healthIssueCount, setHealthIssueCount] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHealthIssueCount(
        buildProofreadReport(chapters, outlines, timelineEvents, foreshadowings, storylines, settings).issues.length,
      );
    }, 1500);
    return () => clearTimeout(timer);
  }, [chapters, outlines, timelineEvents, foreshadowings, storylines, settings]);

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
      // ⌘K 冲突修复：命令面板监听若已处理（defaultPrevented），此处不再重复响应
      if (e.defaultPrevented) return;
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

  // 时间线「绑定章节」：按当前书构建章节树，下拉严格按树层级展开（缩进口径与大纲树一致）
  const bindableChapterRows = useMemo(() => {
    const rows: { id: string; title: string; depth: number }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        rows.push({ id: n.node.id, title: n.node.title, depth: n.depth });
        walk(n.children);
      }
    };
    walk(buildTree(chapters.filter((c) => c.bookId === activeSetting?.bookId)));
    return rows;
  }, [chapters, activeSetting?.bookId]);

  // ─── 正文自动保存：pending 快照 + 防抖 timer ───
  const pendingRef = useRef<{ chapterId: string; html: string; wordCount: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChapterIdRef = useRef<string | null>(activeChapterId);
  // 保存失败 toast 节流（10s 内最多弹一次）
  const lastSaveFailToastRef = useRef(0);
  useEffect(() => {
    activeChapterIdRef.current = activeChapterId;
  }, [activeChapterId]);

  const flushSave = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return true;
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
      return true;
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
      return false;
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
        // 强制草稿快照兜底：卸载 flush 是 fire-and-forget，路由切换后 IPC 失败无人重试——
        // 先把最新内容同步写入草稿，flush 成功会被 clearDraftSnap 清掉，失败则下次可恢复
        if (activeBookIdRef.current) {
          saveDraftSnap(activeBookIdRef.current, pending.chapterId, pending.html, pending.wordCount, 'manual');
        }
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
      // 批次⑥ 专业格式控件：段落对齐（左/中/右/两端）与整体缩进
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
      TextIndent,
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
      // 语料集成：光标前片段作为检索关键词，自动参考面板随输入实时刷新
      setCorpusQuery(extractCorpusQuery(editor));
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
  // M1 资料辅助创作：跨章回填时暂存草稿，切章 effect 装载新章内容后插入（不覆盖加载内容）
  const pendingMaterialInsertRef = useRef<{ chapterId: string; text: string } | null>(null);
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
    // M1 资料辅助创作：跨章回填——装载完成后插入待写入草稿（光标末尾，触发自动保存）
    if (pendingMaterialInsertRef.current && pendingMaterialInsertRef.current.chapterId === activeChapterId) {
      const { text } = pendingMaterialInsertRef.current;
      pendingMaterialInsertRef.current = null;
      editor.chain().focus('end').insertContent(textToParagraphHtml(text)).run();
    }
    // 语料集成：换章即清空自动检索关键词（setContent 不触发 onUpdate）
    setCorpusQuery('');
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

  // 同章切「正文 ↔ 章详情/设定卡」的滚动位置记忆（2026-10-31 第六轮）。
  // body 分支整体挂载/卸载：切到章详情或设定卡时滚动容器被卸载，切回正文是全新 DOM（scrollTop 归零），
  // 而上面的换章 effect 只认 loadedChapterIdRef 变化——同章切视图走不到它，正文便跳回顶部。
  // 本 hook 以「body 是否挂载」为生命周期，持续落账、返回即恢复，与换章 effect 共用同一 memory Map（幂等）。
  useEditorScrollMemory({
    scrollRef: editorScrollRef,
    bodyVisible: rightTab === 'body' && !activeSetting,
    chapterId: activeChapterId ?? null,
    memory: scrollTopByChapterRef.current,
  });

  // ─── AI 写工具外部变更（writing-chapter-external-change）──────────────────
  // 后端 write_chapter / create_chapter 落库后推送。分三路：
  // ① 改的是别的章 / 新建章 → 只刷新目录（字数、新章条目），不打扰编辑；
  // ② 改的是当前章且无未保存编辑 → 从库里拉最新正文重载编辑器，提示「AI 已更新」；
  // ③ 改的是当前章但有未保存编辑 → 绝不覆盖编辑器（用户输入优先），提示冲突——
  //    用户保存会覆盖 AI 版本，AI 写入前的原稿在其版本历史里可找回。
  useEffect(() => {
    if (!editor) return;
    let un: (() => void) | undefined;
    listen<{ bookId: string; chapterId: string; action: 'write' | 'create' }>(
      'writing-chapter-external-change',
      (e) => {
        const { bookId, chapterId, action } = e.payload;
        // 非激活书不动编辑器：切书时 loadChapters 会重新拉库，天然一致
        if (bookId !== activeBookIdRef.current) return;
        // 目录刷新对两种 action 都需要（create 加新章、write 字数变了）
        void useWritingStore
          .getState()
          .loadChapters(bookId)
          .catch((err) => logger.warn('WritingPage', 'refresh chapters after AI change failed', { error: err }));
        if (action !== 'write') return;
        if (chapterId !== activeChapterIdRef.current) return;
        // 编辑器有未保存输入：用户内容优先，不覆盖
        if (pendingRef.current && pendingRef.current.chapterId === chapterId) {
          useToastStore.getState().warning(t('writing.aiEditedConflict'));
          return;
        }
        // 无未保存输入：静默拉库重载，与切章装载同口径（emitUpdate=false 不触发保存）
        void writingApi
          .getChapter(chapterId)
          .then((latest) => {
            if (!latest) return;
            if (chapterId !== activeChapterIdRef.current) return; // 期间切章了
            if (pendingRef.current && pendingRef.current.chapterId === chapterId) return; // 期间又输入了
            editor.commands.setContent(latest.content, { emitUpdate: false });
            setSaveStateRef.current('idle');
            proofreadTextRef.current = editor.getText();
            runProofreadDebounced();
            useToastStore.getState().info(t('writing.aiEditedReloaded'));
          })
          .catch((err) => logger.warn('WritingPage', 'reload chapter after AI write failed', { error: err }));
      },
    ).then((u) => (un = u));
    return () => un?.();
    // 只依赖 editor：handler 内全部走 ref 读最新状态，避免反复退订/重订
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ─── AI 设定卡写工具外部变更（writing-setting-external-change）─────────────
  // 后端 update_character_card 落库后推送。**不接这条会有一处静默数据丢失**：
  // 写作台 store 持着卡片的旧副本，作者此时在卡编辑器里点保存，`save_setting` 是整行
  // upsert，会把 AI 刚写进去的内容顶掉，而作者完全不知道发生过这件事。
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<{ bookId: string; settingId: string }>('writing-setting-external-change', (e) => {
      const { bookId, settingId } = e.payload;
      // 非激活书不动：切书时 load() 会重新拉库，天然一致
      if (bookId !== activeBookIdRef.current) return;
      const openId = useWritingStore.getState().activeSettingId;
      void useWritingStore
        .getState()
        .loadSettings()
        .catch((err) => logger.warn('WritingPage', 'refresh settings after AI change failed', { error: err }));
      // 改的正是作者开着的那张卡：卡编辑器持有打开时的副本，此刻保存会覆盖 AI 的写入。
      // 这里读不到卡编辑器内部的"有无未保存输入"，所以宁可提示一次，也不静默。
      if (openId && openId === settingId) {
        useToastStore.getState().warning(t('writing.aiEditedSettingCard'));
      }
    }).then((u) => (un = u));
    return () => un?.();
    // handler 内全部走 ref / getState 读最新状态，无需重订阅
  }, []);

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
      // 竞态修复：恢复前先取消防抖定时器并清空 pending，防止恢复后被 800ms 旧定时器覆盖
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = null;
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
    // 竞态修复：同快照恢复——先取消防抖定时器并清空 pending，防止草稿被旧定时器覆盖
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
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
      settingId: annotationSettingId || '',
      createdAt: now,
      updatedAt: now,
    };
    try {
      await writingAnnotationsApi.save(ann);
      editor.chain().focus().setWritingAnnotation(ann.id).run();
      setChapterAnnotations((prev) => [ann, ...prev]);
      setAnnotationDraft(null);
      setAnnotationText('');
      setAnnotationSettingId('');
      useToastStore.getState().success(t('writing.annotationAdded'));
    } catch (e) {
      logger.warn('WritingPage', 'save annotation failed', { error: e });
      useToastStore.getState().error(String(e));
    }
  }, [editor, activeChapterId, activeChapter, annotationDraft, annotationText, annotationSettingId]);

  /** 查看弹窗内修改关联设定卡：拷贝对象 → 落库 → 本地态同步 */
  const handleUpdateAnnotationSetting = useCallback(async (ann: WritingAnnotation, settingId: string) => {
    const next: WritingAnnotation = { ...ann, settingId: settingId || '', updatedAt: Math.floor(Date.now() / 1000) };
    try {
      await writingAnnotationsApi.save(next);
      setChapterAnnotations((prev) => prev.map((a) => (a.id === next.id ? next : a)));
      setAnnotationView(next);
      useToastStore.getState().success(t('writing.annotationSettingSaved'));
    } catch (e) {
      logger.warn('WritingPage', 'update annotation setting failed', { error: e });
      useToastStore.getState().error(String(e));
    }
  }, []);

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
    setAnnotationSettingId('');
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
  // Block3 出场章主动绑定：选中候选章的本地草稿（不落库，绑定成功即清空）
  const [bindChapterId, setBindChapterId] = useState('');
  const settingPendingRef = useRef<{
    settingId: string;
    patch: { name: string; subtitle: string; description: string; extra: string };
  } | null>(null);
  const settingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ⑥ 写侧单向同步：记录每个世界观卡「上次由 relations 自动同步进 linkedTo 的摘要」。
  // 手动编辑 linkedTo 后（值与上次自动值不同）不再被后续 relations 变更覆盖；清空则恢复自动同步。
  const linkedToAutoRef = useRef<Map<string, string>>(new Map());

  const flushSettingSave = useCallback(async (): Promise<boolean> => {
    if (settingTimerRef.current) {
      clearTimeout(settingTimerRef.current);
      settingTimerRef.current = null;
    }
    const pending = settingPendingRef.current;
    if (!pending) return true;
    settingPendingRef.current = null;
    try {
      await updateSetting(pending.settingId, pending.patch);
      return true;
    } catch (e) {
      logger.warn('WritingPage', 'setting auto save failed', { error: e });
      // 失败不丢改动：把待存补丁放回 pending——下次编辑/切卡/关窗会自动重试
      if (!settingPendingRef.current) settingPendingRef.current = pending;
      // 失败必须可见：静默失败=用户误以为设定已保存
      useToastStore.getState().error(t('writing.settingSaveFailed'));
      return false;
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
    inlineStyleConsistency,
    setInlineStyleConsistency,
    styleFingerprintAvailable,
    agents,
    writingPresets,
    streamPreviewRef,
    inlineSelectionRef,
    settingAiOpen,
    setSettingAiOpen,
    settingAiAgentId,
    setSettingAiAgentId,
    settingAiRunning,
    settingAiStreamText,
    settingAiResult,
    setSettingAiResult,
    openSettingAi,
    handleRunSettingAi,
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

  // 统一的「打开设定卡」动作：置 activeSetting 同时把右栏拉回正文页签。
  // 修反向卡死：右栏停在「章详情」时因渲染优先级 details 在前，只置 activeSetting
  // 会让用户点了人物/设定却毫无反应——必须在打开设定时复位 rightTab 到 body。
  const openSetting = useCallback(
    (id: string) => {
      setActiveSetting(id);
      setRightTab('body');
    },
    [setActiveSetting],
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
    openSetting,
  });

  // ─── 关窗保稿（批次①）：窗口关闭先 flush 未保存正文/设定卡再放行 ───
  // 卸载 flush 是 fire-and-forget，Tauri 关窗即销毁 webview，IPC 可能没跑完——
  // 必须拦下 close 事件、等 flush 落库完成后再销毁窗口。800ms 防抖窗口内关窗不再丢稿。
  // flush IPC 卡死（后端忙/锁等待）时不能让窗口永远关不掉：超时后放行销毁，
  // 靠关窗前强制写入的草稿快照在下次启动时恢复（快照兜底）。
  const CLOSE_FLUSH_TIMEOUT_MS = 5_000;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closing = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (closing) return;
        if (!pendingRef.current && !settingPendingRef.current) return; // 无脏内容：放行默认关闭
        event.preventDefault();
        closing = true;
        // 快照兜底（同步、零成本）：先把最新待存内容强制写入 localStorage 崩溃草稿
        // （绕过 15s 节流）。flush 成功会被 clearDraftSnap 清掉；失败/超时/强杀则保证
        // 下次打开能恢复到最后一次按键的内容，而不是最多丢 15s 节流窗口内的输入。
        const bodyPending = pendingRef.current;
        if (bodyPending && activeBookIdRef.current) {
          saveDraftSnap(
            activeBookIdRef.current,
            bodyPending.chapterId,
            bodyPending.html,
            bodyPending.wordCount,
            'manual',
          );
        }
        // 关窗保稿 + 超时护栏：正文与设定卡在时限内落库成功才放行销毁；
        // 落库失败（DB 明确报错）保留窗口并可见提示，用户可重试或手动复制内容；
        // 超时（IPC 无响应）则放行销毁——草稿快照已兜底，卡死窗口强杀只会更糟。
        const raced = await Promise.race([
          Promise.all([flushSave(), flushSettingSave()]),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), CLOSE_FLUSH_TIMEOUT_MS)),
        ]);
        if (raced === 'timeout') {
          logger.warn('WritingPage', 'flush on close timed out, destroying with draft fallback');
          await getCurrentWindow().destroy();
          return;
        }
        const [bodySaved, settingSaved] = raced;
        if (!bodySaved || !settingSaved) {
          logger.warn('WritingPage', 'flush on close failed', { bodySaved, settingSaved });
          closing = false; // 允许用户再次尝试关闭或继续编辑
          useToastStore.getState().error(t('writing.closeSaveFailed'));
          return;
        }
        await getCurrentWindow().destroy();
      })
      .then((u) => {
        unlisten = u;
      });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- CLOSE_FLUSH_TIMEOUT_MS 为组件内常量
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

  /**
   * ⑥ 写侧单向同步：世界观卡编辑 relations 时，把关联摘要同步进 linkedTo（自由文本）。
   * 规则：仅当 linkedTo 为空，或仍等于「上次由本函数自动写入的值」时才更新——
   * 用户手动改过 linkedTo 后不再被自动覆盖；手动清空后恢复自动同步。
   * 摘要格式：〈目标名〉（〈类型〉）顿号连接；relations 清空时同步清空自动摘要。
   */
  const syncLinkedTo = (e: WritingSettingExtra) => {
    if (activeSetting?.kind !== 'worldbuilding') return;
    const rels = Array.isArray(e.relations) ? e.relations : [];
    const summary = rels
      .map((r) => {
        const name = relationTargetName(settings, r);
        return r.type?.trim() ? `${name}（${r.type.trim()}）` : name;
      })
      .filter(Boolean)
      .join('、');
    const wb: WritingWorldbuildingProfile = { ...(e.worldbuildingProfile ?? {}) };
    const cur = wb.linkedTo ?? '';
    const lastAuto = linkedToAutoRef.current.get(activeSetting.id) ?? '';
    if (cur.trim() !== '' && cur !== lastAuto) return; // 手动改过：不覆盖
    if (summary) {
      wb.linkedTo = summary;
      linkedToAutoRef.current.set(activeSetting.id, summary);
    } else {
      delete wb.linkedTo;
      linkedToAutoRef.current.set(activeSetting.id, '');
    }
    if (Object.keys(wb).length > 0) e.worldbuildingProfile = wb;
    else delete e.worldbuildingProfile;
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
      syncLinkedTo(e);
    });
  };
  const addRelation = () =>
    updateExtra((e) => {
      e.relations = [...(e.relations ?? []), { target: '', type: '' }];
      syncLinkedTo(e);
    });
  const removeRelation = (idx: number) =>
    updateExtra((e) => {
      e.relations = (e.relations ?? []).filter((_, i) => i !== idx);
      syncLinkedTo(e);
    });
  const setTimelineRow = (
    eventId: string,
    field: 'at' | 'event' | 'chapterId' | 'storylineId' | 'timeKey',
    value: string,
  ) => {
    // timeKey 三态要分开：空串 = 作者没填（null，该条不参与倒挂检查）；纯整数才落库。
    // 输入过程中的 "-"、"1e" 这类半成品直接忽略，别把作者正在敲的东西存成 0——
    // 存成 0 会让这条事件被当成"第 0 天"，凭空造出一个假的时间倒挂。
    if (field === 'timeKey') {
      const raw = value.trim();
      if (raw === '') void updateTimelineEvent(eventId, { timeKey: null });
      else if (/^-?\d+$/.test(raw)) void updateTimelineEvent(eventId, { timeKey: Number(raw) });
      return;
    }
    const patch: Partial<Pick<WritingTimelineEvent, 'at' | 'event' | 'chapterId' | 'storylineId'>> =
      field === 'chapterId' || field === 'storylineId' ? { [field]: value || null } : { [field]: value };
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
  /**
   * 认知权重（T12）：写入 / 清空 extra.profile.cognitiveWeights，零迁移。
   *
   * `0` 与 `null` 含义不同（口径统一在 `utils/writingCognitiveWeights`）：
   * 0 = 中立，是作者明确表达过的取值，要落库；null = 未设置，才删掉该维。
   * 旧写法把两者混为一谈，导致「他在这条轴上不偏不倚」这个设定根本存不下来。
   */
  const setCognitiveWeightField = (field: keyof WritingCognitiveWeights, value: number | null) => {
    updateExtra((e) => {
      const profile: WritingSettingProfile = { ...(e.profile ?? {}) };
      const cw = withCognitiveWeight(profile.cognitiveWeights, field, value);
      if (cw) profile.cognitiveWeights = cw;
      else delete profile.cognitiveWeights;
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

  /**
   * Block3 出场章主动绑定：把当前设定挂到选中章（人物→cast / 世界观→scenes）。
   * 复用 toggleSettingOnChapter —— 与章检视器 / 人物 tab / 章详情同一写入口，防口径漂移。
   * 落库后 store 会重建 characterChapterIndex，chaptersOfSetting 派生随之刷新。
   */
  const bindSettingToChapter = async () => {
    if (!bindChapterId || !activeSetting) return;
    const isChar = activeSetting.kind === 'character';
    const chapter = chapters.find((c) => c.id === bindChapterId);
    await toggleSettingOnChapter(
      { outlines, createOutline, updateOutline },
      bindChapterId,
      isChar ? 'cast' : 'scenes',
      activeSetting.id,
      chapter?.title || activeSetting.name,
    );
    setBindChapterId('');
  };

  // ─── 设定卡 AI 补全（P0）：从卡片已有内容生成缺失字段建议，确认后一次性回填 ───
  /** 各类档案的字段集（英文键，与 WritingSettingProfile / WritingWorldbuildingProfile 对齐） */
  const SETTING_PROFILE_FIELDS: Record<SettingCardKind, string[]> = {
    character: ['appearance', 'personality', 'motivation', 'catchphrase', 'notes'],
    worldbuilding: ['type', 'rules', 'exceptions', 'linkedTo', 'notes'],
  };
  /** 组装补全上下文：已有值 + 缺失字段；全部已填则提示并不打开对话框 */
  const openSettingCompletion = (kind: SettingCardKind) => {
    const src = kind === 'character' ? settingDraft.extra.profile : settingDraft.extra.worldbuildingProfile;
    const existing: Record<string, string> = {};
    const missingKeys: string[] = [];
    for (const key of SETTING_PROFILE_FIELDS[kind]) {
      const v = src?.[key as keyof typeof src];
      const s = typeof v === 'string' ? v : '';
      existing[key] = s;
      if (!s.trim()) missingKeys.push(key);
    }
    if (missingKeys.length === 0) {
      useToastStore.getState().info(t('writing.settingAiComplete'));
      return;
    }
    openSettingAi({
      kind,
      settingName: settingDraft.name,
      subtitle: settingDraft.subtitle,
      description: settingDraft.description,
      existing,
      missingKeys,
    } satisfies SettingCompletionContext);
  };
  /** 应用补全结果：一次性构造 next.extra 再 editSettingDraft（避免多次 setState 互相覆盖） */
  const applySettingCompletion = () => {
    const result = settingAiResult;
    if (!result || result.fields.length === 0) {
      setSettingAiOpen(false);
      return;
    }
    const next: WritingSettingExtra = { ...settingDraft.extra };
    if (result.kind === 'character') {
      const profile: WritingSettingProfile = { ...(next.profile ?? {}) };
      for (const f of result.fields) profile[f.key as keyof WritingSettingProfile] = f.value;
      next.profile = profile;
    } else {
      const wb: WritingWorldbuildingProfile = { ...(next.worldbuildingProfile ?? {}) };
      for (const f of result.fields) wb[f.key as keyof WritingWorldbuildingProfile] = f.value;
      next.worldbuildingProfile = wb;
    }
    editSettingDraft({ ...settingDraft, extra: next });
    setSettingAiOpen(false);
    setSettingAiResult(null);
    useToastStore.getState().success(t('writing.settingAiApplied', { n: result.fields.length }));
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

  /**
   * 「推演序号」：按时间线现有排序口径（compareByAt，全视图唯一口径）为带数字的时点
   * 批量填 timeKey，替作者免掉逐条手敲。推演与拒做的规则都在 `deriveTimeKeys`，
   * 这里只负责落库 + 把"填了几条、还剩几条要手填"照实说清楚，不许静默少做。
   *
   * 落库走 `assignTimelineTimeKeys`（一次更新），不循环 updateTimelineEvent：
   * 几百条会是一场界面风暴。
   */
  const deriveTimelineKeys = async () => {
    const r = deriveTimeKeys(timelineEvents);
    const toast = useToastStore.getState();
    if (r.kind === 'noEvents') {
      toast.success(t('writing.deriveTimeKeysNothing'));
      return;
    }
    if (r.kind === 'noDigits') {
      // 不硬排一个序：猜错的代价是假的 block 级冲突，比不检查更糟
      toast.error(t('writing.deriveTimeKeysNoDigits'));
      return;
    }
    try {
      const filled = await assignTimelineTimeKeys(Object.fromEntries(r.assignments));
      toast.success(
        r.needsManual > 0
          ? t('writing.deriveTimeKeysDoneSome', { filled, needsManual: r.needsManual })
          : t('writing.deriveTimeKeysDone', { filled }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('WritingPage', '推演时间线序号失败', { error: msg });
      toast.error(t('writing.deriveTimeKeysFailed', { msg }));
    }
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

  // ─── 语料库集成：检索命中句子插入当前章正文（编辑器光标处，段落 HTML） ───
  const handleCorpusInsert = useCallback(
    (text: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent(textToParagraphHtml(text)).run();
    },
    [editor],
  );

  // ─── 灵感扩写插入（O7）：插入到光标处后，复用 buildTextIndex/textRangeToPos 原语
  // 把「插入产生的正文区间」映射回 doc selection 并滚动高亮——插入即定位，
  // 与校对/语料定位同一套房（locate.ts），跨视角落点一致。 ───
  const handleInspirationInsert = useCallback(
    (text: string) => {
      if (!editor || !text.trim()) return;
      // 插入前：记录光标 doc pos 对应的纯文本偏移（start）
      const before = buildTextIndex(editor.state.doc);
      const from = editor.state.selection.from;
      const start = docPosToTextOffset(before, from);
      // 插入正文（与 handleCorpusInsert 同链路：textToParagraphHtml 段落化）
      editor.chain().focus().insertContent(textToParagraphHtml(text)).run();
      // 插入后：文本长度增量 = 新插入内容的纯文本展平长度，映射回 doc 区间并选中高亮
      const after = buildTextIndex(editor.state.doc);
      const end = start + (after.text.length - before.text.length);
      const range = textRangeToPos(after, start, end);
      if (!range) return;
      editor.chain().focus().setTextSelection(range).scrollIntoView().run();
    },
    [editor],
  );

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

  // ─── 工具栏按钮（行内高频 primary；Aa 格式全家桶在渲染区用 formatMenuAnchor 弹出）───
  const { primary: primaryButtons, toolbarBtnSx } = useToolbarButtons({
    editor,
    openDialog,
  });
  // 「Aa 格式」子菜单锚点（收纳表格/插图/批注/排版/有序列表）
  const [formatMenuAnchor, setFormatMenuAnchor] = useState<HTMLElement | null>(null);
  const formatMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  // 工具栏紧凑按钮尺寸：32px 兼顾点击热区与 1280px 宽下正文工具栏单行不换行
  const compactBtnSx: Record<string, unknown> = { width: 32, height: 32, minWidth: 32, padding: 0, flexShrink: 0 };
  // AI 统一入口菜单锚点（审视/对话/续写/润色）
  const [aiMenuAnchor, setAiMenuAnchor] = useState<HTMLElement | null>(null);
  // ⌘K 命令面板（创作台重设计 · 方向 B 一期）
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ⌘K 冲突修复：章跳转监听已 preventDefault 则命令面板不再响应，一次按键只弹一层
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ⌘K 面板动作：高频 10 项（新建章节/全书搜索/导入 TXT/统计/快照/回收站/快捷键/专注切换/速记/AI 对话）
  const paletteCommands: WorkbenchCommand[] = useMemo(
    () => [
      {
        id: 'cmd-new-chapter',
        title: t('writing.newChapter'),
        category: t('writing.cmdCatChapter'),
        run: () => openDialog({ kind: 'new-chapter' }),
      },
      {
        id: 'cmd-book-search',
        title: t('writing.bookSearchTitle'),
        category: t('writing.cmdCatBook'),
        run: () => setBookSearchOpen(true),
      },
      {
        id: 'cmd-import-txt',
        title: t('writing.importTxtTitle'),
        category: t('writing.cmdCatImport'),
        run: () => setImportOpen(true),
      },
      {
        id: 'cmd-stats',
        title: t('writing.stats'),
        category: t('writing.cmdCatWriting'),
        run: () => void handleOpenStats(),
      },
      {
        id: 'cmd-snapshot',
        title: t('writing.snapshots.title'),
        category: t('writing.cmdCatResource'),
        run: () => setSnapshotsOpen(true),
      },
      {
        id: 'cmd-recycle-bin',
        title: t('writing.recycleBin'),
        category: t('writing.cmdCatResource'),
        run: () => setRecycleBinOpen(true),
      },
      {
        id: 'cmd-shortcuts',
        title: t('writing.shortcutsTitle'),
        category: t('writing.cmdCatHelp'),
        run: () => setHelpOpen(true),
      },
      {
        id: 'cmd-focus-toggle',
        title:
          focusMode === 'zen'
            ? t('writing.exitZen')
            : focusMode === 'focus'
              ? t('writing.exitFocus')
              : t('writing.focusMode'),
        category: t('writing.cmdCatView'),
        run: () =>
          setFocusMode((v) => {
            if (v === 'normal') return 'focus';
            if (v === 'focus') return 'zen';
            return 'normal';
          }),
      },
      {
        id: 'cmd-quick-note',
        title: t('writing.noteFab'),
        category: t('writing.cmdCatWriting'),
        run: () => {
          setNoteDraft('');
          setNotesOpen(true);
        },
      },
      {
        id: 'cmd-ai-chat',
        title: t('writing.aiChatTitle'),
        category: 'AI',
        run: () => setChatOpen(true),
      },
    ],
    [t, openDialog, focusMode, handleOpenStats],
  );

  const characters = settings.filter((x) => x.kind === 'character');
  const worldbuilding = settings.filter((x) => x.kind === 'worldbuilding');

  /** 设定条目行（人设卡 / 世界观共用） */
  const renderSettingRow = (setting: (typeof settings)[number]) => {
    const selected = setting.id === activeSettingId;
    return (
      <Box
        key={setting.id}
        onClick={() => openSetting(setting.id)}
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
    <Box sx={{ display: 'flex', gap: 0, flex: 1, minHeight: 0, height: '100%' }}>
      {/* ─── 左栏：书架 + 章节数/设定 双 tab ─── */}
      <Paper
        variant="outlined"
        sx={{
          width: leftPanelWidth,
          flexShrink: 0,
          display: focusMode !== 'normal' ? 'none' : 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ px: 1.5, pt: 1.5, pb: 0.75 }}>
          {/* 一书一窗：独立窗口显示绑定书名+锁定标识，多开时一眼区分本窗口绑定的作品 */}
          {deskBookId && activeBook && (
            <Box
              sx={{
                mt: 0.75,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.75,
                py: 0.4,
                borderRadius: 1,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
            >
              <LockRoundedIcon sx={{ fontSize: 12 }} />
              <Typography noWrap sx={{ fontSize: 11.5, fontWeight: 600, flex: 1, minWidth: 0 }}>
                {activeBook.title}
              </Typography>
            </Box>
          )}
        </Box>
        {/* 一书一窗：独立窗口只服务绑定作品，不渲染书架列表/开窗/管理按钮——多开入口在主窗口书架与其他入口。
            创作台重设计：主窗口书架收窄为「当前作品行 + 下拉切换」，章节树获得完整栏高（原 45% 滚动书架移除）。 */}
        {!isDeskWindow && (
          <Box sx={{ px: 1, pb: 0.75 }}>
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
            {books.length > 0 && (
              <>
                <Button
                  fullWidth
                  disabled={!activeBook}
                  onClick={(e) => setBookSwitcherAnchor(e.currentTarget)}
                  sx={{
                    justifyContent: 'flex-start',
                    gap: 1,
                    px: 1,
                    py: 0.75,
                    borderRadius: 1.5,
                    color: 'text.primary',
                    textTransform: 'none',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box
                    sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: activeBook?.coverColor, flexShrink: 0 }}
                  />
                  <Typography noWrap sx={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>
                    {activeBook?.title ?? ''}
                  </Typography>
                  {/* P1 创作体系：体裁/载体一眼可见（未设置显示「未设置」引导补选） */}
                  {activeBook && (
                    <Chip
                      size="small"
                      label={t(genreLabelKey(activeBook.genre))}
                      sx={{ height: 16, fontSize: 9, flexShrink: 0, '& .MuiChip-label': { px: 0.5 } }}
                    />
                  )}
                  <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                </Button>
                <Menu
                  anchorEl={bookSwitcherAnchor}
                  open={Boolean(bookSwitcherAnchor)}
                  onClose={() => setBookSwitcherAnchor(null)}
                  slotProps={{ paper: { sx: { width: 300, maxHeight: 420 } } }}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                >
                  {books.map((book) => {
                    const selected = book.id === activeBookId;
                    const isBound = deskBookId === book.id;
                    return (
                      <MenuItem
                        key={book.id}
                        selected={selected}
                        onClick={() => {
                          setActiveBook(book.id);
                          setBookSwitcherAnchor(null);
                        }}
                        sx={{
                          gap: 1,
                          px: 1,
                          '& .row-actions': { opacity: 0 },
                          '&:hover .row-actions': { opacity: 1 },
                        }}
                      >
                        <Box
                          sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: book.coverColor, flexShrink: 0 }}
                        />
                        <Typography
                          noWrap
                          sx={{ fontSize: 13, fontWeight: isBound ? 700 : selected ? 600 : 400, flex: 1, minWidth: 0 }}
                        >
                          {book.title}
                        </Typography>
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
                              setBookSwitcherAnchor(null);
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
                              setBookSwitcherAnchor(null);
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
                              setBookSwitcherAnchor(null);
                              openDialog({ kind: 'delete-book', bookId: book.id });
                            }}
                            aria-label={t('writing.deleteBookTitle')}
                          >
                            <DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Box>
                      </MenuItem>
                    );
                  })}
                </Menu>
              </>
            )}
          </Box>
        )}

        {/* 一书一窗：单例独立窗口（无绑定书）不渲染书架，显示空态引导 */}
        {isDeskWindow && !deskBookId && (
          <Box sx={{ px: 1.5, py: 3, textAlign: 'center' }}>
            <LockRoundedIcon sx={{ fontSize: 30, color: 'primary.main', mb: 1 }} />
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.secondary' }}>
              {t('writing.deskUnboundTitle')}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 0.5 }}>
              {t('writing.deskUnboundHint')}
            </Typography>
          </Box>
        )}

        {focusMode === 'normal' && activeBook && (
          <>
            <Divider />
            <Tabs
              value={leftTab}
              onChange={(_, v: LeftTab) => setLeftTab(v)}
              variant="fullWidth"
              sx={{ minHeight: 34, '& .MuiTab-root': { minHeight: 34, fontSize: 12.5, px: 0.5, minWidth: 0 } }}
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
                          openNotesPanel();
                        }}
                        aria-label={t('writing.noteAdd')}
                      >
                        <AddRoundedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {sidebarNotes.length === 0 ? (
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
                          openNotesPanel();
                        }}
                        data-testid="open-notes-btn"
                      >
                        {t('writing.notesOpenBtn')}
                      </Button>
                    </Box>
                  ) : (
                    <>
                      {sidebarNotes.slice(0, 5).map((note) => (
                        <Box
                          key={note.id}
                          onClick={() => openNotesPanel(note.id)}
                          sx={{
                            px: 1.25,
                            py: 0.75,
                            mx: 0.5,
                            mb: 0.25,
                            borderRadius: 1,
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'action.hover' },
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                            {note.pin !== 0 && (
                              <PushPinRoundedIcon
                                sx={{ fontSize: 11, color: 'primary.main', mt: 0.35, flexShrink: 0 }}
                              />
                            )}
                            <Typography
                              noWrap
                              sx={{
                                fontSize: 12,
                                flex: 1,
                                minWidth: 0,
                                color: note.pin !== 0 ? 'text.primary' : 'text.secondary',
                              }}
                            >
                              {note.content}
                            </Typography>
                          </Box>
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.75,
                              mt: 0.25,
                              pl: note.pin !== 0 ? 1.9 : 0,
                            }}
                          >
                            {note.chapterId && (
                              <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>
                                {chapters.find((c) => c.id === note.chapterId)?.title || t('writingWorkbench.untitled')}
                              </Typography>
                            )}
                            <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>
                              {new Date(note.updatedAt * 1000).toLocaleDateString()}
                            </Typography>
                          </Box>
                        </Box>
                      ))}
                      <Button
                        size="small"
                        fullWidth
                        sx={{ mt: 0.5, fontSize: 11.5 }}
                        onClick={() => openNotesPanel()}
                        data-testid="notes-view-all"
                      >
                        {t('writing.notesViewAll', { n: sidebarNotes.length })}
                      </Button>
                    </>
                  )}
                </>
              )}
            </Box>
          </>
        )}
      </Paper>

      {/* 左栏右缘拖拽手柄：12px 热区（width:0 不占布局，absolute 悬跨左栏右缘 6px）+ 4px 分隔缝，
          常态 divider 灰、hover/拖动主色高亮；双击复位默认宽度 */}
      <Box
        sx={{
          width: 0,
          flexShrink: 0,
          position: 'relative',
          display: focusMode !== 'normal' ? 'none' : 'block',
        }}
      >
        <Box
          role="separator"
          aria-orientation="vertical"
          aria-label={t('writing.resizeLeftPanel')}
          title={t('writing.resizeLeftPanel')}
          onPointerDown={startLeftResize}
          onDoubleClick={onLeftResizeReset}
          sx={{
            position: 'absolute',
            left: -6,
            top: 0,
            bottom: 0,
            width: 12,
            cursor: 'col-resize',
            touchAction: 'none',
            zIndex: 2,
            display: 'flex',
            justifyContent: 'center',
            '& > span': {
              width: 4,
              my: 0.5,
              bgcolor: leftDragActive ? 'primary.main' : 'divider',
              borderRadius: 2,
              transition: 'background-color 120ms ease',
            },
            '&:hover > span': { bgcolor: 'primary.main' },
          }}
        >
          <Box component="span" />
        </Box>
      </Box>

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
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Tabs
            value={rightTab}
            onChange={(_, v: RightTab) => {
              // 章详情与设定卡互斥：其它两个入口（章节树/抽屉）切详情前都会先清 activeSetting，
              // 手动 tab 也必须同口径——否则从设定卡编辑态点「章详情」后再点回「正文」，
              // 渲染优先级 `details ? … : activeSetting ? … : 正文` 会因 activeSetting 仍在
              // 而重新弹回设定卡，用户以为「正文」tab 失灵（状态机卡死）。
              if (v === 'details') setActiveSetting(null);
              setRightTab(v);
            }}
            variant="fullWidth"
            sx={{
              flex: 1,
              minHeight: 38,
              px: 0.5,
              '& .MuiTabs-indicator': { height: 3, borderRadius: '2px 2px 0 0' },
              '& .MuiTab-root': {
                minHeight: 38,
                fontSize: 12.5,
                py: 0,
                px: 0.5,
                minWidth: 0,
                gap: 0.5,
                fontWeight: 500,
                transition: 'color 120ms ease',
                '& .MuiSvgIcon-root': { fontSize: 16 },
                '&.Mui-selected': { fontWeight: 700 },
                '&:hover': { backgroundColor: 'action.hover' },
              },
            }}
          >
            <Tab value="body" icon={<EditNoteRoundedIcon />} iconPosition="start" label={t('writing.tabBody')} />
            <Tab
              value="details"
              icon={<InfoRoundedIcon />}
              iconPosition="start"
              label={t('writing.tabChapterDetails')}
              disabled={!activeBook}
            />
          </Tabs>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, pr: 0.75 }}>
            {/* 工具组：导入 / 解析全书 / 写作统计 / 外观矩阵 / 回收站 / 导出，风格与正文工具栏统一 */}
            <Tooltip title={t('writing.importTxtTitle')}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => setImportOpen(true)}
                  sx={toolbarBtnSx(false)}
                  aria-label={t('writing.importTxtTitle')}
                >
                  <NoteAddRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.analyze')}>
              <span>
                <IconButton
                  size="small"
                  disabled={!activeBook}
                  onClick={() => void handleAnalyzeBook()}
                  sx={toolbarBtnSx(false)}
                  aria-label={t('writing.analyze')}
                >
                  <HubRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.stats')}>
              <span>
                <IconButton
                  size="small"
                  disabled={!activeBook}
                  onClick={() => void handleOpenStats()}
                  sx={toolbarBtnSx(false)}
                  aria-label={t('writing.stats')}
                >
                  <InsightsRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.appearanceMap.title')}>
              <span>
                <IconButton
                  size="small"
                  disabled={!activeBook}
                  onClick={() => void handleOpenAppearance()}
                  sx={toolbarBtnSx(false)}
                  aria-label={t('writing.appearanceMap.title')}
                >
                  <GroupsRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.recycleBin')}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => setRecycleBinOpen(true)}
                  sx={toolbarBtnSx(false)}
                  aria-label={t('writing.recycleBin')}
                >
                  <DeleteSweepRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.export')}>
              <span>
                <IconButton
                  size="small"
                  disabled={!activeBook}
                  onClick={(e) => setExportAnchor(e.currentTarget)}
                  sx={toolbarBtnSx(false)}
                  aria-label={t('writing.export')}
                >
                  <DownloadRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
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
        {rightTab === 'details' ? (
          /* 单一滚动容器（对齐设定卡分支）：九维统筹卡与章详情面板同处一个滚动流，
             不再各开一个滚动区、上下争高——修「切到章详情布局就乱」。
             统筹卡去掉 maxHeight:52vh 硬顶，改为随内容自然展开。 */
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {/* 九维章统筹面板：与主窗口正文页签右栏同一组件、同一派生口径（M8 同源）。
                独立窗口跳转经 dispatchChapterJump 协议发往主窗口，行点可跳并置前。 */}
            <Box
              sx={{
                px: { xs: 2, md: 4 },
                pt: 1.5,
                maxWidth: 760,
                width: '100%',
                mx: 'auto',
                pb: 1,
              }}
            >
              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2,
                  overflow: 'hidden',
                  bgcolor: 'background.paper',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}
              >
                <ChapterOverviewPanel
                  bookId={activeBook?.id ?? ''}
                  chapterId={activeChapterId}
                  fit="content"
                />
              </Box>
            </Box>
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
          </Box>
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
                sx={{
                  width: 42,
                  height: 42,
                  borderRadius: '12px',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  bgcolor: activeSetting.kind === 'character' ? 'primary.main' : 'secondary.main',
                }}
              >
                {activeSetting.kind === 'character' ? (
                  <PersonRoundedIcon sx={{ fontSize: 24 }} />
                ) : (
                  <PublicRoundedIcon sx={{ fontSize: 24 }} />
                )}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <TextField
                  variant="standard"
                  fullWidth
                  hiddenLabel
                  placeholder={t('writingWorkbench.untitled')}
                  value={settingDraft.name}
                  onChange={(e) => handleSettingFieldChange('name', e.target.value)}
                  slotProps={{ input: { disableUnderline: true, 'aria-label': t('writing.settingName') } }}
                  sx={{ '& .MuiInputBase-root': { fontSize: 17, fontWeight: 700, color: 'text.primary' } }}
                />
                <TextField
                  variant="standard"
                  fullWidth
                  hiddenLabel
                  placeholder={
                    activeSetting.kind === 'character' ? t('writing.settingRole') : t('writing.settingCategory')
                  }
                  value={settingDraft.subtitle}
                  onChange={(e) => handleSettingFieldChange('subtitle', e.target.value)}
                  slotProps={{ input: { disableUnderline: true, 'aria-label': t('writing.settingRole') } }}
                  sx={{ '& .MuiInputBase-root': { fontSize: 12.5, color: 'text.secondary', mt: 0.25 } }}
                />
              </Box>
              {/* 设定卡是叠加在「正文」页签上的编辑态：右栏 Tabs 仍显示「正文」高亮，
                  但内容已不是正文——没有出口时用户再点一次「正文」tab（onChange 只在
                  值变化时触发）毫无反应，等于被卡在卡里。此按钮先落盘未保存编辑再退出
                  编辑态，回到原章正文（activeChapter 不动，编辑器内容未被重载）。 */}
              <Tooltip title={t('writing.closeSettingCard')}>
                <IconButton
                  size="small"
                  aria-label={t('writing.closeSettingCard')}
                  onClick={() => {
                    void flushSettingSave();
                    setActiveSetting(null);
                  }}
                  sx={{ color: 'text.secondary', flexShrink: 0, '&:hover': { color: 'primary.main' } }}
                >
                  <CloseRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 2, md: 4 }, py: 2 }}>
              <Box sx={{ maxWidth: 760, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* ─── 区块 1：基本信息（名称/身份已在头部内联编辑；此处为长描述） ─── */}
                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
                    <Box sx={{ color: 'primary.main', display: 'flex' }}>
                      <EditNoteRoundedIcon sx={{ fontSize: 17 }} />
                    </Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{t('writing.basicInfo')}</Typography>
                  </Box>
                  <TextField
                    multiline
                    minRows={8}
                    label={t('writing.settingDescription')}
                    placeholder={t('writing.settingDescriptionHint')}
                    slotProps={{ inputLabel: { shrink: true } }}
                    value={settingDraft.description}
                    onChange={(e) => handleSettingFieldChange('description', e.target.value)}
                  />
                </Box>

                {/* ─── 区块 2：人物档案（仅人设卡；结构化字段，落 extra.profile，零迁移） ─── */}
                {(() => {
                  if (activeSetting.kind !== 'character') return null;
                  const missing = settingCompleteness('character', settingDraft.extra).missingKeys.map((k) => t(k));
                  return (
                    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ color: 'primary.main', display: 'flex' }}>
                            <AutoFixHighRoundedIcon sx={{ fontSize: 17 }} />
                          </Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{t('writing.profile')}</Typography>
                        </Box>
                        <Tooltip title={t('writing.settingAiTitle')}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<AutoFixHighRoundedIcon sx={{ fontSize: 14 }} />}
                            onClick={() => openSettingCompletion('character')}
                            aria-label={t('writing.settingAiTitle')}
                            sx={{ textTransform: 'none', fontSize: 11.5 }}
                          >
                            {t('writing.settingAiTitle')}
                          </Button>
                        </Tooltip>
                      </Box>
                      {missing.length > 0 && (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                            mb: 1.5,
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
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                        <TextField
                          size="small"
                          label={t('writing.appearance')}
                          placeholder={t('writing.appearanceHint')}
                          slotProps={{ inputLabel: { shrink: true } }}
                          value={settingDraft.extra.profile?.appearance ?? ''}
                          onChange={(e) => setProfileField('appearance', e.target.value)}
                        />
                        <TextField
                          size="small"
                          label={t('writing.personality')}
                          placeholder={t('writing.personalityHint')}
                          slotProps={{ inputLabel: { shrink: true } }}
                          value={settingDraft.extra.profile?.personality ?? ''}
                          onChange={(e) => setProfileField('personality', e.target.value)}
                        />
                        <TextField
                          size="small"
                          label={t('writing.motivation')}
                          placeholder={t('writing.motivationHint')}
                          slotProps={{ inputLabel: { shrink: true } }}
                          value={settingDraft.extra.profile?.motivation ?? ''}
                          onChange={(e) => setProfileField('motivation', e.target.value)}
                        />
                        <TextField
                          size="small"
                          label={t('writing.catchphrase')}
                          placeholder={t('writing.catchphraseHint')}
                          slotProps={{ inputLabel: { shrink: true } }}
                          value={settingDraft.extra.profile?.catchphrase ?? ''}
                          onChange={(e) => setProfileField('catchphrase', e.target.value)}
                        />
                        <TextField
                          size="small"
                          multiline
                          minRows={3}
                          label={t('writing.notes')}
                          placeholder={t('writing.notesHint')}
                          slotProps={{ inputLabel: { shrink: true } }}
                          value={settingDraft.extra.profile?.notes ?? ''}
                          onChange={(e) => setProfileField('notes', e.target.value)}
                          sx={{ gridColumn: { xs: 'auto', sm: '1 / -1' } }}
                        />
                        {/* ─── T12 认知权重滑块（仅人设卡） ─── */}
                        <Box sx={{ gridColumn: { xs: 'auto', sm: '1 / -1' }, mt: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Box sx={{ color: 'primary.main', display: 'flex' }}>
                              <InsightsRoundedIcon sx={{ fontSize: 17 }} />
                            </Box>
                            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                              {t('writing.cognitiveWeights')}
                            </Typography>
                          </Box>
                          {/* 不写这句，作者无从区分"我选了中立"和"我还没动过"——而这两者喂给 AI 的内容不同 */}
                          <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mb: 1 }}>
                            {t('writing.cognitiveWeightsHint')}
                          </Typography>
                          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                            {COGNITIVE_DIMENSIONS.map((dim) => {
                              const neg = t(dim.negKey);
                              const pos = t(dim.posKey);
                              // 不再 `?? 0` 后统一当数字看：未设置与中立是两回事，必须分得开
                              const raw = settingDraft.extra.profile?.cognitiveWeights?.[dim.key];
                              const isSet = typeof raw === 'number';
                              return (
                                <Box key={dim.key}>
                                  <Box
                                    sx={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      gap: 0.75,
                                      mb: 0.5,
                                    }}
                                  >
                                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{neg}</Typography>
                                    <Typography
                                      sx={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        // 未设置用 disabled 灰、已设置（含 0）用主色：一眼看出这条轴作者表过态没有
                                        color: isSet ? 'primary.main' : 'text.disabled',
                                      }}
                                    >
                                      {isSet
                                        ? raw === 0
                                          ? t('writing.cwNeutral')
                                          : `${raw > 0 ? pos : neg}${Math.abs(raw)}`
                                        : t('writing.cwUnset')}
                                    </Typography>
                                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{pos}</Typography>
                                    {isSet && (
                                      <Tooltip title={t('writing.cwClear')}>
                                        <IconButton
                                          size="small"
                                          aria-label={t('writing.cwClear')}
                                          onClick={() => setCognitiveWeightField(dim.key, null)}
                                          sx={{ p: 0.25, alignSelf: 'center' }}
                                        >
                                          <CloseRoundedIcon sx={{ fontSize: 13 }} />
                                        </IconButton>
                                      </Tooltip>
                                    )}
                                  </Box>
                                  <Slider
                                    size="small"
                                    value={raw ?? 0}
                                    min={-10}
                                    max={10}
                                    step={1}
                                    marks
                                    valueLabelDisplay="auto"
                                    // 0 直接写 0（中立是一个取值）；要回到"未设置"用右边的清除按钮
                                    onChange={(_, v) => setCognitiveWeightField(dim.key, v as number)}
                                  />
                                </Box>
                              );
                            })}
                          </Box>
                        </Box>
                      </Box>
                    </Box>
                  );
                })()}

                {/* ─── 区块 2b：世界观档案（仅世界观设定；结构化字段，落 extra.worldbuildingProfile，零迁移） ─── */}
                {(() => {
                  if (activeSetting.kind !== 'worldbuilding') return null;
                  const missing = settingCompleteness('worldbuilding', settingDraft.extra).missingKeys.map((k) => t(k));
                  return (
                    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ color: 'secondary.main', display: 'flex' }}>
                            <AutoFixHighRoundedIcon sx={{ fontSize: 17 }} />
                          </Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{t('writing.wbProfile')}</Typography>
                        </Box>
                        <Tooltip title={t('writing.settingAiTitle')}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<AutoFixHighRoundedIcon sx={{ fontSize: 14 }} />}
                            onClick={() => openSettingCompletion('worldbuilding')}
                            aria-label={t('writing.settingAiTitle')}
                            sx={{ textTransform: 'none', fontSize: 11.5 }}
                          >
                            {t('writing.settingAiTitle')}
                          </Button>
                        </Tooltip>
                      </Box>
                      {missing.length > 0 && (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                            mb: 1.5,
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
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                        <TextField
                          size="small"
                          select
                          label={t('writing.wbType')}
                          slotProps={{ inputLabel: { shrink: true } }}
                          value={settingDraft.extra.worldbuildingProfile?.type ?? ''}
                          onChange={(e) => setWbProfileField('type', e.target.value)}
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
                          label={t('writing.wbLinkedTo')}
                          placeholder={t('writing.wbLinkedToHint')}
                          slotProps={{ inputLabel: { shrink: true } }}
                          value={settingDraft.extra.worldbuildingProfile?.linkedTo ?? ''}
                          onChange={(e) => setWbProfileField('linkedTo', e.target.value)}
                        />
                        <TextField
                          size="small"
                          label={t('writing.wbRules')}
                          placeholder={t('writing.wbRulesHint')}
                          slotProps={{ inputLabel: { shrink: true } }}
                          value={settingDraft.extra.worldbuildingProfile?.rules ?? ''}
                          onChange={(e) => setWbProfileField('rules', e.target.value)}
                        />
                        <TextField
                          size="small"
                          label={t('writing.wbExceptions')}
                          placeholder={t('writing.wbExceptionsHint')}
                          slotProps={{ inputLabel: { shrink: true } }}
                          value={settingDraft.extra.worldbuildingProfile?.exceptions ?? ''}
                          onChange={(e) => setWbProfileField('exceptions', e.target.value)}
                        />
                        <TextField
                          size="small"
                          multiline
                          minRows={3}
                          label={t('writing.notes')}
                          placeholder={t('writing.notesHint')}
                          slotProps={{ inputLabel: { shrink: true } }}
                          value={settingDraft.extra.worldbuildingProfile?.notes ?? ''}
                          onChange={(e) => setWbProfileField('notes', e.target.value)}
                          sx={{ gridColumn: { xs: 'auto', sm: '1 / -1' } }}
                        />
                      </Box>
                    </Box>
                  );
                })()}

                {/* ─── 区块 3：出场章（读 outline.extra，与大纲/要素面板同一份口径；支持在本设定侧主动绑定；点击跳章） ─── */}
                {(() => {
                  const isChar = activeSetting.kind === 'character';
                  const related = chaptersOfSetting(
                    outlines,
                    chapters,
                    activeSetting.id,
                    isChar ? 'character' : 'worldbuilding',
                  );
                  // 候选章 = 当前书未绑定的叶章（排除容器节点：出场章只对实际章节成立）
                  const candidateRows = bindableChapterRows.filter(
                    (r) => !related.some((c) => c.id === r.id) && !chapters.some((c2) => c2.parentId === r.id),
                  );
                  return (
                    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Box sx={{ color: 'primary.main', display: 'flex' }}>
                          <MenuBookRoundedIcon sx={{ fontSize: 17 }} />
                        </Box>
                        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                          {t(
                            isChar
                              ? 'editor.writing.inspector.appearChapters'
                              : 'editor.writing.inspector.relatedChapters',
                          )}
                        </Typography>
                      </Box>
                      {related.length === 0 ? (
                        <Typography sx={{ fontSize: 11.5, color: 'text.disabled', lineHeight: 1.7 }}>
                          {t('editor.writing.inspector.bindHint')}
                        </Typography>
                      ) : (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                          {related.map((c) => (
                            <Chip
                              key={c.id}
                              size="small"
                              label={c.title}
                              onClick={() => {
                                void flushSettingSave();
                                setLeftTab('chapters');
                                setActiveSetting(null);
                                setActiveChapter(c.id);
                                setRightTab('body');
                              }}
                              sx={{
                                fontSize: 11,
                                maxWidth: 260,
                                '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                              }}
                            />
                          ))}
                        </Box>
                      )}
                      {candidateRows.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1.25 }}>
                          <TextField
                            size="small"
                            select
                            fullWidth
                            label={t('writing.bindChapterSelect')}
                            slotProps={{ inputLabel: { shrink: true } }}
                            value={bindChapterId}
                            onChange={(e) => setBindChapterId(e.target.value)}
                          >
                            <MenuItem value="">{t('writing.bindChapterPlaceholder')}</MenuItem>
                            {candidateRows.map((r) => (
                              <MenuItem key={r.id} value={r.id} sx={{ pl: treeRowIndent(r.depth) }}>
                                {r.title || t('writingWorkbench.untitled')}
                              </MenuItem>
                            ))}
                          </TextField>
                          <Button
                            size="small"
                            variant="contained"
                            disabled={!bindChapterId || !candidateRows.some((r) => r.id === bindChapterId)}
                            onClick={() => void bindSettingToChapter()}
                          >
                            {t('writing.bindChapterGo')}
                          </Button>
                        </Box>
                      )}
                    </Box>
                  );
                })()}

                {/* ─── P4 结构化扩展：人物关系 + 时间线（人设卡与世界观设定通用，relations/timeline 本就零迁移） ─── */}
                {(activeSetting.kind === 'character' || activeSetting.kind === 'worldbuilding') && (
                  <>
                    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ color: 'primary.main', display: 'flex' }}>
                            <GroupsRoundedIcon sx={{ fontSize: 17 }} />
                          </Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{t('writing.relations')}</Typography>
                        </Box>
                        <Button size="small" startIcon={<AddRoundedIcon sx={{ fontSize: 14 }} />} onClick={addRelation}>
                          {t('writing.addRelation')}
                        </Button>
                      </Box>
                      {(settingDraft.extra.relations ?? []).length === 0 ? (
                        <Typography sx={{ fontSize: 11.5, color: 'text.disabled', lineHeight: 1.7 }}>
                          {t('editor.writing.inspector.noRelations')}
                        </Typography>
                      ) : (
                        (settingDraft.extra.relations ?? []).map((rel, idx) => (
                          <Box
                            key={idx}
                            sx={{
                              display: 'flex',
                              gap: 1,
                              alignItems: 'center',
                              mb: 1,
                              p: 1,
                              border: 1,
                              borderColor: 'divider',
                              borderRadius: 1.5,
                            }}
                          >
                            <Box
                              sx={{
                                width: 22,
                                height: 22,
                                borderRadius: '50%',
                                bgcolor: 'action.hover',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 11,
                                fontWeight: 700,
                                color: 'text.secondary',
                                flexShrink: 0,
                              }}
                            >
                              {idx + 1}
                            </Box>
                            <TextField
                              size="small"
                              select
                              fullWidth
                              label={t('writing.relationTargetSetting')}
                              slotProps={{ inputLabel: { shrink: true } }}
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
                            {!rel.targetId && (
                              <TextField
                                size="small"
                                fullWidth
                                label={t('writing.relationTargetCustom')}
                                placeholder={t('writing.relationTargetCustomHint')}
                                slotProps={{ inputLabel: { shrink: true } }}
                                value={rel.target}
                                onChange={(e) => setRelationRow(idx, 'target', e.target.value)}
                              />
                            )}
                            <TextField
                              size="small"
                              fullWidth
                              label={t('writing.relationType')}
                              slotProps={{ inputLabel: { shrink: true } }}
                              value={rel.type}
                              onChange={(e) => setRelationRow(idx, 'type', e.target.value)}
                            />
                            <IconButton
                              size="small"
                              onClick={() => removeRelation(idx)}
                              aria-label={t('writing.removeRelation')}
                            >
                              <CloseRoundedIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Box>
                        ))
                      )}
                    </Box>
                    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ color: 'primary.main', display: 'flex' }}>
                            <HistoryRoundedIcon sx={{ fontSize: 17 }} />
                          </Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{t('writing.timeline')}</Typography>
                        </Box>
                        <Button size="small" startIcon={<AddRoundedIcon sx={{ fontSize: 14 }} />} onClick={addTimeline}>
                          {t('writing.addTimeline')}
                        </Button>
                      </Box>
                      {timelineEvents.filter((e) => e.settingId === activeSettingId).length === 0 ? (
                        <Typography sx={{ fontSize: 11.5, color: 'text.disabled', lineHeight: 1.7 }}>
                          {t('writing.emptyTimeline')}
                        </Typography>
                      ) : (
                        timelineEvents
                          .filter((e) => e.settingId === activeSettingId)
                          .map((ev, idx) => (
                            <Box key={ev.id} sx={{ mb: 1, p: 1, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                <Box
                                  sx={{
                                    width: 22,
                                    height: 22,
                                    borderRadius: '50%',
                                    bgcolor: 'action.hover',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: 'text.secondary',
                                    flexShrink: 0,
                                  }}
                                >
                                  {idx + 1}
                                </Box>
                                <TextField
                                  size="small"
                                  fullWidth
                                  label={t('writing.timelineEvent')}
                                  placeholder={t('writing.timelineEventHint')}
                                  slotProps={{ inputLabel: { shrink: true } }}
                                  value={ev.event}
                                  onChange={(e) => setTimelineRow(ev.id, 'event', e.target.value)}
                                />
                                <IconButton
                                  size="small"
                                  onClick={() => removeTimeline(ev.id)}
                                  aria-label={t('writing.removeTimelineEvent')}
                                >
                                  <CloseRoundedIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                              </Box>
                              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1.5, pl: 4 }}>
                                <TextField
                                  size="small"
                                  sx={{ width: 210, flexShrink: 0 }}
                                  label={t('writing.timelineAt')}
                                  placeholder={t('writing.timelineAtHint')}
                                  slotProps={{ inputLabel: { shrink: true } }}
                                  value={ev.at}
                                  onChange={(e) => setTimelineRow(ev.id, 'at', e.target.value)}
                                />
                                {/* 可排序时点：at 是给人看的任意历法文本，机器比不出先后。
                                    填了这个数字，这条事件才会参与「跨章时间往回走」检查。
                                    口径见 utils/writingTimeline 的 eventSortKey。 */}
                                <Tooltip title={t('writing.timelineTimeKeyTip')} placement="top">
                                  <span>
                                    <TextField
                                      size="small"
                                      type="number"
                                      sx={{ width: 104, ml: 1, flexShrink: 0 }}
                                      label={t('writing.timelineTimeKey')}
                                      placeholder={t('writing.timelineTimeKeyHint')}
                                      slotProps={{ inputLabel: { shrink: true } }}
                                      value={ev.timeKey ?? ''}
                                      onChange={(e) => setTimelineRow(ev.id, 'timeKey', e.target.value)}
                                    />
                                  </span>
                                </Tooltip>
                                <TextField
                                  size="small"
                                  select
                                  fullWidth
                                  label={t('writing.timelineChapter')}
                                  slotProps={{ inputLabel: { shrink: true } }}
                                  value={ev.chapterId ?? ''}
                                  onChange={(e) => setTimelineRow(ev.id, 'chapterId', e.target.value)}
                                >
                                  <MenuItem value="">{t('writing.relationTargetNone')}</MenuItem>
                                  {bindableChapterRows.map((r) => (
                                    <MenuItem key={r.id} value={r.id} sx={{ pl: treeRowIndent(r.depth) }}>
                                      {r.title || t('writingWorkbench.untitled')}
                                    </MenuItem>
                                  ))}
                                </TextField>
                                {storylines.length > 0 && (
                                  <TextField
                                    size="small"
                                    select
                                    sx={{ width: 190, flexShrink: 0 }}
                                    label={t('writing.timelineStoryline')}
                                    slotProps={{ inputLabel: { shrink: true } }}
                                    value={ev.storylineId ?? ''}
                                    onChange={(e) => setTimelineRow(ev.id, 'storylineId', e.target.value)}
                                  >
                                    <MenuItem value="">{t('writing.storylineUnlined')}</MenuItem>
                                    {storylines.map((sl) => (
                                      <MenuItem key={sl.id} value={sl.id}>
                                        {sl.name || t('writingWorkbench.untitled')}
                                      </MenuItem>
                                    ))}
                                  </TextField>
                                )}
                              </Box>
                            </Box>
                          ))
                      )}
                    </Box>
                    {/* 区块 4c：全书级时间线（settingId=null 的事件，修复「全书」lane 无创建入口的缺口） */}
                    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ color: 'secondary.main', display: 'flex' }}>
                            <HistoryRoundedIcon sx={{ fontSize: 17 }} />
                          </Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                            {t('writing.bookLevelTimeline')}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {/* 批量推演作用域是**全书**时间线（倒挂本就跨章跨卡），放在全书级区块里；
                              tooltip 必须讲清"已手填的不动、纯汉字时点推不出"，否则作者会以为漏了 */}
                          <Tooltip title={t('writing.deriveTimeKeysTip')} placement="top">
                            <Button size="small" onClick={deriveTimelineKeys}>
                              {t('writing.deriveTimeKeys')}
                            </Button>
                          </Tooltip>
                          <Button
                            size="small"
                            startIcon={<AddRoundedIcon sx={{ fontSize: 14 }} />}
                            onClick={addBookTimeline}
                          >
                            {t('writing.addTimeline')}
                          </Button>
                        </Box>
                      </Box>
                      {timelineEvents.filter((e) => e.settingId === null).length === 0 ? (
                        <Typography sx={{ fontSize: 11.5, color: 'text.disabled', lineHeight: 1.7 }}>
                          {t('writing.emptyTimeline')}
                        </Typography>
                      ) : (
                        timelineEvents
                          .filter((e) => e.settingId === null)
                          .map((ev, idx) => (
                            <Box key={ev.id} sx={{ mb: 1, p: 1, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                <Box
                                  sx={{
                                    width: 22,
                                    height: 22,
                                    borderRadius: '50%',
                                    bgcolor: 'action.hover',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: 'text.secondary',
                                    flexShrink: 0,
                                  }}
                                >
                                  {idx + 1}
                                </Box>
                                <TextField
                                  size="small"
                                  fullWidth
                                  label={t('writing.timelineEvent')}
                                  placeholder={t('writing.timelineEventHint')}
                                  slotProps={{ inputLabel: { shrink: true } }}
                                  value={ev.event}
                                  onChange={(e) => setTimelineRow(ev.id, 'event', e.target.value)}
                                />
                                <IconButton
                                  size="small"
                                  onClick={() => removeTimeline(ev.id)}
                                  aria-label={t('writing.removeBookTimelineEvent')}
                                >
                                  <CloseRoundedIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                              </Box>
                              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1.5, pl: 4 }}>
                                <TextField
                                  size="small"
                                  sx={{ width: 210, flexShrink: 0 }}
                                  label={t('writing.timelineAt')}
                                  placeholder={t('writing.timelineAtHint')}
                                  slotProps={{ inputLabel: { shrink: true } }}
                                  value={ev.at}
                                  onChange={(e) => setTimelineRow(ev.id, 'at', e.target.value)}
                                />
                                {/* 可排序时点：at 是给人看的任意历法文本，机器比不出先后。
                                    填了这个数字，这条事件才会参与「跨章时间往回走」检查。
                                    口径见 utils/writingTimeline 的 eventSortKey。 */}
                                <Tooltip title={t('writing.timelineTimeKeyTip')} placement="top">
                                  <span>
                                    <TextField
                                      size="small"
                                      type="number"
                                      sx={{ width: 104, ml: 1, flexShrink: 0 }}
                                      label={t('writing.timelineTimeKey')}
                                      placeholder={t('writing.timelineTimeKeyHint')}
                                      slotProps={{ inputLabel: { shrink: true } }}
                                      value={ev.timeKey ?? ''}
                                      onChange={(e) => setTimelineRow(ev.id, 'timeKey', e.target.value)}
                                    />
                                  </span>
                                </Tooltip>
                                <TextField
                                  size="small"
                                  select
                                  fullWidth
                                  label={t('writing.timelineChapter')}
                                  slotProps={{ inputLabel: { shrink: true } }}
                                  value={ev.chapterId ?? ''}
                                  onChange={(e) => setTimelineRow(ev.id, 'chapterId', e.target.value)}
                                >
                                  <MenuItem value="">{t('writing.relationTargetNone')}</MenuItem>
                                  {bindableChapterRows.map((r) => (
                                    <MenuItem key={r.id} value={r.id} sx={{ pl: treeRowIndent(r.depth) }}>
                                      {r.title || t('writingWorkbench.untitled')}
                                    </MenuItem>
                                  ))}
                                </TextField>
                                {storylines.length > 0 && (
                                  <TextField
                                    size="small"
                                    select
                                    sx={{ width: 190, flexShrink: 0 }}
                                    label={t('writing.timelineStoryline')}
                                    slotProps={{ inputLabel: { shrink: true } }}
                                    value={ev.storylineId ?? ''}
                                    onChange={(e) => setTimelineRow(ev.id, 'storylineId', e.target.value)}
                                  >
                                    <MenuItem value="">{t('writing.storylineUnlined')}</MenuItem>
                                    {storylines.map((sl) => (
                                      <MenuItem key={sl.id} value={sl.id}>
                                        {sl.name || t('writingWorkbench.untitled')}
                                      </MenuItem>
                                    ))}
                                  </TextField>
                                )}
                              </Box>
                            </Box>
                          ))
                      )}
                    </Box>
                  </>
                )}

                {/* ─── 区块 5：修改历史（AI 改写 / 恢复前的旧值，可恢复到任一版本）─── */}
                <SettingHistoryPanel
                  key={activeSetting.id}
                  setting={activeSetting}
                  onBeforeRestore={async () => {
                    // 先把编辑框里未防抖落库的按键推下去，再清掉 pending：
                    // 否则恢复完成后残留的 patch 会把刚恢复的值又盖回去。
                    // 作者刚敲的内容此刻已落库，而恢复会把"当前值"存进历史，所以仍找得回。
                    await flushSettingSave();
                    if (settingTimerRef.current) {
                      clearTimeout(settingTimerRef.current);
                      settingTimerRef.current = null;
                    }
                    settingPendingRef.current = null;
                  }}
                  onRestored={(next) => {
                    // 装载 effect 刻意只依赖 settingId，恢复后 id 不变 → 必须手动重载草稿，
                    // 否则库里已是恢复值、界面还显示恢复前的内容。
                    setSettingDraft({
                      name: next.name,
                      subtitle: next.subtitle,
                      description: next.description,
                      extra: parseSettingExtra(next.extra),
                    });
                    void useWritingStore.getState().loadSettings();
                  }}
                />
              </Box>
            </Box>
          </>
        ) : activeChapter && editor ? (
          <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                position: 'relative',
              }}
            >
              {/* 创作台重设计 · 方向 B'：工具栏响应式换行。左段 = Aa 格式全家桶 + 行内高频 ≤10 项（占满剩余宽度、可换行）；右段按写作/检查/资料/AI 分组（独立换行单元） */}
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  alignContent: 'flex-start',
                  columnGap: 0.25,
                  rowGap: 0.5,
                  px: 1,
                  py: 0.5,
                  borderBottom: 1,
                  borderColor: 'divider',
                  // 响应式工具栏（方向 B'）：左段/右段为两个可换行的 flex 子容器，
                  // 拖动左侧章节树/右侧抽屉使编辑列变窄时，按钮自动换行，不再横向滚动、也不重叠
                  minWidth: 0,
                }}
              >
                {/* ── 左段：Aa 格式 + 行内高频（可换行，占满剩余宽度）── */}
                <Box
                  sx={{
                    display: 'flex',
                    flex: 1,
                    minWidth: 0,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    columnGap: 0.25,
                    rowGap: 0.5,
                  }}
                >
                  {/* Aa 格式（表格/插图/批注/排版/有序列表收进子菜单） */}
                  <Tooltip title={t('writing.formatMenu')}>
                    <IconButton
                      size="small"
                      ref={formatMenuBtnRef}
                      onClick={(e) => setFormatMenuAnchor(e.currentTarget)}
                      sx={[toolbarBtnSx(Boolean(formatMenuAnchor)), compactBtnSx]}
                      aria-label={t('writing.formatMenu')}
                    >
                      <FormatColorTextRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                  <Menu
                    anchorEl={formatMenuAnchor}
                    open={Boolean(formatMenuAnchor)}
                    onClose={() => setFormatMenuAnchor(null)}
                  >
                    {editor?.isActive('table') ? (
                      <span>
                        <MenuItem
                          onClick={() => {
                            setFormatMenuAnchor(null);
                            editor.chain().focus().addRowAfter().run();
                          }}
                        >
                          <TableChartRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                          {t('writing.tableInsertRowAfter')}
                        </MenuItem>
                        <MenuItem
                          onClick={() => {
                            setFormatMenuAnchor(null);
                            editor.chain().focus().addColumnAfter().run();
                          }}
                        >
                          <TableChartRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                          {t('writing.tableInsertColumnAfter')}
                        </MenuItem>
                        <Divider />
                        <MenuItem
                          onClick={() => {
                            setFormatMenuAnchor(null);
                            editor.chain().focus().deleteRow().run();
                          }}
                        >
                          <TableChartRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                          {t('writing.tableDeleteRow')}
                        </MenuItem>
                        <MenuItem
                          onClick={() => {
                            setFormatMenuAnchor(null);
                            editor.chain().focus().deleteColumn().run();
                          }}
                        >
                          <TableChartRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                          {t('writing.tableDeleteColumn')}
                        </MenuItem>
                        <MenuItem
                          onClick={() => {
                            setFormatMenuAnchor(null);
                            editor.chain().focus().deleteTable().run();
                          }}
                        >
                          <TableChartRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                          {t('writing.tableDeleteTable')}
                        </MenuItem>
                      </span>
                    ) : (
                      <MenuItem
                        onClick={() => {
                          setFormatMenuAnchor(null);
                          editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run();
                        }}
                      >
                        <TableChartRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                        {t('writing.insertTable')}
                      </MenuItem>
                    )}
                    <MenuItem
                      onClick={() => {
                        setFormatMenuAnchor(null);
                        useAssetPickerStore.getState().openPicker({
                          editorInserter: (a) => {
                            if (editor) void insertIllustrationIntoEditor(editor, a);
                          },
                        });
                      }}
                    >
                      <ImageRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.insertImage')}
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setFormatMenuAnchor(null);
                        handleStartAnnotation();
                      }}
                    >
                      <StickyNote2RoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.annotationAdd')}
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setFormatMenuAnchor(null);
                        setTypoAnchor(formatMenuBtnRef.current);
                      }}
                    >
                      <FormatSizeRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.typography.title')}
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setFormatMenuAnchor(null);
                        editor.chain().focus().toggleOrderedList().run();
                      }}
                    >
                      <FormatListNumberedRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.fmtOrdered')}
                    </MenuItem>
                  </Menu>
                  {/* ── 正文排版快捷：字体 / 字号直接暴露在工具栏（批次⑤：不再埋在子菜单里），改动即 per-book 持久化 ── */}
                  <Tooltip title={t('writing.typography.fontFamily')}>
                    <Select
                      size="small"
                      value={typo.fontFamily}
                      onChange={(e) => setTypo({ fontFamily: e.target.value as FontFamilyKey })}
                      sx={{
                        height: 32,
                        minWidth: 92,
                        fontSize: 12.5,
                        ml: 0.5,
                        flexShrink: 0,
                        '& .MuiSelect-select': { py: 0.5 },
                      }}
                      inputProps={{ 'aria-label': t('writing.typography.fontFamily') }}
                    >
                      {FONT_FAMILY_OPTIONS.map((o) => (
                        <MenuItem key={o.key} value={o.key} sx={{ fontFamily: o.stack || undefined, fontSize: 13 }}>
                          {t(`writing.typography.font_${o.key}`)}
                        </MenuItem>
                      ))}
                    </Select>
                  </Tooltip>
                  <Tooltip title={t('writing.typography.fontSize', { n: typo.fontSize })}>
                    <Select
                      size="small"
                      value={typo.fontSize}
                      onChange={(e) => setTypo({ fontSize: Number(e.target.value) })}
                      sx={{
                        height: 32,
                        minWidth: 64,
                        fontSize: 12.5,
                        flexShrink: 0,
                        '& .MuiSelect-select': { py: 0.5 },
                      }}
                      inputProps={{ 'aria-label': t('writing.typography.fontSize', { n: typo.fontSize }) }}
                    >
                      {FONT_SIZE_PRESETS.map((v) => (
                        <MenuItem key={v} value={v} sx={{ fontSize: 13 }}>
                          {v}
                        </MenuItem>
                      ))}
                    </Select>
                  </Tooltip>
                  {/* 批次⑥ 专业格式控件：字号快捷步进（按档位 ±1，边界禁用） */}
                  <Tooltip title={t('writing.typography.decreaseFont')}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={typo.fontSize <= FONT_SIZE_PRESETS[0]}
                        onClick={() => {
                          const cur = typo.fontSize;
                          const lo = FONT_SIZE_PRESETS.filter((v) => v < cur).pop();
                          if (lo) setTypo({ fontSize: lo });
                        }}
                        sx={[toolbarBtnSx(false), compactBtnSx]}
                        aria-label={t('writing.typography.decreaseFont')}
                      >
                        <TextDecreaseRoundedIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t('writing.typography.increaseFont')}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={typo.fontSize >= FONT_SIZE_PRESETS[FONT_SIZE_PRESETS.length - 1]}
                        onClick={() => {
                          const cur = typo.fontSize;
                          const hi = FONT_SIZE_PRESETS.find((v) => v > cur);
                          if (hi) setTypo({ fontSize: hi });
                        }}
                        sx={[toolbarBtnSx(false), compactBtnSx]}
                        aria-label={t('writing.typography.increaseFont')}
                      >
                        <TextIncreaseRoundedIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 0.5 }} />
                  {primaryButtons.map((btn, i) => (
                    <Tooltip key={i} title={btn.label}>
                      <IconButton
                        size="small"
                        onClick={(e) => btn.onClick(e)}
                        sx={[toolbarBtnSx(btn.active), compactBtnSx]}
                        aria-label={btn.label}
                      >
                        {btn.icon}
                      </IconButton>
                    </Tooltip>
                  ))}
                  {/* 多色高亮色板（行内「高亮」= 第 10 项） */}
                  <Tooltip title={t('writing.fmtHighlightColor')}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        setHighlightAnchor(e.currentTarget);
                        setHighlightOpen(true);
                      }}
                      sx={[toolbarBtnSx(editor?.isActive('highlight') ?? false), compactBtnSx]}
                      aria-label={t('writing.fmtHighlightColor')}
                    >
                      <HighlightRoundedIcon sx={{ fontSize: 17 }} />
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
                  {/* 批次⑥ 专业格式控件：段落对齐 4 态（左/中/右/两端） */}
                  <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 0.5 }} />
                  {(
                    [
                      {
                        align: 'left',
                        icon: <FormatAlignLeftRoundedIcon sx={{ fontSize: 17 }} />,
                        label: t('writing.fmtAlignLeft'),
                      },
                      {
                        align: 'center',
                        icon: <FormatAlignCenterRoundedIcon sx={{ fontSize: 17 }} />,
                        label: t('writing.fmtAlignCenter'),
                      },
                      {
                        align: 'right',
                        icon: <FormatAlignRightRoundedIcon sx={{ fontSize: 17 }} />,
                        label: t('writing.fmtAlignRight'),
                      },
                      {
                        align: 'justify',
                        icon: <FormatAlignJustifyRoundedIcon sx={{ fontSize: 17 }} />,
                        label: t('writing.fmtAlignJustify'),
                      },
                    ] as const
                  ).map((a) => (
                    <Tooltip key={a.align} title={a.label}>
                      <IconButton
                        size="small"
                        onClick={() =>
                          editor
                            ?.chain()
                            .focus()
                            .command(({ commands }) => {
                              if (a.align === 'left') return commands.unsetTextAlign();
                              return commands.setTextAlign(a.align as 'center' | 'right' | 'justify');
                            })
                            .run()
                        }
                        sx={[toolbarBtnSx(editor?.isActive({ textAlign: a.align }) ?? false), compactBtnSx]}
                        aria-label={a.label}
                      >
                        {a.icon}
                      </IconButton>
                    </Tooltip>
                  ))}
                  {/* 缩进增减（段落整体缩进，em 步进） */}
                  <Tooltip title={t('writing.fmtIndentDecrease')}>
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => editor?.chain().focus().decreaseIndent().run()}
                        sx={[toolbarBtnSx(false), compactBtnSx]}
                        aria-label={t('writing.fmtIndentDecrease')}
                      >
                        <FormatIndentDecreaseRoundedIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t('writing.fmtIndentIncrease')}>
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => editor?.chain().focus().increaseIndent().run()}
                        sx={[toolbarBtnSx(false), compactBtnSx]}
                        aria-label={t('writing.fmtIndentIncrease')}
                      >
                        <FormatIndentIncreaseRoundedIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  {/* 清除格式：清空选区所有 mark 与块级结构（标题→段落），保留缩进由 textIndent 属性随段落保留 */}
                  <Tooltip title={t('writing.fmtClearFormat')}>
                    <IconButton
                      size="small"
                      onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}
                      sx={[toolbarBtnSx(false), compactBtnSx]}
                      aria-label={t('writing.fmtClearFormat')}
                    >
                      <FormatClearRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
                {/* ── 右段分组：写作 / 检查 / 资料 / AI（独立换行单元，宽度不足时整体换到下一行）── */}
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    flexShrink: 0,
                    columnGap: 0.25,
                    rowGap: 0.4,
                  }}
                >
                  {/* 写作：章导航 · 专注 · 速记 */}
                  <Tooltip title={t('writing.prevChapter')}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={!hasPrevChapter}
                        onClick={goPrevChapter}
                        sx={[toolbarBtnSx(false), compactBtnSx]}
                        aria-label={t('writing.prevChapter')}
                      >
                        <NavigateBeforeRoundedIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t('writing.nextChapter')}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={!hasNextChapter}
                        onClick={goNextChapter}
                        sx={[toolbarBtnSx(false), compactBtnSx]}
                        aria-label={t('writing.nextChapter')}
                      >
                        <NavigateNextRoundedIcon sx={{ fontSize: 17 }} />
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
                      sx={[toolbarBtnSx(focusMode !== 'normal'), compactBtnSx]}
                      aria-label={
                        focusMode === 'zen'
                          ? t('writing.exitZen')
                          : focusMode === 'focus'
                            ? t('writing.exitFocus')
                            : t('writing.focusMode')
                      }
                    >
                      <ChromeReaderModeRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('writing.noteFab')}>
                    <IconButton
                      size="small"
                      disabled={!activeBook}
                      onClick={() => {
                        setNoteDraft('');
                        setNotesOpen(true);
                      }}
                      sx={[toolbarBtnSx(false), compactBtnSx]}
                      aria-label={t('writing.noteFab')}
                    >
                      <StickyNote2RoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                  <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 0.5 }} />
                  {/* 检查：校对 · 查找替换 · 自动审阅 */}
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
                      sx={[toolbarBtnSx(false), compactBtnSx]}
                      aria-label={t('writing.proofreadTitle')}
                    >
                      <SpellcheckRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('writing.aiFlavorTitle')}>
                    <IconButton
                      size="small"
                      disabled={!activeChapter}
                      color={aiFlavorIssues.length > 0 ? 'secondary' : 'default'}
                      onClick={() => {
                        // 打开面板时用最新正文同步重检，口径与校对面板一致
                        if (editor) {
                          const text = editor.getText();
                          setAiFlavorIssues(text.trim() ? detectAiFlavor(text) : []);
                          setActiveAiFlavorKey('');
                        }
                        setAiFlavorOpen(true);
                      }}
                      sx={[toolbarBtnSx(false), compactBtnSx]}
                      aria-label={t('writing.aiFlavorTitle')}
                    >
                      <AutoAwesomeRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('writing.findReplace')}>
                    <IconButton
                      size="small"
                      disabled={!activeChapter}
                      onClick={() => setFrOpen(true)}
                      sx={[toolbarBtnSx(false), compactBtnSx]}
                      aria-label={t('writing.findReplace')}
                    >
                      <FindInPageRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('writing.autoReview')}>
                    <IconButton
                      size="small"
                      disabled={!activeBook}
                      onClick={() => setAutoDialogOpen(true)}
                      sx={[toolbarBtnSx(false), compactBtnSx]}
                      aria-label={t('writing.autoReview')}
                    >
                      <AutoModeRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                  <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 0.5 }} />
                  {/* 资料：快照 · 快捷键 */}
                  <Tooltip title={t('writing.snapshots.title')}>
                    <IconButton
                      size="small"
                      disabled={!activeChapter}
                      onClick={() => setSnapshotsOpen(true)}
                      sx={[toolbarBtnSx(false), compactBtnSx]}
                      aria-label={t('writing.snapshots.title')}
                    >
                      <HistoryRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('writing.shortcutsTitle')}>
                    <IconButton
                      size="small"
                      onClick={() => setHelpOpen(true)}
                      sx={[toolbarBtnSx(false), compactBtnSx]}
                      aria-label={t('writing.shortcutsTitle')}
                    >
                      <KeyboardRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                  <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 0.5 }} />
                  {/* AI：审视/对话/续写/润色收敛为单一入口（创作台重设计 · 方向 B） */}
                  <Tooltip title={t('writing.aiMenu')}>
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={(e) => setAiMenuAnchor(e.currentTarget)}
                      sx={[toolbarBtnSx(Boolean(aiMenuAnchor)), compactBtnSx]}
                      aria-label={t('writing.aiMenu')}
                    >
                      <AutoAwesomeRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                  <Menu anchorEl={aiMenuAnchor} open={Boolean(aiMenuAnchor)} onClose={() => setAiMenuAnchor(null)}>
                    <MenuItem
                      onClick={() => {
                        setAiMenuAnchor(null);
                        void handleOpenAiDialog();
                      }}
                    >
                      <AutoAwesomeRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.aiReview')}
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setAiMenuAnchor(null);
                        setChatOpen(true);
                      }}
                    >
                      <ChatBubbleOutlineRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.aiChatTitle')}
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setAiMenuAnchor(null);
                        // C3：自带编辑器选中句打开对照工作台（无选中时也可手动输入）
                        if (editor) {
                          const { from, to, empty } = editor.state.selection;
                          setCraftSource(empty ? '' : editor.state.doc.textBetween(from, to, ' ', ' '));
                        } else {
                          setCraftSource('');
                        }
                        setCraftCompareOpen(true);
                      }}
                    >
                      <CompareArrowsRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.craftCompareMenu')}
                    </MenuItem>
                    <MenuItem
                      disabled={!activeChapter}
                      onClick={() => {
                        setAiMenuAnchor(null);
                        // A3：用最新正文重建情感弧线后展开面板；空正文直接展开（面板显示空态）
                        if (editor) {
                          setEmotionArcSegments(editor.getText().trim() ? analyzeEmotionArc(editor.getText()) : []);
                          setActiveEmotionArcKey('');
                        }
                        setEmotionArcOpen(true);
                      }}
                    >
                      <ShowChartRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.emotionArcMenu')}
                    </MenuItem>
                    <MenuItem
                      disabled={!activeChapter}
                      onClick={() => {
                        setAiMenuAnchor(null);
                        // B3：同步重检情绪直述句；空正文直接展开（面板显示空态）
                        if (editor) {
                          setShowTellIssues(editor.getText().trim() ? detectShowTell(editor.getText()) : []);
                          setActiveShowTellKey('');
                        }
                        setShowTellOpen(true);
                      }}
                    >
                      <VisibilityRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.showTellMenu')}
                    </MenuItem>
                    <MenuItem
                      disabled={!activeBook}
                      onClick={() => {
                        setAiMenuAnchor(null);
                        // O7：打开灵感扩写面板（念头池在面板内列出，选中一条 → AI 扩写 → 插入正文）
                        setInspirationExpandOpen(true);
                      }}
                    >
                      <PsychologyRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.inspirationExpandMenu')}
                    </MenuItem>
                    <MenuItem
                      disabled={!activeBook}
                      onClick={() => {
                        setAiMenuAnchor(null);
                        // M1：打开资料辅助创作（选资料目录 → AI 分析 → 选作品/章 → 生成草稿回填）
                        setMaterialOpen(true);
                      }}
                    >
                      <FolderOpenRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.materialTitle')}
                    </MenuItem>
                    <MenuItem
                      disabled={!activeBook}
                      onClick={() => {
                        setAiMenuAnchor(null);
                        // C8：打开外部素材采集（图片/文本/记事本/链接 → AI 分析 → 素材库）
                        setCaptureOpen(true);
                      }}
                    >
                      <CameraAltRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.captureMenu')}
                    </MenuItem>
                    <Divider />
                    <MenuItem
                      disabled={!activeBook || !activeChapter}
                      onClick={() => {
                        setAiMenuAnchor(null);
                        openInlineDialog('continue');
                      }}
                    >
                      <NotesRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.inlineContinue')}
                    </MenuItem>
                    <MenuItem
                      disabled={!activeBook || !activeChapter}
                      onClick={() => {
                        setAiMenuAnchor(null);
                        openInlineDialog('polish');
                      }}
                    >
                      <AutoFixHighRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.inlinePolish')}
                    </MenuItem>
                    <MenuItem
                      disabled={!activeBook || !activeChapter}
                      onClick={() => {
                        setAiMenuAnchor(null);
                        openInlineDialog('review');
                      }}
                    >
                      <SpellcheckRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                      {t('writing.inlineReview')}
                    </MenuItem>
                  </Menu>
                </Box>
              </Box>
              <Box sx={{ px: { xs: 2, md: 6 }, pt: 2, maxWidth: typo.pageWidth, mx: 'auto' }}>
                {/* 批次② 写作动线：标题点击即改名（原对话框入口），状态/层级徽章就地切换 */}
                <Typography
                  onClick={() =>
                    openDialog({ kind: 'rename-chapter', chapterId: activeChapter.id }, activeChapter.title)
                  }
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
                  {/* 笔记完善（C）：本章笔记数入口 — 点击打开弹窗并按当前章筛选 */}
                  <Chip
                    size="small"
                    color="default"
                    variant="outlined"
                    icon={<StickyNote2RoundedIcon sx={{ fontSize: 13 }} />}
                    label={t('writing.chapterNotesChip', { n: chapterNoteCount })}
                    onClick={() => openNotesPanel(null, activeChapterId ?? '')}
                    sx={{ fontSize: 11, height: 22, cursor: 'pointer' }}
                    clickable
                    data-testid="chapter-notes-chip"
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
                {/* 保存指示随 T4 工具栏单行化移入底栏（原在工具栏，占位推宽工具栏） */}
                <SaveIndicator register={registerSaveIndicator} />
                <Box sx={{ flex: 1 }} />
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
              {/* T4 浮动速记 FAB：normal 模式随时采灵感（focus/zen 沉浸时不打扰），锚定编辑区工具栏下方右侧，不遮挡底部字数栏 */}
              {activeBook && focusMode === 'normal' && (
                <Fab
                  size="small"
                  color="primary"
                  aria-label={t('writing.noteFab')}
                  onClick={() => {
                    setNoteDraft('');
                    setNotesOpen(true);
                  }}
                  sx={{ position: 'absolute', top: 116, right: 16, zIndex: 5 }}
                >
                  <StickyNote2RoundedIcon sx={{ fontSize: 20 }} />
                </Fab>
              )}
            </Box>
            {/* 创作台右抽屉：提醒汇总 + 语料参考 + 章详情入口（normal/focus 显示，zen 沉浸隐藏；提醒区仅 normal） */}
            <WritingDrawer
              corpusQuery={corpusQuery}
              onInsertText={handleCorpusInsert}
              payableForeshadowings={payableForeshadowings}
              inspirationReminders={inspirationReminders}
              proofreadReminders={proofreadReminders}
              activeChapter={activeChapter}
              chapters={chapters}
              genre={genre}
              onOpenChapterDetails={() => {
                setActiveSetting(null);
                setRightTab('details');
              }}
              hidden={focusMode === 'zen'}
              remindersVisible={focusMode === 'normal'}
              healthCount={healthIssueCount}
              onOpenHealth={() => setHealthOpen(true)}
              aiCorpus={{
                chatTitle: `${t('writing.aiCorpusTitle')} · ${activeBook?.title ?? ''}`,
                buildContextBlock: buildChatContext,
                agentId: chatAgentId,
                onAgentChange: setChatAgentId,
                onOpenSettings: goAiSettings,
              }}
              externalCapture={{
                bookId: activeBookId ?? '',
                refreshKey: captureRefreshKey,
                onOpenCapture: () => setCaptureOpen(true),
              }}
            />
          </Box>
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
      {/* ─── 校对面板（批次③ T5）：问题列表 + 编辑器内定位 + 一键修复 ─── */}
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
        onFix={(issue) => {
          if (!editor || !issue.fix) return;
          const index = buildTextIndex(editor.state.doc);
          const range = textRangeToPos(index, issue.start, issue.end);
          if (!range) return;
          // 原位替换为修复文本，随后立即以最新正文同步重检（不等防抖），
          // 避免旧区间指向已失效位置、旧条目残留。
          editor.chain().focus().insertContentAt(range, issue.fix).run();
          const text = editor.getText();
          proofreadTextRef.current = text;
          setProofreadIssues(text.trim() ? runProofread(text) : []);
          setActiveProofreadKey('');
          useToastStore.getState().success(t('writing.proofreadFixDone', { text: issue.excerpt, fix: issue.fix }));
        }}
        onOpenLexicon={() => setLexiconOpen(true)}
        customEntryCount={lexiconEntryCount}
        labels={{
          title: t('writing.proofreadTitle'),
          empty: t('writing.proofreadEmpty'),
          hint: t('writing.proofreadHint'),
          typo: t('writing.proofreadTypo'),
          repeat: t('writing.proofreadRepeat'),
          sensitive: t('writing.proofreadSensitive'),
          punct: t('writing.proofreadPunct'),
          redundant: t('writing.proofreadRedundant'),
          count: t('writing.proofreadCount'),
          locate: t('writing.proofreadLocate'),
          fix: t('writing.proofreadFix'),
        }}
      />
      {/* 自定义校对词库（增-6）：改完立即以新词库重检当前正文，面板与提示同步反映生效结果 */}
      <LexiconDialog
        open={lexiconOpen}
        onClose={() => setLexiconOpen(false)}
        onChanged={() => {
          setLexiconEntryCount(countCustomEntries(getCustomLexicon()));
          if (!proofreadTextRef.current.trim()) return;
          setProofreadIssues(runProofread(proofreadTextRef.current));
          setActiveProofreadKey('');
        }}
      />
      {/* ─── AI 味检测面板（写作方案 A2）：统计层问题列表 + 编辑器内定位 + LLM 深度审校入口 ─── */}
      <AiFlavorPanel
        open={aiFlavorOpen}
        onClose={() => setAiFlavorOpen(false)}
        issues={aiFlavorIssues}
        activeKey={activeAiFlavorKey}
        onLocate={(issue) => {
          if (!editor) return;
          const index = buildTextIndex(editor.state.doc);
          const range = textRangeToPos(index, issue.start, issue.end);
          if (!range) return;
          setActiveAiFlavorKey(`${issue.kind}:${issue.start}:${issue.end}`);
          editor.chain().focus().setTextSelection(range).scrollIntoView().run();
        }}
        onDeepReview={() => {
          setAiFlavorOpen(false);
          void handleOpenAiDialog();
        }}
        onCompare={(issue) => {
          setAiFlavorOpen(false);
          setCraftSource(issue.excerpt);
          setCraftCompareOpen(true);
        }}
        labels={{
          title: t('writing.aiFlavorTitle'),
          empty: t('writing.aiFlavorEmpty'),
          hint: t('writing.aiFlavorHint'),
          template: t('writing.aiFlavorTemplate'),
          rhythm: t('writing.aiFlavorRhythm'),
          punctuation: t('writing.aiFlavorPunctuation'),
          vague: t('writing.aiFlavorVague'),
          count: t('writing.aiFlavorCount'),
          locate: t('writing.aiFlavorLocate'),
          deepReview: t('writing.aiFlavorDeepReview'),
          compare: t('writing.aiFlavorCompare'),
        }}
      />
      {/* ─── 情感弧线分析面板（写作方案 A3）：段落级情感曲线 + 平淡/断层标记 ─── */}
      <EmotionArcPanel
        open={emotionArcOpen}
        onClose={() => setEmotionArcOpen(false)}
        segments={emotionArcSegments}
        activeKey={activeEmotionArcKey}
        onLocate={(seg) => {
          if (!editor) return;
          const index = buildTextIndex(editor.state.doc);
          const range = textRangeToPos(index, seg.start, seg.end);
          if (!range) return;
          setActiveEmotionArcKey(`${seg.index}:${seg.start}:${seg.end}`);
          editor.chain().focus().setTextSelection(range).scrollIntoView().run();
        }}
        labels={{
          title: t('writing.emotionArcTitle'),
          empty: t('writing.emotionArcEmpty'),
          hint: t('writing.emotionArcHint'),
          flat: t('writing.emotionArcFlat'),
          breakpoint: t('writing.emotionArcBreakpoint'),
          flatCount: t('writing.emotionArcFlatCount'),
          breakCount: t('writing.emotionArcBreakCount'),
          locate: t('writing.aiFlavorLocate'),
        }}
        emotionLabels={{
          joy: t('writing.emotionJoy'),
          sadness: t('writing.emotionSadness'),
          fear: t('writing.emotionFear'),
          anger: t('writing.emotionAnger'),
          love: t('writing.emotionLove'),
          calm: t('writing.emotionCalm'),
          tension: t('writing.emotionTension'),
          none: t('writing.emotionNone'),
        }}
      />
      {/* ─── Show-not-Tell 顾问面板（写作方案 B3）：情绪直述句 + 改写方向 + 库内示范句 ─── */}
      <ShowTellPanel
        open={showTellOpen}
        onClose={() => setShowTellOpen(false)}
        issues={showTellIssues}
        activeKey={activeShowTellKey}
        onLocate={(issue) => {
          if (!editor) return;
          const index = buildTextIndex(editor.state.doc);
          const range = textRangeToPos(index, issue.start, issue.end);
          if (!range) return;
          setActiveShowTellKey(`${issue.start}:${issue.end}`);
          editor.chain().focus().setTextSelection(range).scrollIntoView().run();
        }}
        onRecall={async (issue) => {
          try {
            const res = await corpusApi.search(issue.emotionWord, null, 10, 0);
            return filterReferenceHits(res.hits).map((h) => ({
              book: h.bookTitle,
              chapter: h.chapterTitle,
              content: h.content,
            }));
          } catch (e) {
            // 检索失败 ≠ 库里没有示范句：返回空之前先说清楚，否则用户以为语料库没货
            const msg = e instanceof Error ? e.message : String(e);
            useToastStore.getState().showToast(t('writing.corpusRecallFailed', { msg }), 'warning');
            return [];
          }
        }}
        labels={{
          title: t('writing.showTellTitle'),
          empty: t('writing.showTellEmpty'),
          hint: t('writing.showTellHint'),
          told: t('writing.showTellTold'),
          directions: t('writing.showTellDirections'),
          rewriteExample: t('writing.showTellRewriteExample'),
          recall: t('writing.showTellRecall'),
          recalling: t('writing.showTellRecalling'),
          recalled: t('writing.showTellRecalled'),
          noRecall: t('writing.showTellNoRecall'),
          locate: t('writing.aiFlavorLocate'),
          count: t('writing.aiFlavorCount'),
        }}
        kindLabels={{
          joy: t('writing.showTellJoy'),
          sadness: t('writing.showTellSadness'),
          fear: t('writing.showTellFear'),
          anger: t('writing.showTellAnger'),
          love: t('writing.showTellLove'),
          calm: t('writing.showTellCalm'),
          tension: t('writing.showTellTension'),
          general: t('writing.showTellGeneral'),
        }}
      />
      {/* ─── O7 灵感扩写面板：灵感念头池 → AI 扩写成段落/场景 → 一键插入正文 ─── */}
      <InspirationExpandPanel
        open={inspirationExpandOpen}
        onClose={() => setInspirationExpandOpen(false)}
        beats={looseBeats(outlines)}
        settings={settings}
        chatTitle={`${t('writing.inspirationExpandTitle')} · ${activeBook?.title ?? ''}`}
        buildContextBlock={buildChatContext}
        onInsertText={handleInspirationInsert}
        initialBeatId={inspirationExpandInitialId}
        onInitialBeatConsumed={() => setInspirationExpandInitialId(null)}
        agentId={chatAgentId}
        onAgentChange={setChatAgentId}
        onOpenSettings={goAiSettings}
      />
      {/* ─── M1 资料辅助创作：选资料目录 → AI 分析 → 选作品/章 → 生成草稿回填 ─── */}
      <MaterialAssistDialog
        open={materialOpen}
        onClose={() => setMaterialOpen(false)}
        agents={agents}
        agentId={chatAgentId}
        onAgentChange={setChatAgentId}
        onGoSettings={goAiSettings}
        books={books}
        activeBookId={activeBookId}
        activeChapterId={activeChapterId}
        currentChapterText={editor ? editor.getText() : ''}
        onInsertText={(text, chapterId) => {
          if (!editor || !text.trim()) return;
          // 目标章是当前激活章 → 直接插入编辑器末尾（与 handleCorpusInsert 同链路）
          if (chapterId === activeChapterId) {
            handleInspirationInsert(text);
            return;
          }
          // 目标章是其他章 → 先切章再回填：切章 effect 装载完成后插入，避免覆盖加载内容
          pendingMaterialInsertRef.current = { chapterId, text };
          setActiveChapter(chapterId);
        }}
      />
      {/* ─── C8 外部素材采集：图片/文本/记事本/链接 → AI 分析 → 素材库（右抽屉「素材库」Tab） ─── */}
      <ExternalCaptureDialog
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        agents={agents}
        agentId={chatAgentId}
        onAgentChange={setChatAgentId}
        onGoSettings={goAiSettings}
        bookId={activeBookId ?? ''}
        notes={sidebarNotes}
        onSaved={() => {
          // 保存成功 → 素材库 Tab 重拉（对话框自身也负责 close）
          setCaptureRefreshKey((k) => k + 1);
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
      {/* ─── C3 写法对照工作台：选中平淡句 ⇄ 语料库召回优质句对照改写 ─── */}
      <CraftComparePanel
        open={craftCompareOpen}
        onClose={() => setCraftCompareOpen(false)}
        source={craftSource}
        onSourceChange={setCraftSource}
        onRequestRewrite={({ original, references }) => {
          setCraftCompareOpen(false);
          const refText = references
            .map((r) => L(`- 《${r.book} · ${r.chapter}》：${r.content}`, `- "${r.book} · ${r.chapter}": ${r.content}`))
            .join('\n');
          const prompt = L(
            `请对照下面的语料库优秀句子，改写我的原句：给出 1-3 个版本，并在每版后用一行标注所用手法（节奏/视角/细节密度/修辞等）及为什么这样改更有表现力。\n\n【原句】\n${original}\n\n【语料库参考句】\n${refText}`,
            `Rewrite my original sentence, referring to the excellent corpus sentences below. Provide 1-3 versions, and after each version note on one line the technique used (rhythm / perspective / detail density / rhetoric, etc.) and why the change is more expressive.\n\n[Original sentence]\n${original}\n\n[Corpus reference sentences]\n${refText}`,
          );
          setChatInitial(prompt);
          setChatOpen(true);
        }}
        labels={{
          title: t('writing.craftCompareTitle'),
          hint: t('writing.craftCompareHint'),
          source: t('writing.craftCompareSource'),
          recall: t('writing.craftCompareRecall'),
          recalling: t('writing.craftCompareRecalling'),
          empty: t('writing.craftCompareEmpty'),
          tempoLonger: t('writing.craftCompareTempoLonger'),
          tempoShorter: t('writing.craftCompareTempoShorter'),
          tempoSimilar: t('writing.craftCompareTempoSimilar'),
          reference: t('writing.craftCompareReference'),
          rewrite: t('writing.craftCompareRewrite'),
        }}
      />
      {/* ─── D 对话式 AI：自由问答（per 书复用会话，首轮自动注入写作上下文） ─── */}
      <WritingAiChatDialog
        open={chatOpen}
        onClose={() => {
          setChatOpen(false);
          setChatInitial('');
        }}
        chatTitle={`${t('writing.aiChatTitle')} · ${activeBook?.title ?? ''}`}
        buildContextBlock={buildChatContext}
        agentId={chatAgentId}
        onAgentChange={setChatAgentId}
        onOpenSettings={() => {
          setChatOpen(false);
          goAiSettings();
        }}
        initialMessage={chatInitial}
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
      {/* ─── 批次② 全书体检：七组发现清单，章/卡两类可在写作台内直接跳过去处理 ─── */}
      <WritingHealthDialog
        open={healthOpen}
        onClose={() => setHealthOpen(false)}
        onJumpChapter={(id) => {
          setActiveSetting(null);
          setActiveChapter(id);
        }}
        onOpenSetting={(id) => openSetting(id)}
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
      {/* P0 选中正文悬浮 AI 菜单（改写/续写/润色/总结）：跟随选区视口定位，滚动自动重算 */}
      <AiSelectionMenu editor={editor} scrollRef={editorScrollRef} onPick={openInlineDialog} />
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
        styleConsistency={inlineStyleConsistency}
        onStyleConsistencyChange={setInlineStyleConsistency}
        styleFingerprintAvailable={styleFingerprintAvailable}
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
      {/* ─── 设定卡 AI 补全（P0）：基于卡片已有内容生成缺失字段建议，确认后一次性回填 ─── */}
      <SettingAiCompleteDialog
        open={settingAiOpen}
        onClose={() => {
          if (!settingAiRunning) setSettingAiOpen(false);
        }}
        agents={agents}
        agentId={settingAiAgentId}
        onAgentChange={setSettingAiAgentId}
        onGoSettings={() => {
          setSettingAiOpen(false);
          goAiSettings();
        }}
        running={settingAiRunning}
        streamText={settingAiStreamText}
        result={settingAiResult}
        onRun={() => void handleRunSettingAi()}
        onApply={applySettingCompletion}
      />
      {/* ─── 内联 AI 结果预览：用户确认后才动正文，绝无静默改写 ─── */}
      <InlineAiResultDialog
        result={inlineResult}
        onClose={() => setInlineResult(null)}
        onApply={handleApplyInlineResult}
        onApplyReviewEntry={(entry) => {
          // 逐句审校逐条应用：定位正文中的原句 → 替换为建议句（用户已点「应用」=显式确认，无静默改写）
          if (!editor || !entry.original || !entry.suggestion) return;
          const text = editor.getText();
          const target = entry.original.trim();
          const pos = text.indexOf(target);
          if (pos < 0) {
            useToastStore.getState().error(t('writing.resultReviewNotFound'));
            return;
          }
          const index = buildTextIndex(editor.state.doc);
          const range = textRangeToPos(index, pos, pos + target.length);
          if (!range) {
            useToastStore.getState().error(t('writing.resultReviewNotFound'));
            return;
          }
          editor.chain().focus().insertContentAt(range, entry.suggestion).run();
          useToastStore.getState().success(t('writing.resultReviewApplyDone', { text: target, fix: entry.suggestion }));
        }}
      />
      {/* ─── P3 排版面板：字号/行距/段距/首行缩进/页宽/纸色，per-book 持久化 ─── */}
      <TypographyPopover anchorEl={typoAnchor} onClose={() => setTypoAnchor(null)} typo={typo} onChange={setTypo} />
      {/* ─── 章内批注（批次② T4）：新增批注 — 选中文本 → 弹窗录入并保存 ─── */}
      <AnnotationCreateDialog
        draft={annotationDraft}
        onClose={() => setAnnotationDraft(null)}
        text={annotationText}
        onTextChange={setAnnotationText}
        settings={settings}
        settingId={annotationSettingId}
        onSettingIdChange={setAnnotationSettingId}
        onSave={() => void handleSaveAnnotation()}
      />
      {/* ─── 章内批注：查看/删除 — 点击正文批注高亮处弹出 ─── */}
      <AnnotationViewDialog
        annotation={annotationView}
        onClose={() => setAnnotationView(null)}
        onDelete={() => void handleDeleteAnnotation()}
        settings={settings}
        onUpdateSetting={(ann, sid) => void handleUpdateAnnotationSetting(ann, sid)}
      />
      {/* ─── T4 灵感/快速笔记：全局跨章、浮动速记不中断心流 ─── */}
      <WritingNotesDialog
        open={notesOpen}
        onClose={() => {
          setNotesOpen(false);
          setNotesFocusId(null);
        }}
        bookId={activeBook?.id ?? ''}
        chapters={chapters}
        activeChapterId={activeChapterId}
        onGotoChapter={(chapterId) => {
          setActiveSetting(null);
          setActiveChapter(chapterId);
          setNotesOpen(false);
          setNotesFocusId(null);
        }}
        draftContent={noteDraft || undefined}
        onClearDraft={() => setNoteDraft('')}
        initialFilterChapterId={notesFilterChapter}
        focusNoteId={notesFocusId}
        onNotesChange={setSidebarNotes}
      />
      {/* ─── ⌘K 命令面板（创作台重设计 · 方向 B 一期）─── */}
      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        commands={paletteCommands}
        title={t('writing.commandPalette')}
        placeholder={t('writing.commandPalette')}
      />
    </Box>
  );
}
