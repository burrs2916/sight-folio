import { useCallback, useState } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppTheme } from './theme';
import { SideMenu, AppNavbar, AppFooter } from './components/layout';
import SettingsDrawer from './components/layout/SettingsDrawer';
// 写作台独立窗口的精简设置面板（第二十六轮）：与主抽屉共用同一批 store
import { WritingDeskSettingsHost } from './components/layout/DeskSettingsPanel';
import GlobalToast from './components/ui/GlobalToast';
import GlobalConfirmDialog from './components/ui/GlobalConfirmDialog';
import ToolApprovalDialog from './components/ui/ToolApprovalDialog';
import {
  BookshelfPage,
  SceneEditorPage,
  PublishedScenesPage,
  ScenePreviewPage,
  AiAgentPage,
  WritingPage,
  LibraryPage,
} from './pages';
import { useThemeStore, resolveModeWithSystem } from './store/themeStore';
import { CONTENT_PADDING_PX, resolveContentMaxWidth } from './theme/appearanceScales';
// 明暗的 DOM 门面（祖先侧最后一道写者）：三道闸的来龙去脉见该模块头注释
import { useColorSchemeFacade } from './theme/colorSchemeFacade';
import { useSceneStore } from './store/sceneStore';
import { useI18n } from './i18n';
// resolveFullBleedFollowsLayout：三页无边距是否让位给「内容留白 / 内容区宽度」的唯一读数口径（第二十七轮）
import { useLayoutStore, resolveFullBleedFollowsLayout } from './store/layoutStore';
import { useAppearanceStore } from './store/appearanceStore';
import { useTypographyDefaultsStore } from './store/typographyDefaultsStore';
// 书级排版覆盖（第三十轮 P1）：落点从 localStorage 换进设置库，首帧同样要等它读回
import { useBookTypographyStore } from './store/bookTypographyStore';
import { useLanguageStore } from './store/languageStore';
import { useWritingPrefsStore } from './store/writingPrefsStore';
import { useSettingsPanelStore } from './store/settingsPanelStore';
import { useSettingsHealthStore } from './store/settingsHealthStore';
import { useSettingsShortcut } from './hooks/useSettingsShortcut';
import { subscribeAppearanceChanges } from './services/appearanceSync';
import type { ThemeConfig } from './store/themeStore';
import type { LayoutConfig } from './store/layoutStore';
import type { BookTypography } from './utils/typography';
import type { WritingPrefs } from './store/writingPrefsStore';
import { useDataSourceStore } from './store/datasourceStore';
import { useAuthStore } from './store/authStore';
import { useProjectStore } from './store/projectStore';
import {
  useWritingStore,
  WRITING_CONTENT_SAVED_EVENT,
  WRITING_NARRATIVE_CHANGED_EVENT,
  WRITING_BOOK_META_CHANGED_EVENT,
  WRITING_CHAPTER_STRUCT_CHANGED_EVENT,
  WRITING_OUTLINE_CHANGED_EVENT,
  type WritingOutlineChangedPayload,
  WRITING_SETTING_CHANGED_EVENT,
  type WritingSettingChangedPayload,
  type WritingContentSavedPayload,
  type WritingNarrativeChangedPayload,
  type WritingBookMetaChangedPayload,
  type WritingChapterStructChangedPayload,
} from './store/writingStore';
import {
  DESK_GOTO_PUBLISHED_EVENT,
  DESK_GOTO_VIEW_EVENT,
  PUBLISHED_ROUTE,
  applyDeskGotoView,
  type ChapterJumpPayload,
} from './utils/writingDeskJump';
import { CodeWorkbenchStandalone } from './editor/panels/CodeWorkbenchStandalone';
import { useCanvasWorkbenchLink, useWorkbenchFocusCanvasListener } from './editor/utils/canvasWorkbenchLink';
import { startAnalysisScheduler, stopAnalysisScheduler } from './ai/analysisScheduler';
import { useEffect, useMemo } from 'react';

// 独立页面（无侧边栏）：预览 / 组件预览。
// 写作台不进本表：主窗口 /writing 保持原布局（侧边栏+导航栏）；
// 仅写作台独立窗口（query 带 desk=1 标记）走下方沉浸分支。
const STANDALONE_ROUTES = ['/preview'];

function isStandaloneRoute(pathname: string): boolean {
  return STANDALONE_ROUTES.some((r) => pathname.startsWith(r));
}

