/**
 * AiAgentPage - AI助手 全页面
 *
 * 双栏布局：左侧对话列表 + 右侧聊天区域
 * 专为全页面设计，不复用侧边栏的 AiAgentPanel
 */
import { useState, useEffect, useRef, useMemo, useCallback, Component, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogContentText from '@mui/material/DialogContentText';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import Tooltip from '@mui/material/Tooltip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SettingsIcon from '@mui/icons-material/Settings';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InputAdornment from '@mui/material/InputAdornment';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import Popover from '@mui/material/Popover';
import ChatBubbleOutlinedIcon from '@mui/icons-material/ChatBubbleOutlined';
import StopIcon from '@mui/icons-material/Stop';
import ReplayIcon from '@mui/icons-material/Replay';
import LinkIcon from '@mui/icons-material/Link';
import PsychologyIcon from '@mui/icons-material/Psychology';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import PersonIcon from '@mui/icons-material/Person';
import ListAltIcon from '@mui/icons-material/ListAlt';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import SearchIcon from '@mui/icons-material/Search';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { projectScanApi } from '../services/projectScan';
import { useAgentStore } from '../store/agentStore';
import { useWritingStore } from '../store/writingStore';
import { useToastStore } from '../store/toastStore';
import OllamaLocalPanel from './OllamaLocalPanel';
import AboutPanel from './AboutPanel';
import { L } from '../ai/aiLang';
import { quickActionCopyFor, quickActionTermsFor, buildAnalyzePrompt, buildOutlinePrompt, buildCharacterPrompt } from '../ai/quickActionPrompts';
import { genreTagLabelKey } from '../utils/writingSchema';
import { AI_COLOR } from '../ai/aiBrand';
import { logger } from '../utils/logger';
import { authTypeAfterBaseUrlEdit, defaultAuthType, isLoopbackBaseUrl, providerKeyState } from '../utils/agentProviderKey';
import { t } from '../i18n';
import type { QuickActionKind } from '../ai/WelcomeView';
import { PROVIDER_COLORS, randomProviderColor, colorForProvider } from '../utils/providerColors';
import { stripHtmlText } from '../utils/writingProofread';
import { textToParagraphHtml } from '../ai/writingAssistant';
import { chapterWordCountFromHtml } from './writingPage/editorUtils';
import { AiInsightsPanel } from '../ai/AiInsightsPanel';
import { WritingBookInsights } from '../ai/WritingBookInsights';
import { WelcomeView } from '../ai/WelcomeView';
import { MessageBubble } from '../ai/chat/MessageBubble';
import { ToolCallCard } from '../ai/chat/ToolCallCard';
import { currentScrollBehavior } from '../utils/reducedMotion';
import { bookScopedConversations, describeConversationTitles } from '../utils/agentConversationScope';
import { confirmDestructive } from '../store/confirmStore';
import { uiFontSize } from '../theme/appearanceScales';
// import { AcpHostPanel } from '../ai/acp/AcpHostPanel'; // 已隐藏：ACP Host 后台静默运行，不暴露 UI

/**
 * 写作场景专用工具白名单（P1：写作工具集）。
 * 作为 allowedTools 单次传入 run_agent（additive override，不污染 Agent 持久配置）：
 * 当用户在写作页有激活书籍时，/ai 全页助手的每次发送都自动附带这七个写作工具，
 * 让 AI 能按需读取章节全文 / 章节目录 / 人设卡 / **作者自己的语料库**，
 * 并在审批闸门确认后直接写入正文、新建章节——写入一律先存版本快照，可随时恢复。
 *
 * search_corpus 排在这里的理由值得说明：语料库是作者亲手挑的参考句集合，
 * 助手谈「文风」时如果查不到它，就只能凭印象编一句「示例」——那是幻觉最容易被
 * 作者发现的场合，也是本产品最不该失手的场合。
 */
const WRITING_TOOLS = [
  'list_chapters',
  'read_chapter',
  'read_character_card',
  'search_corpus',
  'update_character_card',
  'write_chapter',
  'create_chapter',
] as const;

// ─── 顶部通栏：品牌 + Agent 选择 + 配置入口 ───
function AgentTopBar({ onOpenSettings, settingsOpen }: { onOpenSettings: () => void; settingsOpen: boolean }) {
  const { agents, selectedAgentId, selectAgent, loadAgents } = useAgentStore();

  // T5：顶部栏展示当前激活书籍/章节上下文，让 AI 状态透明
  const writingBooks = useWritingStore((s) => s.books);
  const writingChapters = useWritingStore((s) => s.chapters);
  const activeBookId = useWritingStore((s) => s.activeBookId);
  const activeChapterId = useWritingStore((s) => s.activeChapterId);
  const currentBook = writingBooks.find((b) => b.id === activeBookId);
  const currentChapter = writingChapters.find((c) => c.id === activeChapterId);

  useEffect(() => {
    loadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box
      sx={{
        height: 56,
        flexShrink: 0,
        px: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        zIndex: 5,
      }}
    >
      {/* T5：当前写作上下文徽章（有激活书籍时显示） */}
      {currentBook ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Chip
            size="small"
            icon={<MenuBookIcon sx={{ fontSize: uiFontSize(14) }} />}
            label={currentBook.title}
            color="primary"
            variant="outlined"
          />
          {currentChapter && (
            <Chip
              size="small"
              icon={<AutoStoriesIcon sx={{ fontSize: uiFontSize(14) }} />}
              label={currentChapter.title}
              variant="outlined"
            />
          )}
        </Box>
      ) : null}

      <Box sx={{ flex: 1 }} />

      {agents.length > 0 ? (
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <Select
            value={selectedAgentId || ''}
            onChange={(e) => selectAgent(e.target.value || null)}
            sx={{ fontSize: uiFontSize(13) }}
          >
            {agents.map((a) => (
              <MenuItem key={a.id} value={a.id} sx={{ fontSize: uiFontSize(13) }}>
                <SmartToyIcon sx={{ fontSize: uiFontSize(16), mr: 1, color: 'primary.main' }} />
                {a.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      ) : null}

      <IconButton
        onClick={onOpenSettings}
        aria-label={t('agent.sidebar.config')}
        sx={{
          bgcolor: settingsOpen ? 'primary.main' : 'action.selected',
          border: 1,
          borderColor: settingsOpen ? 'primary.main' : 'divider',
          borderRadius: 1.5,
          width: 36,
          height: 36,
          '&:hover': {
            bgcolor: settingsOpen ? 'primary.dark' : 'action.hover',
            borderColor: 'primary.main',
          },
        }}
      >
        <AutoAwesomeIcon
          sx={{
            fontSize: uiFontSize(20),
            color: settingsOpen ? 'primary.contrastText' : 'primary.main',
          }}
        />
      </IconButton>
    </Box>
  );
}

// ─── Error Boundary ───
class PageErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error) {
    logger.error('AiAgentPage', 'render crash', { error: error.message, stack: error.stack });
  }
  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="error">{this.state.error}</Typography>
          <Button sx={{ mt: 2 }} onClick={() => this.setState({ hasError: false })}>
            {t('agent.sidebar.retry')}
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════
//  主页面
// ═══════════════════════════════════════════════

export default function AiAgentPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchParams] = useSearchParams();

  // T7：从写作台跳转来 /ai?book=X&chapter=Y → 自动锁定书籍上下文
  const books = useWritingStore((s) => s.books);
  const activeBookId = useWritingStore((s) => s.activeBookId);
  const loadBooks = useWritingStore((s) => s.loadBooks);
  const setActiveBook = useWritingStore((s) => s.setActiveBook);
  const setActiveChapter = useWritingStore((s) => s.setActiveChapter);

  useEffect(() => {
    const urlBookId = searchParams.get('book');
    const urlChapterId = searchParams.get('chapter');
    if (!urlBookId) return;

    const sync = async () => {
      if (books.length === 0) {
        await loadBooks();
      }
      if (activeBookId !== urlBookId) {
        await setActiveBook(urlBookId);
      }
      if (urlChapterId) {
        setActiveChapter(urlChapterId);
      }
    };
    sync().catch(() => {});
    // 依赖以原始值形式抽离，避免 URLSearchParams 对象引用每次 render 变动导致死循环
  },
  /* eslint-disable react-hooks/exhaustive-deps */
  // searchParams 对象引用每次 render 新建（补了会死循环），改用 .get() 提取原始值订阅变化
  [
    searchParams.get('book'),
    searchParams.get('chapter'),
    books.length,
    activeBookId,
    loadBooks,
    setActiveBook,
    setActiveChapter,
  ]
  /* eslint-enable react-hooks/exhaustive-deps */);

  const closeSettings = () => setSettingsOpen(false);
  const toggleSettings = () => setSettingsOpen((s) => !s);

  return (
    <PageErrorBoundary>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          bgcolor: 'background.default',
        }}
      >
        <AgentTopBar onOpenSettings={toggleSettings} settingsOpen={settingsOpen} />
        <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <ConversationSidebar />
          <ChatArea settingsOpen={settingsOpen} onCloseSettings={closeSettings} />
        </Box>
      </Box>
    </PageErrorBoundary>
  );
}

// ═══════════════════════════════════════════════
//  左侧面板：对话列表
// ═══════════════════════════════════════════════

