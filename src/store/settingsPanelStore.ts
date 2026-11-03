// 设置抽屉的开合状态（第二十一轮）
//
// 为什么单独一个 store：抽屉此前由 AppLayout 的 useState 私有持有，于是「打开设置」这件事
// 只有顶栏那颗按钮能做。台账待办（第十九、二十轮都带下来）：设置抽屉可发现性差 —— 快捷键、
// 侧栏入口都要能触发同一个动作，把读数从组件私有状态提到 store 是唯一不靠 DOM 事件转发的做法。
//
// 不进设置库：窗口开合是本次会话的界面状态，不是用户要跨启动记住的偏好（跟 themeStore.systemMode
// 一个道理 —— 不是所有「界面读数」都该落盘）。
import { create } from 'zustand';

interface SettingsPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useSettingsPanelStore = create<SettingsPanelState>((set, get) => ({
  open: false,
  setOpen: (open: boolean) => set({ open }),
  toggle: () => set({ open: !get().open }),
}));

/** 非组件环境（快捷键监听、命令面板等）直接开合 */
export function openSettingsPanel(): void {
  useSettingsPanelStore.getState().setOpen(true);
}

export function toggleSettingsPanel(): void {
  useSettingsPanelStore.getState().toggle();
}
