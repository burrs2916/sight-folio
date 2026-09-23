import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
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
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
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
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import KeyboardRoundedIcon from '@mui/icons-material/KeyboardRounded';
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded';
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded';
import FormatStrikethroughRoundedIcon from '@mui/icons-material/FormatStrikethroughRounded';
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import FormatSizeRoundedIcon from '@mui/icons-material/FormatSizeRounded';
import Popover from '@mui/material/Popover';
import Switch from '@mui/material/Switch';
import Slider from '@mui/material/Slider';
import { useTheme } from '@mui/material/styles';
import { loadTypography, saveTypography, paperBackground, type BookTypography } from '../utils/typography';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { WritingImage, insertIllustrationIntoEditor } from '../editor/extensions/writingImage';
import TurndownService from 'turndown';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { emit, listen } from '@tauri-apps/api/event';
import { useLocation, useNavigate } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WRITING_DESK_FOCUS_EVENT, isWritingDeskWindow, type WritingDeskFocus } from '../utils/writingDeskWindow';
import { deleteBookWithScene } from '../utils/studioBook';
import { useWritingStore } from '../store/writingStore';
import {
  saveTextFile,
  saveWritingEpub,
  writingScanApi,
  writingSnapshotsApi,
  parseSettingExtra,
  WORLDBUILDING_TYPE_KEYS,
  type WritingSettingKind,
  type WritingSettingExtra,
  type WritingSettingProfile,
  type WritingWorldbuildingProfile,
  type WritingTimelineEvent,
  type AiAgent,
  type AssetInfo,
} from '../services/tauri';
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
import { parseChapterCover } from '../editor/renderers/WritingChapterEditor';
import { pickLang, t } from '../i18n';
import { genreLabelKey, mediumLabelKey } from '../utils/writingSchema';
import { GenreMediumFields } from './GenreMediumFields';
import { logger } from '../utils/logger';
import { chaptersOfSetting } from '../utils/writingOutline';

/**
 * 写作台（Sight Folio）
 *
 * 左栏：书架 + 双 tab（章节 / 设定）；右栏：TipTap 正文编辑器 或 设定卡编辑。
 * 自动保存：正文与设定卡各自 800ms 防抖落库；切目标 / 卸载时 flush。
 * 导出：Turndown 把各章 HTML 转 Markdown → 系统对话框选路径 → 后端写盘。
 */

// SaveState 类型下沉 SaveIndicator.tsx（随状态一起搬家，WritingPage type-only 回引）

type LeftTab = 'chapters' | 'settings' | 'outline';

const SAVE_DEBOUNCE_MS = 800;

function chapterWordCount(editor: Editor): number {
  // 中文按字符数计（不含空白），与网文平台口径一致
  return editor.getText().replace(/\s/g, '').length;
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

// ─── 章节内查找替换（P9）：跨加粗/斜体边界的词会漏（MVP 已知限制，段内匹配覆盖绝大多数场景） ───

interface MatchRange {
  from: number;
  to: number;
}

/** 大小写不敏感地在当前文档里找全部匹配区间（按单文本节点内匹配） */
function findMatches(editor: Editor, query: string): MatchRange[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: MatchRange[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const text = node.text.toLowerCase();
      let idx = text.indexOf(q);
      while (idx >= 0) {
        out.push({ from: pos + idx, to: pos + idx + q.length });
        idx = text.indexOf(q, idx + 1);
      }
    }
    return true;
  });
  return out;
}

/** 全部替换：一次事务内逆序替换（后改不影响前者的位置），返回替换数 */
function replaceAllMatches(editor: Editor, query: string, replacement: string): number {
  const ranges = findMatches(editor, query);
  if (!ranges.length) return 0;
  const tr = editor.state.tr;
  for (const r of [...ranges].reverse()) {
    tr.insertText(replacement, r.from, r.to);
  }
  editor.view.dispatch(tr);
  return ranges.length;
}

