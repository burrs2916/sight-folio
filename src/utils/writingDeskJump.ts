// 章级跳转分发（正文/写作台 → 主窗口 L2 页签的精确联动）
//
// 背景：正文写作卡（chrome="paper" 旧模型）与写作台独立窗口（/writing?desk=1）
// 顶部都可渲染章级提醒条（伏笔待回收 / 灵感待分发 / 校对发现问题 / 统计离群）。
// 跳转目标页签（伏笔/灵感/校对/统计）在**主窗口**的 L2 视图体系里，而写作台是
// 独立 OS 窗口（各自独立 JS 运行时与 Zustand store）——因此跳转必须按窗口形态分发：
//
//   主窗口    → 就地执行（选中实体 / 设置 focusKey + openTypedCarrierView）
//   写作台窗口 → emit desk-goto-view 事件，主窗口 App 监听后按同一语义执行 + 置前
//
// 这套分发的对端消费约定与 T5（proofreadFocusKey=issue.key）/ S4（statsFocusChapterId）
// 完全一致：提醒条点击带出精确选中，页签内消费方 reset 过滤 + 滚动 + 闪烁定位。
import { emit } from '@tauri-apps/api/event';
import { useEditorStore } from '../store/editorStore';
import { openTypedCarrierView, type WritingViewKind } from './studioBook';
import { isWritingDeskWindow } from './writingDeskWindow';
import { logger } from './logger';

/** 提醒条可跳转的页签子集 */
export type ChapterJumpKind = 'foreshadowing' | 'inspiration' | 'proofread' | 'stats';

/** 章级跳转载荷：kind 决定页签，附带对应精确选中字段。 */
export interface ChapterJumpPayload {
  genre: string;
  kind: ChapterJumpKind;
  /** 伏笔/灵感：跳转前先选中该实体（与画布右栏联动选中同语义） */
  selectedId?: string | null;
  /** 校对：定位到具体 issue（T5 proofreadFocusKey 语义，值为 issue.key） */
  issueKey?: string | null;
  /** 统计：定位到当前章（S4 statsFocusChapterId 语义，值为 chapter.id） */
  chapterId?: string | null;
}

/** 跨窗口事件名（写作台 → 主窗口）：主窗口 App 监听后按 applyDeskGotoView 执行。 */
export const DESK_GOTO_VIEW_EVENT = 'desk-goto-view';

/**
 * 主窗口侧执行章级跳转（写作台窗口场景由 App 监听事件后回调此函数）。
 * 顺序与画布内既有跳转完全一致：先设置选中/focusKey，再切页签——
 * ProofreadPane/StatsPane 的消费 effect 在挂载后读取 focus 字段完成定位。
 */
export function applyDeskGotoView(p: ChapterJumpPayload): void {
  try {
    const es = useEditorStore.getState();
    if (p.kind === 'foreshadowing' && p.selectedId) {
      es.selectForeshadowing(p.selectedId);
    }
    if (p.kind === 'inspiration' && p.selectedId) {
      es.selectInspiration(p.selectedId);
    }
    if (p.kind === 'proofread' && p.issueKey) {
      es.setProofreadFocusKey(p.issueKey);
    }
    if (p.kind === 'stats' && p.chapterId) {
      es.setStatsFocusChapterId(p.chapterId);
    }
    openTypedCarrierView(p.genre, p.kind as WritingViewKind);
  } catch (e) {
    logger.warn('writingDeskJump', 'applyDeskGotoView failed', { error: String(e) });
  }
}

/**
 * 章级跳转统一入口（提醒条 onClick 使用）：
 * 写作台独立窗口 → emit 事件让主窗口接管；主窗口 → 就地 apply。
 */
export function dispatchChapterJump(p: ChapterJumpPayload): void {
  if (isWritingDeskWindow()) {
    emit(DESK_GOTO_VIEW_EVENT, p).catch((e) =>
      logger.warn('writingDeskJump', 'emit desk-goto-view failed', { error: String(e) }),
    );
    return;
  }
  applyDeskGotoView(p);
}
