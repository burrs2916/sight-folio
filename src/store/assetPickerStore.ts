// 素材库选择器全局状态（H2 插画链路）。
//
// 为什么是全局 store 而不是 SceneEditorPage 局部 state：
// 打开选择器的入口有多处 —— ① 顶栏「插入插画」按钮（SceneEditorPage）；
// ② 画布右键菜单「更换插画…」（EditorContextMenu，藏在 SceneEditor 深层，
//    往外传事件要穿三层 prop）；③ 章节纸面卡「章头图」按钮（批次 2）；
// ④ 章树卷/章行、大纲节拍行的封面按钮（封面链路）。
// 全局 store 让各处零耦合地打开同一个对话框，靠下面三类目标区分意图。
//
// 目标类型：
// - replaceComponentId：替换画布选中图片实体的图源（null = 纯插入模式）。
// - editorInserter：插入到某 TipTap 编辑器光标处（批次 1 正文插图）。携带闭包，
//   由打开方在点击时注入；store 自身不持有编辑器实例，避免跨页/跨组件生命周期陷阱。
// - coverSetter：把选中的素材设为某目标的封面（章/卷/节拍，零后端字段，全走
//   extra.coverImage 引用）。携带闭包，由打开方注入——闭包内已捕获具体目标 id，
//   对话框确认时回调它即可；kind 只用于对话框的标题/确认按钮文案。
//   三类目标互斥（openPicker 同一时刻只注入一类），确认时分派器按优先级挑一个执行。
import { create } from 'zustand';
import type { AssetInfo } from '../services/tauri';

/** 封面目标的文案类别：'chapter' 走章头图文案；'beat' 走节拍封面文案 */
export interface CoverSetterTarget {
  kind: 'chapter' | 'beat';
  /** 闭包：把选中素材应用到目标（闭包内已捕获具体目标 id） */
  apply: (asset: AssetInfo) => void;
  /** 目标标题（卷/章/节拍名），弹窗副标题展示「为《title》设置封面」 */
  title?: string;
  /** 目标当前是否已有封面：有则弹窗展示「清除封面」入口 */
  hasCover?: boolean;
  /** 清除封面闭包（可选）：点击「清除封面」时回调，由入口注入（闭包内已捕获目标 id） */
  clear?: () => void;
}

interface AssetPickerState {
  open: boolean;
  /** null = 插入模式；非 null = 替换该组件的图源 */
  replaceComponentId: string | null;
  /** 非空 = 插入到某编辑器光标处（批次 1 正文插图） */
  editorInserter: ((asset: AssetInfo) => void) | null;
  /** 非空 = 选中的素材设为某目标封面（章/卷/节拍） */
  coverSetter: CoverSetterTarget | null;
  openPicker: (opts?: {
    replaceComponentId?: string | null;
    editorInserter?: (asset: AssetInfo) => void;
    coverSetter?: CoverSetterTarget;
  }) => void;
  closePicker: () => void;
}

export const useAssetPickerStore = create<AssetPickerState>((set) => ({
  open: false,
  replaceComponentId: null,
  editorInserter: null,
  coverSetter: null,
  openPicker: (opts) =>
    set({
      open: true,
      replaceComponentId: opts?.replaceComponentId ?? null,
      editorInserter: opts?.editorInserter ?? null,
      coverSetter: opts?.coverSetter ?? null,
    }),
  closePicker: () =>
    set({
      open: false,
      replaceComponentId: null,
      editorInserter: null,
      coverSetter: null,
    }),
}));
