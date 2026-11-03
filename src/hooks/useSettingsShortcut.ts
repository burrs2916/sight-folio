// 打开设置抽屉的全局快捷键（第二十一轮）
//
// 台账连着两轮带下来的待办：设置抽屉只有顶栏一个图标入口，调完一次设置想再进去，
// 得先把鼠标移到顶栏那颗不起眼的齿轮上。桌面应用的习惯入口是 ⌘, / Ctrl+,
// （macOS HIG 与 Windows 通用约定），这里照约定实现，不另创组合。
//
// 细节口径：
// - **capture 阶段**监听：编辑器（Monaco / ProseMirror）会在冒泡阶段吃掉按键，
//   只有 capture 才保证「在任何界面里都进得去设置」，这正是可发现性的意义。
// - 组合键必须带修饰键，所以不判断「焦点在输入框」——纯逗号仍归输入框。
import { useEffect } from 'react';
import { toggleSettingsPanel } from '../store/settingsPanelStore';

/** 触发键（KeyboardEvent.key） */
export const SETTINGS_SHORTCUT_KEY = ',';

/** 界面提示用的快捷键文案：macOS 用 ⌘，其余用 Ctrl（与用户实际键盘一致，不照抄 mac 符号） */
export function settingsShortcutLabel(): string {
  const platform = typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent || '' : '';
  return /Mac|iPhone|iPad/i.test(platform) ? '⌘ ,' : 'Ctrl ,';
}

/**
 * @param enabled 关闭时完全不挂监听（独立窗口没有设置抽屉，不该抢这个组合键）
 */
export function useSettingsShortcut(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== SETTINGS_SHORTCUT_KEY) return;
      if (!e.metaKey && !e.ctrlKey) return;
      // 拦下浏览器的「加速拨号」等原生行为，交给应用自己决定
      e.preventDefault();
      toggleSettingsPanel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}
