import { useState, useEffect, useRef } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Tooltip from '@mui/material/Tooltip';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SearchIcon from '@mui/icons-material/Search';
import StopIcon from '@mui/icons-material/Stop';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import LinkIcon from '@mui/icons-material/Link';
import LayersIcon from '@mui/icons-material/Layers';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import BuildIcon from '@mui/icons-material/Build';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import BlockIcon from '@mui/icons-material/Block';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import HubIcon from '@mui/icons-material/Hub';
import InsightsIcon from '@mui/icons-material/Insights';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import GppMaybeIcon from '@mui/icons-material/GppMaybe';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import GridViewIcon from '@mui/icons-material/GridView';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AutoAwesomeMosaicIcon from '@mui/icons-material/AutoAwesomeMosaic';
import CodeIcon from '@mui/icons-material/Code';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import WaterfallChartIcon from '@mui/icons-material/WaterfallChart';
import VerifiedIcon from '@mui/icons-material/Verified';
import SecurityIcon from '@mui/icons-material/Security';
import ApiIcon from '@mui/icons-material/Api';
import CoronavirusIcon from '@mui/icons-material/Coronavirus';
import GroupsIcon from '@mui/icons-material/Groups';
import ShareIcon from '@mui/icons-material/Share';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import BugReportIcon from '@mui/icons-material/BugReport';
import TerminalIcon from '@mui/icons-material/Terminal';
import CommentIcon from '@mui/icons-material/Comment';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import TuneIcon from '@mui/icons-material/Tune';
import Chip from '@mui/material/Chip';
import { open } from '@tauri-apps/plugin-dialog';
import { SceneEditor } from '../editor/SceneEditor';
import { useSceneStore } from '../store/sceneStore';
import { useWritingStore } from '../store/writingStore';
import { useProjectStore } from '../store/projectStore';
import { projectScanApi, spawnCodeWorkbench, writingScanApi, type AssetInfo } from '../services/tauri';
import { createBookNamed, importBookFromDialog, openBookInStudio, parseBookIdFromRoot } from '../utils/studioBook';
import { genreLabelKey, mediumLabelKey, genreDef } from '../utils/writingSchema';
import { NewBookDialog, type NewBookResult } from './NewBookDialog';
import { openWritingDesk as openWritingDeskWindow } from '../utils/writingDeskWindow';
import { buildBookOverview } from '../utils/bookOverview';
import { buildRelationBoard, buildStoryboard } from '../utils/writingBoards';
import { AssetLibraryDialog } from '../editor/panels/AssetLibraryDialog';
import { CanvasAiDialog } from '../editor/panels/CanvasAiDialog';
import { useAssetPickerStore } from '../store/assetPickerStore';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEditorStore, useDirtyStore, type BulkComponentInput } from '../store/editorStore';
import { ArchitectureLayersPanel } from '../editor/panels/ArchitectureLayersPanel';
import { ScanEmptyState } from './ScanEmptyState';
import { useToastStore } from '../store/toastStore';
import {
  activateAnalyzerForLanguage,
  activateAnalyzersForLanguages,
  syncPluginRulesToBackend,
} from '../editor/analyzer';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import ViewCarouselIcon from '@mui/icons-material/ViewCarousel';
import { buildFileInsights, emptyFileInsight } from '../editor/utils/fileInsights';
import { buildTreeLayout } from '../editor/utils/syncLayout';
import { entityTypeForFile } from '../editor/utils/fileKind';
import { runPortrait, type PortraitKind } from '../editor/utils/portraits';
import { CommandPalette, type WorkbenchCommand } from '../editor/panels/CommandPalette';
import { t, getLang } from '../i18n';
import { formatBigCount } from '../utils/formatCount';
import { PORTRAIT_ICON_COLORS, PORTRAIT_FALLBACK_COLOR, WATCHING_STATUS_COLOR } from '../theme/categoryColors';

/**
 * 写作预设画板（H1/H5）
 *
 * 书=场景之后，画布不再是目录树，而是一组「预设板」：
 *   全书总览 = 体量读法（人物列 + 章节网格）；
 *   分镜板   = 顺序读法（横向时间轴，一章一格镜头）；
 *   关系板   = 结构读法（设定卡共现图）。
 * 每块板一个专属视图，按名幂等，用户可在板之间自由切换且各自保留手改布局。
 */
type BookBoardKind = 'overview' | 'storyboard' | 'relation';
const BOARD_LABEL: Record<BookBoardKind, string> = {
  overview: 'editorPage.bookOverview.viewName',
  storyboard: 'editorPage.board.storyboard.viewName',
  relation: 'editorPage.board.relation.viewName',
};

/** 预设画板菜单项（与「更多画像」同一套 ListItemIcon + 说明文案的样式） */
const BOARD_MENU: {
  kind: BookBoardKind;
  labelKey: string;
  descKey: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  {
    kind: 'overview',
    labelKey: 'editorPage.board.overview.label',
    descKey: 'editorPage.board.overview.desc',
    icon: <AccountTreeIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.violet,
  },
  {
    kind: 'storyboard',
    labelKey: 'editorPage.board.storyboard.label',
    descKey: 'editorPage.board.storyboard.desc',
    icon: <ViewCarouselIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.violet,
  },
  {
    kind: 'relation',
    labelKey: 'editorPage.board.relation.label',
    descKey: 'editorPage.board.relation.desc',
    icon: <HubIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.amber,
  },
];

/**
 * 画像菜单（顶部工具栏「更多画像」）
 *
 * 九种画像原本平铺成九个按钮，工具栏挤到换行还看不出分类。
 * 这里按「结构 / 质量」两组收进下拉：结构组回答"项目长什么样"，
 * 质量组回答"哪里有问题"。每项都带一句人话说明，避免只有名字猜不到用途。
 */
const PORTRAIT_MENU: {
  key: string;
  labelKey: string;
  descKey?: string;
  kind?: PortraitKind;
  icon?: React.ReactNode;
  color?: string;
  divider?: boolean;
}[] = [
  { key: 'h1', labelKey: 'editorPage.portrait.h1', divider: true },
  {
    key: 'directory',
    kind: 'directory',
    labelKey: 'editorPage.portrait.directory.label',
    descKey: 'editorPage.portrait.directory.desc',
    icon: <FolderSpecialIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.amber,
  },
  {
    key: 'moduleGraph',
    kind: 'moduleGraph',
    labelKey: 'editorPage.portrait.moduleGraph.label',
    descKey: 'editorPage.portrait.moduleGraph.desc',
    icon: <HubIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.violet,
  },
  {
    key: 'symbols',
    kind: 'symbols',
    labelKey: 'editorPage.portrait.symbols.label',
    descKey: 'editorPage.portrait.symbols.desc',
    icon: <CodeIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.blue,
  },
  {
    key: 'dependency',
    kind: 'dependency',
    labelKey: 'editorPage.portrait.dependency.label',
    descKey: 'editorPage.portrait.dependency.desc',
    icon: <AccountTreeIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.indigo,
  },
  {
    key: 'changeCoupling',
    kind: 'changeCoupling',
    labelKey: 'editorPage.portrait.changeCoupling.label',
    descKey: 'editorPage.portrait.changeCoupling.desc',
    icon: <LinkIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.amber,
  },
  {
    key: 'coupling',
    kind: 'coupling',
    labelKey: 'editorPage.portrait.coupling.label',
    descKey: 'editorPage.portrait.coupling.desc',
    icon: <ScatterPlotIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.fuchsia,
  },
  {
    key: 'layering',
    kind: 'layering',
    labelKey: 'editorPage.portrait.layering.label',
    descKey: 'editorPage.portrait.layering.desc',
    icon: <LayersIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.sky,
  },
  {
    key: 'architecture',
    kind: 'architecture',
    labelKey: 'editorPage.portrait.architecture.label',
    descKey: 'editorPage.portrait.architecture.desc',
    icon: <AccountTreeIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.indigo,
  },
  {
    key: 'callGraph',
    kind: 'callGraph',
    labelKey: 'editorPage.portrait.callGraph.label',
    descKey: 'editorPage.portrait.callGraph.desc',
    icon: <HubIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.violet,
  },
  {
    key: 'dataFlow',
    kind: 'dataFlow',
    labelKey: 'editorPage.portrait.dataFlow.label',
    descKey: 'editorPage.portrait.dataFlow.desc',
    icon: <WaterfallChartIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.teal,
  },
  {
    key: 'executionFlow',
    kind: 'executionFlow',
    labelKey: 'editorPage.portrait.executionFlow.label',
    descKey: 'editorPage.portrait.executionFlow.desc',
    icon: <AccountTreeIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.green,
  },
  {
    key: 'apiTrace',
    kind: 'apiTrace',
    labelKey: 'editorPage.portrait.apiTrace.label',
    descKey: 'editorPage.portrait.apiTrace.desc',
    icon: <ApiIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.blue,
  },
  {
    key: 'taintFlow',
    kind: 'taintFlow',
    labelKey: 'editorPage.portrait.taintFlow.label',
    descKey: 'editorPage.portrait.taintFlow.desc',
    icon: <CoronavirusIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.red,
  },
  {
    key: 'patterns',
    kind: 'patterns',
    labelKey: 'editorPage.portrait.patterns.label',
    descKey: 'editorPage.portrait.patterns.desc',
    icon: <AutoAwesomeMosaicIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.cyan,
  },
  { key: 'h2', labelKey: 'editorPage.portrait.h2', divider: true },
  {
    key: 'hotspotFunctions',
    kind: 'hotspotFunctions',
    labelKey: 'editorPage.portrait.hotspotFunctions.label',
    descKey: 'editorPage.portrait.hotspotFunctions.desc',
    icon: <LocalFireDepartmentIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.red,
  },
  {
    key: 'quadrant',
    kind: 'quadrant',
    labelKey: 'editorPage.portrait.quadrant.label',
    descKey: 'editorPage.portrait.quadrant.desc',
    icon: <GridViewIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.purple,
  },
  {
    key: 'complexity',
    kind: 'complexity',
    labelKey: 'editorPage.portrait.complexity.label',
    descKey: 'editorPage.portrait.complexity.desc',
    icon: <WhatshotIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.orange,
  },
  {
    key: 'risk',
    kind: 'risk',
    labelKey: 'editorPage.portrait.risk.label',
    descKey: 'editorPage.portrait.risk.desc',
    icon: <GppMaybeIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.red,
  },
  {
    key: 'techDebt',
    kind: 'techDebt',
    labelKey: 'editorPage.portrait.techDebt.label',
    descKey: 'editorPage.portrait.techDebt.desc',
    icon: <BuildIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.amber,
  },
  {
    key: 'churn',
    kind: 'churn',
    labelKey: 'editorPage.portrait.churn.label',
    descKey: 'editorPage.portrait.churn.desc',
    icon: <TrendingUpIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.pink,
  },
  {
    key: 'duplication',
    kind: 'duplication',
    labelKey: 'editorPage.portrait.duplication.label',
    descKey: 'editorPage.portrait.duplication.desc',
    icon: <ContentCopyIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.teal,
  },
  {
    key: 'deadCode',
    kind: 'deadCode',
    labelKey: 'editorPage.portrait.deadCode.label',
    descKey: 'editorPage.portrait.deadCode.desc',
    icon: <BlockIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.slate,
  },
  {
    key: 'syntax',
    kind: 'syntax',
    labelKey: 'editorPage.portrait.syntax.label',
    descKey: 'editorPage.portrait.syntax.desc',
    icon: <ErrorOutlinedIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.red,
  },
  { key: 'h3', labelKey: 'editorPage.portrait.h3', divider: true },
  {
    key: 'testCoverage',
    kind: 'testCoverage',
    labelKey: 'editorPage.portrait.testCoverage.label',
    descKey: 'editorPage.portrait.testCoverage.desc',
    icon: <VerifiedIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.green,
  },
  {
    key: 'security',
    kind: 'security',
    labelKey: 'editorPage.portrait.security.label',
    descKey: 'editorPage.portrait.security.desc',
    icon: <SecurityIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.red,
  },
  {
    key: 'apiSurface',
    kind: 'apiSurface',
    labelKey: 'editorPage.portrait.apiSurface.label',
    descKey: 'editorPage.portrait.apiSurface.desc',
    icon: <ApiIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.cyan,
  },
  {
    key: 'busFactor',
    kind: 'busFactor',
    labelKey: 'editorPage.portrait.busFactor.label',
    descKey: 'editorPage.portrait.busFactor.desc',
    icon: <GroupsIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.fuchsia,
  },
  {
    key: 'ripple',
    kind: 'ripple',
    labelKey: 'editorPage.portrait.ripple.label',
    descKey: 'editorPage.portrait.ripple.desc',
    icon: <ShareIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.sky,
  },
  {
    key: 'docsCoverage',
    kind: 'docsCoverage',
    labelKey: 'editorPage.portrait.docsCoverage.label',
    descKey: 'editorPage.portrait.docsCoverage.desc',
    icon: <MenuBookIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.amber,
  },
  {
    key: 'errorHandling',
    kind: 'errorHandling',
    labelKey: 'editorPage.portrait.errorHandling.label',
    descKey: 'editorPage.portrait.errorHandling.desc',
    icon: <BugReportIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.orange,
  },
  {
    key: 'logging',
    kind: 'logging',
    labelKey: 'editorPage.portrait.logging.label',
    descKey: 'editorPage.portrait.logging.desc',
    icon: <TerminalIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.slate,
  },
  {
    key: 'commentRatio',
    kind: 'commentRatio',
    labelKey: 'editorPage.portrait.commentRatio.label',
    descKey: 'editorPage.portrait.commentRatio.desc',
    icon: <CommentIcon sx={{ fontSize: 17 }} />,
    color: PORTRAIT_ICON_COLORS.teal,
  },
];

