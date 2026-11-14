// 章级跳转分发（正文/写作台 → 主窗口 L2 页签的精确联动）
//
// 背景：正文写作卡（chrome="paper" 旧模型）与写作台独立窗口（/writing?desk=1）
// 顶部都可渲染章级提醒条（伏笔待回收 / 灵感待分发 / 校对发现问题 / 统计离群），
// 写作台「章详情」九维章统筹面板（ChapterOverviewPanel）的每行跳转也复用本协议。
// 跳转目标页签（伏笔/灵感/校对/统计/人物/世界观/时间线/概览）在**主窗口**的 L2
// 视图体系里，而写作台是独立 OS 窗口（各自独立 JS 运行时与 Zustand store）——
// 因此跳转必须按窗口形态分发：
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

/** 提醒条 / 九维章统筹可跳转的页签子集（WritingViewKind 的子集；timeline 兼作剧情线视角） */
export type ChapterJumpKind =
  | 'foreshadowing'
  | 'inspiration'
  | 'proofread'
  | 'stats'
  | 'characters'
  | 'worldview'
  | 'timeline'
  /** 剧情线页签：体检报告的线级发现（悬空/搁置）要落到具体那条线上 */
  | 'storylines'
  | 'overview';

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
  /** 人物/世界观：跳转前先选中该设定卡（与画布右栏 selectSetting 同语义） */
  settingId?: string | null;
  /** 时间线事件：本章视角下选中具体事件（selectTimelineEvent + viewMode='chapter'） */
  eventId?: string | null;
  /** 剧情线视角：选中剧情线（selectStoryline + viewMode='storyline'），kind 取 'timeline' */
  storylineId?: string | null;
  /** timeline 视角口径：chapter=本章事件视角（配 eventId），storyline=剧情线视角（配 storylineId） */
  timelineView?: 'chapter' | 'storyline';
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
    if ((p.kind === 'characters' || p.kind === 'worldview') && p.settingId) {
      es.selectSetting(p.settingId);
    }
    if (p.kind === 'storylines' && p.storylineId) {
      // 线级发现带着具体那条线：切剧情线视角再选中，否则主窗口里看不出任何变化
      if (es.timelineViewMode !== 'storyline') es.setTimelineViewMode('storyline');
      es.selectStoryline(p.storylineId);
    }
    if (p.kind === 'timeline') {
      if (p.timelineView === 'storyline' && p.storylineId) {
        if (es.timelineViewMode !== 'storyline') es.setTimelineViewMode('storyline');
        es.selectStoryline(p.storylineId);
      } else {
        if (es.timelineViewMode !== 'chapter') es.setTimelineViewMode('chapter');
        if (p.eventId) es.selectTimelineEvent(p.eventId);
      }
    }
    // characters/worldview/timeline/overview 与既有四类同为 WritingViewKind 合法键
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

// ─────────────────────────────────────────────────────────────────────────────
// 页面级跳转分发（写作台独立窗口 → 主窗口的整页路由）
// ─────────────────────────────────────────────────────────────────────────────
//
// 与上面章级跳转**同一套判据**，只是落点从 L2 页签换成整页路由。范式在本仓不是新东西：
// 独立窗口无路由可用，主窗口接管导航（见 App 里 'open-ai-settings' → navigate('/ai')）。
//
// 为什么必须有这一层（2026-11-04 审计缺陷 A，`docs/完结作品完成度审计-2026-11-04-1010.md`）：
// 「锁定一版」与「整书导出」的成功 toast 原先直接写 `navigate('/published')`，而写作台
// 窗口的形态判据是 **pathname 前缀 `/writing` 且 query 带 `desk=1`**（App.isWritingDeskWindow）。
// 裸 navigate 一步同时改掉这两者，后果是三重的：
//   ① 沉浸窗口原地长出侧栏与顶栏（形态突变）；
//   ② 窗口 label 仍绑着这本书（writing-desk-{bookId}），`openWritingDesk` 见 label 已存在
//      就只 emitTo + setFocus，而 WritingPage 已被卸载、没有消费方 → 该书专属写作台回不去；
//   ③ App 的 desk-goto-view 监听以 pathname 为依赖，形态翻转后这扇「假主窗口」开始消费
//      本该只有主窗口消费的跳转事件，两扇窗互抢焦点。
// 口径：**跳转只有一个写者** —— desk 窗口发事件、主窗口执行；路由字面量也只在本文件出现一次。
// 回归锁见 __tests__/writingDeskJump.test.ts 的「页面级跳转分发」与「源码扫描锁」两段。

/** 跨窗口事件名（写作台 → 主窗口）：主窗口据此导航到完结作品页并置前。 */
export const DESK_GOTO_PUBLISHED_EVENT = 'desk-goto-published';

/** 完结作品页路由：全站唯一字面量出口，组件里不许再各写一遍 '/published'。 */
export const PUBLISHED_ROUTE = '/published';

/** 跳转落点：'emitted' = 已交主窗口执行（本窗**不许**再动路由）；'local' = 本窗就地跳。 */
export type WorksLibraryGoto = 'emitted' | 'local';

/**
 * 「查看完结作品」统一入口（写作台 / 成品页相关 toast 的 onClick 一律走这里）。
 *
 * 写作台窗口里 emit 失败时**不做就地兜底跳转**：兜底等于把缺陷 A 重新请回来，
 * 宁可不跳（本仓口径：禁静默降级），主窗口侧栏仍有一条入口。
 *
 * @param navigate 调用方自己的 `useNavigate()`，仅主窗口分支使用
 */
export function goWorksLibrary(navigate: (path: string) => void): WorksLibraryGoto {
  if (isWritingDeskWindow()) {
    emit(DESK_GOTO_PUBLISHED_EVENT, {}).catch((e) =>
      logger.warn('writingDeskJump', 'emit desk-goto-published failed', { error: String(e) }),
    );
    return 'emitted';
  }
  navigate(PUBLISHED_ROUTE);
  return 'local';
}
