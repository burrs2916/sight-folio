import { create } from "zustand";

/**
 * 问题面板（Project Diagnostics）开关状态。
 *
 * 与编辑器状态栏「问题」指示项（WorkbenchEditorPane）解耦：指示项在子组件里，
 * 面板渲染在 CodeWorkbench 外壳底坞，二者通过本模块级 store 通信，无需逐层透传 props。
 * 数据来源是 editorDiagnosticsStore（所有已打开文件的实时 Monaco 标记）。
 */
interface ProblemsPanelState {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  /** 打开并确保在视图中（状态栏指示项点击走这条，对标 Zed 状态栏打开面板） */
  requestOpen: () => void;
}

export const useProblemsPanelStore = create<ProblemsPanelState>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set((s) => ({ open: !s.open })),
  requestOpen: () => set({ open: true }),
}));
