import { useEffect, useState, useRef } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import CloseIcon from "@mui/icons-material/Close";
import CircularProgress from "@mui/material/CircularProgress";
import { useParams, useSearchParams } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import { EditorCanvas } from "../editor/canvas/EditorCanvas";
import { SceneTabBar } from "../editor/components/SceneTabBar";
import { pluginLoader } from "../editor/plugins";
import { logger } from "../utils/logger";
import { SceneEditorProvider } from "../editor/context/SceneEditorContext";
import { RuntimeInitializer } from "../editor/runtime/RuntimeInitializer";
import { NavigationBreadcrumb } from "../editor/components/NavigationBreadcrumb";
import { t } from "../i18n";
import type { SceneDSL } from "../types/scene";

type WindowMode = "preview" | "live";

export default function ScenePreviewPage() {
  const { sceneId } = useParams<{ sceneId: string }>();
  const [searchParams] = useSearchParams();
  const mode = (searchParams.get("mode") as WindowMode) || "preview";
  const isLive = mode === "live";

  const scenes = useSceneStore((s) => s.scenes);
  const loadScenes = useSceneStore((s) => s.loadScenes);
  const loadScene = useEditorStore((s) => s.loadScene);
  const loadSceneWithViews = useEditorStore((s) => s.loadSceneWithViews);
  const setCanvasConfig = useEditorStore((s) => s.setCanvasConfig);
  const setPreviewMode = useEditorStore((s) => s.setPreviewMode);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sceneNotFound, setSceneNotFound] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pluginsReady, setPluginsReady] = useState(false);
  const [currentScene, setCurrentScene] = useState<SceneDSL | null>(null);

  // 解析导航传递的变量
  const injectedVariables = useRef<Record<string, unknown>>((() => {
    const varsParam = searchParams.get("vars");
    if (varsParam) {
      try {
        return JSON.parse(decodeURIComponent(varsParam));
      } catch {
        logger.warn("ScenePreviewPage", "Failed to parse navigation variables", { varsParam });
      }
    }
    return {};
  })());

  const unlistenRef = useRef<(() => void) | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    logger.info("ScenePreviewPage", "Page initialized", {
      mode,
      isLive,
      sceneId,
      windowLabel: getCurrentWindow().label,
    });
  }, [mode, isLive, sceneId]);

  // 确保插件系统（包含组件注册）初始化完成
  useEffect(() => {
    pluginLoader.initialize()
      .then(() => {
        setPluginsReady(true);
        logger.info("ScenePreviewPage", "Plugin system ready");
      })
      .catch((err) => {
        // 即使失败也继续，组件可能已部分注册
        setPluginsReady(true);
        logger.warn("ScenePreviewPage", "Plugin system init failed, continuing", { error: String(err) });
      });
  }, []);

  useEffect(() => {
    setPreviewMode(true);
    return () => {
      setPreviewMode(false);
    };
  }, [setPreviewMode]);

  useEffect(() => {
    loadScenes();
  }, [loadScenes]);

  // 初始化数据源（与 App.tsx 一致）
  useEffect(() => {
    const initDataStores = async () => {
      try {
        const { useDataSourceStore } = await import("../store/datasourceStore");
        await useDataSourceStore.getState().loadFromBackend();
        logger.info("ScenePreviewPage", "Data stores initialized");
      } catch (err) {
        logger.warn("ScenePreviewPage", "Data stores init failed", { error: String(err) });
      }
    };
    initDataStores();
  }, []);

  useEffect(() => {
    if (!sceneId || scenes.length === 0) return;

    const scene = scenes.find((s) => s.id === sceneId);
    if (!scene) {
      setSceneNotFound(true);
      return;
    }

    // 保存场景引用供 RuntimeInitializer 使用
    setCurrentScene(scene);

    if (scene.views && scene.views.length > 0) {
      const activeVId = scene.activeViewId || scene.views[0].id;
      loadSceneWithViews(scene.views, scene.globalComponents || [], activeVId);
    } else if (scene.editorComponents && scene.editorLayers) {
      const views = [{ id: "default", name: "viewTab.defaultView", components: scene.editorComponents, layers: scene.editorLayers }];
      loadSceneWithViews(views, [], "default");
    } else {
      loadScene([], []);
    }

    if (scene.canvasConfig) {
      setCanvasConfig(scene.canvasConfig);
    }

    setLoaded(true);
    logger.info("ScenePreviewPage", "Scene loaded", {
      sceneId,
      sceneName: scene.name,
      isLive,
    });
  }, [sceneId, scenes, loadScene, setCanvasConfig, isLive]);

  useEffect(() => {
    return () => {
      document.body.style.backgroundColor = "";
      document.documentElement.style.backgroundColor = "";
    };
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    logger.info("ScenePreviewPage", "Setting up window event listeners", { isLive });
    const currentWindow = getCurrentWindow();
    logger.info("ScenePreviewPage", "getCurrentWindow", { label: currentWindow.label });

    currentWindow.isFullscreen().then((fullscreen) => {
      logger.info("ScenePreviewPage", "Initial isFullscreen", { fullscreen });
      setIsFullscreen(fullscreen);
    }).catch((e) => {
      logger.error("ScenePreviewPage", "isFullscreen check failed", { error: String(e) });
    });

    let unlistenFn: (() => void) | null = null;
    currentWindow.onResized(() => {
      currentWindow.isFullscreen().then((fullscreen) => {
        setIsFullscreen(fullscreen);
      }).catch(() => {});
    }).then((fn) => {
      unlistenFn = fn;
      unlistenRef.current = fn;
      logger.info("ScenePreviewPage", "onResized listener registered");
    }).catch((e) => {
      logger.error("ScenePreviewPage", "onResized registration failed", { error: String(e) });
    });

    return () => {
      if (unlistenFn) {
        unlistenFn();
        unlistenFn = null;
        unlistenRef.current = null;
      }
    };
  }, [isLive]);

  const handleFullscreen = async () => {
    logger.info("ScenePreviewPage", "handleFullscreen clicked", { isLive });
    try {
      const currentWindow = getCurrentWindow();
      const fullscreen = await currentWindow.isFullscreen();
      logger.info("ScenePreviewPage", "Current fullscreen state", { fullscreen });
      if (fullscreen) {
        await currentWindow.setFullscreen(false);
        logger.info("ScenePreviewPage", "setFullscreen(false) succeeded");
      } else {
        await currentWindow.setFullscreen(true);
        logger.info("ScenePreviewPage", "setFullscreen(true) succeeded");
      }
    } catch (e) {
      logger.error("ScenePreviewPage", "fullscreen failed", {
        error: String(e),
        errorType: typeof e,
      });
    }
  };

  const handleClose = async () => {
    logger.info("ScenePreviewPage", "handleClose clicked", { isLive });
    try {
      const win = getCurrentWindow();
      logger.info("ScenePreviewPage", "Calling close", { label: win.label });
      await win.close();
      logger.info("ScenePreviewPage", "close succeeded");
    } catch (e) {
      logger.error("ScenePreviewPage", "close failed", {
        error: String(e),
        errorType: typeof e,
      });
    }
  };

  useEffect(() => {
    const logWindowSize = () => {
      logger.info("ScenePreviewPage", "window size", {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        dpr: window.devicePixelRatio,
        screen: { width: window.screen.width, height: window.screen.height },
      });
    };
    logWindowSize();
    const observer = new ResizeObserver(() => {
      logWindowSize();
    });
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  if (sceneNotFound) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "text.secondary",
          gap: 1,
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 500, opacity: 0.6 }}>
          {t("preview.notFoundTitle")}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.4 }}>
          {t("preview.notFoundDesc")}
        </Typography>
      </Box>
    );
  }

  // 等待插件系统和场景数据加载完成
  if (!pluginsReady || !loaded) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 1,
        }}
      >
        <CircularProgress size={24} />
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {!pluginsReady ? t("preview.loadingComponents") : t("preview.loading")}
        </Typography>
      </Box>
    );
  }

  return (
    <SceneEditorProvider mode="preview">
      <RuntimeInitializer scene={currentScene} injectedVariables={injectedVariables.current} />
      <Box
        sx={{
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          position: "relative",
          bgcolor: "background.default",
          m: 0,
          p: 0,
        }}
      >
          <Box
            sx={{
              width: "100%",
              height: "100%",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <SceneTabBar />
            <EditorCanvas previewMode={true} />
          </Box>

        <Box
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            zIndex: 1000,
            backgroundColor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(30,30,42,0.85)"
                : "rgba(255,255,255,0.85)",
            borderRadius: 1.5,
            px: 1,
            py: 0.25,
            backdropFilter: "blur(12px)",
            border: 1,
            borderColor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.06)",
            opacity: 0.5,
            transition: "opacity 0.2s",
            "&:hover": { opacity: 1 },
            pointerEvents: "auto",
          }}
        >
          {!isLive && (
            <Typography variant="caption" sx={{ color: "text.secondary", px: 0.5 }}>
              {t("preview.preview")}
            </Typography>
          )}
          <Tooltip title={isFullscreen ? t("preview.exitFullscreen") : t("preview.fullscreen")}>
            <IconButton size="small" onClick={handleFullscreen}>
              {isFullscreen ? (
                <FullscreenExitIcon sx={{ fontSize: 16 }} />
              ) : (
                <FullscreenIcon sx={{ fontSize: 16 }} />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title={t("preview.close")}>
            <IconButton size="small" onClick={handleClose}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>

        <NavigationBreadcrumb />
      </Box>
    </SceneEditorProvider>
  );
}
