import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logger } from "./logger";
import { t } from "../i18n";

export async function openPreviewWindow(sceneId: string, sceneName: string) {
  const label = `preview-${sceneId}`;
  logger.info("PreviewWindow", "Opening preview window", { sceneId, sceneName, label });

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    logger.info("PreviewWindow", "Preview window already exists, focusing", { label });
    existing.setFocus();
    return existing;
  }

  const mainWindow = getCurrentWindow();
  const mainSize = await mainWindow.innerSize();
  const scaleFactor = await mainWindow.scaleFactor();

  const width = Math.min(Math.round(mainSize.width / scaleFactor), 1280);
  const height = Math.min(Math.round(mainSize.height / scaleFactor), 800);

  logger.info("PreviewWindow", "Creating preview window", {
    label,
    width,
    height,
    url: `/preview/${sceneId}?mode=preview`,
  });

  const win = new WebviewWindow(label, {
    url: `/preview/${sceneId}?mode=preview`,
    title: t("preview.winTitle", { name: sceneName }),
    width,
    height,
    minWidth: 640,
    minHeight: 480,
    decorations: true,
    resizable: true,
    fullscreen: false,
    center: true,
    dragDropEnabled: false,
  });

  win.once("tauri://error", (e) => {
    logger.error("PreviewWindow", "Window creation error", {
      label,
      error: String(e.payload),
    });
  });

  logger.info("PreviewWindow", "Preview window created", { label });
  return win;
}

export async function openLiveWindow(sceneId: string, sceneName: string) {
  const label = `live-${sceneId}`;
  logger.info("PreviewWindow", "Opening live window", { sceneId, sceneName, label });

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    logger.info("PreviewWindow", "Live window already exists, focusing", { label });
    existing.setFocus();
    return existing;
  }

  const mainWindow = getCurrentWindow();
  const mainSize = await mainWindow.innerSize();
  const scaleFactor = await mainWindow.scaleFactor();

  const width = Math.min(Math.round(mainSize.width / scaleFactor), 1280);
  const height = Math.min(Math.round(mainSize.height / scaleFactor), 800);

  logger.info("PreviewWindow", "Creating live window", {
    label,
    width,
    height,
    url: `/preview/${sceneId}?mode=live`,
    decorations: false,
  });

  const win = new WebviewWindow(label, {
    url: `/preview/${sceneId}?mode=live`,
    title: sceneName,
    width,
    height,
    minWidth: 640,
    minHeight: 480,
    decorations: true,
    resizable: true,
    fullscreen: false,
    center: true,
    dragDropEnabled: false,
  });

  win.once("tauri://error", (e) => {
    logger.error("PreviewWindow", "Live window creation error", {
      label,
      error: String(e.payload),
    });
  });

  logger.info("PreviewWindow", "Live window created", { label });
  return win;
}

