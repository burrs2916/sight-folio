// 创作台右抽屉（上下文辅助面板）
//
// 设计要点（对应「创作台重设计 P0」方向 A）：
// - 三段式工作台框架的右段：收纳「提醒汇总 + 语料参考 + 章详情入口」，
//   正文区不再被语料面板/提醒条推挤（语料从编辑器下方固定条改到这里）。
// - 语料参考保留「输入即自动检索 + 单一固定区 + 插入」核心语义不变，
//   以 embedded 形态铺满抽屉内容区（无拖拽手柄、宽度自适应）。
// - 语料参考区可选升级为双标签页：传入 aiCorpus 配置时，「语料库 / AI 语料」
//   两个 Tab 并列（语料库保持原状零回归；AI 语料复用 AiCorpusPanel 的会话/流式/上下文）；
//   缺省保持单面板，旧调用方不受影响。
// - 提醒条移入抽屉顶部：Foreshadow/Inspiration/Proofread/Stats 四类
//   （normal 模式显示；focus/zen 沉浸时整抽屉隐藏，与正文舞台语义一致）。
// - 章详情：抽屉内提供入口按钮（切右栏 details 视图）——完整细节面板
//   体量大，保持整栏替换视图（P2 再做入抽屉细化）。
import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import InfoRoundedIcon from '@mui/icons-material/InfoRounded';
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import KeyboardDoubleArrowLeftRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowLeftRounded';
import KeyboardDoubleArrowRightRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowRightRounded';
import { t } from '../../i18n';
import type { WritingForeshadowing } from '../../services/tauri';
import type { ProofreadFinding } from '../../utils/writingProofread';
import type { WritingChapter } from '../../services/writing';
import { useDragBodyGuard } from '../../hooks/useDragBodyGuard';
import { CorpusReferencePanel } from './CorpusReferencePanel';
import { AiCorpusPanel, type AiCorpusPanelProps } from './AiCorpusPanel';
import { ExternalCapturePanel, type ExternalCapturePanelProps } from './ExternalCapturePanel';
import {
  ForeshadowReminder,
  InspirationReminder,
  ProofreadReminder,
  StatsReminder,
} from '../../editor/components/writingReminders';
import { uiFontSize } from '../../theme/appearanceScales';
import { surfaceKeyForGenre } from '../../utils/writingSchema';

// 右抽屉（上下文辅助面板）展开态宽度拖拽：范围 240–560，默认 320，跨会话持久化
const DRAWER_WIDTH_MIN = 240;
const DRAWER_WIDTH_MAX = 560;
const DRAWER_WIDTH_DEFAULT = 320;
const DRAWER_WIDTH_KEY = 'sight-folio:writing.drawerWidth';
// 折叠态与语料区标签页偏好：抽屉挂在正文分支内，切「章详情 / 设定卡」时整个分支会被卸载、
// 组件重挂载 → 这两个 state 复位。用户「收起抽屉写正文」「正在用 AI 语料」的选择不应因为
// 看一眼章详情就丢，与宽度同一口径落 localStorage。
const DRAWER_COLLAPSED_KEY = 'sight-folio:writing.drawerCollapsed';
const DRAWER_TAB_KEY = 'sight-folio:writing.drawerCorpusTab';

function readFlag(key: string, dflt: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? dflt : raw === '1';
  } catch {
    return dflt;
  }
}

function readTabPref(): number {
  try {
    const n = Number(localStorage.getItem(DRAWER_TAB_KEY));
    return Number.isInteger(n) && n >= 0 && n <= 2 ? n : 0;
  } catch {
    return 0;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 存储不可写：本次会话内仍生效
  }
}