/** 正文编辑器样式（P3 排版可调）：按 per-book 排版设置动态生成，纸色明暗各配一组 */
function buildEditorBodySx(typo: BookTypography, dark: boolean) {
  const bg = paperBackground(typo.paper, dark);
  return {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    px: { xs: 2, md: 6 },
    py: 3,
    ...(bg ? { backgroundColor: bg } : {}),
    '& .ProseMirror': {
      outline: 'none',
      maxWidth: typo.pageWidth,
      mx: 'auto',
      fontSize: typo.fontSize,
      lineHeight: typo.lineHeight,
      color: 'text.primary',
      // P3 空章节占位提示（Placeholder 扩展的 is-editor-empty 标记）
      '& p.is-editor-empty:first-child::before': {
        content: 'attr(data-placeholder)',
        float: 'left',
        height: 0,
        color: 'text.disabled',
        pointerEvents: 'none',
      },
      '& h1': { fontSize: '1.6rem', fontWeight: 700, mt: 3, mb: 1.5 },
      '& h2': { fontSize: '1.3rem', fontWeight: 700, mt: 3, mb: 1.5 },
      '& p': { my: typo.paraSpacing, ...(typo.indent ? { textIndent: '2em' } : {}) },
      '& blockquote': {
        borderLeft: 3,
        borderColor: 'divider',
        pl: 2,
        my: 1.5,
        color: 'text.secondary',
      },
      '& ul, & ol': { pl: 3 },
    },
  };
}

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
  const createOutline = useWritingStore((s) => s.createOutline);
  const updateOutline = useWritingStore((s) => s.updateOutline);
  const deleteOutline = useWritingStore((s) => s.deleteOutline);
  const setChapterVolume = useWritingStore((s) => s.setChapterVolume);
  const setDailyGoal = useWritingStore((s) => s.setDailyGoal);
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
  const setActiveChapter = useWritingStore((s) => s.setActiveChapter);
  const saveChapterContent = useWritingStore((s) => s.saveChapterContent);
  const createSetting = useWritingStore((s) => s.createSetting);
  const updateSetting = useWritingStore((s) => s.updateSetting);
  const deleteSetting = useWritingStore((s) => s.deleteSetting);
  const setActiveSetting = useWritingStore((s) => s.setActiveSetting);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
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
  // 专注模式（路线 A）：收起左栏，编辑区铺满；工具栏 ☰ 随时退出。
  const [focusMode, setFocusMode] = useState(false);
  const navigate = useNavigate();

  // 打开 AI 设置：写作台独立窗口（standalone 分支）没有 /ai 路由，直接 navigate
  // 会把沉浸窗口打回主布局形态且丢 desk=1 标记——emit open-ai-settings 让主窗口
  // 接管导航（同 WorkbenchAiPanel 先例）；主窗口 /writing 保持原路由跳转。
  const goAiSettings = useCallback(() => {
    if (isWritingDeskWindow()) {
      void emit('open-ai-settings');
    } else {
      navigate('/ai');
    }
  }, [navigate]);

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

  // ─── AI 审视（P2）：预设 + Agent 由用户选择，本页绝不推断 agentId ───
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const writingPresets = aiContextRegistry.get(WRITING_MODULE_ID)?.presets ?? [];
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiPresetKey, setAiPresetKey] = useState<string>('');
  const [aiAgentId, setAiAgentId] = useState<string>('');
  const [aiLaunching, setAiLaunching] = useState(false);

  // ─── 自动审阅规则（P3）：复用模块通用的 AutoAnalysisPanel ───
  const [autoDialogOpen, setAutoDialogOpen] = useState(false);

  // ─── 写作统计（P4） ───
  const [statsOpen, setStatsOpen] = useState(false);
  // A-2 审阅闭环：发射后/随时查看该书 AI 审阅结论（insights 体系，analysisId=bookId）
  const [insightsDialogOpen, setInsightsDialogOpen] = useState(false);
  // D 对话式 AI：聊天面板 + agent 记忆（同窗口内记住上次选择，修「agent 不重选不记忆」缺口）
  const [chatOpen, setChatOpen] = useState(false);
  const [chatAgentId, setChatAgentId] = useState('');
  // 骨架走查 P1-G1/P2-G3：全书搜索 + TXT 批量导入
  const [bookSearchOpen, setBookSearchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // ─── 人物出场图谱（原实体图鉴迁入）：全书 × 设定出场热力矩阵 ───
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  // ─── 批次③ 效率：⌘K 跳章 / 快捷键速查 / 导出收纳 / 版本快照（批次④） ───
  const [quickJumpOpen, setQuickJumpOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  // 选区字数（底栏显示）：跟随编辑器 selectionUpdate/transaction 刷新
  const [selectedChars, setSelectedChars] = useState(0);

  // ─── 内联 AI 写作（P7）：续写 / 润色，Agent 由用户选择 ───
  // B：打开参数对话框时快照的选区字数（>0 = 选区级润色提示）
  const [inlineSelChars, setInlineSelChars] = useState(0);
  // C 流式预览：内联任务运行中的增量文本（最终正文仍以落库消息为准）
  const [inlineStreamText, setInlineStreamText] = useState('');
  const streamPreviewRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // C：流式预览跟底——新内容到达时自动滚到最新
    if (streamPreviewRef.current) {
      streamPreviewRef.current.scrollTop = streamPreviewRef.current.scrollHeight;
    }
  }, [inlineStreamText]);
  const [inlineDialogOpen, setInlineDialogOpen] = useState(false);
  const [inlineKind, setInlineKind] = useState<InlineWritingKind>('continue');
  const [inlineAgentId, setInlineAgentId] = useState('');
  const [inlineRunning, setInlineRunning] = useState(false);
  const [inlineResult, setInlineResult] = useState<{
    kind: InlineWritingKind;
    text: string;
    /** B 选区级润色：选中文本字数（预览对话框提示「将替换选中的 N 字」） */
    selectionChars?: number;
  } | null>(null);
  // B：发起润色时冻结的选区范围（{from,to}）；null = 整章润色
  const inlineSelectionRef = useRef<{ from: number; to: number } | null>(null);
  // P8 参数化：续写字数/走向指令、润色风格档（保留sticky，二次生成不用重填）
  const [inlineWords, setInlineWords] = useState('');
  const [inlineDirective, setInlineDirective] = useState('');
  const [inlineStyle, setInlineStyle] = useState<PolishStyle>('default');

  // ─── 章节拖拽排序（P3）：原生 HTML5 DnD，零新依赖 ───
  const reorderChapter = useWritingStore((s) => s.reorderChapter);
  const dragChapterIdRef = useRef<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // ─── 对话框状态（新建/重命名/删除 书、章、设定 共用一套）───
  const [dialog, setDialog] = useState<
    | { kind: 'edit-book-meta'; bookId: string }
    | { kind: 'rename-book'; bookId: string }
    | { kind: 'delete-book'; bookId: string }
    | { kind: 'new-chapter' }
    | { kind: 'rename-chapter'; chapterId: string }
    | { kind: 'delete-chapter'; chapterId: string }
    | { kind: 'new-setting'; settingKind: WritingSettingKind }
    | { kind: 'rename-setting'; settingId: string }
    | { kind: 'delete-setting'; settingId: string }
    | { kind: 'new-outline' }
    | { kind: 'rename-outline'; outlineId: string }
    | { kind: 'delete-outline'; outlineId: string }
    | { kind: 'move-volume'; chapterId: string }
    | { kind: 'move-volume-batch' }
    | { kind: 'delete-chapters-batch' }
    | null
  >(null);
  const [dialogText, setDialogText] = useState('');

  // 羽化 P：新建作品走共享命名向导（NewBookDialog），与书架/代码场景入口同一组件
  const [newBookOpen, setNewBookOpen] = useState(false);

  // ─── P1 创作体系：建书向导（体裁+载体）与已有书体裁编辑的选中态 ───
  const [wizardGenre, setWizardGenre] = useState('');
  const [wizardMedium, setWizardMedium] = useState('');

  // ─── 全文检索（P5）：标题/正文过滤章节列表 ───
  const [chapterQuery, setChapterQuery] = useState('');

  // ─── 批量章节管理（P9）：多选 → 移卷 / 删除 ───
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);

  // ─── 查找替换（P9）：当前章节内 ───
  const [frOpen, setFrOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

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
      // 若期间没有产生新的脏内容才标 saved；否则保持 dirty
      setSaveStateRef.current((cur) => (pendingRef.current ? 'dirty' : 'saved'));
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
    extensions: [StarterKit, Placeholder.configure({ placeholder: t('writing.placeholder') }), WritingImage],
    content: '',
    onUpdate: ({ editor }) => {
      const chapterId = activeChapterIdRef.current;
      if (!chapterId) return;
      scheduleSave(chapterId, editor.getHTML(), chapterWordCount(editor));
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
    const restored = activeChapterId ? scrollTopByChapterRef.current.get(activeChapterId) : undefined;
    if (restored !== undefined) {
      requestAnimationFrame(() => {
        if (editorScrollRef.current) editorScrollRef.current.scrollTop = restored;
      });
    }
    // 刻意只依赖 id：装载后章节对象更新（保存回写）不应重置编辑器内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeChapterId, flushSave]);

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

  // ─── 导出 Markdown（整书） ───
  const handleExportMarkdown = useCallback(async () => {
    if (!activeBook) return;
    try {
      // 先把未保存的正文落库，确保导出的是最新内容
      await flushSave();
      await flushSettingSave();
      const freshChapters = useWritingStore.getState().chapters;
      const mdParts: string[] = [`# ${activeBook.title}`];
      if (activeBook.description) {
        mdParts.push('', `> ${activeBook.description}`);
      }
      for (const ch of freshChapters) {
        mdParts.push('', `## ${ch.title}`, '', turndown.turndown(ch.content || ''));
      }
      const md = mdParts.join('\n');
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!path) return;
      await saveTextFile(path, md);
      useToastStore.getState().success(t('writing.exported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export markdown failed', { error: e });
      useToastStore.getState().error(t('writing.exportFailed', { msg }));
    }
  }, [activeBook, flushSave, flushSettingSave]);

  // ─── 导出 EPUB（整书）：后端 zip 打包写盘，前端只传章节载荷 ───
  const handleExportEpub = useCallback(async () => {
    if (!activeBook) return;
    try {
      // 导出的一定是落库内容：先 flush 正文与设定
      await flushSave();
      await flushSettingSave();
      const freshChapters = useWritingStore.getState().chapters;
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.epub`,
        filters: [{ name: 'EPUB', extensions: ['epub'] }],
      });
      if (!path) return;
      await saveWritingEpub(
        activeBook.title,
        activeBook.description,
        freshChapters.map((c) => ({
          title: c.title,
          content: c.content || '',
          cover: parseChapterCover(c.extra) ?? null,
        })),
        path,
      );
      useToastStore.getState().success(t('writing.epubExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export epub failed', { error: e });
      useToastStore.getState().error(t('writing.epubExportFailed', { msg }));
    }
  }, [activeBook, flushSave, flushSettingSave]);

  // ─── 导出 HTML（P6，PDF 路径）：独立单文件 + 打印 CSS，浏览器打开即可打印/存 PDF ───
  const handleExportHtml = useCallback(async () => {
    if (!activeBook) return;
    try {
      await flushSave();
      await flushSettingSave();
      const freshChapters = useWritingStore.getState().chapters;
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const body = freshChapters
        .map((c) => {
          const vol = c.volume ? `<p class="volume">${esc(c.volume)}</p>` : '';
          return `${vol}<h2>${esc(c.title)}</h2>\n${c.content || ''}`;
        })
        .join('\n<hr/>\n');
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>${esc(activeBook.title)}</title>
<style>
  body { max-width: 46em; margin: 2em auto; padding: 0 1.5em; font: 16px/1.9 -apple-system, "PingFang SC", "Microsoft YaHei", serif; color: #1a1a1a; }
  h1 { font-size: 1.8em; text-align: center; margin-bottom: 0.3em; }
  h2 { font-size: 1.3em; margin-top: 2em; }
  .book-desc { text-align: center; color: #666; font-style: italic; }
  .volume { color: #4A338F; font-weight: 700; letter-spacing: 0.15em; margin-top: 2em; margin-bottom: -1em; }
  hr { border: none; border-top: 1px dashed #ccc; margin: 2.5em 0; }
  @media print { body { margin: 0 auto; max-width: none; } hr { page-break-after: always; border: none; } }
</style>
</head>
<body>
<h1>${esc(activeBook.title)}</h1>
${activeBook.description ? `<p class="book-desc">${esc(activeBook.description)}</p>` : ''}
${body}
</body>
</html>`;
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (!path) return;
      await saveTextFile(path, html);
      useToastStore.getState().success(t('writing.htmlExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export html failed', { error: e });
      useToastStore.getState().error(t('writing.htmlExportFailed', { msg }));
    }
  }, [activeBook, flushSave, flushSettingSave]);

  // ─── 导出纯文本（P8）：整书 .txt，投稿平台粘贴友好 ───
  const handleExportText = useCallback(async () => {
    if (!activeBook) return;
    try {
      await flushSave();
      await flushSettingSave();
      const freshChapters = useWritingStore.getState().chapters;
      const stripHtml = (h: string) => {
        const doc = new DOMParser().parseFromString(h || '', 'text/html');
        return (doc.body.textContent ?? '').trim();
      };
      const parts: string[] = [activeBook.title];
      if (activeBook.description) parts.push(activeBook.description);
      let lastVolume: string | null = null;
      for (const c of freshChapters) {
        if (c.volume && c.volume !== lastVolume) {
          parts.push('', `════ ${c.volume} ════`);
          lastVolume = c.volume;
        }
        parts.push('', c.title, '', stripHtml(c.content || ''));
      }
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.txt`,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });
      if (!path) return;
      await saveTextFile(path, parts.join('\n'));
      useToastStore.getState().success(t('writing.exported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export text failed', { error: e });
      useToastStore.getState().error(t('writing.exportFailed', { msg }));
    }
  }, [activeBook, flushSave, flushSettingSave]);

  // ─── AI 审视：打开选择框（先 flush 未保存内容，保证 pack 拿到最新正文） ───
  const handleOpenAiDialog = useCallback(async () => {
    await flushSave();
    await flushSettingSave();
    void loadAgents();
    setAiPresetKey((cur) => cur || writingPresets[0]?.key || '');
    setAiDialogOpen(true);
  }, [flushSave, flushSettingSave, loadAgents, writingPresets]);

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

  // ─── 分析器融合（F1）：把书扫进既有分析记录体系，在写作台内点亮出场图谱 ───
  // 扫描读的是落库章节，必须先 flush 编辑器未保存内容；扫完把写作分析器
  // 设为主插件（图谱按写作语义分组），接线 projectStore 后原地打开图谱。
  const handleAnalyzeBook = useCallback(async () => {
    if (!activeBook) return;
    try {
      await flushSave();
      await flushSettingSave();
      useToastStore.getState().info(t('writing.analyzing'));
      const summary = await writingScanApi.scanBook(activeBook.id);
      analyzerRegistry.setActiveAnalyzer('writing-analyzer');
      const ps = useProjectStore.getState();
      ps.setActiveAnalysis(summary.analysisId);
      await ps.loadFiles(summary.analysisId);
      await ps.loadFindings(summary.analysisId);
      setAppearanceOpen(true);
      if (summary.findingCount > 0) {
        useToastStore.getState().warning(t('writing.analyzeFindings', { n: summary.findingCount }));
      }
      useToastStore.getState().success(t('writing.analyzed', { n: summary.fileCount, words: summary.totalWords }));
    } catch (e) {
      logger.error('writing', `scan book failed: ${String(e)}`);
      useToastStore.getState().error(t('writing.analyzeFailed', { msg: String(e) }));
    }
  }, [activeBook, flushSave, flushSettingSave]);

  // ─── D 对话式 AI：聊天面板首轮自动注入的写作上下文（L() 双语，tailOf 控制 token） ───
  const buildChatContext = useCallback(() => {
    const tail = editor ? tailOf(editor.getText(), 2000) : '';
    const names = settings
      .filter((x) => x.kind === 'character')
      .map((x) => x.name)
      .join('、');
    return L(
      `【写作上下文】\n作品：《${activeBook?.title ?? ''}》\n当前章节：${activeChapter?.title ?? ''}\n${names ? `人设卡：${names}\n` : ''}${tail ? `\n当前章正文（末尾）：\n${tail}\n` : ''}——以上为自动注入的写作背景；回答请结合它，但不要复述它。`,
      `[Writing context]\nBook: "${activeBook?.title ?? ''}"\nCurrent chapter: ${activeChapter?.title ?? ''}\n${names ? `Characters: ${names}\n` : ''}${tail ? `\nCurrent chapter text (tail):\n${tail}\n` : ''}— The above is auto-attached background; use it but do not repeat it.`,
    );
  }, [activeBook, activeChapter, editor, settings]);

  // 打开聊天面板时补默认 agent（记忆为空则取第一个）
  useEffect(() => {
    if (chatOpen && !chatAgentId && agents.length > 0) {
      setChatAgentId(agents[0].id);
    }
  }, [chatOpen, chatAgentId, agents]);

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

  // ─── 内联 AI 写作（P7）：续写 / 润色，Agent 由用户选择，绝不推断 ───
  const openInlineDialog = useCallback(
    (kind: InlineWritingKind) => {
      setInlineKind(kind);
      void loadAgents();
      // B：打开时快照选区字数（选区级润色的模式提示）；实际提取仍以发起时 editor.state 为准
      const sel = editor?.state.selection;
      const selChars = editor && sel && !sel.empty ? editor.state.doc.textBetween(sel.from, sel.to, '\n\n').length : 0;
      setInlineSelChars(selChars);
      setInlineDialogOpen(true);
    },
    [loadAgents, editor],
  );

  const buildInlineContext = useCallback(() => {
    if (!activeBook || !activeChapter || !editor) return null;
    // 人设卡：名称（副标）+ 描述 + extra 里的关系/时间线（AI 一致性的关键材料）
    const characterLines = settings
      .filter((x) => x.kind === 'character')
      .map((c) => {
        const extra = parseSettingExtra(c.extra);
        const lines: string[] = [`${c.name}${c.subtitle ? `（${c.subtitle}）` : ''}：${c.description}`];
        if (extra.relations?.length) {
          lines.push(`  ${t('writing.relations')}：${extra.relations.map((r) => `${r.target}(${r.type})`).join('、')}`);
        }
        const settingTimeline = timelineEvents.filter((e) => e.settingId === c.id);
        if (settingTimeline.length) {
          lines.push(`  ${t('writing.timeline')}：${settingTimeline.map((ev) => `${ev.at}：${ev.event}`).join('；')}`);
        }
        return lines.join('\n');
      });
    const outlineLines = outlines.map((o) => {
      const bound = o.chapterId ? chapters.find((c) => c.id === o.chapterId) : null;
      return `- ${o.title}${bound ? ` → ${bound.title}` : ''}${o.summary ? `：${o.summary}` : ''}`;
    });
    // B 选区感知：润色只作用于选中片段（发起时冻结范围，应用时原位替换）；
    // 前后文各取 POLISH_CONTEXT_CHARS 字符作语境。
    const sel = editor.state.selection;
    const selDoc = editor.state.doc;
    const selectionText = sel.empty ? '' : selDoc.textBetween(sel.from, sel.to, '\n\n');
    const selectionRange = sel.empty ? null : { from: sel.from, to: sel.to };
    const beforeText = sel.empty ? undefined : selDoc.textBetween(0, sel.from, '\n\n').slice(-POLISH_CONTEXT_CHARS);
    const afterText = sel.empty
      ? undefined
      : selDoc.textBetween(sel.to, selDoc.content.size, '\n\n').slice(0, POLISH_CONTEXT_CHARS);
    return {
      bookTitle: activeBook.title,
      bookDescription: activeBook.description,
      chapterTitle: activeChapter.title,
      chapterText: editor.getText(),
      characterLines,
      outlineLines,
      // P8 参数化
      targetWords: parseInt(inlineWords, 10) > 0 ? parseInt(inlineWords, 10) : undefined,
      directive: inlineDirective.trim() || undefined,
      style: inlineStyle,
      // B 选区级润色（selectionRange 是应用侧内部字段，不进 prompt）
      selectionText: selectionText || undefined,
      beforeText: selectionText ? beforeText : undefined,
      afterText: selectionText ? afterText : undefined,
      selectionRange,
    };
  }, [
    activeBook,
    activeChapter,
    editor,
    settings,
    outlines,
    chapters,
    timelineEvents,
    inlineWords,
    inlineDirective,
    inlineStyle,
  ]);

  const handleRunInline = useCallback(async () => {
    const built = buildInlineContext();
    if (!built || !inlineAgentId) return;
    // selectionRange 是应用侧内部字段，剥掉再进 prompt ctx
    const { selectionRange, ...inlineCtx } = built;
    setInlineRunning(true);
    setInlineStreamText('');
    try {
      // 结果先落预览对话框，由用户决定插入/应用——绝无静默改文
      const res = await runInlineWritingTask({
        agentId: inlineAgentId,
        kind: inlineKind,
        ctx: inlineCtx,
        // C 流式预览：边生成边看（agentStore 全局唯一流，isStreaming 闸门保证不串台）
        onDelta: (full) => setInlineStreamText(full),
      });
      if (res.interrupted) {
        // 用户中断：安静收场，留在参数对话框（不弹错、不开结果框）
        setInlineStreamText('');
        return;
      }
      // 冻结发起时的选区（对话框打开期间模态遮盖、内容不会变；应用时原位替换）
      inlineSelectionRef.current = selectionRange;
      setInlineResult({
        kind: inlineKind,
        text: res.text,
        selectionChars: inlineCtx.selectionText ? inlineCtx.selectionText.length : undefined,
      });
      setInlineDialogOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'inline writing failed', { error: e });
      useToastStore.getState().error(t('writing.inlineFailed', { msg }));
    } finally {
      setInlineRunning(false);
    }
  }, [buildInlineContext, inlineAgentId, inlineKind]);

  const handleApplyInlineResult = useCallback(() => {
    if (!inlineResult || !editor) return;
    const html = textToParagraphHtml(inlineResult.text);
    if (inlineResult.kind === 'continue') {
      // 续写：接到文末；insertContent 会触发 onUpdate → 走既有防抖自动保存
      editor.chain().focus('end').insertContent(html).run();
    } else if (inlineSelectionRef.current) {
      // B 选区级润色：原位替换冻结的选区；insertContentAt 同样触发自动保存
      const range = inlineSelectionRef.current;
      const selDoc = editor.state.doc;
      // 段内选区：inline 文本替换（避免 <p> 插进段落中间把一段拆成三段）；
      // 跨块选区：段落 HTML 替换（AI 输出可能多段）
      const sameBlock = selDoc.resolve(range.from).sameParent(selDoc.resolve(range.to));
      if (sameBlock) {
        editor.chain().focus().insertContentAt(range, inlineResult.text).run();
      } else {
        editor.chain().focus().insertContentAt(range, html).run();
      }
      inlineSelectionRef.current = null;
    } else {
      // 润色：整章替换；同样触发自动保存
      editor.commands.setContent(html);
    }
    setInlineResult(null);
  }, [inlineResult, editor]);

  const handleLaunchAi = useCallback(async () => {
    if (!activeBook || !aiAgentId || !aiPresetKey) return;
    setAiLaunching(true);
    try {
      await launchModuleAnalysis({
        moduleId: WRITING_MODULE_ID,
        scopeId: activeBook.id,
        agentId: aiAgentId,
        presetKey: aiPresetKey,
      });
      useToastStore.getState().success(t('writing.aiLaunched'));
      setAiDialogOpen(false);
      // A-2 闭环：launchModuleAnalysis 已 await 到 agent 跑完、结论落库——直接打开结果面板
      setInsightsDialogOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'launch AI review failed', { error: e });
      useToastStore.getState().error(t('writing.aiLaunchFailed', { msg }));
    } finally {
      setAiLaunching(false);
    }
  }, [activeBook, aiAgentId, aiPresetKey]);

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

  // ─── 对话框动作 ───
  const handleDialogConfirm = useCallback(async () => {
    if (!dialog) return;
    try {
      switch (dialog.kind) {
        case 'edit-book-meta':
          await setBookMeta(dialog.bookId, { genre: wizardGenre, medium: wizardMedium });
          break;
        case 'rename-book':
          if (dialogText.trim()) await renameBook(dialog.bookId, dialogText.trim());
          break;
        case 'delete-book': {
          // 走 deleteBookWithScene（2026-09-19 加固）：书 + 支撑场景一起清——
          // 此前裸调 deleteBook 会留孤儿场景（场景指向的书没了，重开就是悬空态）。
          // 写作台（含独立窗口）删书与工作室 L1 页签删除同一条链路，行为一致。
          const book = books.find((b) => b.id === dialog.bookId);
          if (book) await deleteBookWithScene(book.id);
          break;
        }
        case 'new-chapter': {
          const name = dialogText.trim() || t('writing.newChapterName', { n: chapters.length + 1 });
          const chapter = await createChapter(name);
          if (chapter) {
            setActiveSetting(null);
            setActiveChapter(chapter.id);
          }
          break;
        }
        case 'rename-chapter':
          if (dialogText.trim()) await renameChapter(dialog.chapterId, dialogText.trim());
          break;
        case 'delete-chapter':
          await deleteChapter(dialog.chapterId);
          break;
        case 'new-setting': {
          const fallback =
            dialog.settingKind === 'character'
              ? t('writing.newCharacterName', { n: settings.filter((x) => x.kind === 'character').length + 1 })
              : t('writing.newWorldbuildingName', { n: settings.filter((x) => x.kind === 'worldbuilding').length + 1 });
          const name = dialogText.trim() || fallback;
          const setting = await createSetting(dialog.settingKind, name);
          if (setting) {
            setActiveChapter(null);
            setActiveSetting(setting.id);
          }
          break;
        }
        case 'rename-setting':
          if (dialogText.trim()) await updateSetting(dialog.settingId, { name: dialogText.trim() });
          break;
        case 'delete-setting':
          await deleteSetting(dialog.settingId);
          break;
        case 'new-outline': {
          const name = dialogText.trim() || t('writing.newOutlineName', { n: outlines.length + 1 });
          await createOutline(name);
          break;
        }
        case 'rename-outline':
          if (dialogText.trim()) await updateOutline(dialog.outlineId, { title: dialogText.trim() });
          break;
        case 'delete-outline':
          await deleteOutline(dialog.outlineId);
          break;
        case 'move-volume':
          await setChapterVolume(dialog.chapterId, dialogText.trim());
          break;
        case 'move-volume-batch': {
          const vol = dialogText.trim();
          // 逐个复用既有 setChapterVolume（先落库再改态）；一个失败即中断抛给 toast
          for (const id of selectedChapterIds) {
            await setChapterVolume(id, vol);
          }
          setSelectionMode(false);
          setSelectedChapterIds([]);
          break;
        }
        case 'delete-chapters-batch': {
          // 复用单个 deleteChapter：内部会解绑大纲，批量语义与逐个删一致
          for (const id of selectedChapterIds) {
            await deleteChapter(id);
          }
          setSelectionMode(false);
          setSelectedChapterIds([]);
          break;
        }
      }
    } catch (e) {
      logger.warn('WritingPage', 'dialog action failed', { e });
    }
    setDialog(null);
    setDialogText('');
  }, [
    dialog,
    dialogText,
    books,
    chapters.length,
    settings,
    outlines,
    selectedChapterIds,
    createBook,
    setBookMeta,
    setActiveBook,
    wizardGenre,
    wizardMedium,
    renameBook,
    createChapter,
    setActiveChapter,
    setActiveSetting,
    renameChapter,
    deleteChapter,
    createSetting,
    updateSetting,
    deleteSetting,
    createOutline,
    updateOutline,
    deleteOutline,
    setChapterVolume,
    setSelectionMode,
    setSelectedChapterIds,
  ]);

  // P1 性能：useCallback 稳定引用——否则传给 ChapterTreePanel 会每渲染新建闭包，破坏 React.memo 隔离。
  const openDialog = useCallback(
    (d: Exclude<typeof dialog, null>, initialText = '') => {
      setDialog(d);
      setDialogText(initialText);
      // P1 创作体系：体裁编辑回填当前值（建书走独立 NewBookDialog，不再进此状态机）
      if (d.kind === 'edit-book-meta') {
        const book = books.find((b) => b.id === d.bookId);
        setWizardGenre(book?.genre ?? '');
        setWizardMedium(book?.medium ?? '');
      }
    },
    [setDialog, setDialogText, setWizardGenre, setWizardMedium, books],
  );

  const dialogTitle = (() => {
    if (!dialog) return '';
    switch (dialog.kind) {
      case 'edit-book-meta':
        return t('writing.editBookMeta');
      case 'rename-book':
        return t('writing.renameBookTitle');
      case 'delete-book':
        return t('writing.deleteBookTitle');
      case 'new-chapter':
        return t('writing.newChapter');
      case 'rename-chapter':
        return t('writing.renameChapterTitle');
      case 'delete-chapter':
        return t('nav.delete');
      case 'new-setting':
        return dialog.settingKind === 'character' ? t('writing.newCharacter') : t('writing.newWorldbuilding');
      case 'rename-setting':
        return t('writing.renameSettingTitle');
      case 'delete-setting':
        return t('writing.deleteSettingTitle');
      case 'new-outline':
        return t('writing.newOutline');
      case 'rename-outline':
        return t('writing.renameOutlineTitle');
      case 'delete-outline':
        return t('writing.deleteOutlineTitle');
      case 'move-volume':
        return t('writing.moveToVolume');
      case 'move-volume-batch':
        return t('writing.batchMove');
      case 'delete-chapters-batch':
        return t('nav.delete');
      default:
        return '';
    }
  })();

  const isDeleteDialog =
    dialog?.kind === 'delete-book' ||
    dialog?.kind === 'delete-chapter' ||
    dialog?.kind === 'delete-setting' ||
    dialog?.kind === 'delete-outline' ||
    dialog?.kind === 'delete-chapters-batch';

  const dialogBody = (() => {
    if (!dialog) return null;
    if (dialog.kind === 'delete-book') {
      const book = books.find((b) => b.id === dialog.bookId);
      // 章节缓存只对当前激活书有效；非激活书拿不到章数，用无计数文案
      const knownCount = dialog.bookId === activeBookId;
      return (
        <Typography sx={{ fontSize: 14 }}>
          {knownCount
            ? t('writing.deleteBookConfirm', { title: book?.title ?? '', n: chapters.length })
            : t('writing.deleteBookConfirmNoCount', { title: book?.title ?? '' })}
        </Typography>
      );
    }
    if (dialog.kind === 'delete-chapter') return null;
    if (dialog.kind === 'delete-chapters-batch') {
      return (
        <Typography sx={{ fontSize: 14 }}>
          {t('writing.batchDeleteConfirm', { n: selectedChapterIds.length })}
        </Typography>
      );
    }
    if (dialog.kind === 'move-volume') {
      const names = [...new Set(chapters.map((c) => c.volume).filter(Boolean))];
      return (
        <>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t('writing.volumeName')}
            value={dialogText}
            onChange={(e) => setDialogText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleDialogConfirm();
            }}
            sx={{ mt: 1 }}
          />
          {names.length > 0 && (
            <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 1 }}>
              {t('writing.volumeExisting')}：{names.join('、')}
            </Typography>
          )}
        </>
      );
    }
    if (dialog.kind === 'delete-outline') {
      const outline = outlines.find((o) => o.id === dialog.outlineId);
      return (
        <Typography sx={{ fontSize: 14 }}>
          {t('writing.deleteOutlineConfirm', { title: outline?.title ?? '' })}
        </Typography>
      );
    }
    if (dialog.kind === 'delete-setting') {
      const setting = settings.find((x) => x.id === dialog.settingId);
      return (
        <Typography sx={{ fontSize: 14 }}>
          {t('writing.deleteSettingConfirm', { title: setting?.name ?? '' })}
        </Typography>
      );
    }
    if (dialog.kind === 'edit-book-meta') {
      // 体裁 × 载体 编辑面（此前落到通用 TextField、无选择 UI，setBookMeta 写回原值等于改不动）
      // 选择字段与 NewBookDialog / 书架编辑共用 GenreMediumFields，口径唯一
      return (
        <GenreMediumFields
          genre={wizardGenre}
          medium={wizardMedium}
          onGenreChange={setWizardGenre}
          onMediumChange={setWizardMedium}
        />
      );
    }
    const label = (() => {
      switch (dialog.kind) {
        case 'rename-book':
          return t('writing.bookName');
        case 'new-chapter':
        case 'rename-chapter':
          return t('writing.chapterName');
        case 'new-setting':
        case 'rename-setting':
          return t('writing.settingName');
        case 'new-outline':
        case 'rename-outline':
          return t('writing.outlineNode');
        case 'move-volume-batch':
          return t('writing.volumeName');
        default:
          return '';
      }
    })();
    return (
      <TextField
        autoFocus
        fullWidth
        size="small"
        label={label}
        value={dialogText}
        onChange={(e) => setDialogText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isDeleteDialog) void handleDialogConfirm();
        }}
        sx={{ mt: 1 }}
      />
    );
  })();

  // ─── 工具栏按钮 ───
  const toolbarBtnSx = (active: boolean) => ({
    color: active ? 'primary.main' : 'text.secondary',
    bgcolor: active ? 'action.selected' : 'transparent',
    '&:hover': { bgcolor: 'action.hover' },
  });

  const toolButtons: Array<{ icon: React.ReactNode; label: string; active: boolean; onClick: () => void }> = [];
  if (editor) {
    toolButtons.push(
      {
        icon: <FormatBoldRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtBold'),
        active: editor.isActive('bold'),
        onClick: () => editor.chain().focus().toggleBold().run(),
      },
      {
        icon: <FormatItalicRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtItalic'),
        active: editor.isActive('italic'),
        onClick: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        icon: <FormatStrikethroughRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtStrike'),
        active: editor.isActive('strike'),
        onClick: () => editor.chain().focus().toggleStrike().run(),
      },
      {
        icon: <Typography sx={{ fontSize: 12, fontWeight: 700 }}>H1</Typography>,
        label: t('writing.fmtH1'),
        active: editor.isActive('heading', { level: 1 }),
        onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        icon: <Typography sx={{ fontSize: 12, fontWeight: 700 }}>H2</Typography>,
        label: t('writing.fmtH2'),
        active: editor.isActive('heading', { level: 2 }),
        onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        icon: <FormatQuoteRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtQuote'),
        active: editor.isActive('blockquote'),
        onClick: () => editor.chain().focus().toggleBlockquote().run(),
      },
      {
        icon: <FormatListBulletedRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtBullet'),
        active: editor.isActive('bulletList'),
        onClick: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        icon: <FormatListNumberedRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtOrdered'),
        active: editor.isActive('orderedList'),
        onClick: () => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        icon: <ImageRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.insertImage'),
        active: false,
        onClick: () =>
          useAssetPickerStore.getState().openPicker({
            editorInserter: (a) => {
              if (editor) void insertIllustrationIntoEditor(editor, a);
            },
          }),
      },
    );
  }

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
          >
            <EditRoundedIcon sx={{ fontSize: 13 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              openDialog({ kind: 'delete-setting', settingId: setting.id });
            }}
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
          display: focusMode ? 'none' : 'flex',
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
                <IconButton size="small" disabled={!activeBook} onClick={() => void handleAnalyzeBook()}>
                  <HubRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.stats')}>
              <span>
                <IconButton size="small" disabled={!activeBook} onClick={() => void handleOpenStats()}>
                  <InsightsRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.appearanceMap.title')}>
              <span>
                <IconButton size="small" disabled={!activeBook} onClick={() => void handleOpenAppearance()}>
                  <GroupsRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('writing.newBook')}>
              <IconButton size="small" color="primary" onClick={() => setNewBookOpen(true)}>
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
                  >
                    <CategoryRoundedIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDialog({ kind: 'rename-book', bookId: book.id }, book.title);
                    }}
                  >
                    <EditRoundedIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDialog({ kind: 'delete-book', bookId: book.id });
                    }}
                  >
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              </Box>
            );
          })}
        </Box>

        {!focusMode && activeBook && (
          <>
            <Divider />
            <Tabs
              value={leftTab}
              onChange={(_, v: LeftTab) => setLeftTab(v)}
              variant="fullWidth"
              sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, fontSize: 12.5 } }}
            >
              <Tab value="chapters" label={t('writing.tabChapters')} />
              <Tab value="outline" label={t('writing.tabOutline')} />
              <Tab value="settings" label={t('writing.tabSettings')} />
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
                        <IconButton size="small" onClick={() => setBookSearchOpen(true)}>
                          <SearchRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('writing.importTxtTitle')}>
                        <IconButton size="small" onClick={() => setImportOpen(true)}>
                          <NoteAddRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('writing.batchManage')}>
                        <IconButton
                          size="small"
                          color={selectionMode ? 'primary' : 'default'}
                          onClick={() => {
                            setSelectionMode(!selectionMode);
                            setSelectedChapterIds([]);
                          }}
                        >
                          <ChecklistRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('writing.newChapter')}>
                        <IconButton size="small" color="primary" onClick={() => openDialog({ kind: 'new-chapter' })}>
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
                        <IconButton size="small" onClick={() => openDialog({ kind: 'move-volume-batch' })}>
                          <DriveFileMoveRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('nav.delete')}>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => openDialog({ kind: 'delete-chapters-batch' })}
                        >
                          <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                </>
              )}

              {leftTab === 'outline' && (
                <>
                  <Box
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5, px: 0.5 }}
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
                      {t('writing.tabOutline')}
                    </Typography>
                    <Tooltip title={t('writing.newOutline')}>
                      <IconButton size="small" color="primary" onClick={() => openDialog({ kind: 'new-outline' })}>
                        <AddRoundedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {outlines.map((o) => {
                    const boundChapter = o.chapterId ? chapters.find((c) => c.id === o.chapterId) : null;
                    return (
                      <Box
                        key={o.id}
                        sx={{
                          px: 1,
                          py: 0.75,
                          borderRadius: 1.5,
                          '&:hover': { bgcolor: 'action.hover' },
                          '& .row-actions': { opacity: 0 },
                          '&:hover .row-actions': { opacity: 1 },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <FlagRoundedIcon
                            sx={{ fontSize: 13, color: o.chapterId ? 'primary.main' : 'text.disabled', flexShrink: 0 }}
                          />
                          <Typography
                            noWrap
                            onClick={() => {
                              // 双向联动的大纲侧：已落章的节拍点击即跳章节
                              if (boundChapter) {
                                setActiveSetting(null);
                                setActiveChapter(boundChapter.id);
                              }
                            }}
                            title={boundChapter ? t('writing.outlineJumpHint') : undefined}
                            sx={{
                              fontSize: 12.5,
                              fontWeight: 600,
                              flex: 1,
                              minWidth: 0,
                              cursor: boundChapter ? 'pointer' : 'default',
                            }}
                          >
                            {o.title}
                            {boundChapter && (
                              <Box
                                component="span"
                                sx={{ color: 'primary.main', ml: 0.75, fontSize: 11, fontWeight: 400 }}
                              >
                                → {boundChapter.title}
                              </Box>
                            )}
                          </Typography>
                          <Box className="row-actions" sx={{ display: 'flex', transition: 'opacity 0.15s' }}>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDialog({ kind: 'rename-outline', outlineId: o.id }, o.title);
                              }}
                            >
                              <EditRoundedIcon sx={{ fontSize: 13 }} />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDialog({ kind: 'delete-outline', outlineId: o.id });
                              }}
                            >
                              <DeleteOutlineRoundedIcon sx={{ fontSize: 13 }} />
                            </IconButton>
                          </Box>
                        </Box>
                        <TextField
                          select
                          fullWidth
                          size="small"
                          label={t('writing.outlineBind')}
                          value={o.chapterId ?? ''}
                          onChange={(e) => {
                            void updateOutline(o.id, { chapterId: e.target.value || null }).catch((err) => {
                              logger.warn('WritingPage', 'bind outline failed', { error: err });
                              useToastStore.getState().error(String(err));
                            });
                          }}
                          sx={{ mt: 0.5, '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
                        >
                          <MenuItem value="">{t('writing.outlineUnbound')}</MenuItem>
                          {chapters.map((c) => (
                            <MenuItem key={c.id} value={c.id}>
                              {c.title}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          fullWidth
                          size="small"
                          multiline
                          minRows={1}
                          maxRows={4}
                          label={t('writing.outlineSummary')}
                          defaultValue={o.summary}
                          onBlur={(e) => {
                            if (e.target.value !== o.summary) {
                              void updateOutline(o.id, { summary: e.target.value }).catch((err) => {
                                logger.warn('WritingPage', 'save outline summary failed', { error: err });
                                useToastStore.getState().error(String(err));
                              });
                            }
                          }}
                          sx={{ mt: 0.5, '& .MuiInputBase-input': { fontSize: 12 } }}
                        />
                      </Box>
                    );
                  })}
                  {outlines.length === 0 && (
                    <Typography sx={{ fontSize: 11.5, color: 'text.disabled', textAlign: 'center', py: 2 }}>
                      {t('writing.emptyOutline')}
                    </Typography>
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
            </Box>
          </>
        )}
      </Paper>

      {/* ─── 右栏：正文编辑器 或 设定卡编辑 ─── */}
      <Paper
        variant="outlined"
        sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
      >
        {activeSetting ? (
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
                            color: '#b25e12',
                            fontSize: 11.5,
                            lineHeight: 1.4,
                          }}
                        >
                          <Box
                            component="span"
                            sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#d9822b', flexShrink: 0 }}
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
                            color: '#b25e12',
                            fontSize: 11.5,
                            lineHeight: 1.4,
                          }}
                        >
                          <Box
                            component="span"
                            sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#d9822b', flexShrink: 0 }}
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
                  <IconButton size="small" onClick={btn.onClick} sx={toolbarBtnSx(btn.active)}>
                    {btn.icon}
                  </IconButton>
                </Tooltip>
              ))}
              <Tooltip title={t('writing.typography.title')}>
                <IconButton size="small" onClick={(e) => setTypoAnchor(e.currentTarget)} sx={toolbarBtnSx(false)}>
                  <FormatSizeRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <Tooltip title={t('writing.prevChapter')}>
                <span>
                  <IconButton size="small" disabled={!hasPrevChapter} onClick={goPrevChapter} sx={toolbarBtnSx(false)}>
                    <NavigateBeforeRoundedIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('writing.nextChapter')}>
                <span>
                  <IconButton size="small" disabled={!hasNextChapter} onClick={goNextChapter} sx={toolbarBtnSx(false)}>
                    <NavigateNextRoundedIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={focusMode ? t('writing.exitFocus') : t('writing.focusMode')}>
                <IconButton size="small" onClick={() => setFocusMode((v) => !v)} sx={toolbarBtnSx(focusMode)}>
                  <ChromeReaderModeRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              {/* P2 性能：saveState 下沉本组件，800ms 翻转只重渲染这里 */}
              <SaveIndicator register={registerSaveIndicator} />
              <Tooltip title={t('writing.snapshots.title')}>
                <IconButton
                  size="small"
                  disabled={!activeChapter}
                  onClick={() => setSnapshotsOpen(true)}
                  sx={toolbarBtnSx(false)}
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
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setExportAnchor(null);
                    void handleExportEpub();
                  }}
                >
                  {t('writing.exportEpub')}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setExportAnchor(null);
                    void handleExportHtml();
                  }}
                >
                  {t('writing.exportHtml')}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setExportAnchor(null);
                    void handleExportText();
                  }}
                >
                  {t('writing.exportText')}
                </MenuItem>
              </Menu>
              <Tooltip title={t('writing.shortcutsTitle')}>
                <IconButton size="small" onClick={() => setHelpOpen(true)} sx={toolbarBtnSx(false)}>
                  <KeyboardRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.aiReview')}>
                <IconButton size="small" color="primary" onClick={() => void handleOpenAiDialog()}>
                  <AutoAwesomeRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.aiChatTitle')}>
                <IconButton size="small" color="primary" onClick={() => setChatOpen(true)}>
                  <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.autoReview')}>
                <IconButton size="small" disabled={!activeBook} onClick={() => setAutoDialogOpen(true)}>
                  <AutoModeRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.findReplace')}>
                <IconButton size="small" disabled={!activeChapter} onClick={() => setFrOpen(true)}>
                  <FindInPageRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.inlineContinue')}>
                <IconButton
                  size="small"
                  disabled={!activeBook || !activeChapter}
                  onClick={() => openInlineDialog('continue')}
                >
                  <NotesRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('writing.inlinePolish')}>
                <IconButton
                  size="small"
                  disabled={!activeBook || !activeChapter}
                  onClick={() => openInlineDialog('polish')}
                >
                  <AutoFixHighRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
            </Box>
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
            <Box ref={editorScrollRef} sx={editorBodySx}>
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
      </Paper>

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
      {/* ─── AI 审视对话框：预设 + Agent 均由用户选择 ─── */}
      <Dialog open={aiDialogOpen} onClose={() => setAiDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15 }}>{t('writing.aiReview')}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <FormLabel sx={{ fontSize: 13 }}>{t('writing.aiPreset')}</FormLabel>
            <RadioGroup value={aiPresetKey} onChange={(e) => setAiPresetKey(e.target.value)}>
              {writingPresets.map((p) => (
                <FormControlLabel
                  key={p.key}
                  value={p.key}
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{pickLang(p.title)}</Typography>
                      <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                        {pickLang(p.description)}
                      </Typography>
                    </Box>
                  }
                />
              ))}
            </RadioGroup>
          </FormControl>
          <FormControl fullWidth sx={{ mt: 1.5 }}>
            <FormLabel sx={{ fontSize: 13 }}>{t('writing.aiAgent')}</FormLabel>
            {agents.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{t('writing.aiNoAgent')}</Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setAiDialogOpen(false);
                    goAiSettings();
                  }}
                >
                  {t('writing.aiGoConfigure')}
                </Button>
              </Box>
            ) : (
              <RadioGroup value={aiAgentId} onChange={(e) => setAiAgentId(e.target.value)}>
                {agents.map((agent: AiAgent) => (
                  <FormControlLabel
                    key={agent.id}
                    value={agent.id}
                    control={<Radio size="small" />}
                    label={<Typography sx={{ fontSize: 13.5 }}>{agent.name}</Typography>}
                  />
                ))}
              </RadioGroup>
            )}
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setAiDialogOpen(false)}>
            {t('nav.cancel')}
          </Button>
          {/* A-2 闭环：不发射也能随时翻看历史审阅结论 */}
          <Button
            size="small"
            disabled={!activeBook}
            onClick={() => {
              setAiDialogOpen(false);
              setInsightsDialogOpen(true);
            }}
          >
            {t('writing.insightView')}
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!aiPresetKey || !aiAgentId || aiLaunching || agents.length === 0}
            onClick={() => void handleLaunchAi()}
            startIcon={aiLaunching ? <CircularProgress size={14} /> : undefined}
          >
            {t('writing.aiLaunch')}
          </Button>
        </DialogActions>
      </Dialog>
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
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>{t('writing.shortcutsTitle')}</DialogTitle>
        <DialogContent dividers>
          {(
            [
              ['⌘[', 'writing.prevChapter'],
              ['⌘]', 'writing.nextChapter'],
              ['⌘S', 'writing.shortcutSave'],
              ['⌘F', 'writing.shortcutFind'],
              ['⌘K', 'writing.shortcutJump'],
            ] as const
          ).map(([key, labelKey]) => (
            <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 0.75 }}>
              <Typography
                component="span"
                sx={{
                  fontSize: 11.5,
                  fontFamily: 'monospace',
                  px: 1,
                  py: 0.25,
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'action.hover',
                  minWidth: 44,
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                {key}
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{t(labelKey)}</Typography>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setHelpOpen(false)}>
            {t('nav.cancel')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* ─── 批次④ 章节版本快照：切章自动存 + 手动存，可恢复 ─── */}
      <ChapterSnapshotsDialog
        open={snapshotsOpen}
        onClose={() => setSnapshotsOpen(false)}
        chapterId={activeChapterId}
        onManualSnapshot={handleManualSnapshot}
        onRestore={handleRestoreSnapshot}
      />
      {/* ─── 人物出场图谱（原实体图鉴迁入）：章节 × 设定出场热力矩阵，点击跳正文 ─── */}
      <Dialog open={appearanceOpen} onClose={() => setAppearanceOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1.5 }}>
          <Typography variant="h6" sx={{ fontSize: 15, fontWeight: 700 }}>
            {t('writing.appearanceMap.title')}
          </Typography>
          <IconButton size="small" onClick={() => setAppearanceOpen(false)}>
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
          // 批次 2（章头图）：选中的素材设为某章的章头图
          const coverSetter = useAssetPickerStore.getState().chapterCoverSetter;
          if (coverSetter) {
            coverSetter(asset);
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
      <Dialog
        open={inlineDialogOpen}
        onClose={() => {
          if (!inlineRunning) setInlineDialogOpen(false);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 15 }}>{t('writing.inlineAi')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5, mb: 1 }}>
            {t('writing.inlineHint')}
          </Typography>
          {/* B 选区级润色：打开时已选中文本 → 明示本次只改选区 */}
          {inlineKind === 'polish' && inlineSelChars > 0 && (
            <Typography sx={{ fontSize: 12, color: 'primary.main', mb: 1 }}>
              {t('writing.inlineSelectionHint', { n: inlineSelChars })}
            </Typography>
          )}
          <FormControl fullWidth sx={{ mb: 1.5 }}>
            <FormLabel sx={{ fontSize: 13 }}>{t('writing.inlineMode')}</FormLabel>
            <RadioGroup row value={inlineKind} onChange={(e) => setInlineKind(e.target.value as InlineWritingKind)}>
              <FormControlLabel value="continue" control={<Radio size="small" />} label={t('writing.inlineContinue')} />
              <FormControlLabel value="polish" control={<Radio size="small" />} label={t('writing.inlinePolish')} />
            </RadioGroup>
          </FormControl>
          <FormControl fullWidth>
            <FormLabel sx={{ fontSize: 13 }}>{t('writing.aiAgent')}</FormLabel>
            {agents.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{t('writing.aiNoAgent')}</Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setInlineDialogOpen(false);
                    goAiSettings();
                  }}
                >
                  {t('writing.aiGoConfigure')}
                </Button>
              </Box>
            ) : (
              <RadioGroup value={inlineAgentId} onChange={(e) => setInlineAgentId(e.target.value)}>
                {agents.map((agent: AiAgent) => (
                  <FormControlLabel
                    key={agent.id}
                    value={agent.id}
                    control={<Radio size="small" />}
                    label={<Typography sx={{ fontSize: 13.5 }}>{agent.name}</Typography>}
                  />
                ))}
              </RadioGroup>
            )}
          </FormControl>
          {/* P8 参数化：续写 → 字数/走向；润色 → 风格档 */}
          {inlineKind === 'continue' ? (
            <>
              <TextField
                fullWidth
                size="small"
                type="number"
                label={t('writing.continueWords')}
                value={inlineWords}
                onChange={(e) => setInlineWords(e.target.value)}
                sx={{ mt: 1.5, '& .MuiInputBase-input': { fontSize: 12.5 } }}
              />
              <TextField
                fullWidth
                size="small"
                multiline
                minRows={2}
                maxRows={4}
                label={t('writing.continueDirective')}
                placeholder={t('writing.continueDirectivePh')}
                value={inlineDirective}
                onChange={(e) => setInlineDirective(e.target.value)}
                sx={{ mt: 1.5, '& .MuiInputBase-input': { fontSize: 12.5 } }}
              />
            </>
          ) : (
            <FormControl fullWidth sx={{ mt: 1.5 }}>
              <FormLabel sx={{ fontSize: 13 }}>{t('writing.polishStyle')}</FormLabel>
              <RadioGroup row value={inlineStyle} onChange={(e) => setInlineStyle(e.target.value as PolishStyle)}>
                <FormControlLabel
                  value="default"
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 12.5 }}>{t('writing.styleDefault')}</Typography>}
                />
                <FormControlLabel
                  value="refine"
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 12.5 }}>{t('writing.styleRefine')}</Typography>}
                />
                <FormControlLabel
                  value="vivid"
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 12.5 }}>{t('writing.styleVivid')}</Typography>}
                />
                <FormControlLabel
                  value="plain"
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 12.5 }}>{t('writing.stylePlain')}</Typography>}
                />
              </RadioGroup>
            </FormControl>
          )}
        </DialogContent>
        {/* C 流式预览：运行中边生成边看（auto-scroll 跟底），可中途停止 */}
        {inlineRunning && (
          <Box sx={{ px: 2, pb: 0.5 }}>
            {inlineStreamText ? (
              <Box
                ref={streamPreviewRef}
                sx={{
                  maxHeight: 220,
                  overflowY: 'auto',
                  bgcolor: 'action.hover',
                  borderRadius: 1.5,
                  p: 1.25,
                }}
              >
                <Typography sx={{ fontSize: 12.5, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                  {inlineStreamText}
                </Typography>
              </Box>
            ) : (
              <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center', py: 1 }}>
                {t('writing.inlineStreamingHint')}
              </Typography>
            )}
            <Button
              size="small"
              fullWidth
              color="error"
              sx={{ mt: 0.5 }}
              onClick={() => useAgentStore.getState().requestInterrupt()}
            >
              {t('writing.inlineStop')}
            </Button>
          </Box>
        )}
        <DialogActions>
          <Button size="small" disabled={inlineRunning} onClick={() => setInlineDialogOpen(false)}>
            {t('nav.cancel')}
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!inlineAgentId || inlineRunning || agents.length === 0}
            onClick={() => void handleRunInline()}
            startIcon={inlineRunning ? <CircularProgress size={14} /> : undefined}
          >
            {inlineRunning ? t('writing.inlineRunning') : t('nav.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* ─── 查找替换（P9）：当前章节内，替换全部走一次事务（触发既有防抖自动保存） ─── */}
      <Dialog open={frOpen} onClose={() => setFrOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15 }}>{t('writing.findReplace')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t('writing.findText')}
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            sx={{ mt: 1 }}
          />
          <TextField
            fullWidth
            size="small"
            label={t('writing.replaceText')}
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            sx={{ mt: 1.5 }}
          />
          {findText.trim() && editor && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5 }}>
              {t('writing.matchCount', { n: findMatches(editor, findText).length })}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setFrOpen(false)}>
            {t('nav.cancel')}
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!findText.trim() || !editor || findMatches(editor, findText).length === 0}
            onClick={() => {
              if (!editor) return;
              const n = replaceAllMatches(editor, findText, replaceText);
              setFrOpen(false);
              useToastStore.getState().success(t('writing.replacedCount', { n }));
            }}
          >
            {t('writing.replaceAll')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* ─── 内联 AI 结果预览：用户确认后才动正文，绝无静默改写 ─── */}
      <Dialog open={inlineResult !== null} onClose={() => setInlineResult(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 15 }}>
          {inlineResult?.kind === 'continue' ? t('writing.resultContinueTitle') : t('writing.resultPolishTitle')}
          {inlineResult?.kind === 'polish' && inlineResult.selectionChars != null && (
            <Typography component="span" sx={{ fontSize: 12, fontWeight: 400, color: 'text.secondary', ml: 1 }}>
              {t('writing.resultReplaceSelection', { n: inlineResult.selectionChars })}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ maxHeight: 420, overflowY: 'auto', bgcolor: 'action.hover', borderRadius: 1.5, p: 1.5 }}>
            <Typography sx={{ fontSize: 13.5, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>
              {inlineResult?.text}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setInlineResult(null)}>
            {t('writing.discard')}
          </Button>
          <Button size="small" variant="contained" onClick={handleApplyInlineResult}>
            {inlineResult?.kind === 'continue' ? t('writing.insertToChapter') : t('writing.applyToChapter')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* ─── P3 排版面板：字号/行距/段距/首行缩进/页宽/纸色，per-book 持久化 ─── */}
      <Popover
        open={typoAnchor !== null}
        anchorEl={typoAnchor}
        onClose={() => setTypoAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, width: 264, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              color: 'text.secondary',
            }}
          >
            {t('writing.typography.title')}
          </Typography>

          <Box>
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mb: 0.25 }}>
              {t('writing.typography.fontSize', { n: typo.fontSize })}
            </Typography>
            <Slider
              size="small"
              min={14}
              max={22}
              step={1}
              value={typo.fontSize}
              marks
              valueLabelDisplay="auto"
              onChange={(_, v) => setTypo({ fontSize: v as number })}
            />
          </Box>

          <TextField
            select
            size="small"
            fullWidth
            label={t('writing.typography.lineHeight')}
            value={typo.lineHeight}
            onChange={(e) => setTypo({ lineHeight: Number(e.target.value) })}
          >
            <MenuItem value={1.6}>1.6</MenuItem>
            <MenuItem value={1.9}>1.9</MenuItem>
            <MenuItem value={2.2}>2.2</MenuItem>
          </TextField>

          <TextField
            select
            size="small"
            fullWidth
            label={t('writing.typography.paraSpacing')}
            value={typo.paraSpacing}
            onChange={(e) => setTypo({ paraSpacing: Number(e.target.value) })}
          >
            <MenuItem value={0}>{t('writing.typography.paraNone')}</MenuItem>
            <MenuItem value={0.5}>{t('writing.typography.paraSmall')}</MenuItem>
            <MenuItem value={1}>{t('writing.typography.paraMedium')}</MenuItem>
            <MenuItem value={1.5}>{t('writing.typography.paraLarge')}</MenuItem>
          </TextField>

          <TextField
            select
            size="small"
            fullWidth
            label={t('writing.typography.pageWidth')}
            value={typo.pageWidth}
            onChange={(e) => setTypo({ pageWidth: Number(e.target.value) })}
          >
            <MenuItem value={620}>{t('writing.typography.widthNarrow')}</MenuItem>
            <MenuItem value={760}>{t('writing.typography.widthMedium')}</MenuItem>
            <MenuItem value={900}>{t('writing.typography.widthWide')}</MenuItem>
          </TextField>

          <TextField
            select
            size="small"
            fullWidth
            label={t('writing.typography.paper')}
            value={typo.paper}
            onChange={(e) => setTypo({ paper: e.target.value as BookTypography['paper'] })}
          >
            <MenuItem value="default">{t('writing.typography.paperDefault')}</MenuItem>
            <MenuItem value="sepia">{t('writing.typography.paperSepia')}</MenuItem>
            <MenuItem value="green">{t('writing.typography.paperGreen')}</MenuItem>
          </TextField>

          <FormControlLabel
            control={
              <Switch size="small" checked={typo.indent} onChange={(e) => setTypo({ indent: e.target.checked })} />
            }
            label={<Typography sx={{ fontSize: 12.5 }}>{t('writing.typography.indent')}</Typography>}
            sx={{ mr: 0 }}
          />
        </Box>
      </Popover>
    </Box>
  );
}