function ConversationSidebar() {
  const {
    conversations,
    selectedAgentId,
    selectedConversationId,
    selectConversation,
    loadConversations,
    createConversation,
    deleteConversation,
  } = useAgentStore();

  // 写作上下文用于会话命名与分组
  const writingBooks = useWritingStore((s) => s.books);
  const activeBookId = useWritingStore((s) => s.activeBookId);
  const activeChapterId = useWritingStore((s) => s.activeChapterId);
  const writingChapters = useWritingStore((s) => s.chapters);
  const currentBook = writingBooks.find((b) => b.id === activeBookId);
  const currentChapter = writingChapters.find((c) => c.id === activeChapterId);

  // T6：搜索 + 批量删除两步确认
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (selectedAgentId) {
      loadConversations(selectedAgentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentId]);

  // 搜索过滤（标题包含，忽略大小写）
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  /** 相对时间基准秒数（懒初始化 + 交互时刷新，避免渲染期调用不纯函数） */
  const [nowTs, setNowTs] = useState(() => Date.now() / 1000);
  const touchClock = () => setNowTs(Date.now() / 1000);

  /** 相对时间（刚刚 / N分钟前 / N小时前 / 昨天 / N天前） */
  const relTime = (ts: number) => {
    const diff = nowTs - ts;
    if (diff < 60) return t('agent.sidebar.justNow');
    if (diff < 3600) return t('agent.sidebar.minutesAgo', { n: Math.floor(diff / 60) });
    if (diff < 86400) return t('agent.sidebar.hoursAgo', { n: Math.floor(diff / 3600) });
    if (diff < 172800) return t('agent.sidebar.yesterday');
    return t('agent.sidebar.daysAgo', { n: Math.floor(diff / 86400) });
  };

  // 清空当前作品的全部会话（2026-11-04 删除铁律 + 全仓删除账 ③d）。
  // 三处改判据：
  //  ① 归属用**按分隔符切段后精确比对**代替 `title.includes(bookTitle)`——
  //    子串匹配会误删：删《长夜》会把《长夜难明》的会话一起带走；
  //  ② 把**将删清单原样列进确认弹窗**。会话表里没有归属列（ai_repository.rs:72-78 只有
  //    id/agent_id/title/时间），归属只能从标题读，所以边界必须让用户看见——
  //    尤其是"改过书名后旧书名下的会话不在本次范围内"这件事，以前是删完才发现；
  //  ③ 换掉旧的"两步点击 + 一句『确认清空？』"：不给条数、不给名单、还会 3 秒后自己失效。
  const handleClearBook = () => {
    const bookTitle = currentBook?.title;
    if (!bookTitle) return;
    const targets = bookScopedConversations(conversations, bookTitle);
    if (targets.length === 0) {
      // 没得删就如实说一句，不弹一张"确认删除 0 个"的窗
      useToastStore.getState().info(t('agent.sidebar.clearBookConvosNothing'));
      return;
    }
    confirmDestructive({
      title: t('agent.sidebar.clearBookConvosConfirmTitle', { n: targets.length }),
      impact: [
        t('agent.sidebar.clearBookConvosImpactList', {
          list: describeConversationTitles(targets.map((c) => c.title)),
        }),
        t('agent.sidebar.clearBookConvosImpactUndo'),
        t('agent.sidebar.clearBookConvosImpactScope'),
      ],
      confirmLabel: t('agent.sidebar.clearBookConvos'),
      cancelLabel: t('ui.cancel'),
      onConfirm: () => {
        targets.forEach((c) => {
          void deleteConversation(c.id);
        });
      },
    });
  };

  return (
    <Box
      sx={{
        width: 280,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      {/* 新建对话按钮 */}
      {selectedAgentId && (
        <Box sx={{ p: 1.5, pb: 1 }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              const suffix = currentBook
                ? currentChapter
                  ? ` · ${currentBook.title} › ${currentChapter.title}`
                  : ` · ${currentBook.title}`
                : '';
              const title = (t('agent.sidebar.newChat') + suffix).slice(0, 80);
              createConversation(selectedAgentId, title);
            }}
            sx={{
              textTransform: 'none',
              fontSize: uiFontSize(13),
              fontWeight: 500,
              py: 1,
              borderRadius: 2,
              boxShadow: '0 2px 8px rgb(var(--template-palette-primary-mainChannel) / 0.2)',
            }}
          >
            {t('agent.sidebar.newChat')}
          </Button>
        </Box>
      )}

      {/* T6：搜索框 */}
      {conversations.length > 0 && (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <TextField
            size="small"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              touchClock();
            }}
            placeholder={t('agent.sidebar.searchPlaceholder')}
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: uiFontSize(16), color: 'text.secondary' }} />
                  </InputAdornment>
                ),
                endAdornment: search ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => {
                        setSearch('');
                        touchClock();
                      }}
                      aria-label={t('agent.sidebar.clearSearch')}
                      sx={{ p: 0.25 }}
                    >
                      <CloseIcon sx={{ fontSize: uiFontSize(14) }} />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              },
            }}
            sx={{
              '& .MuiInputBase-root': { fontSize: uiFontSize(12.5), borderRadius: 1.5 },
            }}
          />
        </Box>
      )}

      {/* 对话列表：按当前作品分组 */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 1.5, pb: 1.5 }}>
        {filtered.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <ChatBubbleOutlinedIcon sx={{ fontSize: uiFontSize(40), opacity: 0.15, mb: 1 }} />
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: uiFontSize(13) }}>
              {search ? t('agent.sidebar.noMatch') : t('agent.sidebar.noConversations')}
            </Typography>
            {!search && (
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: uiFontSize(11) }}>
                {t('agent.sidebar.clickToStart')}
              </Typography>
            )}
          </Box>
        ) : (
          (() => {
            const bookTitle = currentBook?.title;
            // 与「清空该作品对话」用同一把尺子（utils/agentConversationScope）：
            // 分组和删除只要各用一套判据，就会出现"列在本书下、却删不掉"或反之。
            const currentConvos = bookScopedConversations(filtered, bookTitle);
            const otherConvos = bookTitle ? filtered.filter((c) => !currentConvos.includes(c)) : filtered;

            const renderItem = (c: (typeof filtered)[0]) => {
              const selected = c.id === selectedConversationId;
              return (
                <Paper
                  key={c.id}
                  variant="outlined"
                  onClick={() => selectConversation(c.id)}
                  sx={{
                    px: 1.5,
                    py: 1,
                    mb: 1,
                    borderRadius: 2,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    borderColor: selected ? 'primary.main' : 'divider',
                    bgcolor: selected ? 'rgb(var(--template-palette-primary-mainChannel) / 0.06)' : 'transparent',
                    transition: 'all 0.15s',
                    '&:hover': {
                      borderColor: 'primary.main',
                      bgcolor: 'action.hover',
                    },
                  }}
                >
                  <ChatBubbleOutlinedIcon
                    sx={{
                      fontSize: uiFontSize(16),
                      color: selected ? 'primary.main' : 'text.secondary',
                      flexShrink: 0,
                    }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      noWrap
                      sx={{
                        fontSize: uiFontSize(13),
                        fontWeight: selected ? 600 : 400,
                      }}
                    >
                      {c.title}
                    </Typography>
                    <Typography sx={{ fontSize: uiFontSize(10.5), color: 'text.disabled', mt: 0.25 }}>
                      {relTime(c.updatedAt)}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(c.id);
                    }}
                    sx={{ p: 0.5, opacity: 0.5, '&:hover': { opacity: 1 } }}
                  >
                    <DeleteIcon sx={{ fontSize: uiFontSize(14) }} />
                  </IconButton>
                </Paper>
              );
            };

            return (
              <>
                {bookTitle && currentConvos.length > 0 && (
                  <>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        px: 0.5,
                        pb: 0.5,
                        pt: 1,
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: uiFontSize(11),
                          fontWeight: 700,
                          color: 'primary.main',
                        }}
                      >
                        {t('agent.sidebar.currentBook')}
                      </Typography>
                      {!search && (
                        <Tooltip title={t('agent.sidebar.clearBookConvos')}>
                          <IconButton
                            size="small"
                            onClick={handleClearBook}
                            aria-label={t('agent.sidebar.clearBookConvos')}
                            sx={{
                              p: 0.4,
                              color: 'text.disabled',
                              borderRadius: 1,
                              '&:hover': { color: 'error.main' },
                            }}
                          >
                            <DeleteIcon sx={{ fontSize: uiFontSize(13) }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                    {currentConvos.map(renderItem)}
                  </>
                )}
                {otherConvos.length > 0 && (
                  <>
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: uiFontSize(11),
                        fontWeight: 700,
                        color: 'text.disabled',
                        px: 0.5,
                        pb: 0.5,
                        pt: bookTitle && currentConvos.length > 0 ? 1 : 0,
                        display: 'block',
                      }}
                    >
                      {t('agent.sidebar.otherChats')}
                    </Typography>
                    {otherConvos.map(renderItem)}
                  </>
                )}
              </>
            );
          })()
        )}
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════
//  右侧面板：聊天区域
// ═══════════════════════════════════════════════