function readSavedDrawerWidth(): number {
  try {
    const raw = Number(localStorage.getItem(DRAWER_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= DRAWER_WIDTH_MIN && raw <= DRAWER_WIDTH_MAX) {
      return Math.round(raw);
    }
  } catch {
    // 忽略读取异常，回退默认值
  }
  return DRAWER_WIDTH_DEFAULT;
}

export interface WritingDrawerProps {
  /** 语料参考：当前输入片段（WritingPage 从编辑器 onUpdate 提取） */
  corpusQuery: string;
  /** 语料参考：插入正文回调（复用 handleCorpusInsert，闭环不变） */
  onInsertText: (text: string) => void;
  /** 提醒汇总数据（与正文写作卡同口径） */
  payableForeshadowings: WritingForeshadowing[];
  inspirationReminders: { id: string; title?: string; summary?: string }[];
  proofreadReminders: ProofreadFinding[];
  activeChapter: WritingChapter | null;
  chapters: WritingChapter[];
  genre: string;
  /** 章详情入口：切换右栏到 details 视图 */
  onOpenChapterDetails: () => void;
  /** 当前是否处于 normal 模式（倒置：focus/zen 时隐藏整个抽屉） */
  hidden: boolean;
  /** 提醒汇总区是否可见（原提醒条仅在 normal 模式展示；focus 时抽屉仅保留语料） */
  remindersVisible?: boolean;
  /** 全书体检发现数（批次② 增-1）。与 onOpenHealth 一起传才渲染入口条 */
  healthCount?: number;
  /** 打开全书体检面板 */
  onOpenHealth?: () => void;
  /** AI 语料标签页配置（传入则语料参考区升级为「语料库 / AI 语料」双 Tab；缺省保持单面板） */
  aiCorpus?: Omit<AiCorpusPanelProps, 'onInsertText'>;
  /** 外部素材库标签页配置（传入则语料区升级为三 Tab：语料库 / AI 语料 / 素材库） */
  externalCapture?: ExternalCapturePanelProps;
}

export function WritingDrawer({
  corpusQuery,
  onInsertText,
  payableForeshadowings,
  inspirationReminders,
  proofreadReminders,
  activeChapter,
  chapters,
  genre,
  onOpenChapterDetails,
  hidden,
  remindersVisible = true,
  healthCount,
  onOpenHealth,
  aiCorpus,
  externalCapture,
}: WritingDrawerProps) {
  // 折叠态（收起为 36px 窄条；zen 隐藏走 hidden，二者独立）——hook 必须无条件调用
  const [collapsed, setCollapsedRaw] = useState(() => readFlag(DRAWER_COLLAPSED_KEY, false));
  /** 语料参考区当前标签页（0 = 语料库，1 = AI 语料，2 = 素材库；后两者按配置存在） */
  const [corpusTab, setCorpusTabRaw] = useState(readTabPref);
  // 包装 setter：改态即落偏好，抽屉重挂载（切章详情/设定卡再切回）后回到用户离开时的视图
  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedRaw(v);
    writePref(DRAWER_COLLAPSED_KEY, v ? '1' : '0');
  }, []);
  const setCorpusTab = useCallback((v: number) => {
    setCorpusTabRaw(v);
    writePref(DRAWER_TAB_KEY, String(v));
  }, []);
  // 提醒区折叠：正在输入（触发语料检索）时自动折叠让位给语料；输入清空后自动恢复；
  // 手动展开/收起可以临时覆盖自动逻辑，直到下一次 query 空↔非空翻转。
  const [remindersCollapsed, setRemindersCollapsed] = useState(false);
  // 展开态宽度（拖拽调节；折叠 36px 窄条不受影响），跨会话记忆 + 双击复位
  const [drawerWidth, setDrawerWidth] = useState<number>(readSavedDrawerWidth);
  const drawerWidthRef = useRef<number>(drawerWidth);
  // 统一经 updateDrawerWidth 改宽度：state 与 ref 同步，拖拽结束按 ref 写偏好
  const updateDrawerWidth = useCallback((w: number) => {
    drawerWidthRef.current = w;
    setDrawerWidth(w);
  }, []);
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  // 拖拽期间禁用选文的全局副作用统一交给守卫：正常松手复位，拖拽中途被卸载也复位
  const { begin: beginBodyDrag, release: releaseBodyDrag } = useDragBodyGuard();

  /** 拖拽手柄按下：记录起始位置与宽度（手柄在抽屉左缘，向左拖 = 变宽），进入高亮态 */
  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragStartRef.current = { x: e.clientX, width: drawerWidthRef.current };
      setDragActive(true);
      // 拖拽期间禁止选中文本，避免拖动时高亮选中相邻内容
      beginBodyDrag();
    },
    [beginBodyDrag],
  );

  /** 拖拽移动（window 级）：向左拖 = 变宽，向右拖 = 变窄 */
  const onResizeMove = useCallback((e: PointerEvent) => {
    const s = dragStartRef.current;
    if (!s) return;
    const next = s.width - (e.clientX - s.x);
    updateDrawerWidth(Math.min(DRAWER_WIDTH_MAX, Math.max(DRAWER_WIDTH_MIN, Math.round(next))));
  }, []);

  /** 拖拽结束：写偏好 + 清理拖拽态 */
  const onResizeEnd = useCallback(() => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    setDragActive(false);
    releaseBodyDrag();
    try {
      localStorage.setItem(DRAWER_WIDTH_KEY, String(drawerWidthRef.current));
    } catch {
      // 存储不可写（隐私模式等）：本次会话内宽度仍生效，不再重试
    }
  }, [releaseBodyDrag]);

  /** 双击手柄：宽度一键复位为默认值（误拖后快速回到原始布局），并记忆偏好 */
  const onResizeReset = useCallback(() => {
    dragStartRef.current = null;
    setDragActive(false);
    releaseBodyDrag();
    updateDrawerWidth(DRAWER_WIDTH_DEFAULT);
    try {
      localStorage.setItem(DRAWER_WIDTH_KEY, String(DRAWER_WIDTH_DEFAULT));
    } catch {
      // 存储不可写（隐私模式等）：本次会话内立即生效即可
    }
  }, [releaseBodyDrag]);

  // 拖拽监听挂在 window：移出面板/iframe 边界仍持续跟手，松开即停
  useEffect(() => {
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', onResizeEnd);
    window.addEventListener('pointercancel', onResizeEnd);
    return () => {
      window.removeEventListener('pointermove', onResizeMove);
      window.removeEventListener('pointerup', onResizeEnd);
      window.removeEventListener('pointercancel', onResizeEnd);
    };
  }, [onResizeMove, onResizeEnd]);

  const prevQueryRef = useRef(corpusQuery);
  useEffect(() => {
    const prev = prevQueryRef.current;
    prevQueryRef.current = corpusQuery;
    if (!prev && corpusQuery) setRemindersCollapsed(true);
    else if (prev && !corpusQuery) setRemindersCollapsed(false);
  }, [corpusQuery]);
  if (hidden) return null;
  // 当前配置下合法的 tab 索引：0=语料库；1=AI 语料（aiCorpus 存在时）；末位=素材库（externalCapture 存在时）。
  // localStorage 恢复的 corpusTab 可能因配置变化越界，渲染期夹紧后 Tabs 高亮与内容分支共用同一值。
  const tabCount = 1 + (aiCorpus ? 1 : 0) + (externalCapture ? 1 : 0);
  const safeTab = Math.min(corpusTab, tabCount - 1);
  const captureTabIndex = aiCorpus ? 2 : 1;
  const hasReminders =
    remindersVisible &&
    (payableForeshadowings.length > 0 ||
      inspirationReminders.length > 0 ||
      proofreadReminders.length > 0 ||
      Boolean(activeChapter));
  // 折叠窄条态：仅保留「展开」入口，正文区横向空间让出；
  // 语料面板随之卸载（effect 不再运行 → 检索暂停），展开后按当前 query 重挂恢复。
  if (collapsed) {
    return (
      <Box
        sx={{
          width: 36,
          flexShrink: 0,
          borderLeft: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0.75,
          py: 0.75,
          bgcolor: 'background.paper',
        }}
      >
        <IconButton
          size="small"
          aria-label={t('writing.drawerExpand')}
          title={t('writing.drawerExpand')}
          onClick={() => setCollapsed(false)}
          sx={{ color: 'text.secondary' }}
        >
          <KeyboardDoubleArrowLeftRoundedIcon sx={{ fontSize: uiFontSize(18) }} />
        </IconButton>
      </Box>
    );
  }
  return (
    <>
      {/* 抽屉左缘拖拽手柄：12px 热区（width:0 不占布局，absolute 悬跨抽屉左缘 6px）+ 4px 分隔缝，
          常态 divider 灰、hover/拖动主色高亮；双击复位默认宽度 */}
      <Box sx={{ width: 0, flexShrink: 0, position: 'relative' }}>
        <Box
          role="separator"
          aria-orientation="vertical"
          aria-label={t('writing.resizeRightPanel')}
          title={t('writing.resizeRightPanel')}
          onPointerDown={onResizeStart}
          onDoubleClick={onResizeReset}
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
              bgcolor: dragActive ? 'primary.main' : 'divider',
              borderRadius: 2,
              transition: 'background-color 120ms ease',
            },
            '&:hover > span': { bgcolor: 'primary.main' },
          }}
        >
          <Box component="span" />
        </Box>
      </Box>
      <Box
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          borderLeft: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          bgcolor: 'background.paper',
        }}
      >
        {/* 抽屉顶栏：章详情入口 + 收起按钮（标题已移除，按钮靠右） */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 0.75,
            px: 1.5,
            py: 0.75,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Button
            size="small"
            startIcon={<InfoRoundedIcon />}
            disabled={!activeChapter}
            onClick={onOpenChapterDetails}
            sx={{
              fontSize: uiFontSize(11.5),
              minWidth: 0,
              px: 0.75,
              textTransform: 'none',
              // startIcon 内 SvgIcon 会被 MUI Button 的 `.MuiButton-startIcon > :nth-of-type(1)`(1.125rem)
              // 覆盖尺寸，必须用更高特异性的选择器才能压住，统一图标 14px 与文字协调
              '& .MuiButton-startIcon svg': { fontSize: uiFontSize(14) },
            }}
          >
            {t(surfaceKeyForGenre(genre, 'unitDetail'))}
          </Button>
          <IconButton
            size="small"
            aria-label={t('writing.drawerCollapse')}
            title={t('writing.drawerCollapse')}
            onClick={() => setCollapsed(true)}
            sx={{
              color: 'text.secondary',
              // hover 时随「章详情」同用主色，提示右侧两个按钮同属抽屉头部操作组
              '&:hover': { color: 'primary.main' },
            }}
          >
            <KeyboardDoubleArrowRightRoundedIcon sx={{ fontSize: uiFontSize(16) }} />
          </IconButton>
        </Box>

        {/* 全书体检入口（批次② 增-1）：六组全书体检此前只在场景画布可见，写作台进不去。
            刻意放在提醒区之上、且不受"有没有提醒"控制——0 项也要显示，
            "全书没查出问题"本身就是作者要看到的信息。 */}
        {onOpenHealth && (
          <Box
            role="button"
            tabIndex={0}
            onClick={onOpenHealth}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenHealth();
              }
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              px: 1.5,
              py: 0.75,
              flexShrink: 0,
              cursor: 'pointer',
              borderBottom: 1,
              borderColor: 'divider',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Typography
              sx={{ fontSize: uiFontSize(11), fontWeight: 600, color: 'text.secondary', flex: 1, minWidth: 0 }}
            >
              {t('writing.healthEntry')}
            </Typography>
            {typeof healthCount === 'number' && (
              <Box
                component="span"
                sx={{
                  fontSize: uiFontSize(11),
                  fontWeight: 700,
                  px: 0.6,
                  borderRadius: 1,
                  // 文字实色 + 底用低透明：同色实心会把数字糊掉
                  color: healthCount > 0 ? 'warning.main' : 'success.main',
                  bgcolor: healthCount > 0 ? 'rgba(180,83,9,0.12)' : 'rgba(22,163,74,0.12)',
                }}
              >
                {healthCount}
              </Box>
            )}
          </Box>
        )}

        {/* 提醒汇总区：四类提醒条（有内容才渲染；空时整区隐藏，避免空壳占位）——
          正在输入触发语料检索时自动折叠为标题行（语料检索获得整段垂直空间），
          标题行按钮可手动展开/收起；输入清空自动恢复展开。 */}
        {hasReminders && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              ...(remindersCollapsed ? {} : { maxHeight: '40%', overflowY: 'auto' }),
              borderBottom: 1,
              borderColor: 'divider',
              bgcolor: 'action.hover' as unknown as string,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1.5,
                py: 0.5,
                bgcolor: 'background.paper',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <NotificationsNoneRoundedIcon sx={{ fontSize: uiFontSize(13), color: 'text.disabled' }} />
              <Typography
                sx={{ fontSize: uiFontSize(11), fontWeight: 600, color: 'text.secondary', flex: 1, minWidth: 0 }}
              >
                {t('writing.drawerReminders')}
              </Typography>
              <IconButton
                size="small"
                aria-label={
                  remindersCollapsed ? t('writing.drawerRemindersExpand') : t('writing.drawerRemindersCollapse')
                }
                title={remindersCollapsed ? t('writing.drawerRemindersExpand') : t('writing.drawerRemindersCollapse')}
                onClick={() => setRemindersCollapsed((c) => !c)}
                sx={{ color: 'text.disabled' }}
              >
                {remindersCollapsed ? (
                  <KeyboardArrowDownRoundedIcon sx={{ fontSize: uiFontSize(16) }} />
                ) : (
                  <KeyboardArrowUpRoundedIcon sx={{ fontSize: uiFontSize(16) }} />
                )}
              </IconButton>
            </Box>
            {!remindersCollapsed && activeChapter && (
              <>
                <ForeshadowReminder foreshadowings={payableForeshadowings} genre={genre} />
                <InspirationReminder inspirations={inspirationReminders} genre={genre} />
                <ProofreadReminder issues={proofreadReminders} genre={genre} />
                <StatsReminder chapter={activeChapter} chapters={chapters} genre={genre} />
              </>
            )}
          </Box>
        )}

        {/* 语料参考：embedded 铺满剩余高度（输入即自动检索 + 固定单一展示区 + 插入不变）；
          配置了 aiCorpus 时升级为「语料库 / AI 语料」双标签页——语料库 Tab 原样保留零回归，
          AI 语料 Tab 渲染 AiCorpusPanel（会话/流式复用既有 agent 体系）；
          再配置 externalCapture 时追加「素材库」Tab（外部素材采集分析结果）。 */}
        {aiCorpus || externalCapture ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <Tabs
              value={safeTab}
              onChange={(_e, v) => setCorpusTab(v as number)}
              sx={{
                flexShrink: 0,
                minHeight: 34,
                px: 1,
                '& .MuiTabs-indicator': { height: 2 },
                '& .MuiTab-root': { minHeight: 34, fontSize: uiFontSize(12), py: 0.5, textTransform: 'none' },
              }}
            >
              <Tab value={0} label={t('writing.corpusTabLibrary')} data-testid="corpus-tab-library" />
              {aiCorpus && <Tab value={1} label={t('writing.corpusTabAi')} data-testid="corpus-tab-ai" />}
              {externalCapture && (
                <Tab value={captureTabIndex} label={t('writing.corpusTabCapture')} data-testid="corpus-tab-capture" />
              )}
            </Tabs>
            {safeTab === 0 ? (
              <CorpusReferencePanel embedded query={corpusQuery} onInsertText={onInsertText} />
            ) : aiCorpus && safeTab === 1 ? (
              <AiCorpusPanel {...aiCorpus} onInsertText={onInsertText} />
            ) : externalCapture ? (
              <ExternalCapturePanel {...externalCapture} />
            ) : (
              <CorpusReferencePanel embedded query={corpusQuery} onInsertText={onInsertText} />
            )}
          </Box>
        ) : (
          <CorpusReferencePanel embedded query={corpusQuery} onInsertText={onInsertText} />
        )}
      </Box>
    </>
  );
}
