import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { logger } from "./logger";
import { t } from "../i18n";

/**
 * 写作台独立窗口（Sight Folio）
 *
 * 写作台（/writing）以独立 OS 窗口形态存在：主窗口内的所有「去写作台」入口
 * 统一走 openWritingDesk —— 窗口不存在则创建（query 携带定位参数），
 * 已存在则 emit 焦点事件让窗口内部切到目标章节/设定，再置前。
 *
 * 定位参数走 query 而非 location.state：WebviewWindow 是全新 webview，
 * state 传不过去；WritingPage 侧消费 query 后立即 replace 清参数。
 */

export const WRITING_DESK_LABEL = "writing-desk";
export const WRITING_DESK_FOCUS_EVENT = "writing-desk-focus";

export interface WritingDeskFocus {
  bookId?: string | null;
  chapterId?: string | null;
  settingId?: string | null;
}

/** 组装写作台定位 query（desk=1 标记独立窗口形态） */
export function writingDeskUrl(focus: WritingDeskFocus): string {
  const params = new URLSearchParams({ desk: "1" });
  if (focus.bookId) params.set("book", focus.bookId);
  if (focus.chapterId) params.set("chapter", focus.chapterId);
  if (focus.settingId) params.set("setting", focus.settingId);
  return `/writing?${params.toString()}`;
}

/**
 * 当前 webview 是否为写作台独立窗口（与 App.isWritingDeskWindow 同判据）。
 * 供页面侧分流：独立窗口无 /ai 路由（standalone 分支只有 /writing），
 * 跨窗口导航须走事件让主窗口接管，不能直接 navigate。
 */
export function isWritingDeskWindow(): boolean {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("desk")
  );
}

/**
 * 打开（或聚焦）写作台独立窗口。
 * 已存在时：emit writing-desk-focus 事件（窗口内部切章/设定）+ setFocus。
 */
export async function openWritingDesk(focus: WritingDeskFocus = {}) {
  const existing = await WebviewWindow.getByLabel(WRITING_DESK_LABEL);
  if (existing) {
    logger.info("WritingDeskWindow", "Desk window exists, emitting focus + focusing", { focus });
    try {
      await emit(WRITING_DESK_FOCUS_EVENT, focus);
    } catch (e) {
      logger.warn("WritingDeskWindow", "emit focus event failed", { error: String(e) });
    }
    existing.setFocus();
    return existing;
  }

  const mainWindow = getCurrentWindow();
  const mainSize = await mainWindow.innerSize();
  const scaleFactor = await mainWindow.scaleFactor();

  // 写作台是编辑主阵地，上限放宽到 1600×1000（预览窗为 1280×800）
  const width = Math.min(Math.round(mainSize.width / scaleFactor), 1600);
  const height = Math.min(Math.round(mainSize.height / scaleFactor), 1000);
  const url = writingDeskUrl(focus);

  logger.info("WritingDeskWindow", "Creating desk window", { label: WRITING_DESK_LABEL, width, height, url, focus });

  const win = new WebviewWindow(WRITING_DESK_LABEL, {
    url,
    title: t("writing.deskWindowTitle"),
    width,
    height,
    minWidth: 960,
    minHeight: 640,
    decorations: true,
    resizable: true,
    fullscreen: false,
    center: true,
    dragDropEnabled: false,
  });

  win.once("tauri://error", (e) => {
    logger.error("WritingDeskWindow", "Window creation error", {
      label: WRITING_DESK_LABEL,
      error: String(e.payload),
    });
  });

  logger.info("WritingDeskWindow", "Desk window created", { label: WRITING_DESK_LABEL });
  return win;
}