// 写作台独立窗口判定：/writing + desk=1 query（writingDeskWindow 建窗时打上）。
// WritingPage 消费定位参数后会保留 desk=1（只清 book/chapter/setting），判定稳定不闪回。
function isWritingDeskWindow(pathname: string): boolean {
  return (
    pathname.startsWith('/writing') &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('desk')
  );
}

// ─── 封存域开关（2026-10-22 产品决策：遗留资产封存降级）───
// 代码分析工作台 + 数据源集成保留代码、停止投入；应用启动不再初始化这两个域
// （数据源 loadFromBackend 会对已配置连接真实建连，文件监视挂的是代码分析域监听）。
// 恢复方式：改回 false 即恢复原启动行为；画布数据绑定等能力代码原样保留。
const SEAL_LEGACY_DOMAINS = true;

/**
 * 外观读回门控（第二十三轮）。
 *
 * 病灶：渲染只等 themeInitialized，而布局 / 正文排版同样是从设置库异步读回的 ——
 * 首帧于是按「默认模板」画一遍（侧栏展开 240px、标准留白、默认排版），几百毫秒后读回值到达
 * 才跳到用户那一套。对天天开同一个软件的人来说，这一跳就是「设置是不是又没生效」。
 * 主题单独挡住是因为 MUI 主题在首帧就要定色板；第二十三轮把同一条口径补齐到布局与正文排版，
 * 第二十四轮再补上界面语言与写作偏好（五项都是设置库异步读回，缺一即开机闪一帧「不是我的那套」）。
 *
 * 兜底超时：读回走的是 IPC，万一某一项永远回不来（库被占 / 后端异常），不能因此永远白屏 ——
 * 到点先让界面出来，宁可闪一下，也不能把整个应用挂住。
 *
 * 第三十四轮补一句，防止下一个人把这窗口当漏洞填掉：超时放行后界面已可交互，而 init 还在飞，
 * 这段时间的改动会与迟到读数撞上。修法不在这里加锁（那等于把白屏换一个「点了没反应」），
 * 而在各 store 的 init 里按字段合并迟到读数 —— 见 store/settingsReadbackGuard.ts。
 */
const APPEARANCE_READBACK_TIMEOUT_MS = 1500;

function useAppearanceReadbackReady(ready: boolean): boolean {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setTimedOut(true), APPEARANCE_READBACK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready]);
  return ready || timedOut;
}