function ChatArea({ settingsOpen, onCloseSettings }: { settingsOpen: boolean; onCloseSettings: () => void }) {
  // 润色快捷动作的目标：{conversationId, chapterId, chapterTitle}；无目标时为 null。
  // 消息视图据此在最后一条完整润色回复下方展示「覆盖到当前章节」入口。
  const [polishTarget, setPolishTarget] = useState<{
    conversationId: string;
    chapterId: string;
    chapterTitle: string;
  } | null>(null);
  const {
    selectedConversationId,
    selectedAgentId,
    agents,
    sendMessage,
    createConversation,
    selectConversation,
    conversations,
  } = useAgentStore();

  // 写作上下文：供快捷入口调用
  const writingBooks = useWritingStore((s) => s.books);
  const writingChapters = useWritingStore((s) => s.chapters);
  const writingSettings = useWritingStore((s) => s.settings);
  const writingOutlines = useWritingStore((s) => s.outlines);
  const activeBookId = useWritingStore((s) => s.activeBookId);
  const activeChapterId = useWritingStore((s) => s.activeChapterId);
  const currentBook = writingBooks.find((b) => b.id === activeBookId);
  const currentChapter = writingChapters.find((c) => c.id === activeChapterId);

  const handleQuickAction = async (kind: QuickActionKind) => {
    if (!selectedAgentId || !currentBook) return;
    // 发送前自动注入写作上下文（复用 MessageView 的注入逻辑，这里直接走发送管道）
    let content: string = '';
    const bookTitle = currentBook.title;
    const chapterTitle = currentChapter?.title ?? '';
    const chapterText = currentChapter?.content ?? '';
    // ㉝ AI-2b（轮 9）：发出去的话按体裁取。单位词表与指令文案的真源在 `quickActionPrompts`
    // （判据 = `workbenchCommandSet`，未设/脏值落小说格 = 改造前逐字节）；卡面话同批改词走
    // `aiCardDescKey`（writingSchema），两边配对着色由测试锁在同一批现成名词上。
    const terms = quickActionTermsFor(currentBook.genre);
    const copy = quickActionCopyFor(currentBook.genre);
    // 脏读数修复（队列 AI-2b 点名）：prompt 里的体裁必须是**显示名**，模型读不懂 schema id。
    // 空体裁旧书不拼括号（与改造前一致）；未登记值按全仓口径落小说词（`genreTagLabelKey`）。
    const genreTag = currentBook.genre ? `（${t(genreTagLabelKey(currentBook.genre))}）` : '';

    switch (kind) {
      case 'continue': {
        const tail = chapterText.slice(-3000);
        const chars = writingSettings
          .filter((s) => s.kind === 'character')
          .map((c) => `- ${c.name}${c.description ? `：${c.description.slice(0, 60)}` : ''}`);
        const outlineLines = writingOutlines
          .filter((o) => o.chapterId === activeChapterId)
          .map((o) => `- ${o.title}${o.summary ? `：${o.summary.slice(0, 50)}` : ''}`);
        const ctx = [
          `【当前作品】${bookTitle}${genreTag}`,
          `【${terms.currentUnitLabel}】${chapterTitle}${currentChapter?.wordCount ? `（${currentChapter.wordCount}字）` : ''}`,
          ...(chars.length ? [`【${terms.personaLabel}】`, ...chars] : []),
          ...(outlineLines.length ? [`【${terms.outlineLabel}】`, ...outlineLines] : []),
          `【${terms.progressLabel}】共${writingChapters.length}${terms.unitMeasure}，已完稿${writingChapters.filter((c) => c.status === 'completed').length}${terms.unitMeasure}`,
        ].join('\n');
        content = `${ctx}\n\n---\n\n${L(copy.continueIntro.zh, copy.continueIntro.en)}\n\n【已有正文（末尾）】\n${tail}\n\n${L(copy.continueTail.zh, copy.continueTail.en)}`;
        break;
      }
      case 'polish': {
        const ctx = [
          `【当前作品】${bookTitle}`,
          `【${terms.currentUnitLabel}】${chapterTitle}${currentChapter?.wordCount ? `（${currentChapter.wordCount}字）` : ''}`,
        ].join('\n');
        content = `${ctx}\n\n---\n\n${L(copy.polish.zh, copy.polish.en)}\n\n【原文】\n${chapterText}`;
        break;
      }
      case 'analyze': {
        const completed = writingChapters.filter((c) => c.status === 'completed').length;
        const total = writingChapters.length;
        const chars = writingSettings
          .filter((s) => s.kind === 'character')
          .map((c) => `- ${c.name}${c.description ? `：${c.description.slice(0, 60)}` : ''}`);
        const outlineLines = writingOutlines
          .filter((o) => o.chapterId === activeChapterId)
          .map((o) => `- ${o.title}${o.summary ? `：${o.summary.slice(0, 50)}` : ''}`);
        const ctx = [
          `【当前作品】${bookTitle}${genreTag}`,
          `【${terms.currentUnitLabel}】${chapterTitle}${currentChapter?.wordCount ? `（${currentChapter.wordCount}字）` : ''}`,
          ...(chars.length ? [`【${terms.personaLabel}】`, ...chars] : []),
          ...(outlineLines.length ? [`【${terms.outlineLabel}】`, ...outlineLines] : []),
          `【${terms.progressLabel}】共${total}${terms.unitMeasure}，已完稿${completed}${terms.unitMeasure}`,
        ].join('\n');
        // ㉞ AI-2b′（轮 11）：五维诊断模板按体裁取，真源 = `quickActionPrompts` 的 DIAGNOSE。
        // 改造前这里整段写死小说：诗集收到的是「维度 1 · 情节破洞」「维度 5 · 伏笔状态」，
        // 而这两栏在 `hiddenViewKindsForGenre` 里早被诗集裁掉了。组装也放在模块里 —— 页面
        // 只调一个函数拿一整段成品，不给「算好了没接到行上」（AU-7 ⑨）留缝。
        content = `${ctx}\n\n---\n\n${buildAnalyzePrompt(currentBook.genre)}`;
        break;
      }
      case 'outline': {
        const total = writingChapters.length;
        const completed = writingChapters.filter((c) => c.status === 'completed').length;
        const ctx = [
          `【当前作品】${bookTitle}${genreTag}`,
          `【${terms.currentUnitLabel}】${chapterTitle}${currentChapter?.wordCount ? `（${currentChapter.wordCount}字）` : ''}`,
          `【${terms.progressLabel}】共${total}${terms.unitMeasure}，已完稿${completed}${terms.unitMeasure}`,
        ].join('\n');
        // ㉞ AI-2b′：大纲指令同上（Record 穷尽 = 编译期锁；页面不再自持小说模板）
        content = `${ctx}\n\n---\n\n${buildOutlinePrompt(currentBook.genre)}`;
        break;
      }
      case 'character': {
        const chars = writingSettings
          .filter((s) => s.kind === 'character')
          .map((c) => `- ${c.name}${c.description ? `：${c.description.slice(0, 80)}` : ''}`);
        const ctx = [
          `【当前作品】${bookTitle}${genreTag}`,
          ...(chars.length ? ['【现有角色】', ...chars] : []),
        ].join('\n');
        // ㉠ AI-2b″（轮 13）：角色诊断指令按体裁取。角色卡对五种载体都可见，小说那六条
        // （反派动机 / 配角脸谱 / 成长弧线 / 与主线的关联度）对诗集日记是错误任务单。
        // 真源 = `quickActionPrompts` 的 CHARACTER（novel 格逐字节 = 改造前本页字面量）。
        content = `${ctx}\n\n---\n\n${buildCharacterPrompt(currentBook.genre)}`;
        break;
      }
      case 'world': {
        const ctx = [
          `【当前作品】${bookTitle}${genreTag}`,
          `【${terms.currentUnitLabel}】${chapterTitle}`,
        ].join('\n');
        content = `${ctx}\n\n---\n\n${L('请为当前作品构建或优化世界观设定。\n\n要求：\n1. 梳理已呈现的世界规则（物理法则、社会结构、文化习俗、历史背景），检查是否前后矛盾\n2. 补充「作者已暗示但未明说」的设定细节，提升沉浸感\n3. 评估当前设定的「叙事利用率」：哪些设定被充分利用，哪些只是背景板\n4. 提出 3-5 个可增强戏剧张力的世界规则冲突点\n5. 如有科幻/奇幻元素，检查其内部逻辑自洽性（能力代价、限制条件、副作用）\n6. 输出形式：设定文档 + 冲突点清单 + 叙事建议', 'Please build or optimize the world-building for the current work.\n\nRequirements:\n1. Review presented world rules (physics, social structures, cultural customs, historical background); check for internal contradictions\n2. Supplement implied-but-unstated setting details to enhance immersion\n3. Evaluate narrative utilization rate: which settings are leveraged vs. mere backdrop\n4. Propose 3-5 world-rule conflict points that can heighten dramatic tension\n5. If sci-fi/fantasy elements exist, verify internal logical consistency (costs, constraints, side effects)\n6. Output format: setting document + conflict list + narrative suggestions')}`;
        break;
      }
    }

    // 创建会话并直接发送消息
    const suffix = currentChapter ? ` · ${bookTitle} › ${chapterTitle}` : ` · ${bookTitle}`;
    const titleMap: Record<QuickActionKind, string> = {
      continue: L('续写', 'Continue'),
      polish: L('润色', 'Polish'),
      analyze: L('分析', 'Analyze'),
      outline: L('大纲', 'Outline'),
      character: L('角色', 'Character'),
      world: L('世界观', 'World'),
    };
    const title = titleMap[kind] + suffix;
    const conv = await createConversation(selectedAgentId, title);
    selectConversation(conv.id);
    await sendMessage(conv.id, content, WRITING_TOOLS as unknown as string[]);

    // 润色快捷动作：记录目标会话 + 目标章节，供结果消息下方展示「覆盖到当前章节」
    if (kind === 'polish' && activeChapterId) {
      setPolishTarget({
        conversationId: conv.id,
        chapterId: activeChapterId,
        chapterTitle: currentChapter?.title ?? '',
      });
    } else if (kind !== 'polish') {
      setPolishTarget(null);
    }
  };

  const currentAgent = agents.find((a) => a.id === selectedAgentId);

  if (!selectedConversationId) {
    return (
      <Box
        sx={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        <WelcomeView
          agentName={currentAgent?.name}
          onQuickAction={handleQuickAction}
          currentBook={currentBook ?? undefined}
          currentChapter={
            currentChapter ? { title: currentChapter.title, wordCount: currentChapter.wordCount } : undefined
          }
          conversations={conversations}
          onSelectConversation={(id) => selectConversation(id)}
        />
        <Divider />
        {/* 空态洞察分流：写作台有激活书籍 → 展示当前书籍 AI 洞察摘要（大纲/人物/续写历史）；
            否则保留代码分析洞察 */}
        {currentBook ? <WritingBookInsights /> : <AiInsightsPanel />}
        <SettingsDrawer open={settingsOpen} onClose={onCloseSettings} />
      </Box>
    );
  }

  return <MessageView settingsOpen={settingsOpen} onCloseSettings={onCloseSettings} polishTarget={polishTarget} />;
}

// ─── AI 配置抽屉 ───
// 局部面板：在所属容器（聊天区 / 消息视图）内部右滑展开，不影响顶部导航与左侧边栏

function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {/* 遮罩：只在抽屉所在容器内生效
          背景用标准遮断级（MUI backdrop 0.5）：原 0.18 过淡，下层欢迎区/书籍洞察整块透出，
          与面板叠印成「元素重合」（2026-10-10 修复，同 ChapterTreePanel 行尾浮层） */}
      <Box
        onClick={onClose}
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          bgcolor: 'rgba(0,0,0,0.5)',
          transition: 'opacity 0.2s',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
        }}
      />
      {/* 抽屉面板 */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: { xs: '100%', sm: 600, md: 720 },
          bgcolor: 'background.paper',
          borderLeft: 1,
          borderColor: 'divider',
          zIndex: 11,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
          display: 'flex',
          flexDirection: 'column',
          userSelect: 'none',
          touchAction: 'pan-y',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <Box
          sx={{
            px: 3,
            py: 2,
            display: 'flex',
            alignItems: 'center',
            borderBottom: 1,
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          <Typography sx={{ flex: 1, fontSize: uiFontSize(16), fontWeight: 600 }}>
            {t('agent.settings.title')}
          </Typography>
          <IconButton onClick={onClose} aria-label={t('agent.settings.close')} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SettingsView />
        </Box>
      </Box>
    </>
  );
}

// ─── 消息视图 ───

function MessageView({
  settingsOpen,
  onCloseSettings,
  polishTarget,
}: {
  settingsOpen: boolean;
  onCloseSettings: () => void;
  polishTarget?: { conversationId: string; chapterId: string; chapterTitle: string } | null;
}) {
  const {
    messages,
    selectedConversationId,
    streamingContent,
    isStreaming,
    interruptRequested,
    toolCalls,
    sendMessage,
    agents,
    selectedAgentId,
    loading,
    // 流归属：streamingContent/isStreaming/错误是全局状态，同窗口多 AI 入口共享——
    // 只有「最新一轮流式属于当前选中会话」时才渲染流式轨迹/错误气泡，防止别处发起的流串台。
    currentStreamConversationId,
    lastStreamError,
    stoppedConversationId,
  } = useAgentStore();

  // 润色覆盖到章节：目标会话消息下方提供「覆盖到当前章节」，确认后整章替换
  const saveChapterContent = useWritingStore((s) => s.saveChapterContent);
  const [polishApplyOpen, setPolishApplyOpen] = useState(false);
  const [polishApplying, setPolishApplying] = useState(false);
  const [polishApplyTarget, setPolishApplyTarget] = useState<{ chapterId: string; chapterTitle: string } | null>(null);
  const applyPolishChapter = useCallback(async () => {
    if (!polishApplyTarget || polishApplying) return;
    // 取目标会话最后一条完整 assistant 回复作为替换内容
    const last = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.conversationId === selectedConversationId && m.content.trim());
    if (!last) return;
    setPolishApplying(true);
    try {
      const html = textToParagraphHtml(last.content);
      const wordCount = chapterWordCountFromHtml(html);
      await saveChapterContent(polishApplyTarget.chapterId, html, wordCount);
      setPolishApplyOpen(false);
      useToastStore.getState().success(t('agent.chat.polishApplied', { title: polishApplyTarget.chapterTitle }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('AiAgentPage', 'apply polish to chapter failed', { error: e });
      useToastStore.getState().error(t('agent.chat.polishApplyFailed', { msg }));
    } finally {
      setPolishApplying(false);
    }
  }, [messages, polishApplyTarget, polishApplying, saveChapterContent, selectedConversationId]);

  // 写作上下文注入：订阅当前激活书籍/章节/设定/大纲
  const writingBooks = useWritingStore((s) => s.books);
  const writingChapters = useWritingStore((s) => s.chapters);
  const writingSettings = useWritingStore((s) => s.settings);
  const writingOutlines = useWritingStore((s) => s.outlines);
  const activeBookId = useWritingStore((s) => s.activeBookId);
  const activeChapterId = useWritingStore((s) => s.activeChapterId);
  const booksLoading = useWritingStore((s) => s.booksLoading);
  const loadBooks = useWritingStore((s) => s.loadBooks);
  const setActiveBook = useWritingStore((s) => s.setActiveBook);
  const setActiveChapter = useWritingStore((s) => s.setActiveChapter);

  const currentBook = writingBooks.find((b) => b.id === activeBookId);
  const currentChapter = writingChapters.find((c) => c.id === activeChapterId);
  // ㉞ AI-2b′：常规发送与「快捷插入」的单位词按体裁取（真源 = quickActionPrompts 的 TERMS）。
  // 没有激活书籍时落小说格，而这四处本来就只在写作场景里可达。
  const terms = quickActionTermsFor(currentBook?.genre ?? '');

  // 首次进入消息视图：若书籍列表未加载则补拉，保证作品选择器可用
  useEffect(() => {
    if (writingBooks.length === 0 && !booksLoading) {
      loadBooks().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<number | null>(null);
  const isNearBottomRef = useRef(true);
  /** 最近一次本页发起的请求（实际发送全文），供错误态「重试」原样重发 */
  const lastSentRef = useRef<string | null>(null);

  const scrollToBottom = (behavior: ScrollBehavior = currentScrollBehavior()) => {
    if (!scrollContainerRef.current) return;
    const el = scrollContainerRef.current;
    if (isNearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    }
  };

  useEffect(() => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    // 流式中用瞬时滚动（对齐 openclaw scrollToEnd({behavior:'auto'})）：
    // smooth 动画在 48ms 级高频 flush 下会不断被打断重启动画，造成滚轮追尾抖动；
    // 结束/新消息时才恢复平滑滚动。
    scrollTimer.current = window.setTimeout(() => scrollToBottom(isStreaming ? 'auto' : currentScrollBehavior()), 60);
    return () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
    // scrollToBottom 只读 ref（scrollContainerRef/isNearBottomRef），函数引用变化无需重跑
  }, [messages.length, streamingContent, isStreaming]);

  const handleSend = () => {
    if (!input.trim() || !selectedConversationId || isStreaming) return;

    let content = input.trim();

    // 自动注入写作上下文（仅当用户在写作页有激活书籍时）
    if (currentBook) {
      const ctxLines: string[] = [];
      // 作品 id 必须随上下文给出：写作域工具（章节目录/人设卡）按 id 取数，
      // 只给书名的话模型会把书名当 book_id 传，触发查无此书。
      ctxLines.push(
        L(
          `【当前作品】《${currentBook.title}》${currentBook.genre ? `（${t(genreTagLabelKey(currentBook.genre))}）` : ''}（作品 id：${currentBook.id}）`,
          `[Current Book] "${currentBook.title}"${currentBook.genre ? ` (${t(genreTagLabelKey(currentBook.genre))})` : ''} (book id: ${currentBook.id})`,
        ),
      );

      if (currentChapter) {
        const vol = currentChapter.volume ? `${currentChapter.volume} · ` : '';
        ctxLines.push(
          L(
            `【${terms.currentUnitLabel}】${vol}${currentChapter.title}${currentChapter.wordCount ? `（${currentChapter.wordCount}字）` : ''}（${terms.idLabel}：${currentChapter.id}）`,
            `[${terms.currentUnitEn}] ${vol}${currentChapter.title}${currentChapter.wordCount ? ` (${currentChapter.wordCount} chars)` : ''} (${terms.idEn}: ${currentChapter.id})`,
          ),
        );
      }

      const chars = writingSettings.filter((s) => s.kind === 'character').slice(0, 5);
      if (chars.length) {
        ctxLines.push(L(`【${terms.personaLabel}】`, `[${terms.personaEn}]`));
        chars.forEach((c) => {
          ctxLines.push(`- ${c.name}${c.description ? `：${c.description.slice(0, 60)}` : ''}`);
        });
      }

      const relOutlines = writingOutlines.filter((o) => o.chapterId === activeChapterId).slice(0, 8);
      if (relOutlines.length) {
        ctxLines.push(L(`【${terms.outlineLabel}】`, `[${terms.outlineEn}]`));
        relOutlines.forEach((o) => {
          ctxLines.push(`- ${o.title}${o.summary ? `：${o.summary.slice(0, 50)}` : ''}`);
        });
      }

      const completed = writingChapters.filter((c) => c.status === 'completed').length;
      ctxLines.push(
        L(
          `【${terms.progressLabel}】共${writingChapters.length}${terms.unitMeasure}，已完稿${completed}${terms.unitMeasure}`,
          `[Progress] ${writingChapters.length} total, ${completed} completed`,
        ),
      );

      content = ctxLines.join('\n') + '\n\n---\n\n' + content;
    }

    // 写作场景：有激活书籍时附带写作工具白名单（additive，不污染 Agent 配置）
    lastSentRef.current = content;
    sendMessage(selectedConversationId, content, currentBook ? (WRITING_TOOLS as unknown as string[]) : undefined);
    setInput('');
  };

  // 错误态「重试」：原样重发最近一次内容；先重拉消息刷新乐观态，再发起
  const handleRetry = useCallback(() => {
    const convId = selectedConversationId;
    if (!convId || !lastSentRef.current || isStreaming) return;
    void useAgentStore.getState().loadMessages(convId);
    sendMessage(convId, lastSentRef.current);
  }, [selectedConversationId, isStreaming, sendMessage]);

  // 本页会话「正在进行中的流」：全局闸门外再加归属校验，防止别处流串台
  const isOwnStreaming = isStreaming && currentStreamConversationId === selectedConversationId;

  // 润色覆盖目标：polish 快捷动作的会话、且最新一条完整 assistant 回复已就绪时，
  // 在该回复下方展示「覆盖到当前章节」。流式/中断/错误期间不展示，避免覆盖半截结果。
  const polishApplyMessageId = useMemo(() => {
    if (!polishTarget || polishTarget.conversationId !== selectedConversationId) return null;
    if (isOwnStreaming || stoppedConversationId === selectedConversationId) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.conversationId === selectedConversationId && m.content.trim()) {
        return m.id;
      }
    }
    return null;
  }, [polishTarget, selectedConversationId, isOwnStreaming, stoppedConversationId, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── 快捷素材插入（写作场景联动）──
  const [insertAnchor, setInsertAnchor] = useState<null | HTMLElement>(null);

  /** 章节末尾纯文本（剥 HTML） */
  const chapterTailText = useMemo(() => {
    if (!currentChapter?.content) return '';
    const text = stripHtmlText(currentChapter.content).trim();
    return text.length > 320 ? text.slice(-320) : text;
  }, [currentChapter]);

  /** 通用插入：把一段素材以引用块形式追加到输入框 */
  const appendToInput = (block: string) => {
    setInput((prev) => {
      const base = prev.trimEnd();
      return base ? `${base}\n\n${block}\n` : `${block}\n`;
    });
    setInsertAnchor(null);
  };

  const insertTail = () => {
    if (!chapterTailText) return;
    const quoted = chapterTailText
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    appendToInput(L(`【${terms.currentUnitLabel}末尾】\n${quoted}`, `[${terms.tailEn}]\n${quoted}`));
  };

  const insertCharacters = () => {
    const chars = writingSettings.filter((s) => s.kind === 'character').slice(0, 5);
    if (!chars.length) return;
    const lines = chars.map((c) => `- ${c.name}${c.description ? `：${c.description.slice(0, 60)}` : ''}`);
    appendToInput(L(`【${terms.personaLabel}】\n`, `[${terms.personaEn}]\n`) + lines.join('\n'));
  };

  const insertOutline = () => {
    const rel = writingOutlines.filter((o) => o.chapterId === activeChapterId).slice(0, 8);
    if (!rel.length) return;
    const lines = rel.map((o) => `- ${o.title}${o.summary ? `：${o.summary.slice(0, 50)}` : ''}`);
    appendToInput(L(`【${terms.outlineLabel}】\n`, `[${terms.outlineEn}]\n`) + lines.join('\n'));
  };

  /** 从本地选择文本文件（.txt/.md），读取内容以引用块插入输入框 */
  const insertLocalFile = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [
          { name: 'Text', extensions: ['txt', 'md', 'markdown'] },
          { name: 'All', extensions: ['*'] },
        ],
      });
      if (!selected) return;
      const filePath = typeof selected === 'string' ? selected : (selected[0] ?? '');
      if (!filePath) return;

      const buf = await projectScanApi.readFileBytes(filePath);
      const text = new TextDecoder('utf-8').decode(buf);
      const trimmed = text.trim();
      const maxChars = 2000;
      const excerpt = trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…（已截取前 ${maxChars} 字）` : trimmed;
      if (!excerpt) {
        useToastStore.getState().error(t('agent.chat.fileEmpty'));
        return;
      }
      const fileName = filePath.split('/').pop() ?? filePath;
      const quoted = excerpt
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
      appendToInput(L(`【文件引用：${fileName}】\n${quoted}`, `[File: ${fileName}]\n${quoted}`));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('AiAgentPage', 'insertLocalFile failed', { error: e });
      useToastStore.getState().error(t('agent.chat.fileReadFailed', { msg }));
    }
  };

  const currentAgent = agents.find((a) => a.id === selectedAgentId);

  return (
    <Box
      sx={{
        flex: 1,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      {/* 头部 */}
      <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'rgb(var(--template-palette-primary-mainChannel) / 0.1)',
          }}
        >
          <SmartToyIcon sx={{ fontSize: uiFontSize(18), color: 'primary.main' }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: uiFontSize(14), fontWeight: 600 }}>
            {currentAgent?.name || t('agent.panel.chat')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: uiFontSize(11) }}>
            {isOwnStreaming ? t('agent.chat.thinking') : t('agent.chat.ready')}
          </Typography>
        </Box>
        {!isStreaming && (
          <Tooltip title={t('agent.chat.newConversation')}>
            <IconButton
              onClick={async () => {
                if (!selectedAgentId) return;
                const title = L('新对话', 'New Chat');
                const conv = await useAgentStore.getState().createConversation(selectedAgentId, title);
                useAgentStore.getState().selectConversation(conv.id);
              }}
              size="small"
              sx={{ p: 0.75 }}
            >
              <AddIcon sx={{ fontSize: uiFontSize(20) }} />
            </IconButton>
          </Tooltip>
        )}
        {isOwnStreaming && <CircularProgress size={18} />}
      </Box>

      {/* 消息列表 */}
      <Box
        ref={scrollContainerRef}
        onScroll={() => {
          const el = scrollContainerRef.current;
          if (!el) return;
          isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        sx={{ flex: 1, overflow: 'auto', px: 3, py: 1.5 }}
      >
        {/* 加载态 / 空态 / 消息列表 */}
        {loading.messages && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 12,
              gap: 2,
            }}
          >
            <CircularProgress size={24} thickness={3} />
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: uiFontSize(13) }}>
              {t('agent.chat.loadingMessages')}
            </Typography>
          </Box>
        )}

        {!loading.messages && messages.length === 0 && !isStreaming && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 10,
              gap: 2.5,
            }}
          >
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: 2.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: (th) => `${th.palette.primary.main}10`,
              }}
            >
              <ChatBubbleOutlinedIcon sx={{ fontSize: uiFontSize(28), color: 'primary.main', opacity: 0.6 }} />
            </Box>
            <Typography variant="body1" sx={{ fontSize: uiFontSize(15), fontWeight: 500, color: 'text.primary' }}>
              {currentBook ? t('agent.chat.emptyWithBook') : t('agent.chat.emptyNoBook')}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontSize: uiFontSize(13),
                color: 'text.secondary',
                maxWidth: 360,
                textAlign: 'center',
                lineHeight: 1.6,
              }}
            >
              {currentBook
                ? t('agent.chat.emptyWithBookDesc', { book: currentBook.title })
                : t('agent.chat.emptyNoBookDesc')}
            </Typography>
            {currentBook && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center', mt: 1 }}>
                <Chip
                  size="small"
                  icon={<MenuBookIcon sx={{ fontSize: uiFontSize(14) }} />}
                  label={currentBook.title}
                  color="primary"
                  variant="outlined"
                />
                {currentChapter && (
                  <Chip
                    size="small"
                    icon={<AutoStoriesIcon sx={{ fontSize: uiFontSize(14) }} />}
                    label={`${currentChapter.title} · ${currentChapter.wordCount} 字`}
                    variant="outlined"
                  />
                )}
              </Box>
            )}
          </Box>
        )}

        {messages.map((msg) => (
          <Box key={msg.id}>
            <MessageBubble role={msg.role} content={msg.content} createdAt={msg.createdAt} toolCalls={msg.toolCalls} />
            {msg.id === polishApplyMessageId && polishTarget && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-start', px: 2, pb: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  color="primary"
                  startIcon={<AutoAwesomeIcon sx={{ fontSize: uiFontSize(14) }} />}
                  onClick={() => {
                    setPolishApplyTarget({
                      chapterId: polishTarget.chapterId,
                      chapterTitle: polishTarget.chapterTitle,
                    });
                    setPolishApplyOpen(true);
                  }}
                >
                  {t('agent.chat.polishApplyTitle', { title: polishTarget.chapterTitle })}
                </Button>
              </Box>
            )}
          </Box>
        ))}

        {/* 流式响应：与确认消息统一间距，无额外包裹层（仅归属本会话的流才渲染，防止别处串台） */}
        {isOwnStreaming && toolCalls.map((tc, i) => <ToolCallCard key={`tc-${i}`} toolCall={tc} />)}
        {isOwnStreaming && streamingContent && (
          <MessageBubble key="streaming" role="assistant" content={streamingContent} isStreaming />
        )}
        {isOwnStreaming && !streamingContent && toolCalls.length === 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: uiFontSize(13) }}>
              {t('agent.chat.thinkingShort')}
            </Typography>
          </Box>
        )}

        {/* 流错误回执：归属当前会话且不在流式中时，展示最近一轮错误 + 重试（错误优先于停止标注） */}
        {!isStreaming && lastStreamError && currentStreamConversationId === selectedConversationId && (
          <Alert
            severity="error"
            variant="outlined"
            sx={{ fontSize: uiFontSize(12), mt: 1, '& .MuiAlert-message': { py: 0.25 } }}
            action={
              <Button
                size="small"
                color="error"
                startIcon={<ReplayIcon sx={{ fontSize: uiFontSize(14) }} />}
                onClick={handleRetry}
              >
                {t('ui.retry')}
              </Button>
            }
          >
            {lastStreamError === 'timeout' ? t('agent.chat.timeout') : lastStreamError}
          </Alert>
        )}
        {/* 停止回执：后端会保留「已吐出的部分回答」并落库，不标注的话用户分不清是答完了还是被自己截断了 */}
        {!isStreaming && !lastStreamError && stoppedConversationId === selectedConversationId && (
          <Chip
            size="small"
            icon={<StopIcon sx={{ fontSize: uiFontSize(12) }} />}
            label={t('agent.chat.stopped')}
            color="error"
            variant="outlined"
            sx={{ fontSize: uiFontSize(10.5), height: 20, mt: 1 }}
          />
        )}

        <div ref={messagesEndRef} />
      </Box>

      {/* 润色覆盖回正文：整章替换属高影响操作，必须二次确认后才落库 */}
      <Dialog
        open={polishApplyOpen}
        onClose={() => {
          if (!polishApplying) setPolishApplyOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: uiFontSize(15) }}>{t('agent.chat.polishApplyConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: uiFontSize(13) }}>
            {t('agent.chat.polishApplyHint', { title: polishApplyTarget?.chapterTitle ?? '' })}
          </DialogContentText>
          <DialogContentText sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mt: 1 }}>
            {t('agent.chat.polishApplyCrossWindow')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button size="small" disabled={polishApplying} onClick={() => setPolishApplyOpen(false)}>
            {t('agent.chat.cancel')}
          </Button>
          <Button
            size="small"
            variant="contained"
            color="primary"
            disabled={polishApplying}
            startIcon={polishApplying ? <CircularProgress size={12} /> : undefined}
            onClick={() => void applyPolishChapter()}
          >
            {t('agent.chat.polishApplyConfirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 输入区 */}
      <Box
        sx={{
          px: 3,
          py: 1.5,
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ maxWidth: 900, mx: 'auto' }}>
          {/* 快捷操作工具栏：上下文选择 + 素材/文件插入 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75, flexWrap: 'wrap' }}>
            {/* 插入素材 / 文件按钮 */}
            <IconButton
              size="small"
              onClick={(e) => setInsertAnchor(e.currentTarget)}
              aria-label={t('agent.chat.insertMenu')}
              title={t('agent.chat.insertMenuTip')}
              sx={{ p: 0.5, mr: 0.25 }}
            >
              <AddIcon sx={{ fontSize: uiFontSize(18) }} />
            </IconButton>

            {/* 作品上下文选择器（books 非空时显示） */}
            {writingBooks.length > 0 && (
              <FormControl size="small" sx={{ minWidth: 150, maxWidth: 220 }}>
                <Select
                  value={activeBookId ?? ''}
                  onChange={(e) => {
                    const bookId = (e.target.value as string) || null;
                    setActiveBook(bookId);
                  }}
                  displayEmpty
                  renderValue={(v) => {
                    if (!v)
                      return (
                        <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary' }}>
                          {t('agent.chat.noBook')}
                        </Typography>
                      );
                    const book = writingBooks.find((b) => b.id === v);
                    return (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                        <MenuBookIcon sx={{ fontSize: uiFontSize(14), color: 'primary.main', flexShrink: 0 }} />
                        <Typography
                          sx={{
                            fontSize: uiFontSize(12),
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {book?.title ?? ''}
                        </Typography>
                      </Box>
                    );
                  }}
                  sx={{ fontSize: uiFontSize(12), '& .MuiSelect-select': { py: 0.75 } }}
                >
                  <MenuItem value="" sx={{ fontSize: uiFontSize(13) }}>
                    {t('agent.chat.noBook')}
                  </MenuItem>
                  {writingBooks.map((b) => (
                    <MenuItem key={b.id} value={b.id} sx={{ fontSize: uiFontSize(13) }}>
                      <MenuBookIcon sx={{ fontSize: uiFontSize(15), mr: 0.75, color: 'primary.main' }} />
                      {b.title}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {/* 章节上下文选择器（选中作品后显示）：T6 改为树形 Popover，支持卷/章层级展开 */}
            {currentBook && writingChapters.length > 0 && (
              <ChapterTreeSelector
                chapters={writingChapters}
                activeChapterId={activeChapterId}
                onSelect={(id) => setActiveChapter(id)}
                currentBook={currentBook}
              />
            )}

            {/* 插入素材 / 文件菜单 */}
            <Menu
              anchorEl={insertAnchor}
              open={Boolean(insertAnchor)}
              onClose={() => setInsertAnchor(null)}
              slotProps={{ paper: { sx: { minWidth: 220 } } }}
            >
              <MenuItem onClick={insertLocalFile}>
                <AttachFileIcon sx={{ fontSize: uiFontSize(17), mr: 1, color: 'info.main' }} />
                <Box>
                  <Typography sx={{ fontSize: uiFontSize(13), fontWeight: 600 }}>
                    {t('agent.chat.insertFile')}
                  </Typography>
                  <Typography sx={{ fontSize: uiFontSize(11), color: 'text.secondary' }}>
                    {t('agent.chat.insertFileTip')}
                  </Typography>
                </Box>
              </MenuItem>
              <Divider sx={{ my: 0.5 }} />
              <MenuItem onClick={insertTail} disabled={!chapterTailText}>
                <AutoStoriesIcon sx={{ fontSize: uiFontSize(17), mr: 1, color: 'primary.main' }} />
                <Box>
                  <Typography sx={{ fontSize: uiFontSize(13), fontWeight: 600 }}>
                    {t('agent.chat.insertTail')}
                  </Typography>
                  <Typography sx={{ fontSize: uiFontSize(11), color: 'text.secondary' }}>
                    {t('agent.chat.insertTailTip')}
                  </Typography>
                </Box>
              </MenuItem>
              <MenuItem onClick={insertCharacters}>
                <PersonIcon sx={{ fontSize: uiFontSize(17), mr: 1, color: 'secondary.main' }} />
                <Box>
                  <Typography sx={{ fontSize: uiFontSize(13), fontWeight: 600 }}>
                    {t('agent.chat.insertChars')}
                  </Typography>
                  <Typography sx={{ fontSize: uiFontSize(11), color: 'text.secondary' }}>
                    {t('agent.chat.insertCharsTip')}
                  </Typography>
                </Box>
              </MenuItem>
              <MenuItem onClick={insertOutline}>
                <ListAltIcon sx={{ fontSize: uiFontSize(17), mr: 1, color: 'warning.main' }} />
                <Box>
                  <Typography sx={{ fontSize: uiFontSize(13), fontWeight: 600 }}>
                    {t('agent.chat.insertOutline')}
                  </Typography>
                  <Typography sx={{ fontSize: uiFontSize(11), color: 'text.secondary' }}>
                    {t('agent.chat.insertOutlineTip')}
                  </Typography>
                </Box>
              </MenuItem>
            </Menu>
          </Box>

          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-end' }}>
            <TextField
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('agent.chat.placeholder')}
              fullWidth
              multiline
              minRows={1}
              maxRows={6}
              disabled={isStreaming}
              sx={{
                '& .MuiInputBase-root': {
                  fontSize: uiFontSize(14),
                  py: 1.25,
                  px: 2,
                  borderRadius: 2,
                },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'divider',
                },
                '& .Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'primary.main',
                  borderWidth: 1.5,
                },
              }}
            />
            {isOwnStreaming ? (
              <Tooltip title={t('agent.chat.stopTip')}>
                <IconButton
                  color="error"
                  disabled={interruptRequested}
                  onClick={() => useAgentStore.getState().requestInterrupt()}
                  sx={{ width: 48, height: 48, flexShrink: 0 }}
                >
                  <StopIcon />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title={t('agent.chat.sendTip')}>
                <span>
                  <IconButton
                    color="primary"
                    onClick={handleSend}
                    disabled={!input.trim() || isStreaming}
                    sx={{
                      width: 48,
                      height: 48,
                      flexShrink: 0,
                      bgcolor: input.trim() ? 'primary.main' : 'action.disabledBackground',
                      color: input.trim() ? 'primary.contrastText' : 'text.disabled',
                      '&:hover': input.trim() ? { bgcolor: 'primary.dark' } : { bgcolor: 'action.disabledBackground' },
                      transition: 'all 0.2s',
                    }}
                  >
                    <SendIcon />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Box>
        </Box>
      </Box>

      <SettingsDrawer open={settingsOpen} onClose={onCloseSettings} />
    </Box>
  );
}

// ═══════════════════════════════════════════════
//  配置视图（对话框内）
// ═══════════════════════════════════════════════

/** 设置分区元数据：须在函数体内求值（t() 随语言取值，模块级会固化导致切换不更新） */
function getSectionMeta() {
  return {
    provider: { label: t('agent.section.provider'), desc: t('agent.section.providerDesc') },
    endpoint: { label: t('agent.section.endpoint'), desc: t('agent.section.endpointDesc') },
    model: { label: t('agent.section.model'), desc: t('agent.section.modelDesc') },
    agent: { label: t('agent.section.agent'), desc: t('agent.section.agentDesc') },
    about: { label: t('agent.section.about'), desc: t('agent.section.aboutDesc') },
  } as const;
}

function SettingsView() {
  const [section, setSection] = useState<'provider' | 'endpoint' | 'model' | 'agent' | 'about'>('provider');
  const sectionMeta = getSectionMeta();

  return (
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* 左侧分类导航 */}
      <Box
        sx={{
          width: 180,
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          py: 1,
        }}
      >
        {(['provider', 'endpoint', 'model', 'agent', 'about'] as const).map((s) => {
          const active = section === s;
          return (
            <Box
              key={s}
              onClick={() => setSection(s)}
              sx={{
                px: 2,
                py: 1.5,
                mx: 0.5,
                borderRadius: 1.5,
                cursor: 'pointer',
                bgcolor: active ? 'rgb(var(--template-palette-primary-mainChannel) / 0.08)' : 'transparent',
                borderLeft: 3,
                borderColor: active ? 'primary.main' : 'transparent',
                transition: 'all 0.15s',
                '&:hover': {
                  bgcolor: active ? 'rgb(var(--template-palette-primary-mainChannel) / 0.12)' : 'action.hover',
                },
              }}
            >
              <Typography
                sx={{
                  fontSize: uiFontSize(13),
                  fontWeight: active ? 600 : 400,
                  color: active ? 'primary.main' : 'text.primary',
                }}
              >
                {sectionMeta[s].label}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* 右侧内容区 */}
      <Box sx={{ flex: 1, px: 3, py: 2, overflowY: 'auto', overflowX: 'hidden' }}>
        <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mb: 2 }}>
          {sectionMeta[section].desc}
        </Typography>
        {section === 'provider' && (
          <>
            {/* 本机 Ollama：打开就自动扫描 + 自动接入（2026-11-07 口径），摆在供应商列表上方，
                因为它是"又一个供应商"，而这一家不需要用户填任何东西 */}
            <OllamaLocalPanel />
            <ProviderConfig />
          </>
        )}
        {section === 'endpoint' && <EndpointConfig />}
        {section === 'model' && <ModelConfig />}
        {section === 'agent' && <AgentConfig />}
        {section === 'about' && <AboutPanel />}
      </Box>
    </Box>
  );
}

// ─── 通用表单容器 ───

function FormCard({
  title,
  children,
  onCancel,
  formId,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  formId?: string;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        mb: 2,
        borderRadius: 2,
        border: 1,
        borderColor: 'primary.light',
        bgcolor: (t) =>
          t.palette.mode === 'dark'
            ? 'rgb(var(--template-palette-primary-mainChannel) / 0.04)'
            : 'rgb(var(--template-palette-primary-mainChannel) / 0.02)',
      }}
    >
      <Typography sx={{ fontSize: uiFontSize(14), fontWeight: 600, mb: 2 }}>{title}</Typography>
      {children}
      <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
        <Button
          variant="contained"
          size="small"
          type="submit"
          form={formId}
          sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}
        >
          {t('agent.form.save')}
        </Button>
        <Button size="small" onClick={onCancel} sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}>
          {t('agent.form.cancel')}
        </Button>
      </Box>
    </Paper>
  );
}

// ─── 通用列表卡片 ───

function ListCard({
  icon,
  title,
  subtitle,
  chips,
  actions,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  chips?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mb: 1.5,
        borderRadius: 2,
        transition: 'box-shadow 0.15s',
        '&:hover': { boxShadow: 1 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {icon && (
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'action.hover',
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: uiFontSize(14), fontWeight: 600 }}>{title}</Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: uiFontSize(12) }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {chips && <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>{chips}</Box>}
        {actions && <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>{actions}</Box>}
      </Box>
      {children}
    </Paper>
  );
}

// ─── Provider 配置 ───

function ProviderConfig() {
  // endpoints 只为一个判定服务：这家有没有端点跑在本机回环上（决定"未配置 Key"这句话该不该说）
  const { providers, endpoints, loadProviders, loadEndpoints, saveProvider, deleteProvider } = useAgentStore();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadProviders();
    loadEndpoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (data: any) => {
    const now = Date.now();
    await saveProvider({
      id: editing?.id || `prov_${now}`,
      name: data.name || '',
      apiKey: data.apiKey || '',
      color: data.color || randomProviderColor(),
      enabled: data.enabled ?? true,
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    });
    setEditing(null);
    setShowForm(false);
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {!showForm && (
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          sx={{ mb: 2, textTransform: 'none', fontSize: uiFontSize(13), borderRadius: 2 }}
        >
          {t('agent.form.addProvider')}
        </Button>
      )}

      {showForm && (
        <ProviderForm
          initial={editing}
          localNoKey={providerKeyState(editing || {}, endpoints) === 'local-noneed'}
          onSave={handleSave}
          onCancel={() => {
            setEditing(null);
            setShowForm(false);
          }}
        />
      )}

      {providers.length === 0 && !showForm && (
        <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
          <SettingsIcon sx={{ fontSize: uiFontSize(36), opacity: 0.15, mb: 1 }} />
          <Typography sx={{ fontSize: uiFontSize(13) }}>{t('agent.form.noProvider')}</Typography>
        </Box>
      )}

      {providers.map((p) => {
        // 三种状态分开说话：有 key / 本地服务本来就不需要 key / 远端真的没配（判据在 utils/agentProviderKey）
        const keyState = providerKeyState(p, endpoints);
        return (
        <ListCard
          key={p.id}
          icon={<Box sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: colorForProvider(p.id, p.color) }} />}
          title={p.name}
          subtitle={
            keyState === 'masked'
              ? '••••' + p.apiKey.slice(-4)
              : t(keyState === 'local-noneed' ? 'agent.form.localNoKey' : 'agent.form.noKey')
          }
          chips={
            <Chip
              label={p.enabled ? t('agent.form.enabled') : t('agent.form.disabled')}
              size="small"
              color={p.enabled ? 'success' : 'default'}
              sx={{ fontSize: uiFontSize(11) }}
            />
          }
          actions={
            <>
              <IconButton
                size="small"
                onClick={() => {
                  setEditing(p);
                  setShowForm(true);
                }}
              >
                <SettingsIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={() => deleteProvider(p.id)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </>
          }
        />
        );
      })}
    </Box>
  );
}

function ProviderForm({ initial, localNoKey, onSave, onCancel }: any) {
  const [name, setName] = useState(initial?.name || '');
  const [apiKey, setApiKey] = useState(initial?.apiKey || '');
  const [color, setColor] = useState(initial?.color || '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <FormCard
      title={initial ? t('agent.form.editProvider') : t('agent.form.newProvider')}
      onCancel={onCancel}
      formId="provider-form"
    >
      <Box
        component="form"
        id="provider-form"
        onSubmit={(e: any) => {
          e.preventDefault();
          onSave({ name, apiKey, color, enabled });
        }}
      >
        <TextField
          label={t('agent.form.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          size="small"
          required
          sx={{ mb: 1.5 }}
        />
        {/* 本地服务（端点在本机回环上）连「密钥」这个输入框都不出现：
            本地压根没有 Key，摆一个空框就是让人去配一个不存在的东西。远端照旧。 */}
        {localNoKey ? (
          <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mb: 1.5 }}>
            {t('agent.form.localNoKeyHint')}
          </Typography>
        ) : (
        <TextField
          label={t('agent.form.apiKey')}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type={showApiKey ? 'text' : 'password'}
          fullWidth
          size="small"
          sx={{ mb: 1.5 }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showApiKey ? t('agent.form.hideKey') : t('agent.form.showKey')}
                    onClick={() => setShowApiKey((s) => !s)}
                    edge="end"
                    size="small"
                  >
                    {showApiKey ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        )}

        {/* 标识颜色：预设圆点 + 自定义取色器；不选则保存时随机生成 */}
        <Box sx={{ mb: 1.5 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: uiFontSize(12), display: 'block', mb: 0.75 }}
          >
            {t('agent.form.colorLabel')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
            {PROVIDER_COLORS.map((c) => (
              <Box
                key={c}
                onClick={() => setColor(c)}
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  bgcolor: c,
                  cursor: 'pointer',
                  border: '1px solid rgb(var(--template-palette-dividerChannel) / 0.5)',
                  boxShadow: color === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : 'none',
                  transition: 'transform 0.12s',
                  '&:hover': { transform: 'scale(1.12)' },
                }}
              />
            ))}
            {/* 自定义颜色 */}
            <Box sx={{ position: 'relative', width: 22, height: 22, flexShrink: 0 }}>
              <Box
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  cursor: 'pointer',
                  border: '1px solid rgb(var(--template-palette-dividerChannel) / 0.5)',
                  background:
                    color && !PROVIDER_COLORS.includes(color)
                      ? `linear-gradient(135deg, ${color} 50%, #fff 50%)`
                      : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                }}
              />
              <input
                type="color"
                value={color || AI_COLOR}
                onChange={(e) => setColor(e.target.value)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'pointer',
                  border: 'none',
                }}
                aria-label={t('agent.form.customColor')}
              />
            </Box>
          </Box>
          {color && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color }} />
              <Typography variant="caption" sx={{ fontSize: uiFontSize(11) }}>
                {color}
              </Typography>
            </Box>
          )}
        </Box>

        <FormControlLabel
          control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} size="small" />}
          label={<Typography sx={{ fontSize: uiFontSize(13) }}>{t('agent.form.enabled')}</Typography>}
        />
      </Box>
    </FormCard>
  );
}

