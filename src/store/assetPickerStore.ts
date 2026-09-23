// 素材库选择器全局状态（H2 插画链路）。
//
// 为什么是全局 store 而不是 SceneEditorPage 局部 state：
// 打开选择器的入口有多处 —— ① 顶栏「插入插画」按钮（SceneEditorPage）；
// ② 画布右键菜单「更换插画…」（EditorContextMenu，藏在 SceneEditor 深层，
//    往外传事件要穿三层 prop）；③ 章节纸面卡「章头图」按钮（批次 2）。
// 全局 store 让各处零耦合地打开同一个对话框，靠下面三类目标区分意图。
//
// 目标类型：
// - replaceComponentId：替换画布选中图片实体的图源（null = 纯插入模式）。
// - editorInserter：插入到某 TipTap 编辑器光标处（批次 1 正文插图）。携带闭包，
//   由打开方在点击时注入；store 自身不持有编辑器实例，避免跨页/跨组件生命周期陷阱。
// - chapterCoverSetter：把选中的素材设为某章的章头图（批次 2）。同样携带闭包，
//   由打开方注入——闭包内已捕获具体 chapterId，对话框确认时回调它即可。
//   三类目标互斥（openPicker 同一时刻只注入一类），确认时分派器按优先级挑一个执行。
import { create } from "zustand";
import type { AssetInfo } from "../services/tauri";

interface AssetPickerState {
  open: boolean;
  /** null = 插入模式；非 null = 替换该组件的图源 */
  replaceComponentId: string | null;
  /** 非空 = 插入到某编辑器光标处（批次 1 正文插图） */
  editorInserter: ((asset: AssetInfo) => void) | null;
  /** 非空 = 选中的素材设为某章章头图（批次 2） */
  chapterCoverSetter: ((asset: AssetInfo) => void) | null;
  openPicker: (opts?: {
    replaceComponentId?: string | null;
    editorInserter?: (asset: AssetInfo) => void;
    chapterCoverSetter?: (asset: AssetInfo) => void;
  }) => void;
  closePicker: () => void;
}

export const useAssetPickerStore = create<AssetPickerState>((set) => ({
  open: false,
  replaceComponentId: null,
  editorInserter: null,
  chapterCoverSetter: null,
  openPicker: (opts) =>
    set({
      open: true,
      replaceComponentId: opts?.replaceComponentId ?? null,
      editorInserter: opts?.editorInserter ?? null,
      chapterCoverSetter: opts?.chapterCoverSetter ?? null,
    }),
  closePicker: () =>
    set({ open: false, replaceComponentId: null, editorInserter: null, chapterCoverSetter: null }),
}));
