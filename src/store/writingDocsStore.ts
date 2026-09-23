// 写作文字编辑视图 · L3 文档页签会话态（G3）
//
// 三层视图模型的最内层：文字编辑容器视图（kind="writing"）里的卷/章节页签。
// 铁律：L3 页签**绝不落 scene.views**（那会重演「视图爆炸」），页签是纯会话态——
// 重启后由容器渲染器自动打开第一章恢复。同章多开（对照写）= 同一 chapterId
// 允许多个页签条目（tabId 唯一，chapterId 可重复），显式「在新页签打开」触发。
//
// key 用容器卡的 componentId（随场景 JSON 持久化、稳定），一个容器卡一组页签。
// 标准 zustand（非 immer，对齐 toastStore 模式）：更新走不可变替换。
import { create } from "zustand";

export interface WritingDocTab {
  /** 页签实例 id（同章多开时一个章有多个 tabId） */
  tabId: string;
  chapterId: string;
  /** 兜底标题（章节列表未就绪时显示；就绪后以 writingStore 章节标题为准） */
  name: string;
}

interface WritingDocsState {
  /** containerComponentId → 打开的页签（有序） */
  tabs: Record<string, WritingDocTab[]>;
  /** containerComponentId → 激活页签 tabId */
  activeTab: Record<string, string>;
  /** bookId → 当前激活章节 id（跨容器汇总，供正文视图右栏「本章」上下文 / AI 语料消费；
   *  会话态派生，不落盘——重启后由容器首开恢复自然重建） */
  activeChapterByBook: Record<string, string>;
  /** 打开章节页签：默认按 chapterId 去重激活；forceNew=true 强制新页签（同章对照写） */
  openTab: (containerId: string, chapterId: string, name: string, opts?: { forceNew?: boolean }) => void;
  closeTab: (containerId: string, tabId: string) => void;
  setActive: (containerId: string, tabId: string) => void;
  /** 容器渲染器同步「该书当前激活章」（openTab/setActive/关页签回退后都由它统一登记） */
  setActiveChapterForBook: (bookId: string, chapterId: string | null) => void;
}

export const useWritingDocsStore = create<WritingDocsState>((set) => ({
  tabs: {},
  activeTab: {},
  activeChapterByBook: {},

  openTab: (containerId, chapterId, name, opts) => {
    set((state) => {
      const list = state.tabs[containerId] ?? [];
      if (!opts?.forceNew) {
        const hit = list.find((tb) => tb.chapterId === chapterId);
        if (hit) {
          return { activeTab: { ...state.activeTab, [containerId]: hit.tabId } };
        }
      }
      const tab: WritingDocTab = {
        tabId: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        chapterId,
        name,
      };
      return {
        tabs: { ...state.tabs, [containerId]: [...list, tab] },
        activeTab: { ...state.activeTab, [containerId]: tab.tabId },
      };
    });
  },

  closeTab: (containerId, tabId) => {
    set((state) => {
      const list = state.tabs[containerId] ?? [];
      const idx = list.findIndex((tb) => tb.tabId === tabId);
      if (idx === -1) return {};
      const next = list.filter((tb) => tb.tabId !== tabId);
      const activeTab = { ...state.activeTab };
      if (state.activeTab[containerId] === tabId) {
        const fallback = next[Math.min(idx, next.length - 1)];
        if (fallback) activeTab[containerId] = fallback.tabId;
        else delete activeTab[containerId];
      }
      return { tabs: { ...state.tabs, [containerId]: next }, activeTab };
    });
  },

  setActive: (containerId, tabId) => {
    set((state) => ({ activeTab: { ...state.activeTab, [containerId]: tabId } }));
  },

  setActiveChapterForBook: (bookId, chapterId) => {
    set((state) => {
      const cur = state.activeChapterByBook[bookId];
      if (cur === chapterId) return {};
      const next = { ...state.activeChapterByBook };
      if (chapterId) next[bookId] = chapterId;
      else delete next[bookId];
      return { activeChapterByBook: next };
    });
  },
}));