// ─── Endpoint 配置 ───

function EndpointConfig() {
  const { providers, endpoints, loadProviders, loadEndpoints, saveEndpoint, deleteEndpoint, testEndpointConnection } =
    useAgentStore();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    loadProviders();
    loadEndpoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (data: any) => {
    const now = Date.now();
    await saveEndpoint({
      id: editing?.id || `ep_${now}`,
      providerId: data.providerId || '',
      name: data.name || '',
      apiType: data.apiType || 'openai-completions',
      baseUrl: data.baseUrl || '',
      authType: data.authType || 'bearer',
      customAuthHeader: data.customAuthHeader || '',
      enabled: data.enabled ?? true,
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    });
    setEditing(null);
    setShowForm(false);
  };

  const handleTest = async (epId: string) => {
    setTesting(epId);
    setTestResult(null);
    try {
      const result = await testEndpointConnection(epId);
      setTestResult(result);
    } catch (err: any) {
      setTestResult(t('agent.form.testFailed', { msg: err?.message || err }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {!showForm && (
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          sx={{ mb: 2, textTransform: 'none', fontSize: uiFontSize(13), borderRadius: 2 }}
        >
          {t('agent.form.addEndpoint')}
        </Button>
      )}

      {showForm && (
        <EndpointForm
          initial={editing}
          providers={providers}
          onSave={handleSave}
          onCancel={() => {
            setEditing(null);
            setShowForm(false);
          }}
        />
      )}

      {testResult && (
        <Box
          sx={{
            mb: 2,
            p: 1.5,
            borderRadius: 2,
            bgcolor:
              testResult.toLowerCase().includes('success') || testResult.includes('成功')
                ? 'success.light'
                : 'error.light',
            fontSize: uiFontSize(13),
          }}
        >
          {testResult}
        </Box>
      )}

      {endpoints.length === 0 && !showForm && (
        <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
          <LinkIcon sx={{ fontSize: uiFontSize(36), opacity: 0.15, mb: 1 }} />
          <Typography sx={{ fontSize: uiFontSize(13) }}>{t('agent.form.noEndpoint')}</Typography>
        </Box>
      )}

      {endpoints.map((ep) => {
        const provider = providers.find((p) => p.id === ep.providerId);
        return (
          <ListCard
            key={ep.id}
            icon={<LinkIcon sx={{ fontSize: uiFontSize(18), color: 'text.secondary' }} />}
            title={ep.name}
            subtitle={`${provider?.name || t('agent.form.unknown')} · ${ep.apiType} · ${
              ep.authType === 'none' ? t('agent.form.noAuth') : ep.authType
            }`}
            chips={
              <Chip
                label={ep.enabled ? t('agent.form.enabled') : t('agent.form.disabled')}
                size="small"
                color={ep.enabled ? 'success' : 'default'}
                sx={{ fontSize: uiFontSize(11) }}
              />
            }
            actions={
              <>
                <Button
                  size="small"
                  onClick={() => handleTest(ep.id)}
                  disabled={testing === ep.id}
                  sx={{ fontSize: uiFontSize(11), textTransform: 'none', minWidth: 0 }}
                >
                  {testing === ep.id ? <CircularProgress size={14} /> : t('agent.form.test')}
                </Button>
                <IconButton
                  size="small"
                  onClick={() => {
                    setEditing(ep);
                    setShowForm(true);
                  }}
                >
                  <SettingsIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => deleteEndpoint(ep.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </>
            }
          />
        );
      })}
    </Box>
  );
}

function EndpointForm({ initial, providers, onSave, onCancel }: any) {
  const [providerId, setProviderId] = useState(initial?.providerId || (providers[0]?.id ?? ''));
  const [name, setName] = useState(initial?.name || '');
  const [apiType, setApiType] = useState(initial?.apiType || 'openai-completions');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl || '');
  // 地址在本机回环 → 认证方式默认就是「无需密钥」：本地服务压根没有 Key 这个概念，
  // 不该让人先去供应商里"配一个空 Key"。（判据与后端 is_loopback_base_url 同一口径）
  const localUrl = isLoopbackBaseUrl(initial?.baseUrl) || isLoopbackBaseUrl(baseUrl);
  const [authType, setAuthType] = useState(defaultAuthType(initial?.authType, initial?.baseUrl));
  const [customAuthHeader, setCustomAuthHeader] = useState(initial?.customAuthHeader || '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  return (
    <FormCard
      title={initial ? t('agent.form.editEndpoint') : t('agent.form.newEndpoint')}
      onCancel={onCancel}
      formId="endpoint-form"
    >
      <Box
        component="form"
        id="endpoint-form"
        onSubmit={(e: any) => {
          e.preventDefault();
          onSave({ providerId, name, apiType, baseUrl, authType, customAuthHeader, enabled });
        }}
      >
        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel>{t('agent.section.provider')}</InputLabel>
          <Select
            value={providerId}
            label={t('agent.section.provider')}
            onChange={(e) => setProviderId(e.target.value)}
          >
            {providers.map((p: any) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label={t('agent.form.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          size="small"
          required
          sx={{ mb: 1.5 }}
        />
        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel>{t('agent.form.apiType')}</InputLabel>
          <Select value={apiType} label={t('agent.form.apiType')} onChange={(e) => setApiType(e.target.value)}>
            <MenuItem value="openai-completions">OpenAI Completions</MenuItem>
            <MenuItem value="anthropic-messages">Anthropic Messages</MenuItem>
            <MenuItem value="openai-responses">OpenAI Responses</MenuItem>
          </Select>
        </FormControl>
        <TextField
          label={t('agent.form.baseUrl')}
          value={baseUrl}
          onChange={(e) => {
            const next = e.target.value;
            setBaseUrl(next);
            // 一填成本机地址就把认证方式带成「无需密钥」（只在他还没动过 bearer 默认时带，不覆盖手选）
            setAuthType((a: string) => authTypeAfterBaseUrlEdit(a, next));
          }}
          fullWidth
          size="small"
          placeholder="https://api.openai.com/v1  |  http://127.0.0.1:11434/v1"
          helperText={localUrl ? t('agent.form.localUrlHint') : ''}
          sx={{ mb: 1.5 }}
        />
        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel>{t('agent.form.authType')}</InputLabel>
          <Select value={authType} label={t('agent.form.authType')} onChange={(e) => setAuthType(e.target.value)}>
            <MenuItem value="none">{t('agent.form.noAuth')}</MenuItem>
            <MenuItem value="bearer">{t('agent.form.bearer')}</MenuItem>
            <MenuItem value="x-api-key">{t('agent.form.xApiKey')}</MenuItem>
            <MenuItem value="custom">{t('agent.form.customHeader')}</MenuItem>
          </Select>
        </FormControl>
        {authType === 'custom' && (
          <TextField
            label={t('agent.form.customHeaderName')}
            value={customAuthHeader}
            onChange={(e) => setCustomAuthHeader(e.target.value)}
            fullWidth
            size="small"
            sx={{ mb: 1.5 }}
          />
        )}
        <FormControlLabel
          control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} size="small" />}
          label={<Typography sx={{ fontSize: uiFontSize(13) }}>{t('agent.form.enabled')}</Typography>}
        />
      </Box>
    </FormCard>
  );
}

// ─── Model 配置 ───

function ModelConfig() {
  const { endpoints, models, loadEndpoints, loadModels, saveModel, deleteModel, testModelChat } = useAgentStore();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    loadEndpoints();
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (data: any) => {
    const now = Date.now();
    await saveModel({
      id: editing?.id || `model_${now}`,
      name: data.name || '',
      refKey: data.refKey || '',
      endpointId: data.endpointId || '',
      reasoning: data.reasoning ?? false,
      inputTypes: data.inputTypes || ['text'],
      contextWindow: data.contextWindow || 128000,
      maxTokens: data.maxTokens || 4096,
      enabled: data.enabled ?? true,
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    });
    setEditing(null);
    setShowForm(false);
  };

  const handleTest = async (modelId: string) => {
    setTesting(modelId);
    setTestResult(null);
    try {
      const result = await testModelChat(modelId);
      setTestResult(result);
    } catch (err: any) {
      setTestResult(t('agent.form.testFailed', { msg: err?.message || err }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {!showForm && (
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          sx={{ mb: 2, textTransform: 'none', fontSize: uiFontSize(13), borderRadius: 2 }}
        >
          {t('agent.form.addModel')}
        </Button>
      )}

      {showForm && (
        <ModelForm
          initial={editing}
          endpoints={endpoints}
          onSave={handleSave}
          onCancel={() => {
            setEditing(null);
            setShowForm(false);
          }}
        />
      )}

      {testResult && (
        <Box
          sx={{
            mb: 2,
            p: 1.5,
            borderRadius: 2,
            bgcolor:
              testResult.toLowerCase().includes('success') || testResult.includes('成功')
                ? 'success.light'
                : 'error.light',
            fontSize: uiFontSize(13),
          }}
        >
          {testResult}
        </Box>
      )}

      {models.length === 0 && !showForm && (
        <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
          <PsychologyIcon sx={{ fontSize: uiFontSize(36), opacity: 0.15, mb: 1 }} />
          <Typography sx={{ fontSize: uiFontSize(13) }}>{t('agent.form.noModel')}</Typography>
        </Box>
      )}

      {models.map((m) => {
        const ep = endpoints.find((e) => e.id === m.endpointId);
        return (
          <ListCard
            key={m.id}
            icon={<PsychologyIcon sx={{ fontSize: uiFontSize(18), color: 'text.secondary' }} />}
            title={m.name}
            subtitle={`${ep?.name || t('agent.form.unknown')} · ${m.refKey}`}
            chips={
              <>
                {m.reasoning && (
                  <Chip
                    label={t('agent.form.reasoningShort')}
                    size="small"
                    color="info"
                    sx={{ fontSize: uiFontSize(11) }}
                  />
                )}
                <Chip
                  label={m.enabled ? t('agent.form.enabled') : t('agent.form.disabled')}
                  size="small"
                  color={m.enabled ? 'success' : 'default'}
                  sx={{ fontSize: uiFontSize(11) }}
                />
              </>
            }
            actions={
              <>
                <Button
                  size="small"
                  onClick={() => handleTest(m.id)}
                  disabled={testing === m.id}
                  sx={{ fontSize: uiFontSize(11), textTransform: 'none', minWidth: 0 }}
                >
                  {testing === m.id ? <CircularProgress size={14} /> : t('agent.form.test')}
                </Button>
                <IconButton
                  size="small"
                  onClick={() => {
                    setEditing(m);
                    setShowForm(true);
                  }}
                >
                  <SettingsIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => deleteModel(m.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </>
            }
          />
        );
      })}
    </Box>
  );
}

function ModelForm({ initial, endpoints, onSave, onCancel }: any) {
  const [endpointId, setEndpointId] = useState(initial?.endpointId || (endpoints[0]?.id ?? ''));
  const [name, setName] = useState(initial?.name || '');
  const [refKey, setRefKey] = useState(initial?.refKey || '');
  const [reasoning, setReasoning] = useState(initial?.reasoning ?? false);
  const [contextWindow, setContextWindow] = useState(initial?.contextWindow || 128000);
  const [maxTokens, setMaxTokens] = useState(initial?.maxTokens || 4096);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  return (
    <FormCard
      title={initial ? t('agent.form.editModel') : t('agent.form.newModel')}
      onCancel={onCancel}
      formId="model-form"
    >
      <Box
        component="form"
        id="model-form"
        onSubmit={(e: any) => {
          e.preventDefault();
          onSave({ endpointId, name, refKey, reasoning, contextWindow, maxTokens, enabled });
        }}
      >
        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel>{t('agent.section.endpoint')}</InputLabel>
          <Select
            value={endpointId}
            label={t('agent.section.endpoint')}
            onChange={(e) => setEndpointId(e.target.value)}
          >
            {endpoints.map((ep: any) => (
              <MenuItem key={ep.id} value={ep.id}>
                {ep.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label={t('agent.form.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          size="small"
          required
          sx={{ mb: 1.5 }}
        />
        <TextField
          label={t('agent.form.refKey')}
          value={refKey}
          onChange={(e) => setRefKey(e.target.value)}
          fullWidth
          size="small"
          placeholder="gpt-4o, claude-sonnet-4-20250514"
          sx={{ mb: 1.5 }}
        />
        <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5 }}>
          <TextField
            label={t('agent.form.contextWindow')}
            type="number"
            value={contextWindow}
            onChange={(e) => setContextWindow(Number(e.target.value))}
            size="small"
            fullWidth
          />
          <TextField
            label={t('agent.form.maxTokens')}
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
            size="small"
            fullWidth
          />
        </Box>
        <FormControlLabel
          control={<Switch checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} size="small" />}
          label={<Typography sx={{ fontSize: uiFontSize(13) }}>{t('agent.form.reasoning')}</Typography>}
          sx={{ mr: 2 }}
        />
        <FormControlLabel
          control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} size="small" />}
          label={<Typography sx={{ fontSize: uiFontSize(13) }}>{t('agent.form.enabled')}</Typography>}
        />
      </Box>
    </FormCard>
  );
}

// ─── Agent 配置 ───

function AgentConfig() {
  const { models, endpoints, agents, loadModels, loadEndpoints, loadAgents, saveAgent, deleteAgent } = useAgentStore();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadModels();
    loadEndpoints();
    loadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (data: any) => {
    const now = Date.now();
    await saveAgent({
      id: editing?.id || `agent_${now}`,
      name: data.name || '',
      description: data.description || '',
      modelId: data.modelId || '',
      systemPrompt: data.systemPrompt || t('agent.form.defaultSystemPrompt'),
      temperature: data.temperature ?? 0.7,
      maxIterations: data.maxIterations ?? 10,
      toolIds: data.toolIds || [],
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    });
    setEditing(null);
    setShowForm(false);
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {!showForm && (
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          sx={{ mb: 2, textTransform: 'none', fontSize: uiFontSize(13), borderRadius: 2 }}
        >
          {t('agent.form.addAgent')}
        </Button>
      )}

      {showForm && (
        <AgentForm
          initial={editing}
          models={models}
          endpoints={endpoints}
          onSave={handleSave}
          onCancel={() => {
            setEditing(null);
            setShowForm(false);
          }}
        />
      )}

      {agents.length === 0 && !showForm && (
        <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
          <SmartToyIcon sx={{ fontSize: uiFontSize(36), opacity: 0.15, mb: 1 }} />
          <Typography sx={{ fontSize: uiFontSize(13) }}>{t('agent.form.noAgent')}</Typography>
        </Box>
      )}

      {agents.map((a) => {
        const model = models.find((m) => m.id === a.modelId);
        return (
          <ListCard
            key={a.id}
            icon={<SmartToyIcon sx={{ fontSize: uiFontSize(18), color: 'primary.main' }} />}
            title={a.name}
            subtitle={`${model?.name || t('agent.form.noModel')} · ${t('agent.form.toolCount', { n: a.toolIds.length })}`}
            actions={
              <>
                <IconButton
                  size="small"
                  onClick={() => {
                    setEditing(a);
                    setShowForm(true);
                  }}
                >
                  <SettingsIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => deleteAgent(a.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </>
            }
          >
            {a.description && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: uiFontSize(12), mt: 1 }}>
                {a.description}
              </Typography>
            )}
          </ListCard>
        );
      })}
    </Box>
  );
}

function AgentForm({ initial, models, endpoints, onSave, onCancel }: any) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [modelId, setModelId] = useState(initial?.modelId || (models[0]?.id ?? ''));
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt || t('agent.form.defaultSystemPrompt'));
  const [temperature, setTemperature] = useState(initial?.temperature ?? 0.7);
  const [maxIterations, setMaxIterations] = useState(initial?.maxIterations ?? 10);

  const availableTools = [
    { id: 'code_search', name: t('agent.form.tools.code_search') },
    { id: 'file_read', name: t('agent.form.tools.file_read') },
    { id: 'symbol_lookup', name: t('agent.form.tools.symbol_lookup') },
    { id: 'architecture_query', name: t('agent.form.tools.architecture_query') },
    { id: 'review_explain', name: t('agent.form.tools.review_explain') },
    { id: 'impact_assess', name: t('agent.form.tools.impact_assess') },
    { id: 'project_context', name: t('agent.form.tools.project_context') },
    { id: 'context_insight', name: t('agent.form.tools.context_insight') },
    { id: 'scan_records', name: t('agent.form.tools.scan_records') },
    { id: 'apply_change', name: t('agent.form.tools.apply_change') },
    { id: 'run_command', name: t('agent.form.tools.run_command') },
    // 写作场景工具（P1）：/ai 全页助手在写作场景下按需读取章节/人设，写入需审批
    { id: 'list_chapters', name: t('agent.form.tools.list_chapters') },
    { id: 'read_chapter', name: t('agent.form.tools.read_chapter') },
    { id: 'read_character_card', name: t('agent.form.tools.read_character_card') },
    { id: 'search_corpus', name: t('agent.form.tools.search_corpus') },
    { id: 'update_character_card', name: t('agent.form.tools.update_character_card') },
    { id: 'write_chapter', name: t('agent.form.tools.write_chapter') },
    { id: 'create_chapter', name: t('agent.form.tools.create_chapter') },
  ];
  // 新助手默认即拥有全部工具能力（含 run_command 终端权限），与「导入项目即默认可用工作区、
  // 助手默认具备终端能力、无需手动勾选」的产品定位一致；仅在编辑已有助手时沿用其已保存的 toolIds。
  const [selectedTools, setSelectedTools] = useState<string[]>(initial?.toolIds || availableTools.map((t) => t.id));

  const toggleTool = (toolId: string) => {
    setSelectedTools((prev) => (prev.includes(toolId) ? prev.filter((t) => t !== toolId) : [...prev, toolId]));
  };

  return (
    <FormCard
      title={initial ? t('agent.form.editAgent') : t('agent.form.newAgent')}
      onCancel={onCancel}
      formId="agent-form"
    >
      <Box
        component="form"
        id="agent-form"
        onSubmit={(e: any) => {
          e.preventDefault();
          onSave({ name, description, modelId, systemPrompt, temperature, maxIterations, toolIds: selectedTools });
        }}
      >
        <TextField
          label={t('agent.form.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          size="small"
          required
          sx={{ mb: 1.5 }}
        />
        <TextField
          label={t('agent.form.desc')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          size="small"
          multiline
          rows={2}
          sx={{ mb: 1.5 }}
        />
        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel>{t('agent.section.model')}</InputLabel>
          <Select value={modelId} label={t('agent.section.model')} onChange={(e) => setModelId(e.target.value)}>
            {models.map((m: any) => {
              const ep = endpoints?.find((e: any) => e.id === m.endpointId);
              return (
                <MenuItem
                  key={m.id}
                  value={m.id}
                  sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
                >
                  <Box component="span">{m.name}</Box>
                  {ep && (
                    <Box component="span" sx={{ fontSize: uiFontSize(10), color: 'text.disabled' }}>
                      {ep.name}
                    </Box>
                  )}
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>
        <TextField
          label={t('agent.form.systemPrompt')}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          fullWidth
          size="small"
          multiline
          rows={3}
          sx={{ mb: 1.5, '& .MuiInputBase-root': { fontSize: uiFontSize(12) } }}
        />
        <Box sx={{ mb: 1.5 }}>
          <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mb: 0.5 }}>
            {t('agent.form.temperature', { value: temperature })}
          </Typography>
          <Slider
            value={temperature}
            onChange={(_e, v) => setTemperature(v as number)}
            min={0}
            max={2}
            step={0.1}
            size="small"
          />
        </Box>
        <TextField
          label={t('agent.form.maxIterations')}
          type="number"
          value={maxIterations}
          onChange={(e) => setMaxIterations(Number(e.target.value))}
          fullWidth
          size="small"
          sx={{ mb: 1.5 }}
        />

        <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mb: 1 }}>
          {t('agent.form.enableTools')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
          {availableTools.map((tool) => (
            <Chip
              key={tool.id}
              label={tool.name}
              size="small"
              onClick={() => toggleTool(tool.id)}
              color={selectedTools.includes(tool.id) ? 'primary' : 'default'}
              variant={selectedTools.includes(tool.id) ? 'filled' : 'outlined'}
              sx={{ cursor: 'pointer' }}
            />
          ))}
        </Box>
      </Box>
    </FormCard>
  );
}

// ═══════════════════════════════════════════════
//  章节树形选择器（AI 助手上下文选择用）
// ═══════════════════════════════════════════════

import { buildTree, type TreeNode, treeRowIndent } from '../utils/writingTree';
import type { WritingBook, WritingChapter } from '../services/tauri';

function ChapterTreeSelector({
  chapters,
  activeChapterId,
  onSelect,
  currentBook,
}: {
  chapters: WritingChapter[];
  activeChapterId: string | null;
  onSelect: (id: string | null) => void;
  currentBook: WritingBook;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(chapters), [chapters]);

  // 路径标签：展示卷/章层级路径
  const pathLabels = useMemo(() => {
    const out = new Map<string, string>();
    const walk = (nodes: TreeNode[], prefix: string[]): void => {
      for (let i = 0; i < nodes.length; i++) {
        const t = nodes[i];
        const label = `${t.node.kind || '章节'} ${i + 1}`;
        const path = [...prefix, label];
        out.set(t.node.id, path.join(' › '));
        walk(t.children, path);
      }
    };
    walk(tree, []);
    return out;
  }, [tree]);

  const activeLabel = activeChapterId ? (pathLabels.get(activeChapterId) ?? '') : '';

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelect = (id: string | null) => {
    onSelect(id);
    setOpen(false);
  };

  // 递归渲染节点（按 ChapterTreePanel TreeRow 的视觉风格）
  const renderNode = (n: TreeNode): ReactNode => {
    const ch = n.node;
    const hasKids = n.children.length > 0;
    const expanded = !collapsed.has(ch.id);
    const selected = ch.id === activeChapterId;

    return (
      <Box key={ch.id}>
        <Box
          role="button"
          tabIndex={0}
          onClick={() => {
            if (hasKids) toggle(ch.id);
            handleSelect(ch.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (hasKids) toggle(ch.id);
              handleSelect(ch.id);
            }
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            pl: treeRowIndent(n.depth),
            pr: 1.5,
            py: 0.6,
            cursor: 'pointer',
            borderRadius: 1,
            bgcolor: selected ? 'action.selected' : 'transparent',
            '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
            transition: 'background-color 0.12s',
          }}
        >
          {/* 折叠角（仅叶子节点无子节点时显示占位，保持缩进对齐） */}
          {hasKids ? (
            <IconButton
              size="small"
              sx={{ p: 0.25, flexShrink: 0 }}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                toggle(ch.id);
              }}
            >
              {expanded ? (
                <ExpandMoreIcon sx={{ fontSize: uiFontSize(16), color: 'text.secondary' }} />
              ) : (
                <ChevronRightIcon sx={{ fontSize: uiFontSize(16), color: 'text.secondary' }} />
              )}
            </IconButton>
          ) : (
            <Box sx={{ width: 22, flexShrink: 0 }} />
          )}

          <AutoStoriesIcon
            sx={{ fontSize: uiFontSize(14), color: selected ? 'secondary.main' : 'text.secondary', flexShrink: 0 }}
          />

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              sx={{
                fontSize: uiFontSize(13),
                fontWeight: selected ? 600 : 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: selected ? 'text.primary' : 'text.secondary',
              }}
            >
              {ch.title}
            </Typography>
            {ch.wordCount > 0 && (
              <Typography sx={{ fontSize: uiFontSize(11), color: 'text.disabled' }}>{ch.wordCount}字</Typography>
            )}
          </Box>

          {selected && (
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                flexShrink: 0,
              }}
            />
          )}
        </Box>

        {/* 递归子树 */}
        {hasKids && expanded && <Box>{n.children.map(renderNode)}</Box>}
      </Box>
    );
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        onClick={(e) => {
          setAnchor(e.currentTarget);
          setOpen(true);
        }}
        sx={{
          minWidth: 160,
          maxWidth: 240,
          justifyContent: 'flex-start',
          textTransform: 'none',
          fontSize: uiFontSize(12),
          py: 0.5,
          px: 1,
          borderColor: 'divider',
          color: activeChapterId ? 'text.primary' : 'text.secondary',
        }}
        startIcon={
          <AutoStoriesIcon
            sx={{ fontSize: uiFontSize(14), color: activeChapterId ? 'secondary.main' : 'text.disabled' }}
          />
        }
      >
        <Typography
          sx={{
            fontSize: uiFontSize(12),
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            textAlign: 'left',
          }}
        >
          {activeLabel || t('agent.chat.noChapter')}
        </Typography>
      </Button>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              width: 320,
              maxHeight: 420,
              overflow: 'auto',
              p: 1,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              boxShadow: (th) => th.shadows[3],
            },
          },
        }}
      >
        {/* 当前作品头 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.75, mb: 0.5 }}>
          <MenuBookIcon sx={{ fontSize: uiFontSize(14), color: 'primary.main' }} />
          <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 600 }}>{currentBook.title}</Typography>
        </Box>
        <Divider sx={{ mb: 0.75 }} />

        {/* 树形列表 */}
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>{tree.map((n) => renderNode(n))}</Box>
      </Popover>
    </>
  );
}
