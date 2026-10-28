import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emitTo } from '@tauri-apps/api/event';
import { logger } from './logger';
import { t } from '../i18n';

/**
 * 写作台独立窗口（Sight Folio）
 *
 * 写作台（/writing）以独立 OS 窗口形态存在：主窗口内的所有「去写作台」入口
 * 统一走 openWritingDesk —— 窗口不存在则创建（query 携带定位参数），
 * 已存在则 emit 焦点事件让窗口内部切到目标章节/设定，再置前。
 *
 * 一书一窗（2026-10-09，用户拍板「一个作品对应一个窗口，允许打开多个窗口」）：
 * - 窗口 label = writing-desk-{bookId}，一部作品一个专属窗口，可多开并存；
 *   - 无 bookId 的入口回退单例 label（writing-desk），行为与旧版一致。
 * - 焦点事件用 emitTo 按 label 定向投递：多开时不串台（每个窗口只收自己书的
 *   定位事件，不会一起切章/切设定）。
 * - 窗口身份反解：deskBookIdFromLabel / currentDeskBookId 从当前窗口 label 取
 *   绑定书 id（query 的 book 参数冷启动后会被 WritingPage replace 清掉，不能依赖）。
 *
 * 定位参数走 query 而非 location.state：WebviewWindow 是全新 webview，
 * state 传不过去；WritingPage 侧消费 query 后立即 replace 清参数。
 */

export const WRITING_DESK_LABEL = 'writing-desk';
export const WRITING_DESK_FOCUS_EVENT = 'writing-desk-focus';

export interface WritingDeskFocus {
  bookId?: string | null;
  chapterId?: string | null;
  settingId?: string | null;
  /** 灵感念头 id：定位打开写作台的灵感扩写面板并预选该念头（O7 轮扩展） */
  inspirationId?: string | null;
}

/** 一书一窗：窗口 label = writing-desk-{bookId}；无 bookId 回退单例 label。 */
export function writingDeskLabel(bookId?: string | null): string {
  return bookId ? `${WRITING_DESK_LABEL}-${bookId}` : WRITING_DESK_LABEL;
}

/** 从窗口 label 反解绑定书 id；非「一书一窗」形态（单例/主窗口）返回 null。 */
export function deskBookIdFromLabel(label: string): string | null {
  const prefix = `${WRITING_DESK_LABEL}-`;
  if (!label.startsWith(prefix)) return null;
  return label.slice(prefix.length);
}

/** 当前窗口的绑定书 id：仅写作台独立窗口且为一书一窗形态时有值，否则 null。 */
export function currentDeskBookId(): string | null {
  if (!isWritingDeskWindow()) return null;
  return deskBookIdFromLabel(getCurrentWindow().label);
}

/** 组装写作台定位 query（desk=1 标记独立窗口形态） */
export function writingDeskUrl(focus: WritingDeskFocus): string {
  const params = new URLSearchParams({ desk: '1' });
  if (focus.bookId) params.set('book', focus.bookId);
  if (focus.chapterId) params.set('chapter', focus.chapterId);
  if (focus.settingId) params.set('setting', focus.settingId);
  if (focus.inspirationId) params.set('insp', focus.inspirationId);
  return `/writing?${params.toString()}`;
}

/**
 * 当前 webview 是否为写作台独立窗口（与 App.isWritingDeskWindow 同判据）。
 * 供页面侧分流：独立窗口无 /ai 路由（standalone 分支只有 /writing），
 * 跨窗口导航须走事件让主窗口接管，不能直接 navigate。
 */
export function isWritingDeskWindow(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('desk');
}

/**
 * 销毁某书的专属写作台窗口（删书防孤儿窗口；窗口不存在时静默跳过）。
 * 该书窗口正在本窗口内（自己删自己）时同样适用：destroy 后 webview 即关闭。
 */
export async function destroyDeskWindowFor(bookId: string): Promise<void> {
  const label = writingDeskLabel(bookId);
  const win = await WebviewWindow.getByLabel(label);
  if (!win) return;
  logger.info('WritingDeskWindow', 'Destroying desk window for book', { label, bookId });
  try {
    await win.destroy();
  } catch (e) {
    logger.warn('WritingDeskWindow', 'destroy desk window failed', { label, bookId, error: String(e) });
  }
}

/**
 * 打开（或聚焦）某作品的写作台独立窗口。
 * 窗口 label 按书绑定（一书一窗）：已存在时用 emitTo 定向投递
 * writing-desk-focus（窗口内部切章/设定）+ setFocus；不存在则新建。
 */
export async function openWritingDesk(focus: WritingDeskFocus = {}) {
  const label = writingDeskLabel(focus.bookId);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    logger.info('WritingDeskWindow', 'Desk window exists, emitting focus + focusing', { label, focus });
    try {
      await emitTo(label, WRITING_DESK_FOCUS_EVENT, focus);
    } catch (e) {
      logger.warn('WritingDeskWindow', 'emit focus event failed', { error: String(e) });
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

  logger.info('WritingDeskWindow', 'Creating desk window', { label, width, height, url, focus });

  const win = new WebviewWindow(label, {
    url,
    title: t('writing.deskWindowTitle'),
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

  win.once('tauri://error', (e) => {
    logger.error('WritingDeskWindow', 'Window creation error', {
      label,
      error: String(e.payload),
    });
  });

  logger.info('WritingDeskWindow', 'Desk window created', { label });
  return win;
}