/** 时间戳友好化（秒 / 毫秒都兼容）→「9月22日」。 */
function fmtUpdated(ts: number): string {
  if (!ts) return '';
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function SceneEditorPage() {
  const activeSceneId = useSceneStore((s) => s.activeSceneId);
  const scenes = useSceneStore((s) => s.scenes);
  const updateScene = useSceneStore((s) => s.updateScene);

  const activeScene = scenes.find((s) => s.id === activeSceneId) ?? null;

  // 语境判定（H1/G1）：书=场景（primaryLanguage === "novel-zh"）→ 工作室整体切换到
  // 作品语境：画布生成全书总览、顶栏隐藏代码扫描/监视/画像入口、解析走写作链路。
  const isBookScene = activeScene?.primaryLanguage === 'novel-zh';

  // ─── 扫描状态 ───
  const scanning = useProjectStore((s) => s.scanning);
  const scanIncremental = useProjectStore((s) => s.scanIncremental);
  const scanChangedCount = useProjectStore((s) => s.scanChangedCount);
  const files = useProjectStore((s) => s.files);
  // 书场景顶栏「行2」的作品身份：**取活的 book 记录**，不取场景快照。
  // 场景 name / totalLines 是建场景时写死的一次性快照（openBookInStudio 仅在「场景不存在」
  // 分支写 name），改名 / 改体裁后不跟随 —— 与 L1 页签用的 live book.title 会不一致（看着像写死）。
  // 这里订阅 books，按活动场景 projectRoot 反解 bookId，书名 / 体裁 / 载体全部跟随切换与改名。
  const books = useWritingStore((s) => s.books);
  const activeBookId = parseBookIdFromRoot(activeScene?.projectRoot);
  const activeBook = activeBookId ? (books.find((b) => b.id === activeBookId) ?? null) : null;
  const activeBookGenreColor = genreDef(activeBook?.genre ?? '')?.color ?? PORTRAIT_FALLBACK_COLOR;
  // 作品身份 = 唯一标识，必须完整可读：书名是行2 里信息优先级最高的元素，
  // 绝不能被后续 chip / 统计挤到省略号（旧实现 flex-shrink 默认 1 会被中间都吃掉）。
  const activeBookName = activeBook?.title ?? activeScene?.name ?? '';
  // 章数 / 字数也走活数据：非目录文件 = 章节；书场景里 file.size = 该章字数（见 writingBoards）。
  // 用 files（每次 openBookInStudio 都按当前书重载）而非 activeScene.totalFiles/totalLines 快照。
  const bookChapters = files.filter((f) => !f.isDirectory);
  const bookWords = bookChapters.reduce((sum, f) => sum + (f.size || 0), 0);
  // 顶栏响应式：窗口窄到放不下文字标签时收起文字只留图标（图标 + Tooltip 已表意），
  // 避免按钮被压缩后文字在按钮内部断行（难看）。阈值取窗口宽度 ≤1280px，使文字模式覆盖更宽范围；
  // 配合 tauri.conf.json 的 minWidth=960（≤1280 一律图标模式），窗口永远缩不到文字会换行的宽度。
  const compact = useMediaQuery('(max-width: 1280px)');
  const findings = useProjectStore((s) => s.findings);
  const layers = useProjectStore((s) => s.layers);
  const scan = useProjectStore((s) => s.scan);
  const cancelScan = useProjectStore((s) => s.cancelScan);
  const loadAll = useProjectStore((s) => s.loadAll);
  // 扫描新鲜度体检结果（check_scan_freshness）：数据是否过时、变更文件清单
  const scanFreshness = useProjectStore((s) => s.scanFreshness);
  const scanFreshnessChecking = useProjectStore((s) => s.scanFreshnessChecking);

  // ─── 文件变更监视 ───
  const watching = useProjectStore((s) => s.watching);
  const watchAnalysisId = useProjectStore((s) => s.watchAnalysisId);
  const recentChanges = useProjectStore((s) => s.recentChanges);
  const lastChangeEvent = useProjectStore((s) => s.lastChangeEvent);
  const startWatching = useProjectStore((s) => s.startWatching);
  const stopWatching = useProjectStore((s) => s.stopWatching);
  const clearChanges = useProjectStore((s) => s.clearChanges);

  // 十四阶段分析完成标志（用于统一扫描进度条的分段指示）
  const structureAnalyzed = useProjectStore((s) => s.structureAnalyzed);
  const depsAnalyzed = useProjectStore((s) => s.depsAnalyzed);
  const refsAnalyzed = useProjectStore((s) => s.refsAnalyzed);
  const callGraphAnalyzed = useProjectStore((s) => s.callGraphAnalyzed);
  const dataFlowAnalyzed = useProjectStore((s) => s.dataFlowAnalyzed);
  const metricsAnalyzed = useProjectStore((s) => s.metricsAnalyzed);
  const techDebtAnalyzed = useProjectStore((s) => s.techDebtAnalyzed);
  const clonesAnalyzed = useProjectStore((s) => s.clonesAnalyzed);
  const gitAnalyzed = useProjectStore((s) => s.gitAnalyzed);
  const couplingAnalyzed = useProjectStore((s) => s.couplingAnalyzed);
  const deadCodeAnalyzed = useProjectStore((s) => s.deadCodeAnalyzed);
  const codeIndexed = useProjectStore((s) => s.codeIndexed);
  const reviewAnalyzed = useProjectStore((s) => s.reviewAnalyzed);
  const findingsCount = useProjectStore((s) => s.findings.length);

  /** 后端扫描覆盖报告（暴露语言盲区 / 已排除目录 / 增量变更） */
  type ScanCoverage = {
    files: number;
    lines: number;
    languages: { language: string; count: number }[];
    deepUnsupported: number;
    excludedDirs: number;
    changed?: number;
    unchanged?: number;
  };

  const [currentJob, setCurrentJob] = useState<{
    progress: number;
    filesScanned: number;
    totalFiles: number;
    stage?: string;
    stageIndex?: number;
    totalStages?: number;
    message?: string;
    coverage?: ScanCoverage | null;
    startedAt?: number;
  } | null>(null);

  // ─── 统一命令面板（对标 Zed command_palette：全局动作注册表，分析页也有 Cmd+Shift+P）───
  // 参考 zed-main/crates/command_palette：动作注册表驱动、可搜索、覆盖「项目 / 视图 / 画像」全动作。
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        setCmdPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 订阅后端实时扫描事件：scan-progress（阶段进度）/ scan-coverage（覆盖报告）
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;
    (async () => {
      const u1 = await listen<{
        stage: string;
        stageIndex: number;
        totalStages: number;
        percent: number;
        scanned: number;
        total: number;
        message: string;
      }>('scan-progress', (e) => {
        if (!useProjectStore.getState().scanning) return;
        setCurrentJob((prev) =>
          prev
            ? {
                ...prev,
                progress: e.payload.percent,
                stage: e.payload.stage,
                stageIndex: e.payload.stageIndex,
                totalStages: e.payload.totalStages,
                message: e.payload.message,
                filesScanned: e.payload.scanned,
                totalFiles: e.payload.total,
              }
            : prev,
        );
        // 同步一份到 projectStore，供画布骨架屏（ProjectCanvas）直接订阅实时进度
        useProjectStore.getState().setScanProgress({
          stage: e.payload.stage,
          percent: e.payload.percent,
          scanned: e.payload.scanned,
          total: e.payload.total,
          message: e.payload.message,
        });
      });
      const u2 = await listen<ScanCoverage>('scan-coverage', (e) => {
        setCurrentJob((prev) => (prev ? { ...prev, coverage: e.payload } : prev));
      });
      if (!cancelled) unlisteners.push(u1, u2);
      else {
        u1();
        u2();
      }
    })();
    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, []);

  const [layersDialogOpen, setLayersDialogOpen] = useState(false);
  // 同步到画布进行中：清空→重建实体是 CPU 阻塞操作，期间画布显示骨架屏而非空白闪烁
  const [syncing, setSyncing] = useState(false);
  const [portraitAnchor, setPortraitAnchor] = useState<null | HTMLElement>(null);
  const showToast = useToastStore((s) => s.showToast);

  // v2.37 重构四象限文件名检索：当激活视图是象限画像时，提供检索框把散点收敛到「用户要找的文件」。
  // isQuadrantView 用派生布尔选择器，仅在该布尔翻转时重渲染；quadSearchRef 防止视图刚打开
  // （quadSearch 初始 ""）时误触发一次重算闪烁。
  const isQuadrantView = useEditorStore((s) =>
    s.components.some((c) => (c.config as Record<string, unknown> | undefined)?.portraitMode === 'quadrant'),
  );
  const [quadSearch, setQuadSearch] = useState('');
  const quadSearchRef = useRef('');
  useEffect(() => {
    if (!isQuadrantView || !activeSceneId) return;
    if (quadSearchRef.current === quadSearch) return;
    quadSearchRef.current = quadSearch;
    const id = window.setTimeout(() => {
      void runPortrait('quadrant', activeSceneId, undefined, activeScene?.projectRoot, {
        nameFilter: quadSearch,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [quadSearch, isQuadrantView, activeSceneId, activeScene?.projectRoot]);

  // ─── 扫描设置（R40：gitignore 自动过滤 + 手动排除目录 + 非代码资源开关）───
  const [scanSettingsOpen, setScanSettingsOpen] = useState(false);
  const [hasGitignore, setHasGitignore] = useState<boolean | null>(null);
  const [excludeDirsText, setExcludeDirsText] = useState('');
  const [excludeResources, setExcludeResources] = useState(true);

  /** 打开扫描设置：从 analysis metadata 读取已保存配置 + 检测 .gitignore */
  const openScanSettings = async () => {
    setScanSettingsOpen(true);
    const meta = (activeScene?.metadata ?? {}) as Record<string, unknown>;
    const saved = Array.isArray(meta.scanExcludes) ? (meta.scanExcludes as string[]) : [];
    setExcludeDirsText(saved.join(', '));
    setExcludeResources(meta.excludeResources !== false);
    if (activeScene?.projectRoot) {
      try {
        setHasGitignore(await projectScanApi.checkGitignore(activeScene.projectRoot));
      } catch {
        setHasGitignore(null);
      }
    } else {
      setHasGitignore(null);
    }
  };

  /** 保存扫描设置到 analysis metadata（只改 metadata，不动场景数据） */
  const saveScanSettings = async () => {
    if (!activeSceneId) return;
    const dirs = excludeDirsText
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await projectScanApi.saveScanExcludes(activeSceneId, dirs, excludeResources);
      await updateScene(activeSceneId, {
        metadata: { ...(activeScene?.metadata ?? {}), scanExcludes: dirs, excludeResources },
      });
      setScanSettingsOpen(false);
      showToast(
        dirs.length > 0
          ? t('editorPage.scanSettingsSaved', { n: dirs.length })
          : t('editorPage.scanSettingsSavedPlain'),
        'success',
      );
    } catch (e) {
      console.error('[scanSettings] save failed', e);
      showToast(t('editorPage.scanSettingsSaveFail'), 'error');
    }
  };

  // 加载当前分析的扫描结果
  useEffect(() => {
    if (activeSceneId) {
      (async () => {
        // 书=场景：作品走写作链路（解析全书），代码分析的自动补齐/自动监视一律跳过
        const bookScene =
          (useSceneStore.getState().scenes.find((s) => s.id === activeSceneId)?.primaryLanguage ?? '') === 'novel-zh';
        await loadAll(activeSceneId);
        // 旧数据分析兼容：已有扫描结果但从未做过结构索引时自动补齐
        const st = useProjectStore.getState();
        if (!bookScene && st.files.length > 0 && !st.structureSummary && !st.scanning) {
          useProjectStore.getState().analyzeStructure(activeSceneId);
        }
        // 旧数据分析兼容：已有结构索引但从未做过符号引用分析时自动补齐
        if (!bookScene && st.files.length > 0 && !st.refsAnalyzed && !st.scanning) {
          useProjectStore.getState().analyzeSymbolRefs(activeSceneId);
        }
        // 旧数据分析兼容：已有扫描结果但从未做过文件度量（复杂度）分析时自动补齐
        if (!bookScene && st.files.length > 0 && !st.metricsAnalyzed && !st.scanning) {
          useProjectStore.getState().analyzeMetrics(activeSceneId);
        }
        // 旧数据分析兼容：已有扫描结果但从未做过技术债扫描时自动补齐
        if (!bookScene && st.files.length > 0 && !st.techDebtAnalyzed && !st.scanning) {
          useProjectStore.getState().analyzeTechDebt(activeSceneId);
        }
        // 旧数据分析兼容：已有扫描结果但从未做过代码克隆检测时自动补齐
        if (!bookScene && st.files.length > 0 && !st.clonesAnalyzed && !st.scanning) {
          useProjectStore.getState().analyzeClones(activeSceneId);
        }
        // 旧数据分析兼容：已有扫描结果但从未建立代码全文索引时自动补齐
        if (!bookScene && st.files.length > 0 && !st.codeIndexed && !st.scanning) {
          useProjectStore.getState().indexCode(activeSceneId);
        }
        // 画布自动填充：有扫描数据但画布为空（场景从未同步过 / 旧场景无 views）
        // 时自动同步到画布，避免用户打开场景后看到空白画布却不知道要点击"同步"。
        // 延迟 200ms 确保 loadAll 数据已写入 projectStore 且 SceneEditor 的 reload
        // effect 已完成（避免与 clearScene 竞争）。
        // 【2026-09-21 用户拍板】书场景**排除**：书架新建作品一进工作室就被自动铺
        // 一块「全书总览」画板 + 页签，莫名其妙。书画布保持「拖入载体」空态引导；
        // 想要画板走命令面板「生成全书总览 / 分镜板 / 人物关系板」手动入口，
        // 或顶栏「同步到画布」显式动作。
        setTimeout(() => {
          const editorState = useEditorStore.getState();
          const projectState = useProjectStore.getState();
          if (!bookScene && projectState.files.length > 0 && editorState.components.length === 0) {
            handleSyncToCanvas();
          }
        }, 200);
        // v2.14 旧版符号画像自动迁移：DB 里持久化的「代码结构」视图可能是 v2.12 横带 /
        // v2.13 模块总览等旧范式生成的（目录树标记 dirSymbolTree 不存在）。检测到旧内容 →
        // 切到该视图并用 v2.14 目录树自动重建一次（幂等：重建后带 dirSymbolTree 标记，
        // 再次进入不再命中）。覆盖 v2.12 前旧横带（a/b 符号 模板 + 300×40）与之后各版本。
        setTimeout(() => {
          const ed = useEditorStore.getState();
          const symLabel = t('editorPage.portrait.symbols.label');
          const symView = ed.views.find((v) => v.name === symLabel || v.name.startsWith(`${symLabel} `));
          if (!symView) return;
          const stale =
            symView.components.length > 0 && !symView.components.some((c) => (c.config as any)?.dirSymbolTree === true);
          if (stale) {
            if (ed.activeViewId !== symView.id) ed.switchView(symView.id);
            void runPortrait('symbols', activeSceneId).then((res) =>
              useToastStore.getState().showToast(res.ok ? t('portrait.msg.symMigrated') : res.message, res.severity),
            );
          }
        }, 500);
        // v2.17 旧版依赖画像自动迁移：DB 里持久化的「依赖关系图」视图可能是 v2.16 及更早
        // 生成的（节点无模块簇着色/度数徽标）。检测：依赖视图里存在 file 组件且没有一个带
        // metricBadge（v2.17 起每个依赖节点都带 →N ←M 徽标）→ 旧版 → 切过去用新逻辑重建
        // （幂等：重建后全部节点带 metricBadge，再次进入不再命中）。
        setTimeout(() => {
          const ed = useEditorStore.getState();
          const depLabel = t('editorPage.portrait.dependency.label');
          const depView = ed.views.find((v) => v.name === depLabel || v.name.startsWith(`${depLabel} `));
          if (!depView) return;
          const hasFile = depView.components.some((c) => c.type === 'file');
          const anyBadge = depView.components.some((c) => (c.config as any)?.metricBadge);
          const stale = hasFile && !anyBadge;
          if (stale) {
            if (ed.activeViewId !== depView.id) ed.switchView(depView.id);
            void runPortrait('dependency', activeSceneId).then((res) =>
              useToastStore.getState().showToast(res.ok ? t('portrait.msg.depMigrated') : res.message, res.severity),
            );
          }
        }, 500);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId, loadAll]);

  // ─── 文件变更自动监视：打开分析且设置过项目根目录时自动开始 ───
  const projectRoot = activeScene?.projectRoot ?? null;
  useEffect(() => {
    if (!activeSceneId || !projectRoot) return;
    // 书=场景：章节在数据库里，不走文件监视
    if (isBookScene) return;
    let cancelled = false;
    (async () => {
      // 切换分析时先停掉旧的监视，再启动当前分析的监视
      if (watchAnalysisId && watchAnalysisId !== activeSceneId) {
        await stopWatching();
      }
      if (cancelled) return;
      try {
        await startWatching(activeSceneId, projectRoot);
      } catch (e) {
        console.error('[SceneEditorPage] auto watch failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId, projectRoot, isBookScene]);

  // 离开分析器页面时停止监视（避免后台资源占用）
  useEffect(() => {
    return () => {
      stopWatching();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 文件变更通知（合并批次，去重防刷屏）───
  const lastToastRef = useRef<{ path: string; ts: number } | null>(null);
  useEffect(() => {
    if (!lastChangeEvent) return;
    const { path, timestamp, kind } = lastChangeEvent;
    const prev = lastToastRef.current;
    // 同一文件 3 秒内的连续变更只提示一次
    if (prev && prev.path === path && timestamp - prev.ts < 3000) return;
    lastToastRef.current = { path, ts: timestamp };
    const fileName = path.split('/').pop() || path;
    const kindLabel =
      kind === 'created'
        ? t('editorPage.changeCreated')
        : kind === 'removed'
          ? t('editorPage.changeRemoved')
          : t('editorPage.changeModified');
    showToast(t('editorPage.fileChanged', { kind: kindLabel, name: fileName }), 'info');
  }, [lastChangeEvent, showToast]);

  // 轮询扫描进度
  useEffect(() => {
    if (!scanning || !activeSceneId) return;
    const interval = setInterval(async () => {
      try {
        const latest = await projectScanApi.latestJob(activeSceneId);
        if (latest) {
          setCurrentJob({
            progress: latest.progress,
            filesScanned: latest.filesScanned,
            totalFiles: latest.totalFiles,
          });
        }
      } catch (e) {
        console.error(e);
      }
    }, 800);
    return () => clearInterval(interval);
  }, [scanning, activeSceneId]);

  // ─── 工作室作品入口（F4/F5/F7）：新建 / 导入，作品直接落成工作室场景 ───
  // 注意：须定义在 !activeScene 早退之前 —— 工作室空态也提供这两个入口
  // 羽化 P：新建改走命名向导（NewBookDialog → createBookNamed），干掉「新建作品 N」丑默认名；
  // 导入仍走系统对话框。
  const [newBookOpen, setNewBookOpen] = useState(false);
  const handleNewBookInStudio = () => setNewBookOpen(true);
  const handleBookCreated = (book: NewBookResult) => {
    // F7：不跳写作台 —— 书=场景，createBookNamed 已落支撑场景并 setActiveScene，
    // 用户就留在工作室画布上（本页 loadAll effect 会自动装载+同步画布）
    showToast(t('studio.createdInStudio', { title: book.title }), 'success');
  };
  const handleBookCreateError = (e: unknown) => {
    showToast(t('studio.opFailed', { msg: String(e) }), 'error');
  };

  const handleImportBookInStudio = async () => {
    try {
      const imported = await importBookFromDialog();
      if (!imported) return;
      await openBookInStudio(imported.bookId);
      showToast(
        t('studio.imported', {
          title: imported.title,
          chapters: imported.chapterCount,
          words: imported.totalWords,
        }),
        'success',
      );
    } catch (e) {
      console.error('[SceneEditorPage] import book failed', e);
      showToast(t('studio.opFailed', { msg: String(e) }), 'error');
    }
  };

  // ─── G5：写作台入口从侧栏迁入工作室 —— 书场景工具栏一键直达 ───
  // 书的支撑场景 id = wscan_{bookId}（studioBook.bookSceneId 同一规则），去掉前缀即 bookId。
  // 写作台读同一 writingStore：setActiveBook 会自动装载章节/设定/大纲（writingStore.ts:149）。
  const handleOpenWriting = async () => {
    const sid = useSceneStore.getState().activeSceneId ?? '';
    if (!sid.startsWith('wscan_')) {
      showToast(t('studio.openWritingNoBook'), 'warning');
      return;
    }
    try {
      const ws = useWritingStore.getState();
      if (ws.books.length === 0) await ws.loadBooks();
      await ws.setActiveBook(sid.slice('wscan_'.length));
      void openWritingDeskWindow({ bookId: sid.slice('wscan_'.length) });
    } catch (e) {
      console.error('[SceneEditorPage] open writing failed', e);
      showToast(t('studio.opFailed', { msg: String(e) }), 'error');
    }
  };

  // ─── 写作预设画板（H1/H5）：全书总览 / 分镜板 / 人物关系板 ───
  // 三块板共享同一套「专属视图 + 批量落库 + 持久化 + 适应视口」流程，差别只在布局函数。
  // 视图按名幂等（与画像视图同一约定）：重复生成是重建，不会叠图层。
  const buildBookBoard = async (kind: BookBoardKind) => {
    if (!activeSceneId) return;
    const label = t(BOARD_LABEL[kind]);
    const ed = useEditorStore.getState();
    const existing = ed.views.find((v) => v.name === label || v.name.startsWith(`${label} `));
    const viewId = existing ? existing.id : ed.addView(label);
    if (useEditorStore.getState().activeViewId !== viewId) {
      useEditorStore.getState().switchView(viewId);
    }
    // 重建语义：清空当前视图组件，防止重复点击叠加
    useEditorStore.setState((s: any) => {
      s.components = [];
    });
    const filesNow = useProjectStore.getState().files;
    let cards: {
      type: string;
      name: string;
      x: number;
      y: number;
      width: number;
      height: number;
      locked: boolean;
      config: Record<string, unknown>;
    }[] = [];
    let doneMsg = '';
    if (kind === 'overview') {
      const r = buildBookOverview(filesNow);
      if (r.chapterCount === 0) {
        showToast(t('editorPage.bookOverview.empty'), 'warning');
        return;
      }
      cards = r.cards;
      doneMsg =
        r.appearanceEdgesDropped > 0
          ? t('editorPage.bookOverview.doneEdgesTrimmed', {
              chapters: r.chapterCount,
              characters: r.characterCount,
              edges: r.appearanceEdgeCount,
              dropped: r.appearanceEdgesDropped,
            })
          : r.appearanceEdgeCount > 0
            ? t('editorPage.bookOverview.doneEdges', {
                chapters: r.chapterCount,
                characters: r.characterCount,
                edges: r.appearanceEdgeCount,
              })
            : t('editorPage.bookOverview.done', { chapters: r.chapterCount, characters: r.characterCount });
    } else if (kind === 'storyboard') {
      const r = buildStoryboard(filesNow);
      if (r.chapterCount === 0) {
        showToast(t('editorPage.bookOverview.empty'), 'warning');
        return;
      }
      cards = r.cards;
      doneMsg = t('editorPage.board.storyboard.done', { chapters: r.chapterCount, volumes: r.volumeCount });
    } else {
      const r = buildRelationBoard(filesNow);
      if (r.nodeCount < 2 || r.edgeCount === 0) {
        showToast(t('editorPage.board.relation.empty'), 'warning');
        return;
      }
      cards = r.cards;
      doneMsg =
        r.dropped > 0
          ? t('editorPage.board.relation.doneTrimmed', { nodes: r.nodeCount, edges: r.edgeCount, dropped: r.dropped })
          : t('editorPage.board.relation.done', { nodes: r.nodeCount, edges: r.edgeCount });
    }
    const added = useEditorStore.getState().addComponentsBulk(cards);
    if (added.length === 0) {
      showToast(t('editorPage.syncFail'), 'error');
      return;
    }
    // 显式落库（与代码场景同步同一契约：立即持久化 + 标净 + 适应视口）
    try {
      const { views, globalComponents, activeViewId } = useEditorStore.getState().exportSceneWithViews();
      await useSceneStore.getState().updateScene(activeSceneId, {
        views,
        globalComponents,
        activeViewId,
      } as any);
      useDirtyStore.getState().markClean();
    } catch (e) {
      console.error('[SceneEditorPage] persist book board failed', e);
    }
    useEditorStore.getState().requestFit();
    showToast(doneMsg, 'success');
  };

  /** 生成预设板（含让出一帧与骨架屏开关）：顶栏菜单与命令面板共用同一入口 */
  const runBoard = async (kind: BookBoardKind) => {
    setSyncing(true);
    await new Promise<void>((r) => setTimeout(r, 40));
    try {
      await buildBookBoard(kind);
    } finally {
      setSyncing(false);
    }
  };

  /** 当前激活视图属于哪块预设板（重解析后按原板重建；非预设板返回 null） */
  const activeBoardKind = (): BookBoardKind | null => {
    const ed = useEditorStore.getState();
    const view = ed.views.find((v) => v.id === ed.activeViewId);
    if (!view) return null;
    for (const k of ['overview', 'storyboard', 'relation'] as BookBoardKind[]) {
      const label = t(BOARD_LABEL[k]);
      if (view.name === label || view.name.startsWith(`${label} `)) return k;
    }
    return null;
  };

  // ─── 解析全书（G1）：书场景顶栏的「扫描项目」替身，走写作扫描链路 ───
  // 幂等：后端 upsert + 画布字段透传（F7），重解析不丢画布布局。
  const handleParseBook = async () => {
    if (!activeSceneId || !activeScene?.projectRoot) return;
    // projectRoot 契约：writing://{bookId}/
    const bookId = activeScene.projectRoot.replace(/^writing:\/\//, '').replace(/\/+$/, '');
    if (!bookId) return;
    try {
      const summary = await writingScanApi.scanBook(bookId);
      await loadAll(activeSceneId);
      // 书名/字数可能变了 → 刷新场景列表，画布若停在全书总览视图则重建
      await useSceneStore.getState().loadScenes();
      // 重解析后画布若停在某块预设板上 → 按原板重建（章节数/人物会变，旧布局必然过期）
      const kind = activeBoardKind();
      if (kind) {
        setSyncing(true);
        try {
          await buildBookBoard(kind);
        } finally {
          setSyncing(false);
        }
      }
      showToast(t('editorPage.parseBookDone', { chapters: summary.fileCount, words: summary.totalWords }), 'success');
    } catch (e) {
      console.error('[SceneEditorPage] parse book failed', e);
      showToast(t('studio.opFailed', { msg: String(e) }), 'error');
    }
  };

  // ─── 插画链路（H2）：素材库选图 → 插入画布 / 替换选中图片实体的图源 ───
  const pickerOpen = useAssetPickerStore((s) => s.open);
  const pickerReplaceId = useAssetPickerStore((s) => s.replaceComponentId);
  // ─── 画布 AI 助手（H3）：AI 出操作方案 → 预览确认 → 应用/撤销 ───
  const [canvasAiOpen, setCanvasAiOpen] = useState(false);

  const handlePickAsset = (asset: AssetInfo) => {
    const ed = useEditorStore.getState();
    // 批次 1（正文插图）：插入到某编辑器光标处，由打开方注入的闭包执行
    const pickerEditorInserter = useAssetPickerStore.getState().editorInserter;
    if (pickerEditorInserter) {
      pickerEditorInserter(asset);
      showToast(t('studio.illustration.inserted'), 'success');
      return;
    }
    // 批次 2（封面）：选中的素材设为目标封面（章/卷/节拍），由打开方注入的闭包执行
    const pickerCoverSetter = useAssetPickerStore.getState().coverSetter;
    if (pickerCoverSetter) {
      pickerCoverSetter.apply(asset);
      showToast(t('studio.illustration.coverSet'), 'success');
      return;
    }
    if (pickerReplaceId) {
      // 替换模式：只换图源，保留用户摆好的位置与尺寸
      ed.updateComponentConfig(pickerReplaceId, {
        absPath: asset.path,
        filePath: '',
        fileName: asset.name,
        fileSize: asset.size,
        language: 'image',
      });
      showToast(t('studio.illustration.replaced'), 'success');
      return;
    }
    // 插入模式：新书页中央附近落一张 360×260 的插画卡（可拖可缩）
    const n = ed.components.length;
    const added = ed.addComponent('image', undefined, {
      x: 140 + (n % 6) * 32,
      y: 110 + (n % 6) * 26,
    });
    if (!added) {
      showToast(t('studio.opFailed', { msg: 'image entity unavailable' }), 'error');
      return;
    }
    ed.updateComponentTransform(added.id, { width: 360, height: 260 });
    ed.updateComponentConfig(added.id, {
      absPath: asset.path,
      filePath: '',
      fileName: asset.name,
      fileSize: asset.size,
      language: 'image',
    });
    showToast(t('studio.illustration.inserted'), 'success');
  };

  if (!activeScene) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.secondary',
          gap: 1,
        }}
      >
        <AccountTreeIcon sx={{ fontSize: 56, opacity: 0.25 }} />
        <Typography variant="h6" sx={{ fontWeight: 500 }}>
          {t('editorPage.noAnalysisTitle')}
        </Typography>
        <Typography variant="body2">{t('editorPage.noAnalysisHint')}</Typography>
        {/* 工作室作品入口：空态即可新建 / 导入，不必先去别处（F6） */}
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<MenuBookRoundedIcon sx={{ fontSize: 16 }} />}
            onClick={() => void handleNewBookInStudio()}
          >
            {t('studio.newBook')}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<UploadFileRoundedIcon sx={{ fontSize: 16 }} />}
            onClick={() => void handleImportBookInStudio()}
          >
            {t('studio.importBook')}
          </Button>
        </Box>
        {/* 羽化 P：空态「新建作品」也走命名向导（对话框用 portal，不影响此居中布局） */}
        <NewBookDialog
          open={newBookOpen}
          onClose={() => setNewBookOpen(false)}
          onCreate={createBookNamed}
          onCreated={handleBookCreated}
          onError={handleBookCreateError}
        />
      </Box>
    );
  }

  // ─── 选择项目根目录 ───
  const handleSelectRoot = async () => {
    try {
      const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
      if (!isTauri) {
        showToast(t('editorPage.dirPickDesktopOnly'), 'warning');
        return;
      }
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('editorPage.selectRoot'),
      });
      if (typeof selected === 'string' && activeScene) {
        await updateScene(activeScene.id, { ...activeScene, projectRoot: selected });
        showToast(t('editorPage.rootSet'), 'success');
      }
    } catch (e) {
      console.error('[SceneEditorPage] select root failed', e);
      const msg = e instanceof Error ? e.message : String(e);
      // 暴露真实原因（权限被拒 / 非 Tauri 环境 / 其他）
      showToast(t('editorPage.selectDirFail', { msg }), 'error');
    }
  };

  // ─── 触发扫描 ───
  const handleScan = async () => {
    if (!activeScene?.projectRoot || !activeSceneId) return;
    try {
      setCurrentJob({
        progress: 0,
        filesScanned: 0,
        totalFiles: 0,
        stage: 'enumerate',
        stageIndex: 1,
        totalStages: 14,
        message: t('editorPage.stage.enumerate'),
        coverage: null,
        startedAt: Date.now(),
      });
      // 复位深度分析取消标志（与后端 scan_project 的复位双保险）
      try {
        await projectScanApi.resetAnalysisCancel(activeSceneId);
      } catch {
        /* 忽略 */
      }
      // R40：从 metadata 读取扫描排除配置（.gitignore 由后端自动读取）
      const meta = (activeScene?.metadata ?? {}) as Record<string, unknown>;
      const excludeDirs = Array.isArray(meta.scanExcludes) ? (meta.scanExcludes as string[]) : [];
      const excludeResources = meta.excludeResources !== false;
      const ignoreHint = excludeDirs.length > 0 ? t('editorPage.scanExcludeHint', { n: excludeDirs.length }) : '';
      showToast(
        t('editorPage.scanStart', {
          git: hasGitignore ? t('editorPage.gitignoreUsed') : t('editorPage.gitignoreMissing'),
          ignoreHint,
        }),
        'info',
      );
      await scan(activeSceneId, activeScene.projectRoot, { excludeDirs, excludeResources });
      // 刷新分析列表（后端扫描后回写 primaryLanguage 到 analysis 记录）
      await useSceneStore.getState().loadScenes();
      const refreshed = useSceneStore.getState().scenes.find((s) => s.id === activeSceneId);

      // 混合项目：统计扫描结果里的全部语言（每个文件都有后端识别的 language 字段）
      const langSet = new Set<string>();
      useProjectStore.getState().files.forEach((f) => {
        if (f.language) langSet.add(f.language);
      });
      if (refreshed?.primaryLanguage) langSet.add(refreshed.primaryLanguage);

      if (langSet.size > 0) {
        // 主插件用项目主语言（出现最多的语言）
        if (refreshed?.primaryLanguage) {
          activateAnalyzerForLanguage(refreshed.primaryLanguage);
          // 注意：这里**不再**自动 setFocusLanguage(主语言)。
          // 历史行为是扫描完自动把左侧面板（实体 tab / 文件目录 tab）过滤成主语言，
          // 混合项目（TS + Python + Shell + 资源…）下其余语言文件/实体被整体隐藏，
          // 表现为「扫描后实体与目录结构展示不全」。语言焦点是**主动筛选**语义，
          // 保留为用户显式操作（切换插件 PluginSelector / 目录树语言 chip / 实体语言行）。
        }
        // 其余语言批量激活对应插件
        const { activated, missing } = activateAnalyzersForLanguages(Array.from(langSet));
        const langLabel = Array.from(langSet).join('、');
        const parts: string[] = [];
        if (activated.length > 0) parts.push(t('editorPage.activatedAnalyzers', { names: activated.join('、') }));
        if (missing.length > 0) parts.push(t('editorPage.noPluginFor', { names: missing.join('、') }));
        showToast(
          t('editorPage.langsDetected', { n: langSet.size, langs: langLabel, parts: parts.join('；') }),
          activated.length > 0 ? 'success' : 'warning',
        );

        // 把激活插件的规则声明同步到后端规则引擎（§4.2 深度联动），再重跑审查
        const synced = await syncPluginRulesToBackend(refreshed?.primaryLanguage);
        if (synced > 0) {
          await useProjectStore.getState().loadRules();
          await projectScanApi.runReviewRules(activeSceneId);
          useProjectStore.setState({ reviewAnalyzed: true });
          await useProjectStore.getState().loadFindings(activeSceneId);
        }
      }
      setCurrentJob(null);
      showToast(t('editorPage.scanDone'), 'success');
      // 扫描完成后自动同步到画布（此前需要手动点击"同步到画布"按钮，
      // 导致新建场景的默认视图始终空白 —— 用户扫描完项目却看不到任何实体）。
      // 先刷新内存 files：scan 已把文件写库，但 projectStore 尚未更新；
      // 若不 reload，handleSyncToCanvas 读到空 files 会直接 return，自动同步失效。
      await loadAll(activeSceneId);
      setTimeout(() => {
        handleSyncToCanvas();
      }, 100);
    } catch (e) {
      console.error('[SceneEditorPage] scan failed', e);
      setCurrentJob(null);
      showToast(t('editorPage.scanFail'), 'error');
    }
  };

  const handleCancel = async () => {
    await cancelScan();
    if (activeSceneId) {
      try {
        await projectScanApi.cancelAnalysis(activeSceneId);
      } catch {
        /* 忽略：深度分析可能已结束 */
      }
    }
  };

  // ─── 同步文件到画布（按目录分组网格布局 + 文件级依赖连线，批量落库）───
  // 性能说明：此前逐个 addComponent，每次触发全量 structuredClone（O(N²)），
  // 数百文件时卡死；现在布局在 store 外算好（syncLayout 纯函数），
  // 一次 addComponentsBulk 落库 + 一次持久化，O(N) 完成。
  const handleSyncToCanvas = async () => {
    setSyncing(true);
    // 让出一帧：大项目同步是 CPU 阻塞操作，不 await 则骨架屏不会先渲染，用户只会看到卡顿
    await new Promise<void>((r) => setTimeout(r, 40));
    try {
      // 读实时 files（组件闭包里的 files 在扫描后可能是旧值，会导致误判为空而 return）
      if (!useProjectStore.getState().files.length || !activeSceneId) return;

      // ─── 书=场景（H1）：作品画布不走目录树，生成预设写作板 ───
      if (activeScene?.primaryLanguage === 'novel-zh') {
        await buildBookBoard('overview');
        return;
      }

      const editorStore = useEditorStore;

      // 锁定同步目标：始终把项目结构树画进固定的「结构/default 视图」，
      // 避免用户在查看某个画像视图时点击同步，把画像布局误清空（此前会清掉当前激活视图）。
      const structureViewId = editorStore.getState().ensureStructureView();
      if (editorStore.getState().activeViewId !== structureViewId) {
        editorStore.getState().switchView(structureViewId);
      }

      // 画布画像数据：聚合符号/设计模式/引用/复杂度/技术债/调用图/git 变更/死代码/审查
      const pst = useProjectStore.getState();
      const insights = buildFileInsights(
        pst.files,
        pst.symbols,
        pst.patternHits,
        pst.symbolRefs,
        pst.metrics,
        pst.techDebt,
        pst.gitChurn,
        pst.callEdges,
        pst.deadSymbols,
        pst.findings,
        pst.clones,
      );
      const configFor = (f: (typeof pst.files)[number]) => {
        const ins = insights.get(f.id) ?? emptyFileInsight();
        return {
          language: f.language,
          fileSize: f.size,
          lineCount: f.lineCount,
          projectLayerId: f.layerId,
          symbolCount: ins.symbolCount,
          patternNames: ins.patternNames,
          refCount: ins.refCount,
          complexity: ins.complexity,
          complexityLevel: ins.complexityLevel,
          techDebtCount: ins.techDebtCount,
          callOut: ins.callOut,
          callIn: ins.callIn,
          churnScore: ins.churnScore,
          churnLevel: ins.churnLevel,
          deadCount: ins.deadCount,
          cloneCount: ins.cloneCount,
          cloneType2Count: ins.cloneType2Count,
          duplicatedLines: ins.duplicatedLines,
          duplicationRatio: ins.duplicationRatio,
          quadrant: ins.quadrant,
        };
      };

      const layout = buildTreeLayout(pst.files, pst.dependencies, configFor, pst.symbolRefs);
      if (layout.nodes.length === 0) {
        showToast(t('editorPage.syncNoFiles'), 'warning');
        return;
      }

      // 清空旧画布（同步是「重建」语义，防止重复点击叠加出重复文件）
      editorStore.setState((s: any) => {
        s.components = [];
      });

      // 批量添加实体：文件夹（目录树节点）+ 文件（叶子）+ 结构边（父子引导线）+ 依赖边（代码引用）
      const items: BulkComponentInput[] = [
        // 文件夹实体（目录层级节点）
        ...layout.nodes
          .filter((n) => n.isDirectory)
          .map((n) => ({
            type: 'folder',
            name: n.name,
            x: n.x,
            y: n.y,
            width: n.width,
            height: n.height,
            config: n.config,
          })),
        // 文件实体（叶子节点）
        // 类型按文件种类分派：图片资源（png/jpg/jpeg/gif/webp/svg/ico/bmp/tiff/avif/heic）
        // 落 image 实体 —— 画布上直接渲染真实缩略图、可点开图片详情。此前这里硬编码 "file"，
        // 图片被画成代码文件卡片（注册好的 image 渲染器从来没被用上）。
        ...layout.nodes
          .filter((n) => !n.isDirectory)
          .map((n) => ({
            type: entityTypeForFile(n.raw),
            name: n.name,
            x: n.x,
            y: n.y,
            width: n.width,
            height: n.height,
            config: n.config,
          })),
        // 结构边（父子树形引导线，depType=structure 区别于代码依赖）
        ...layout.structureEdges.map((e) => {
          const minX = Math.min(e.fromX, e.toX);
          const minY = Math.min(e.fromY, e.toY);
          return {
            type: 'dependency-edge',
            name: 'tree',
            x: minX,
            y: minY,
            width: Math.max(4, Math.abs(e.toX - e.fromX) + 16),
            height: Math.max(4, Math.abs(e.toY - e.fromY) + 16),
            config: {
              depType: 'structure',
              isCircular: false,
              fromX: e.fromX - minX,
              fromY: e.fromY - minY,
              toX: e.toX - minX,
              toY: e.toY - minY,
              fromFileId: e.fromId,
              toFileId: e.toId,
              edgeCount: 1,
              weight: 0,
              kinds: [],
              symbolNames: [],
            },
          };
        }),
        // 依赖边（代码引用关系）
        ...layout.dependencyEdges.map((e) => ({
          type: 'dependency-edge',
          name: e.name,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          config: e.config,
        })),
      ];
      const addedIds = editorStore.getState().addComponentsBulk(items);
      // 加固：若实际落库数为 0（理论上不可能，防御无图层/类型未注册等边缘），
      // 明确提示而不是假装成功 —— 此前静默失败是「同步到画布无法正常使用」的根因之一。
      if (addedIds.length === 0) {
        showToast(t('editorPage.syncFail'), 'error');
        return;
      }

      // 显式持久化到后端：把当前画布布局写入 analysis.editor_components / views，
      // 确保刷新页面或重进分析后画布布局不丢失（不依赖 1 秒防抖自动保存）。
      try {
        const { views, globalComponents, activeViewId } = useEditorStore.getState().exportSceneWithViews();
        await useSceneStore.getState().updateScene(activeSceneId, {
          views,
          globalComponents,
          activeViewId,
        } as any);
        // 已显式落库：标净，避免 1s 后防抖自动保存重复写同样内容
        useDirtyStore.getState().markClean();
      } catch (e) {
        console.error('[SceneEditorPage] persist canvas failed', e);
      }

      // 统筹全局：同步后自动「适应视口」，让整棵项目结构图进入视野
      useEditorStore.getState().requestFit();

      showToast(
        t('editorPage.syncDone', {
          files: layout.summary.files,
          folders: layout.summary.folders,
          depth: layout.summary.depth,
          dep: layout.summary.depEdges > 0 ? t('editorPage.syncDeps', { n: layout.summary.depEdges }) : '',
        }),
        'success',
      );
    } finally {
      setSyncing(false);
    }
  };

  // ─── 统一画像入口：每个画像独立开一个可关闭的视图并渲染 ───
  // 改造前：画像直接画进「当前激活视图」，会覆盖目录树 / 上一个画像，且无法并存对照。
  // 改造后：点击画像 → 新建一个独立视图（标签可关闭）→ 切换过去 → 在该视图内出图。
  // 用户可同时打开多个画像视图、与目录树并列对照，按需关闭任意视图。
  // （目录树 default 视图永不被覆盖；画像视图均为非 default，SceneTabBar 已支持关闭）
  const handlePortrait = async (kind: PortraitKind) => {
    if (!activeSceneId) return;
    const menuItem = PORTRAIT_MENU.find((m) => m.kind === kind);
    const baseName = menuItem ? t(menuItem.labelKey) : kind;
    const editor = useEditorStore.getState();
    // 同名去重：已存在同名视图则追加序号，避免标签混淆（仍是新视图）
    const taken = new Set(editor.views.map((v) => v.name));
    let name = baseName;
    for (let i = 2; taken.has(name); i++) name = `${baseName} ${i}`;
    // v2.44 根治「画像打开是空白/缩在角落 = 不能用」：addView 默认把当前画布视口（可能是
    // 用户刚平移/缩放后的离屏位置，或结构图的全览小比例）继承给新视图，导致新建画像视图
    // 一打开就停在离屏/极小视口，auto-fit 契约（仅当视口为默认 scale=1,offset=0 才触发）永不
    // 命中 → 用户看到空白或角落小图，误判「画像不能用」。这里显式以默认视口开图，保证渲染后
    // persist→requestFit 一定能把画像内容适配进视野（与「同步到画布」自动适应视口同一契约）。
    const newViewId = editor.addView(name, { layout: { scale: 1, panX: 0, panY: 0 } });
    let outcome: Awaited<ReturnType<typeof runPortrait>>;
    try {
      outcome = await runPortrait(kind, activeSceneId, undefined, activeScene?.projectRoot);
    } catch (err) {
      // 画像函数内部抛异常：回滚空视图 + 给出错误提示，避免留下空白标签页且毫无反馈
      console.error('[handlePortrait] 画像渲染异常', kind, err);
      const st = useEditorStore.getState();
      if (st.views.length > 1) st.removeView(newViewId);
      showToast(
        t('editorPage.portraitFail', { name: baseName, msg: (err as Error)?.message || t('editorPage.unknownError') }),
        'error',
      );
      return;
    }
    if (!outcome.ok) {
      // 画像无数据可渲染：撤销刚开的空视图，避免留下空白标签页
      const st = useEditorStore.getState();
      if (st.views.length > 1) st.removeView(newViewId);
    }
    showToast(outcome.message, outcome.severity);
  };

  // ─── 分析页统一命令（对标 Zed command_palette：动作注册表驱动，可搜索、可频次排序）───
  // 弱项：分析页（项目主视图）此前没有任何统一命令入口，扫描/画像只能靠工具栏按钮逐个找。
  // 复用数据驱动的 CommandPalette 组件，注册「项目 / 视图 / 画像」全动作，使面板真正能驱动分析。
  const pageCommands: WorkbenchCommand[] = (() => {
    const catProject = t('page.cmd.catProject');
    const catView = t('page.cmd.catView');
    // 书=场景（G4）：代码画像命令（依赖/污点/调用图…）对一本书全是空跑，
    // 留着等于给用户一堆点了没反应的按钮 —— 整表换成写作动作。
    if (isBookScene) {
      const catWriting = t('page.cmd.catWriting');
      return [
        {
          id: 'parseBook',
          title: t('page.cmd.parseBook'),
          category: catWriting,
          keywords: 'parse scan book chapter 解析 全书',
          run: () => void handleParseBook(),
        },
        ...BOARD_MENU.map((item) => ({
          id: `board_${item.kind}`,
          title: t(item.labelKey),
          category: catWriting,
          keywords: `${item.kind} board 画板`,
          run: () => void runBoard(item.kind),
        })),
        {
          id: 'canvasAi',
          title: t('studio.canvasAi.button'),
          category: catWriting,
          keywords: 'ai optimize layout 优化 排版',
          run: () => setCanvasAiOpen(true),
        },
        {
          // 方案 A：写作台入口从顶栏迁 L1 书页签后，命令面板仍是全局可达的兜底
          id: 'openWriting',
          title: t('studio.openWriting'),
          category: catWriting,
          keywords: 'writing desk workbench 写作台 编辑正文',
          run: () => void handleOpenWriting(),
        },
        {
          id: 'fitView',
          title: t('page.cmd.fitView'),
          category: catView,
          keywords: 'zoom fit overview reset',
          run: () => {
            useEditorStore.getState().requestFit();
          },
        },
      ];
    }
    const catPortrait = t('page.cmd.catPortrait');
    const runPortraitSafe = (kind: PortraitKind) => async () => {
      if (!activeSceneId) return;
      const res = await runPortrait(kind, activeSceneId, undefined, activeScene?.projectRoot);
      useToastStore.getState().showToast(res.message, res.severity);
    };
    const portraits: { id: string; titleKey: string; kind: PortraitKind; kw: string }[] = [
      { id: 'portraitDependency', titleKey: 'portraitDependency', kind: 'dependency', kw: 'graph import module' },
      { id: 'portraitArchitecture', titleKey: 'portraitArchitecture', kind: 'architecture', kw: 'overview structure' },
      { id: 'portraitPatterns', titleKey: 'portraitPatterns', kind: 'patterns', kw: 'design pattern gof' },
      { id: 'portraitDuplication', titleKey: 'portraitDuplication', kind: 'duplication', kw: 'clone duplicate copy' },
      { id: 'portraitComplexity', titleKey: 'portraitComplexity', kind: 'complexity', kw: 'heatmap metric cyclomatic' },
      { id: 'portraitCallGraph', titleKey: 'portraitCallGraph', kind: 'callGraph', kw: 'function call' },
      {
        id: 'portraitChangeCoupling',
        titleKey: 'portraitChangeCoupling',
        kind: 'changeCoupling',
        kw: 'co-change temporal hidden',
      },
      { id: 'portraitSymbols', titleKey: 'portraitSymbols', kind: 'symbols', kw: 'class symbol interface' },
      { id: 'portraitHotspot', titleKey: 'portraitHotspot', kind: 'hotspotFunctions', kw: 'hot function risk' },
      // v2.25：dataFlow 的 kw 原写 "taint source sink"，那时并没有真正的污点分析。
      // 真实污点画像（taintFlow）落地后把 taint 相关词让给它，避免搜索「taint」跳到数据流三区图。
      {
        id: 'portraitDataFlow',
        titleKey: 'portraitDataFlow',
        kind: 'dataFlow',
        kw: 'data flow def-use summary conduit blocker',
      },
      {
        id: 'portraitExecutionFlow',
        titleKey: 'portraitExecutionFlow',
        kind: 'executionFlow',
        kw: 'execution flow entry trace',
      },
      { id: 'portraitTechDebt', titleKey: 'portraitTechDebt', kind: 'techDebt', kw: 'debt maintainability' },
      { id: 'portraitDeadCode', titleKey: 'portraitDeadCode', kind: 'deadCode', kw: 'unused dead unreachable' },
    ];
    return [
      {
        id: 'scanProject',
        title: t('page.cmd.scanProject'),
        category: catProject,
        keybinding: '',
        keywords: 'rescan refresh analyze',
        run: () => {
          void handleScan();
        },
      },
      {
        id: 'syncCanvas',
        title: t('page.cmd.syncCanvas'),
        category: catProject,
        keywords: 'canvas sync files entities',
        run: () => {
          void handleSyncToCanvas();
        },
      },
      {
        id: 'fitView',
        title: t('page.cmd.fitView'),
        category: catView,
        keywords: 'zoom fit overview reset',
        run: () => {
          useEditorStore.getState().requestFit();
        },
      },
      ...portraits.map((p) => ({
        id: p.id,
        title: t(`page.cmd.${p.titleKey}`),
        category: catPortrait,
        keywords: p.kw,
        run: runPortraitSafe(p.kind),
      })),
      {
        id: 'portraitApiTrace',
        title: t('page.cmd.portraitApiTrace'),
        category: catPortrait,
        keywords: 'api trace frontend backend route handler link',
        run: () =>
          void runPortrait('apiTrace', activeSceneId ?? '', undefined, activeScene?.projectRoot, {
            apiTraceView: 'all',
          }),
      },
      {
        id: 'portraitApiTraceOrphan',
        title: t('page.cmd.portraitApiTraceOrphan'),
        category: catPortrait,
        keywords: 'api orphan dangling unmatched frontend',
        run: () =>
          void runPortrait('apiTrace', activeSceneId ?? '', undefined, activeScene?.projectRoot, {
            apiTraceView: 'orphan',
          }),
      },
      {
        id: 'portraitApiTraceDead',
        title: t('page.cmd.portraitApiTraceDead'),
        category: catPortrait,
        keywords: 'api dead route unused backend',
        run: () =>
          void runPortrait('apiTrace', activeSceneId ?? '', undefined, activeScene?.projectRoot, {
            apiTraceView: 'dead',
          }),
      },
      {
        id: 'portraitTaintFlow',
        title: t('page.cmd.portraitTaintFlow'),
        category: catPortrait,
        keywords: 'taint flow source sink security injection sql xss rce path',
        run: () =>
          void runPortrait('taintFlow', activeSceneId ?? '', undefined, activeScene?.projectRoot, { taintView: 'all' }),
      },
      {
        id: 'portraitTaintFlowCritical',
        title: t('page.cmd.portraitTaintFlowCritical'),
        category: catPortrait,
        keywords: 'taint critical dangerous injection sql xss exec rce vulnerability',
        run: () =>
          void runPortrait('taintFlow', activeSceneId ?? '', undefined, activeScene?.projectRoot, {
            taintView: 'critical',
          }),
      },
      {
        id: 'portraitTaintFlowSanitized',
        title: t('page.cmd.portraitTaintFlowSanitized'),
        category: catPortrait,
        keywords: 'taint sanitized escaped validated blocked safe',
        run: () =>
          void runPortrait('taintFlow', activeSceneId ?? '', undefined, activeScene?.projectRoot, {
            taintView: 'sanitized',
          }),
      },
    ];
  })();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* ─── 扫描新鲜度横幅：数据是否过时（check_scan_freshness 驱动）─── */}
      {scanFreshnessChecking && !isBookScene && (
        <Alert severity="info" variant="outlined" sx={{ borderRadius: 0, py: 0.25 }}>
          {t('editorPage.freshness.checking')}
        </Alert>
      )}
      {scanFreshness?.stale && !scanning && !scanFreshnessChecking && !isBookScene && (
        <Alert
          severity="warning"
          variant="outlined"
          sx={{ borderRadius: 0, alignItems: 'center' }}
          action={
            <Button
              size="small"
              variant="contained"
              color="warning"
              startIcon={<RefreshIcon sx={{ fontSize: 14 }} />}
              onClick={handleScan}
              disabled={!activeScene?.projectRoot}
            >
              {t('editorPage.freshness.rescan')}
            </Button>
          }
        >
          <AlertTitle sx={{ fontWeight: 600 }}>{t('editorPage.freshness.staleTitle')}</AlertTitle>
          {(() => {
            const f = scanFreshness;
            const last = f.lastScannedAt
              ? new Date(f.lastScannedAt * 1000).toLocaleString()
              : t('editorPage.freshness.unknown');
            const dirs = Array.from(new Set(f.added.map((p) => p.split('/')[0]).filter(Boolean))).slice(0, 4);
            const dirHint = dirs.length > 0 ? ' ' + t('editorPage.freshness.addedDirs', { dirs: dirs.join('、') }) : '';
            return t('editorPage.freshness.staleBody', {
              last,
              added: f.addedCount,
              removed: f.removedCount,
              modified: f.modifiedCount,
              dirHint,
            });
          })()}
        </Alert>
      )}

      {/* 顶部控制条：代码场景单行（原样零回归）；书场景拆两行 —— 上行动作按钮、下行书上下文 */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: isBookScene ? 'column' : 'row',
          alignItems: isBookScene ? 'stretch' : 'center',
          gap: isBookScene ? 0.25 : 1,
          px: 1.5,
          py: 0.75,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: 'divider',
          backgroundColor: (theme) =>
            theme.palette.mode === 'dark' ? 'rgba(18, 18, 24, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        }}
      >
        {isBookScene ? (
          <>
            {/* 方案 A（2026-09-14 用户拍板）：原「行1 动作条」整行摘除 —— 那是代码扫描器
                工具栏的 fork（按钮只换了文案，IA 没按新架构重设计）。功能就近归位：
                解析全书→右栏详情 BookMetaPanel（空态引导保留）、AI 优化→右栏 AI tab、
                预设画板/插入插画→命令面板与要素栏、人物出场→图鉴唯一入口、写作台→L1 书页签。
                顶栏只保留行2 上下文条，与「左栏导航/画布创作/右栏要素」三分架构对齐。 */}

            {/* ── 行2 · 作品头：封面色块 · 书名 · 体裁/载体/状态 · 章/字/更新 │ 卷部管理 / 导入 ── */}
            {/* 行2 分两组：
                · 左组 = 作品身份 + 事实（图标 / 书名 / 体裁 / 载体 / 状态 / 统计），内部允许折行；
                · 右组 = 作品级动作（卷部管理 / 导入），靠右并固定在首行行线上，不随左组折行。
                窗口收紧时由左组内部先换行、统计先让位 —— 书名与两个按钮都不会被挤走。 */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                minWidth: 0,
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  rowGap: 0.5,
                  flexWrap: 'wrap',
                  flex: '1 1 auto',
                  minWidth: 0,
                }}
              >
                {/* 书本图标入圆角底色块（体裁色）——比裸图标更成组，像一块「作品标识」 */}
                <Box
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: 1.5,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: `${activeBookGenreColor}1f`,
                    color: activeBookGenreColor,
                  }}
                >
                  <MenuBookRoundedIcon sx={{ fontSize: 15 }} />
                </Box>
                {/* 书名 = 作品身份：flexShrink: 0 保证不被挤压裁断；超长时才省略，
                  并始终可用悬停看到完整书名（MUI Tooltip 取代原生 title，即时且可读）。 */}
                <Tooltip title={activeBookName} placement="bottom-start" arrow enterDelay={400}>
                  <Typography
                    variant="caption"
                    sx={{
                      color: 'text.primary',
                      fontWeight: 700,
                      fontSize: 13,
                      flexShrink: 0,
                      maxWidth: 360,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {activeBookName}
                  </Typography>
                </Tooltip>
                {activeBook && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      rowGap: 0.25,
                      flexWrap: 'wrap',
                      minWidth: 0,
                    }}
                  >
                    <Chip
                      size="small"
                      label={t(genreLabelKey(activeBook.genre))}
                      sx={{
                        height: 20,
                        fontSize: 11,
                        fontWeight: 600,
                        bgcolor: `${activeBookGenreColor}1f`,
                        color: activeBookGenreColor,
                        '& .MuiChip-label': { px: 1 },
                      }}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t(mediumLabelKey(activeBook.medium))}
                      sx={{
                        height: 20,
                        fontSize: 11,
                        color: 'text.secondary',
                        borderColor: 'divider',
                        '& .MuiChip-label': { px: 1 },
                      }}
                    />
                    <Chip
                      size="small"
                      variant={activeBook.status === 'finished' ? 'filled' : 'outlined'}
                      color={activeBook.status === 'finished' ? 'success' : 'default'}
                      label={
                        activeBook.status === 'finished' ? t('dashboard.statusFinished') : t('dashboard.statusOngoing')
                      }
                      sx={{ height: 20, fontSize: 11, '& .MuiChip-label': { px: 1 } }}
                    />
                  </Box>
                )}
                <Box sx={{ width: '1px', height: 16, bgcolor: 'divider', mx: 0.25, flexShrink: 0 }} />
                <Typography
                  variant="caption"
                  title={t('editorPage.bookMeta', {
                    chapters: bookChapters.length,
                    words: formatBigCount(bookWords, getLang()),
                  })}
                  sx={{
                    color: 'text.secondary',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {t('editorPage.bookMeta', {
                    chapters: bookChapters.length,
                    words: formatBigCount(bookWords, getLang()),
                  })}
                  {activeBook && activeBook.updatedAt > 0
                    ? ` · ${t('dashboard.lastUpdated', { d: fmtUpdated(activeBook.updatedAt) })}`
                    : ''}
                </Typography>
              </Box>
              {/* 右组：作品级动作。左组的 flex:1 把它顶到最右；自身不折行，永远守在首行。 */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                <Box sx={{ width: 1, height: 18, bgcolor: 'divider', mr: 0.5 }} />
                {/* 卷部管理：ArchitectureLayersPanel 已按书场景改造为卷部管理 */}
                <Tooltip title={t('editorPage.layerManageTipBook')}>
                  <IconButton
                    size="small"
                    onClick={() => setLayersDialogOpen(true)}
                    disabled={!activeSceneId}
                    sx={{ position: 'relative' }}
                    aria-label={t('editorPage.layerManageTipBook')}
                  >
                    <LayersIcon sx={{ fontSize: 14 }} />
                    {(isBookScene ? bookChapters.length : layers.length) > 0 && (
                      <Box
                        sx={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          minWidth: 12,
                          height: 12,
                          borderRadius: 6,
                          bgcolor: 'primary.main',
                          color: 'common.white',
                          fontSize: 8,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          px: 0.5,
                        }}
                      >
                        {isBookScene ? bookChapters.length : layers.length}
                      </Box>
                    )}
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('studio.importBookTip')}>
                  <IconButton
                    size="small"
                    onClick={() => void handleImportBookInStudio()}
                    aria-label={t('studio.importBookTip')}
                  >
                    <UploadFileRoundedIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Box>
              {findings.length > 0 && (
                <Typography
                  variant="caption"
                  sx={{
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    bgcolor: () =>
                      findings.some((f) => f.severity === 'critical')
                        ? 'error.main'
                        : findings.some((f) => f.severity === 'warning')
                          ? 'warning.main'
                          : 'info.main',
                    color: 'common.white',
                    fontSize: 10,
                  }}
                >
                  {t('editorPage.totalFindings', { n: findings.length })}
                </Typography>
              )}
            </Box>

            {/* 写作预设画板下拉已随行1 摘除（方案 A）：命令面板承接（runBoard 同一入口） */}
          </>
        ) : (
          <>
            <FolderOpenIcon sx={{ fontSize: 16, color: 'primary.main' }} />
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                fontFamily: 'monospace',
                maxWidth: 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={activeScene.projectRoot || t('editorPage.noProjectRoot')}
            >
              {activeScene.projectRoot || t('editorPage.noProjectRoot')}
            </Typography>
            <Tooltip title={t('editorPage.selectRoot')}>
              <IconButton size="small" onClick={handleSelectRoot} aria-label={t('editorPage.selectRoot')}>
                <FolderOpenIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </>
        )}

        {/* 扫描设置（R40）：.gitignore 过滤提示 + 手动排除目录 + 非代码资源开关（仅代码场景） */}
        {!isBookScene && (
          <Tooltip title={t('editorPage.scanSettingsTip')}>
            <IconButton
              size="small"
              onClick={openScanSettings}
              disabled={!activeSceneId}
              aria-label={t('editorPage.scanSettingsTip')}
            >
              <TuneIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}

        {/* 架构分层管理（仅代码场景；书场景的卷部管理入口在上方行2） */}
        {!isBookScene && (
          <Tooltip title={t('editorPage.layerManageTip')}>
            <IconButton
              size="small"
              onClick={() => setLayersDialogOpen(true)}
              disabled={!activeSceneId}
              sx={{ position: 'relative' }}
              aria-label={t('editorPage.layerManageTip')}
            >
              <LayersIcon sx={{ fontSize: 14 }} />
              {layers.length > 0 && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    minWidth: 12,
                    height: 12,
                    borderRadius: 6,
                    bgcolor: 'primary.main',
                    color: 'common.white',
                    fontSize: 8,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    px: 0.5,
                  }}
                >
                  {layers.length}
                </Box>
              )}
            </IconButton>
          </Tooltip>
        )}

        {/* ─── 作品入口（F4，仅代码场景；书场景的入口在上方行2）─── */}
        {!isBookScene && (
          <>
            <Box sx={{ width: 1, height: 18, bgcolor: 'divider', mx: 0.5 }} />
            <Tooltip title={t('studio.newBookTip')}>
              <Button
                size="small"
                sx={{ minWidth: 0, px: 1 }}
                startIcon={<MenuBookRoundedIcon sx={{ fontSize: 14 }} />}
                onClick={() => void handleNewBookInStudio()}
              >
                {!compact && t('studio.newBook')}
              </Button>
            </Tooltip>
            <Tooltip title={t('studio.importBookTip')}>
              <Button
                size="small"
                sx={{ minWidth: 0, px: 1 }}
                startIcon={<UploadFileRoundedIcon sx={{ fontSize: 14 }} />}
                onClick={() => void handleImportBookInStudio()}
              >
                {!compact && t('studio.importBook')}
              </Button>
            </Tooltip>
          </>
        )}

        {!isBookScene && <Box sx={{ flex: 1 }} />}

        {/* ─── 文件变更监视状态（书场景不走文件监视，隐藏）─── */}
        {projectRoot &&
          !scanning &&
          !isBookScene &&
          (watching && watchAnalysisId === activeSceneId ? (
            <>
              <Tooltip title={t('editorPage.watchingTip')}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 0.75,
                    py: 0.25,
                    borderRadius: 1,
                    bgcolor: 'rgba(76, 175, 80, 0.12)',
                    border: '1px solid rgba(76, 175, 80, 0.35)',
                    cursor: 'default',
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: WATCHING_STATUS_COLOR,
                      animation: 'watchPulse 1.5s ease-in-out infinite',
                      '@keyframes watchPulse': {
                        '0%': { opacity: 1, transform: 'scale(1)' },
                        '50%': { opacity: 0.35, transform: 'scale(0.75)' },
                        '100%': { opacity: 1, transform: 'scale(1)' },
                      },
                    }}
                  />
                  <Typography variant="caption" sx={{ fontSize: 10, color: WATCHING_STATUS_COLOR, fontWeight: 600 }}>
                    {t('editorPage.watching')}
                  </Typography>
                  {recentChanges.length > 0 && (
                    <Tooltip title={t('editorPage.recentChanges', { n: recentChanges.length })}>
                      <Box
                        sx={{
                          minWidth: 16,
                          height: 16,
                          px: 0.5,
                          borderRadius: 8,
                          bgcolor: WATCHING_STATUS_COLOR,
                          color: 'common.white',
                          fontSize: 9,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {recentChanges.length}
                      </Box>
                    </Tooltip>
                  )}
                </Box>
              </Tooltip>
              <Tooltip title={t('editorPage.stopWatch')}>
                <IconButton
                  size="small"
                  onClick={() => {
                    stopWatching();
                    clearChanges();
                  }}
                  aria-label={t('editorPage.stopWatch')}
                >
                  <VisibilityOffIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <Tooltip title={t('editorPage.watchingTip')}>
              <IconButton
                size="small"
                onClick={() => activeSceneId && startWatching(activeSceneId, projectRoot)}
                aria-label={t('editorPage.watchingTip')}
              >
                <VisibilityIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          ))}

        {scanning &&
          currentJob &&
          (() => {
            const stages = [
              {
                key: 'enumerate',
                label: t('editorPage.stage.enumerate'),
                done: currentJob.stage === 'done' || currentJob.stage === 'cancelled' || currentJob.progress >= 100,
              },
              { key: 'deps', label: t('editorPage.stage.deps'), done: depsAnalyzed },
              {
                key: 'review',
                label: t('editorPage.stage.review'),
                done:
                  reviewAnalyzed ||
                  currentJob.stage === 'done' ||
                  currentJob.stage === 'cancelled' ||
                  currentJob.progress >= 100 ||
                  findingsCount > 0,
              },
              { key: 'structure', label: t('editorPage.stage.structure'), done: structureAnalyzed },
              { key: 'symbol', label: t('editorPage.stage.symbol'), done: refsAnalyzed },
              { key: 'callGraph', label: t('editorPage.stage.callGraph'), done: callGraphAnalyzed },
              { key: 'dataFlow', label: t('editorPage.stage.dataFlow'), done: dataFlowAnalyzed },
              { key: 'metrics', label: t('editorPage.stage.metrics'), done: metricsAnalyzed },
              { key: 'techDebt', label: t('editorPage.stage.techDebt'), done: techDebtAnalyzed },
              { key: 'clones', label: t('editorPage.stage.clones'), done: clonesAnalyzed },
              { key: 'git', label: 'Git', done: gitAnalyzed },
              { key: 'changeCoupling', label: t('editorPage.stage.coupling'), done: couplingAnalyzed },
              { key: 'deadCode', label: t('editorPage.stage.deadCode'), done: deadCodeAnalyzed },
              { key: 'index', label: t('editorPage.stage.index'), done: codeIndexed },
            ];
            const activeIdx = stages.findIndex((s) => !s.done);
            const cov = currentJob.coverage;
            return (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 320, maxWidth: 460 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {scanIncremental ? (
                    <Chip
                      size="small"
                      color="success"
                      variant="outlined"
                      label={
                        scanChangedCount > 0
                          ? t('editorPage.incremental', { n: scanChangedCount })
                          : t('editorPage.incrementalPlain')
                      }
                      sx={{ fontSize: 10, height: 20, '& .MuiChip-label': { px: 0.75 } }}
                    />
                  ) : (
                    <Chip
                      size="small"
                      color="default"
                      variant="outlined"
                      label={t('editorPage.fullScan')}
                      sx={{ fontSize: 10, height: 20, '& .MuiChip-label': { px: 0.75 } }}
                    />
                  )}
                  <CircularProgress size={14} />
                  <Box sx={{ flex: 1, minWidth: 160 }}>
                    <LinearProgress
                      variant="determinate"
                      value={currentJob.progress}
                      sx={{ height: 4, borderRadius: 2 }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                    {currentJob.message
                      ? currentJob.message
                      : currentJob.totalFiles > 0
                        ? (() => {
                            const elapsed = currentJob.startedAt ? (Date.now() - currentJob.startedAt) / 1000 : 0;
                            const rate = elapsed > 0.5 ? currentJob.filesScanned / elapsed : 0;
                            const remaining = Math.max(0, currentJob.totalFiles - currentJob.filesScanned);
                            const eta = rate > 0 ? remaining / rate : 0;
                            const etaStr =
                              eta >= 60 ? `${(eta / 60).toFixed(1)}m` : `${eta.toFixed(eta < 10 ? 1 : 0)}s`;
                            const rateStr = rate >= 1 ? `${rate.toFixed(0)}/s` : `${rate.toFixed(1)}/s`;
                            return `${currentJob.filesScanned} / ${currentJob.totalFiles} · ${rateStr} · ${t('editorPage.eta', { eta: etaStr })}`;
                          })()
                        : `${currentJob.filesScanned} / ${currentJob.totalFiles}`}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {stages.map((st, i) => (
                    <Box
                      key={st.key}
                      sx={{
                        fontSize: 10,
                        px: 0.75,
                        py: 0.25,
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: st.done ? 'success.main' : i === activeIdx ? 'primary.main' : 'divider',
                        color: st.done ? 'success.main' : i === activeIdx ? 'primary.main' : 'text.disabled',
                        bgcolor: st.done ? 'success.main' : i === activeIdx ? 'primary.main' : 'transparent',
                        opacity: st.done ? 0.18 : 1,
                      }}
                    >
                      {st.label}
                    </Box>
                  ))}
                </Box>
                {cov && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                    {t('editorPage.covSummary', {
                      files: cov.files,
                      lines: cov.lines.toLocaleString(),
                      langs: cov.languages.length,
                    })}
                    {cov.deepUnsupported > 0 && t('editorPage.covDeepUnsupported', { n: cov.deepUnsupported })}
                    {cov.excludedDirs > 0 && t('editorPage.covExcluded', { n: cov.excludedDirs })}
                    {typeof cov.changed === 'number' &&
                      typeof cov.unchanged === 'number' &&
                      (cov.unchanged > 0
                        ? t('editorPage.covIncremental', { changed: cov.changed, unchanged: cov.unchanged })
                        : t('editorPage.covFullNew', { n: cov.changed }))}
                  </Typography>
                )}
              </Box>
            );
          })()}

        {/* 取消扫描 / 刷新 / 扫描项目（仅代码场景；书场景的解析全书与刷新在上方行1） */}
        {!isBookScene &&
          (scanning ? (
            <Tooltip title={t('editorPage.cancel')}>
              <Button
                size="small"
                variant="outlined"
                color="warning"
                sx={{ fontSize: 11, minWidth: 0, px: 1 }}
                startIcon={<StopIcon sx={{ fontSize: 13 }} />}
                onClick={handleCancel}
              >
                {!compact && t('editorPage.cancel')}
              </Button>
            </Tooltip>
          ) : (
            <>
              <Tooltip title={t('editorPage.refreshTip')}>
                <span>
                  <IconButton
                    size="small"
                    onClick={() => activeSceneId && loadAll(activeSceneId)}
                    disabled={!activeScene.projectRoot}
                    aria-label={t('editorPage.refreshTip')}
                  >
                    <RefreshIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('editorPage.scanProject')}>
                <span>
                  <Button
                    size="small"
                    variant="contained"
                    sx={{ fontSize: 11, minWidth: 0, px: 1 }}
                    startIcon={<SearchIcon sx={{ fontSize: 13 }} />}
                    onClick={handleScan}
                    disabled={!activeScene.projectRoot}
                  >
                    {!compact && t('editorPage.scanProject')}
                  </Button>
                </span>
              </Tooltip>
            </>
          ))}

        {/* 同步到画布 / 更多画像 / 打开源码（仅代码场景；书场景的画板/插画/AI 在上方行1） */}
        {!isBookScene && files.length > 0 && !scanning && (
          <>
            <Tooltip title={t('editorPage.syncTip')}>
              <Button
                size="small"
                variant="outlined"
                sx={{ fontSize: 11, minWidth: 0, px: 1 }}
                startIcon={<AccountTreeIcon sx={{ fontSize: 13 }} />}
                onClick={handleSyncToCanvas}
              >
                {!compact && t('editorPage.syncToCanvas')}
              </Button>
            </Tooltip>
            <Tooltip title={t('editorPage.morePortraitsTip')}>
              <Button
                size="small"
                variant="outlined"
                color="secondary"
                sx={{ fontSize: 11, minWidth: 0, px: 1 }}
                startIcon={<InsightsIcon sx={{ fontSize: 13 }} />}
                endIcon={<ArrowDropDownIcon sx={{ fontSize: 15 }} />}
                onClick={(e) => setPortraitAnchor(e.currentTarget)}
              >
                {!compact && t('editorPage.morePortraits')}
              </Button>
            </Tooltip>
            {isQuadrantView && (
              <Tooltip title={t('portrait.quadrant.searchTip')}>
                <TextField
                  size="small"
                  variant="outlined"
                  placeholder={t('portrait.quadrant.search')}
                  value={quadSearch}
                  onChange={(e) => setQuadSearch(e.target.value)}
                  sx={{ width: 188, fontSize: 11, '& .MuiInputBase-root': { height: 30 } }}
                  slotProps={{
                    input: {
                      startAdornment: <SearchIcon sx={{ fontSize: 14, color: 'text.secondary', mr: 0.5 }} />,
                    },
                  }}
                />
              </Tooltip>
            )}
            <Tooltip title={t('editorPage.openSourceTip')}>
              <Button
                size="small"
                variant="outlined"
                sx={{ fontSize: 11, minWidth: 0, px: 1 }}
                startIcon={<CodeIcon sx={{ fontSize: 13 }} />}
                onClick={() => {
                  if (!activeSceneId) return;
                  spawnCodeWorkbench('', null, activeSceneId).catch((e) => {
                    showToast(t('editorPage.openSourceFail', { error: String(e) }), 'error');
                  });
                }}
              >
                {!compact && t('editorPage.openSource')}
              </Button>
            </Tooltip>
            <Menu
              anchorEl={portraitAnchor}
              open={Boolean(portraitAnchor)}
              onClose={() => setPortraitAnchor(null)}
              slotProps={{ paper: { sx: { minWidth: 268 } } }}
            >
              {PORTRAIT_MENU.map((item) =>
                item.divider ? (
                  <ListSubheader key={item.key} sx={{ lineHeight: '30px', fontSize: 11 }}>
                    {t(item.labelKey)}
                  </ListSubheader>
                ) : (
                  <MenuItem
                    key={item.key}
                    onClick={() => {
                      setPortraitAnchor(null);
                      void handlePortrait(item.kind!);
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 30, color: item.color }}>{item.icon}</ListItemIcon>
                    <ListItemText
                      primary={t(item.labelKey)}
                      secondary={item.descKey ? t(item.descKey) : undefined}
                      slotProps={{
                        primary: { sx: { fontSize: 13 } },
                        secondary: { sx: { fontSize: 11 } },
                      }}
                    />
                  </MenuItem>
                ),
              )}
            </Menu>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {t('editorPage.totalFiles', { n: files.length })}
            </Typography>
          </>
        )}

        {/* 问题计数（仅代码场景；书场景的在上方行2 右端） */}
        {!isBookScene && findings.length > 0 && !scanning && (
          <Typography
            variant="caption"
            sx={{
              ml: 1,
              px: 1,
              py: 0.25,
              borderRadius: 1,
              bgcolor: () =>
                findings.some((f) => f.severity === 'critical')
                  ? 'error.main'
                  : findings.some((f) => f.severity === 'warning')
                    ? 'warning.main'
                    : 'info.main',
              color: 'common.white',
              fontSize: 10,
            }}
          >
            {t('editorPage.totalFindings', { n: findings.length })}
          </Typography>
        )}
      </Box>

      {/* 主编辑区 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {isBookScene ? (
          /* 书场景**永远**渲染编辑器壳（2026-09-19 拍板）：左载体栏/右属性栏/L2 页签
             不论有没有书与章节数据都必须在位，初始化默认落「大纲」页签（SceneEditor 内）。
             空数据由画布内 V4 引导（无载体居中提示，不拦拖放）承接，绝不吞掉整个编辑壳。 */
          <SceneEditor
            onOpenLayersDialog={() => setLayersDialogOpen(true)}
            onSyncToCanvas={handleSyncToCanvas}
            syncing={syncing}
            onReparseBook={handleParseBook}
            onOpenCanvasAi={() => setCanvasAiOpen(true)}
          />
        ) : !scanning && (!projectRoot || files.length === 0) ? (
          <ScanEmptyState
            projectRoot={projectRoot}
            filesCount={files.length}
            scanning={scanning}
            onSelectRoot={handleSelectRoot}
            onScan={handleScan}
          />
        ) : (
          <SceneEditor
            onOpenLayersDialog={() => setLayersDialogOpen(true)}
            onSyncToCanvas={handleSyncToCanvas}
            syncing={syncing}
            onReparseBook={handleParseBook}
            onOpenCanvasAi={() => setCanvasAiOpen(true)}
          />
        )}
      </Box>

      {/* 架构分层管理对话框 */}
      <ArchitectureLayersPanel
        open={layersDialogOpen}
        onClose={() => setLayersDialogOpen(false)}
        analysisId={activeSceneId}
      />

      {/* 人物出场画像对话框已摘除（方案 A）：图谱已迁入写作台（人物出场图谱面板），
          工作室不再保留图鉴入口（实体图鉴页整体移除） */}

      {/* 扫描设置对话框（R40）：gitignore 提示 + 手动排除目录 + 非代码资源开关 */}
      <Dialog open={scanSettingsOpen} onClose={() => setScanSettingsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 15, pb: 1 }}>{t('editorPage.scanSettingsTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {/* gitignore 状态提示 */}
          {hasGitignore === true && (
            <Box
              sx={{
                px: 1,
                py: 0.75,
                borderRadius: 1,
                backgroundColor: 'success.soft',
                fontSize: 12,
                color: 'success.main',
                lineHeight: 1.5,
              }}
            >
              {t('editorPage.gitignoreFound')}
            </Box>
          )}
          {hasGitignore === false && (
            <Box
              sx={{
                px: 1,
                py: 0.75,
                borderRadius: 1,
                backgroundColor: 'warning.soft',
                fontSize: 12,
                color: 'warning.main',
                lineHeight: 1.5,
              }}
            >
              {t('editorPage.gitignoreNotFound')}
            </Box>
          )}

          <TextField
            label={t('editorPage.excludeDirsLabel')}
            size="small"
            fullWidth
            value={excludeDirsText}
            onChange={(e) => setExcludeDirsText(e.target.value)}
            placeholder="legacy, vendor, assets"
            helperText={t('editorPage.excludeDirsHelper')}
          />

          <FormControlLabel
            control={
              <Switch size="small" checked={excludeResources} onChange={(e) => setExcludeResources(e.target.checked)} />
            }
            label={
              <Typography variant="body2" sx={{ fontSize: 13 }}>
                {t('editorPage.excludeResources')}
              </Typography>
            }
          />

          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
            {t('editorPage.builtinExcludes')}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 1.5 }}>
          <Button size="small" onClick={() => setScanSettingsOpen(false)}>
            {t('editorPage.cancel')}
          </Button>
          <Button size="small" variant="contained" onClick={saveScanSettings}>
            {t('editorPage.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 统一命令面板（对标 Zed command_palette，Ctrl/Cmd+Shift+P 打开）：项目 / 视图 / 画像 全动作驱动 */}
      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        commands={pageCommands}
        title={t('workbench.commandPalette')}
        placeholder={t('workbench.commandPalettePlaceholder')}
        emptyText={t('workbench.commandPaletteEmpty')}
      />

      {/* 素材库对话框（H2 插画链路）：顶栏插入 / 画布右键更换 共用 */}
      {pickerOpen && <AssetLibraryDialog key={pickerReplaceId ?? 'insert'} onPick={handlePickAsset} />}

      {/* 画布 AI 助手（H3）：AI 出方案 → 预览 → 应用/撤销 */}
      <CanvasAiDialog open={canvasAiOpen} onClose={() => setCanvasAiOpen(false)} />

      {/* 羽化 P：显式「新建作品」入口（空态 + 代码场景工具栏）共用命名向导 */}
      <NewBookDialog
        open={newBookOpen}
        onClose={() => setNewBookOpen(false)}
        onCreate={createBookNamed}
        onCreated={handleBookCreated}
        onError={handleBookCreateError}
      />
    </Box>
  );
}