function AppLayout() {
  // 全局语言订阅：切换语言时强制整棵树重渲染。
  // 项目里绝大多数组件只调用模块级 t()（读 current），本身不订阅
  // useSyncExternalStore —— 只有根组件订阅，语言切换才能刷新所有文案。
  useI18n();
  const location = useLocation();
  const layoutConfig = useLayoutStore((state) => state.config);
  const isDeskWindow = isWritingDeskWindow(location.pathname);
  const standalone = isStandaloneRoute(location.pathname) || isDeskWindow;
  // 抽屉开合提到 store：顶栏按钮、侧栏入口、⌘,/Ctrl+, 快捷键都要触发同一个动作
  // （此前是 AppLayout 的私有 useState，除顶栏外没有任何入口 —— 台账连着两轮的可发现性待办）
  const settingsOpen = useSettingsPanelStore((state) => state.open);
  const setSettingsOpen = useSettingsPanelStore((state) => state.setOpen);
  const handleSettingsClick = useCallback(() => setSettingsOpen(true), [setSettingsOpen]);
  const handleSettingsClose = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);
  // 独立窗口里只有写作台该抢这个组合键：它自带精简设置面板（第二十六轮补的入口）。
  // 预览窗口没有设置面板，继续不抢，免得把用户的 ⌘, 变成一个没反应的组合。
  useSettingsShortcut(!standalone || isDeskWindow);

  // 工作台 AI 面板的「打开 AI 设置」按钮（独立窗口无路由，主窗口在此接管导航）
  const navigate = useNavigate();
  useEffect(() => {
    let un: (() => void) | undefined;
    listen('open-ai-settings', () => navigate('/ai')).then((u) => (un = u));
    return () => un?.();
  }, [navigate]);

  // 跨窗口正文同步：写作台（独立 webview）落库成功后广播 content-saved，
  // 本窗口（含主窗口正文容器）把该章 content 就地并入 writingStore——
  // 保证「写作台写了正文 → 主窗口点章 1 能看到」，不需要整表 loadChapters 刷新。
  // 幂等：store 内按「目标章存在且属于当前激活书」判定，重复事件无副作用。
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<WritingContentSavedPayload>(WRITING_CONTENT_SAVED_EVENT, (e) => {
      void useWritingStore.getState().applyExternalChapterContent(e.payload);
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  // 跨窗口叙事数据同步：任一窗口改了时间线 / 伏笔 / 剧情线，其它打开同一本书的窗口
  // 按组重载。这三张表是全书体检的数据源，两边不一致会让人怀疑检测结论本身。
  // 所有窗口（含写作台自己）都要消费：写的人是自己、看的人也是自己时的重复重载由
  // store 内部按 activeBookId 判定，且重载幂等。
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<WritingNarrativeChangedPayload>(WRITING_NARRATIVE_CHANGED_EVENT, (e) => {
      void useWritingStore.getState().applyExternalNarrativeChange(e.payload);
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  // 跨窗口书元信息同步：任一窗口改了书名 / 简介 / 体裁·载体 / 连载状态 / 日更目标 / 全书目标，
  // 其它已加载该书的窗口整表重载书架。创作者在一边「规划本书」调了截稿 / 目标，另一边（工作室
  // 书属性卡 / 写作台 / 书架）能立刻看到一致的目标与节奏预测，不再基于互相矛盾的旧数据做决策。
  // 所有窗口都消费：写的人自己那次重载幂等（loadBooks 拿同一份库）。
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<WritingBookMetaChangedPayload>(WRITING_BOOK_META_CHANGED_EVENT, (e) => {
      void useWritingStore.getState().applyExternalBookMetaChange(e.payload);
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  // 跨窗口章节结构同步：任一窗口新建 / 删除 / 恢复 / 永久删除 / 重排 / 改名 / 改卷名 / 改状态 /
  // 改层级名 / 挂线 / 换父级 章节，其它正在看这本书的窗口整表重载章节缓存（loadChapters 按
  // activeBookId 守卫、幂等）。补齐第十七轮遗留的「章节增删不广播」缺口——写作台建/删一章，
  // 工作室左栏目录树、catalog 视图、规划本书面板的章节数 / 体量 / 节奏预测能立刻跟上。
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<WritingChapterStructChangedPayload>(WRITING_CHAPTER_STRUCT_CHANGED_EVENT, (e) => {
      void useWritingStore.getState().applyExternalChapterStructChange(e.payload);
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  // 跨窗口大纲结构同步：任一窗口新建 / 改内容 / 改挂载章 / 改封面 / 删除 / 重排 大纲，
  // 其它正在看这本书的窗口整表重载大纲缓存（loadOutlines 按 activeBookId 守卫、幂等）。
  // 补齐第十八轮遗留的「大纲增删改不广播」缺口——写作台挂一个灵感 / 节拍，工作室灵感面板、
  // 章节概览计数、审校报告、伏笔人设关联等能立刻跟上。
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<WritingOutlineChangedPayload>(WRITING_OUTLINE_CHANGED_EVENT, (e) => {
      void useWritingStore.getState().applyExternalOutlineChange(e.payload);
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  // 跨窗口设定结构同步：任一窗口新建 / 改名 / 改副标题·简介·关系挂线 / 删除 设定卡，
  // 其它正在看这本书的窗口整表重载设定缓存（loadSettings 按 activeBookId 守卫、幂等，并重建
  // settingInboundIndex）。补齐与章节结构/大纲同级的「设定增删改不广播」缺口——写作台建/改/删
  // 人设·世界观卡，工作室实体卡视图、关系图、审校结论、章节概览登场/出场计数能立刻跟上。
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<WritingSettingChangedPayload>(WRITING_SETTING_CHANGED_EVENT, (e) => {
      void useWritingStore.getState().applyExternalSettingChange(e.payload);
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  // 跨窗口章级跳转：写作台独立窗口的提醒条点击 → desk-goto-view 事件 →
  // 主窗口按同一语义执行（选中实体 / proofreadFocusKey / statsFocusChapterId +
  // openTypedCarrierView 切页签），并置前聚焦。写作台窗口自身不消费（
  // 跳转目标是主窗口 L2 页签体系；省去 emitTo 对主窗口 label 的硬依赖）。
  useEffect(() => {
    if (isWritingDeskWindow(location.pathname)) return;
    let un: (() => void) | undefined;
    listen<ChapterJumpPayload>(DESK_GOTO_VIEW_EVENT, (e) => {
      applyDeskGotoView(e.payload);
      void getCurrentWindow().setFocus();
    }).then((u) => (un = u));
    return () => un?.();
  }, [location.pathname]);

  // 页面级跳转（2026-11-04 审计缺陷 A）：写作台窗口的「查看完结作品」由**本窗口**执行导航。
  // 判据与上面章级跳转完全同源（写作台自身不消费），差别只在落点是整页路由而不是 L2 页签。
  // 为什么不能由发起方自己 navigate：写作台窗口形态判据含 `?desk=1`，裸 navigate 会同时改掉
  // pathname 与 search，沉浸窗口长侧栏、该书 label 被占却无人消费 focus 事件（写作台回不去）、
  // desk-goto-view 多出一个消费者。详见 utils/writingDeskJump.ts「页面级跳转分发」注释。
  useEffect(() => {
    if (isWritingDeskWindow(location.pathname)) return;
    let un: (() => void) | undefined;
    listen(DESK_GOTO_PUBLISHED_EVENT, () => {
      navigate(PUBLISHED_ROUTE);
      void getCurrentWindow().setFocus();
    }).then((u) => (un = u));
    return () => un?.();
  }, [location.pathname, navigate]);

  // 内容留白档位 → 主内容区 padding（档位定义见 theme/appearanceScales.ts，与设置面板同源）
  const contentPad = CONTENT_PADDING_PX[layoutConfig?.contentPadding] ?? CONTENT_PADDING_PX.medium;
  // 内容区宽度上限档位（第二十一轮）：此前这里是硬编码 1700px，宽屏用户只能改代码
  const contentMaxWidth = resolveContentMaxWidth(layoutConfig?.contentWidth);
  // 侧栏在右：外层是 flex row，侧栏 order=1 / 主区 order=0 即可换位（SideMenu 同步设 order）
  const sidebarOnRight = layoutConfig?.sidebarPosition === 'right';

  // 全出血路由：内容壳的 padding / maxWidth(1700px) / mx:auto 对内容页（仪表盘等）合理，
  // 但套在工作室（/analyzer）上会在宽屏下四周留白、左右被压到上限——用户点名「编辑区没有占满还有空隙」
  // （2026-09-19）。语料库页（/library）同样要求不留边距（用户 2026-09-28 点名）。
  // AI 助手页（/ai）同样要求不留边距（用户 2026-10-05 点名）。
  // 这三条路由全出血，其余页面维持原内容壳不动。
  const isFullBleedRoute =
    location.pathname.startsWith('/analyzer') ||
    location.pathname.startsWith('/library') ||
    location.pathname.startsWith('/ai');
  // 第 26 轮待办 1 的收口：上面这三页曾**无条件**盖掉「内容留白 / 内容区宽度」两档，
  // 于是设置抽屉里切档位这三页毫无反应，用户读到的还是「设置没生效」。
  // 但这三页的无边距是用户三次点名要来的既成事实（见上注），悄悄改回去会让画布重新被压在中间一条。
  // 现由设置项「全出血页遵循布局」决定：默认关（观感一字不变），开了三页一并跟随 ——
  // 例外从代码里挪进设置项，由创作者自己拍板。
  const shellFollowsLayout = !isFullBleedRoute || resolveFullBleedFollowsLayout(layoutConfig?.fullBleedFollowsLayout);

  // 启动加载分析列表，并自动选中第一个（避免分析仪空白屏）
  const sceneLoadScenes = useSceneStore((s) => s.loadScenes);
  const sceneSetActive = useSceneStore((s) => s.setActiveScene);
  useEffect(() => {
    (async () => {
      try {
        await sceneLoadScenes();
        const st = useSceneStore.getState();
        if (!st.activeSceneId && st.scenes.length > 0) {
          sceneSetActive(st.scenes[0].id);
        }
      } catch (e) {
        console.error('[App] loadScenes failed', e);
      }
    })();
  }, [sceneLoadScenes, sceneSetActive]);

  if (standalone) {
    return (
      <>
        <Routes>
          <Route path="/preview/:sceneId" element={<ScenePreviewPage />} />
          {/* 写作台独立窗口：沉浸无 chrome，消费 query 定位参数（见 WritingPage） */}
          <Route path="/writing" element={<WritingPage />} />
        </Routes>
        {/* 写作台独立窗口的设置入口（第二十六轮，落第 25 轮待办 2）：此前这边零入口，
            「正写着想调保存节奏 / 打字机滚动」必须回主窗口。面板写的是同一批 store，
            因此即时生效、落库、跨窗口跟随都自动与主窗口一致（不是第二套设置）。 */}
        {isDeskWindow && <WritingDeskSettingsHost />}
        {/* 独立窗口也要看得见落盘失败（第二十一轮）：写作台里有正文排版入口，那一项同样是
            「即时生效 + 即时落盘」。此前 GlobalToast 只挂在带侧栏的常规分支，这边写库失败
            零提示，用户要等重启才发现没记住。 */}
        <GlobalToast />
        {/* 危险动作确认同理三处壳都要挂（2026-11-04 删除铁律）：独立窗口里也有删除入口，
            少挂一处就是「点了删除什么都没弹，直接没了」。 */}
        <GlobalConfirmDialog />
      </>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <SideMenu />
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minWidth: 0,
          order: sidebarOnRight ? 0 : 1,
        }}
      >
        <AppNavbar onSettingsClick={handleSettingsClick} />
        <Box
          component="main"
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            backgroundColor: (t) => t.palette.background.default,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box
            sx={{
              p: shellFollowsLayout ? contentPad : 0,
              // md 档起才限宽（窄屏本来就占满）；上限值来自「内容区宽度」档位表
              maxWidth: shellFollowsLayout ? { sm: '100%', md: contentMaxWidth } : 'none',
              mx: shellFollowsLayout ? 'auto' : 0,
              minHeight: 0,
              width: '100%',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Routes>
              <Route path="/" element={<BookshelfPage />} />
              <Route path="/analyzer" element={<SceneEditorPage />} />
              <Route path="/published" element={<PublishedScenesPage />} />
              <Route path="/ai" element={<AiAgentPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/writing" element={<WritingPage />} />
            </Routes>
          </Box>
        </Box>
        <AppFooter />
      </Box>

      {/* 设置抽屉 */}
      <SettingsDrawer open={settingsOpen} onClose={handleSettingsClose} />

      {/* 全局 Toast 通知 */}
      <GlobalToast />
      {/* 全局危险动作确认（删除铁律的唯一出口） */}
      <GlobalConfirmDialog />

      {/* 高危工具审批：主窗口与写作台独立窗口都走这里（AppLayout 覆盖两者）。
          绝不能只挂在某个 AI 面板里，否则那条路径的写入会静默超时被拒。 */}
      <ToolApprovalDialog />
    </Box>
  );
}

export default function App() {
  const themeConfig = useThemeStore((state) => state.config);
  const themeInit = useThemeStore((state) => state.init);
  const themeInitialized = useThemeStore((state) => state.initialized);

  const layoutInit = useLayoutStore((state) => state.init);
  const layoutInitialized = useLayoutStore((state) => state.initialized);
  const appearanceInit = useAppearanceStore((state) => state.init);
  const typographyDefaultsInit = useTypographyDefaultsStore((state) => state.init);
  const typographyDefaultsInitialized = useTypographyDefaultsStore((state) => state.initialized);
  const bookTypographyInit = useBookTypographyStore((state) => state.init);
  const bookTypographyInitialized = useBookTypographyStore((state) => state.initialized);
  const languageInit = useLanguageStore((state) => state.init);
  const languageInitialized = useLanguageStore((state) => state.initialized);
  const writingPrefsInit = useWritingPrefsStore((state) => state.init);
  const writingPrefsInitialized = useWritingPrefsStore((state) => state.initialized);
  const authInit = useAuthStore((state) => state.init);
  const loadDataSources = useDataSourceStore((state) => state.loadFromBackend);
  const initFileWatcher = useProjectStore((state) => state.initFileWatcher);

  // 画布 ↔ 代码工作台 双向联动（主窗口侧：订阅选中态 + 监听工作台反向聚焦）
  useCanvasWorkbenchLink();
  useWorkbenchFocusCanvasListener();

  // 实际生效明暗：mode='system' 时取系统读数。读数走 store 的 systemMode 字段而不是在渲染期
  // 直接读 matchMedia —— 后者变了不会让 useMemo 重算，界面就会停在切换前的那套明暗。
  const systemMode = useThemeStore((state) => state.systemMode);
  const resolvedMode = useMemo(
    () => resolveModeWithSystem(themeConfig.mode, systemMode),
    [themeConfig.mode, systemMode],
  );

  // 明暗 DOM 门面的**最后一道**（2026-11-03 李先生报修「重启后深字压深底」）。
  //
  // 机理：CSS 变量挂在 data-mui-color-scheme 上，而这个属性原本有两个写者 ——
  // App 这里一个、MUI 的 CssVarsProvider 一个，且 MUI 用的是它自己那份 mode 状态：
  // 它把 mode 存进 localStorage['mui-mode']，读回时优先于 defaultMode
  // （useCurrentColorScheme.mjs:64），默认值又是 'system'。于是「主题对象已是深色、
  // 属性被盖成 light、变量回到浅色套」的半套主题就出现了：实测「书架」标题 1.17:1、
  // 空态说明 1.10:1，走内联样式的区域是深底、走 var() 的文字是浅色深字。
  //
  // 三道闸（缺一不可，回归锁见 theme/__tests__/colorSchemeDomRound46.test.tsx）：
  //  ① AppTheme 只交「当前那一套 colorScheme」⇒ MUI 推导出的 mode 只能等于我们的值；
  //  ② ThemeProvider storageManager={null} ⇒ 拔掉 localStorage['mui-mode'] 这条库外真源；
  //  ③ 这里在祖先组件的 passive effect 里再写一次 ⇒ 同一轮提交里祖先晚于后代，
  //     「谁后跑谁赢」被固定下来，而不是靠运气。
  useColorSchemeFacade(resolvedMode);

  useEffect(() => {
    layoutInit();
    themeInit();
    appearanceInit();
    // 正文默认排版：init 会把读回的值推给 utils/typography 的模块级默认值，写作台据此渲染
    // （未单独调过排版的书跟随它，见 typographyDefaultsStore 注释里的优先级口径）
    typographyDefaultsInit();
    // 书级排版覆盖（第三十轮 P1）：与全局默认并行读回，顺带把老 localStorage 迁进设置库
    bookTypographyInit();
    // 界面语言同样以设置库为准（独立窗口的 localStorage 不一定共享，见 languageStore 注释）
    languageInit();
    // 写作偏好（专注模式 / 打字机滚动 / 自动保存节奏）：写作台据此决定打开时是哪一态，
    // 必须与首帧一起读回，否则「上次的禅模式」要晚一帧才回来
    writingPrefsInit();
    authInit();
    if (!SEAL_LEGACY_DOMAINS) {
      loadDataSources();
      // 注册文件变更监视事件监听（幂等）；写作台独立窗口不挂代码分析域的文件监视
      if (!isWritingDeskWindow(window.location.pathname)) initFileWatcher();
    }
  }, [
    layoutInit,
    themeInit,
    appearanceInit,
    typographyDefaultsInit,
    bookTypographyInit,
    languageInit,
    writingPrefsInit,
    authInit,
    loadDataSources,
    initFileWatcher,
  ]);

  // 外观设置跨窗口跟随：主窗口改了主题 / 布局 / 正文排版 / 语言，已开着的写作台与
  // 代码工作台窗口立刻同步（病灶：外观只在窗口启动时读一次设置库，改完另一边不变）。
  // 只 hydrate 不回写：发起方已经落库，本窗口再写一次就是回声。
  useEffect(() => {
    return subscribeAppearanceChanges(({ scope, config }) => {
      if (scope === 'theme') useThemeStore.getState().hydrate(config as ThemeConfig);
      else if (scope === 'layout') useLayoutStore.getState().hydrate(config as LayoutConfig);
      else if (scope === 'typography') useTypographyDefaultsStore.getState().hydrate(config as BookTypography);
      // 书级排版覆盖（第三十轮 P1）：主窗口调了这本书的字号 / 纸色，开着的写作台立刻同一套
      else if (scope === 'typographyBooks') useBookTypographyStore.getState().hydrate(config);
      else if (scope === 'writing') useWritingPrefsStore.getState().hydrate(config as WritingPrefs);
      else useLanguageStore.getState().hydrate(config);
    });
  }, []);

  // 自动分析调度心跳。
  //
  // 挂在应用级而不是某个页面：分析的连续性不该取决于用户此刻停在哪个界面。
  // 作用域用函数读取而非固定值——用户随时会切换项目，写死会让心跳一直对着
  // 一个早已关掉的分析发起补跑。至于该作用域下有哪些模块要补，由上下文注册表
  // 自己回答，这里不需要点名任何模块。
  //
  // 作用域优先级：分析 > 书籍。扫描供给者按 analysisId 判可用、写作供给者按
  // bookId 判可用，同一个作用域 id 下两者互斥（id 空间不同），各取所需。
  useEffect(() => {
    startAnalysisScheduler({
      getScopeId: () => useProjectStore.getState().activeAnalysisId || useWritingStore.getState().activeBookId || null,
    });
    return () => stopAnalysisScheduler();
  }, []);

  // 系统明暗跟随（第二十轮改口径）：
  // ① 订阅不再按 mode==='system' 分叉 —— 固定浅/深档位下也保持读数新鲜，用户随时切到
  //    「跟随」都是当前系统的那套，而不是挂载时的快照；
  // ② 回调改调 syncSystemMode（只更新派生读数）。此前调 setMode('system')：档位没变，
  //    但每次系统切明暗都会白写一次设置库 + 白广播一次，还会在落盘状态里留下一次假写入。
  // 设置库健康自检（第二十一轮）：写读回探针 + 跨启动标记，看不穿「内存库」时也能说一句实话。
  // 每个窗口各跑一次无妨：判据只看「库里连一份探针都没有」，多窗口不会互相误报。
  useEffect(() => {
    void useSettingsHealthStore.getState().probe();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const motionMql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => {
      useThemeStore.getState().syncSystemMode();
    };
    const motionHandler = () => {
      useThemeStore.getState().syncSystemMotion();
    };
    handler(); // 挂载即校准一次：store 建值到这里之间系统可能已经换过明暗
    motionHandler(); // 动效读数同理，「跟随系统」档下要拿当下的值
    mql.addEventListener('change', handler);
    motionMql.addEventListener('change', motionHandler);
    return () => {
      mql.removeEventListener('change', handler);
      motionMql.removeEventListener('change', motionHandler);
    };
  }, []);

  // 主题 / 布局 / 正文排版 / 书级排版 / 界面语言 / 写作偏好六项都从设置库读回后再出首帧（口径与病灶见上方门控注释）。
  // 语言为什么也要等（第二十四轮）：store 建值时只能按「本机 localStorage > 浏览器语言」推一版读数，
  // 用户存过的语言要等一次 IPC 才回来。不等就是「先用默认语言画一遍，再整屏跳成用户那套语言」——
  // 英文界面用户每次开机都会先看见一帧中文，这正是被反复投诉的「设置是不是又没生效」。
  // 书级排版为什么也要等（第三十轮 P1）：写作台首帧就要按它排版。它在 P1 之前躺在 localStorage
  // 里是同步可读的，换成设置库之后若不一起等，就会出现「先按全局默认画一遍正文，再跳成这本书那一套」。
  // 外观预设（appearanceStore）不参与：它只喂设置抽屉的卡片列表，不参与首帧渲染，
  // 为它多等一次 IPC 只会把「界面出来」推晚，换不来任何观感收益。
  const appearanceReady = useAppearanceReadbackReady(
    themeInitialized &&
      layoutInitialized &&
      typographyDefaultsInitialized &&
      bookTypographyInitialized &&
      languageInitialized &&
      writingPrefsInitialized,
  );

  if (!appearanceReady) {
    return <Box sx={{ width: 0, height: 0 }} />;
  }

  // 独立原生代码工作台窗口：URL 带 workbench=1 query 时只渲染工作台，不加载主布局。
  const isWorkbenchWindow =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('workbench');
  if (isWorkbenchWindow) {
    return (
      <BrowserRouter>
        <AppTheme config={themeConfig}>
          <CssBaseline enableColorScheme />
          <CodeWorkbenchStandalone />
          {/* 独立工作台窗口不走 AppLayout，审批弹窗与全局提示须在此另挂一份：
              缺后者的话，这边改任何设置遇到写库失败都是静默的（第二十一轮补） */}
          <ToolApprovalDialog />
          <GlobalToast />
          <GlobalConfirmDialog />
        </AppTheme>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <AppTheme config={themeConfig}>
        <CssBaseline enableColorScheme />
        <AppLayout />
      </AppTheme>
    </BrowserRouter>
  );
}
