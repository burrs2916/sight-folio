import { useState, useCallback } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppTheme } from './theme';
import { SideMenu, AppNavbar, AppFooter } from './components/layout';
import SettingsDrawer from './components/layout/SettingsDrawer';
import GlobalToast from './components/ui/GlobalToast';
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
import { useThemeStore } from './store/themeStore';
import { useSceneStore } from './store/sceneStore';
import { useI18n } from './i18n';
import { useLayoutStore } from './store/layoutStore';
import { useAppearanceStore } from './store/appearanceStore';
import { useDataSourceStore } from './store/datasourceStore';
import { useAuthStore } from './store/authStore';
import { useProjectStore } from './store/projectStore';
import {
  useWritingStore,
  WRITING_CONTENT_SAVED_EVENT,
  WRITING_NARRATIVE_CHANGED_EVENT,
  type WritingContentSavedPayload,
  type WritingNarrativeChangedPayload,
} from './store/writingStore';
import { DESK_GOTO_VIEW_EVENT, applyDeskGotoView, type ChapterJumpPayload } from './utils/writingDeskJump';
import { CodeWorkbenchStandalone } from './editor/panels/CodeWorkbenchStandalone';
import { useCanvasWorkbenchLink, useWorkbenchFocusCanvasListener } from './editor/utils/canvasWorkbenchLink';
import { startAnalysisScheduler, stopAnalysisScheduler } from './ai/analysisScheduler';
import type { ThemeMode } from './store/themeStore';
import { useEffect, useMemo } from 'react';

function getSystemMode(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return getSystemMode();
  return mode;
}

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

function AppLayout() {
  // 全局语言订阅：切换语言时强制整棵树重渲染。
  // 项目里绝大多数组件只调用模块级 t()（读 current），本身不订阅
  // useSyncExternalStore —— 只有根组件订阅，语言切换才能刷新所有文案。
  useI18n();
  const location = useLocation();
  const layoutConfig = useLayoutStore((state) => state.config);
  const standalone = isStandaloneRoute(location.pathname) || isWritingDeskWindow(location.pathname);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const handleSettingsClick = useCallback(() => setSettingsOpen(true), []);
  const handleSettingsClose = useCallback(() => setSettingsOpen(false), []);

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

  const contentPaddingMap: Record<string, string> = {
    none: '0px',
    small: '8px',
    medium: '24px',
    large: '40px',
  };
  const contentPad = contentPaddingMap[layoutConfig?.contentPadding] ?? '24px';

  // 全出血路由：内容壳的 padding / maxWidth(1700px) / mx:auto 对内容页（仪表盘等）合理，
  // 但套在工作室（/analyzer）上会在宽屏下四周留白、左右被压到上限——用户点名「编辑区没有占满还有空隙」
  // （2026-09-19）。语料库页（/library）同样要求不留边距（用户 2026-09-28 点名）。
  // AI 助手页（/ai）同样要求不留边距（用户 2026-10-05 点名）。
  // 这三条路由全出血，其余页面维持原内容壳不动。
  const isFullBleedRoute =
    location.pathname.startsWith('/analyzer') ||
    location.pathname.startsWith('/library') ||
    location.pathname.startsWith('/ai');

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
      <Routes>
        <Route path="/preview/:sceneId" element={<ScenePreviewPage />} />
        {/* 写作台独立窗口：沉浸无 chrome，消费 query 定位参数（见 WritingPage） */}
        <Route path="/writing" element={<WritingPage />} />
      </Routes>
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
              p: isFullBleedRoute ? 0 : contentPad,
              maxWidth: isFullBleedRoute ? 'none' : { sm: '100%', md: '1700px' },
              mx: isFullBleedRoute ? 0 : 'auto',
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
  const appearanceInit = useAppearanceStore((state) => state.init);
  const authInit = useAuthStore((state) => state.init);
  const loadDataSources = useDataSourceStore((state) => state.loadFromBackend);
  const initFileWatcher = useProjectStore((state) => state.initFileWatcher);

  // 画布 ↔ 代码工作台 双向联动（主窗口侧：订阅选中态 + 监听工作台反向聚焦）
  useCanvasWorkbenchLink();
  useWorkbenchFocusCanvasListener();

  const resolvedMode = useMemo(() => resolveMode(themeConfig.mode), [themeConfig.mode]);

  useEffect(() => {
    layoutInit();
    themeInit();
    appearanceInit();
    authInit();
    if (!SEAL_LEGACY_DOMAINS) {
      loadDataSources();
      // 注册文件变更监视事件监听（幂等）；写作台独立窗口不挂代码分析域的文件监视
      if (!isWritingDeskWindow(window.location.pathname)) initFileWatcher();
    }
  }, [layoutInit, themeInit, appearanceInit, authInit, loadDataSources, initFileWatcher]);

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

  useEffect(() => {
    if (themeConfig.mode === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        useThemeStore.getState().setMode('system');
      };
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
  }, [themeConfig.mode]);

  useEffect(() => {
    document.documentElement.setAttribute('data-mui-color-scheme', resolvedMode);
  }, [resolvedMode]);

  if (!themeInitialized) {
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
          {/* 独立工作台窗口不走 AppLayout，审批弹窗须在此另挂一份 */}
          <ToolApprovalDialog />
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
