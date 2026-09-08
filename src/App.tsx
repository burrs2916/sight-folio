import { useState, useCallback } from "react";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { AppTheme } from "./theme";
import { SideMenu, AppNavbar, AppFooter } from "./components/layout";
import SettingsDrawer from "./components/layout/SettingsDrawer";
import GlobalToast from "./components/ui/GlobalToast";
import {
  DashboardPage,
  SceneEditorPage,
  PublishedScenesPage,
  ScenePreviewPage,
  EntityCatalogPage,
  AiAgentPage,
} from "./pages";
import { useThemeStore } from "./store/themeStore";
import { useSceneStore } from "./store/sceneStore";
import { useI18n } from "./i18n";
import { useLayoutStore } from "./store/layoutStore";
import { useAppearanceStore } from "./store/appearanceStore";
import { useDataSourceStore } from "./store/datasourceStore";
import { useDeviceAdapterStore } from "./store/deviceAdapterStore";
import { useAuthStore } from "./store/authStore";
import { useProjectStore } from "./store/projectStore";
import { CodeWorkbenchStandalone } from "./editor/panels/CodeWorkbenchStandalone";
import { useCanvasWorkbenchLink, useWorkbenchFocusCanvasListener } from "./editor/utils/canvasWorkbenchLink";
import { startAnalysisScheduler, stopAnalysisScheduler } from "./ai/analysisScheduler";
import type { ThemeMode } from "./store/themeStore";
import { useEffect, useMemo } from "react";

function getSystemMode(): "light" | "dark" {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return getSystemMode();
  return mode;
}

// 独立页面（无侧边栏）：预览 / 组件预览
const STANDALONE_ROUTES = ["/preview"];

function isStandaloneRoute(pathname: string): boolean {
  return STANDALONE_ROUTES.some((r) => pathname.startsWith(r));
}

function AppLayout() {
  // 全局语言订阅：切换语言时强制整棵树重渲染。
  // 项目里绝大多数组件只调用模块级 t()（读 current），本身不订阅
  // useSyncExternalStore —— 只有根组件订阅，语言切换才能刷新所有文案。
  useI18n();
  const location = useLocation();
  const themeConfig = useThemeStore((state) => state.config);
  const layoutConfig = useLayoutStore((state) => state.config);
  const standalone = isStandaloneRoute(location.pathname);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const handleSettingsClick = useCallback(() => setSettingsOpen(true), []);
  const handleSettingsClose = useCallback(() => setSettingsOpen(false), []);

  // 工作台 AI 面板的「打开 AI 设置」按钮（独立窗口无路由，主窗口在此接管导航）
  const navigate = useNavigate();
  useEffect(() => {
    let un: (() => void) | undefined;
    listen("open-ai-settings", () => navigate("/ai")).then((u) => (un = u));
    return () => un?.();
  }, [navigate]);

  const contentPaddingMap: Record<string, string> = {
    none: "0px",
    small: "8px",
    medium: "24px",
    large: "40px",
  };
  const contentPad = contentPaddingMap[layoutConfig?.contentPadding] ?? "24px";

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
        console.error("[App] loadScenes failed", e);
      }
    })();
  }, [sceneLoadScenes, sceneSetActive]);

  if (standalone) {
    return (
      <Routes>
        <Route path="/preview/:sceneId" element={<ScenePreviewPage />} />
      </Routes>
    );
  }

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <SideMenu />
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
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
            overflow: "auto",
            backgroundColor: (t) => t.palette.background.default,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Box
            sx={{
              p: contentPad,
              maxWidth: { sm: "100%", md: "1700px" },
              mx: "auto",
              minHeight: 0,
              width: "100%",
              flex: 1,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/analyzer" element={<SceneEditorPage />} />
              <Route path="/published" element={<PublishedScenesPage />} />
              <Route path="/entities" element={<EntityCatalogPage />} />
              <Route path="/ai" element={<AiAgentPage />} />
            </Routes>
          </Box>
        </Box>
        <AppFooter />
      </Box>

      {/* 设置抽屉 */}
      <SettingsDrawer open={settingsOpen} onClose={handleSettingsClose} />

      {/* 全局 Toast 通知 */}
      <GlobalToast />
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
  const loadAdapters = useDeviceAdapterStore((state) => state.loadFromBackend);
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
    loadDataSources();
    loadAdapters();
    // 注册文件变更监视事件监听（幂等）
    initFileWatcher();
  }, [layoutInit, themeInit, appearanceInit, authInit, loadDataSources, loadAdapters, initFileWatcher]);

  // 自动分析调度心跳。
  //
  // 挂在应用级而不是某个页面：分析的连续性不该取决于用户此刻停在哪个界面。
  // 作用域用函数读取而非固定值——用户随时会切换项目，写死会让心跳一直对着
  // 一个早已关掉的分析发起补跑。至于该作用域下有哪些模块要补，由上下文注册表
  // 自己回答，这里不需要点名任何模块。
  useEffect(() => {
    startAnalysisScheduler({
      getScopeId: () => useProjectStore.getState().activeAnalysisId || null,
    });
    return () => stopAnalysisScheduler();
  }, []);

  useEffect(() => {
    if (themeConfig.mode === "system" && typeof window !== "undefined" && window.matchMedia) {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        useThemeStore.getState().setMode("system");
      };
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
  }, [themeConfig.mode]);

  useEffect(() => {
    document.documentElement.setAttribute("data-mui-color-scheme", resolvedMode);
  }, [resolvedMode]);

    if (!themeInitialized) {
      return <Box sx={{ width: 0, height: 0 }} />;
    }

    // 独立原生代码工作台窗口：URL 带 workbench=1 query 时只渲染工作台，不加载主布局。
    const isWorkbenchWindow =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("workbench");
    if (isWorkbenchWindow) {
      return (
        <BrowserRouter>
          <AppTheme config={themeConfig}>
            <CssBaseline enableColorScheme />
            <CodeWorkbenchStandalone />
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
