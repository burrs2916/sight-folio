// 右栏 tab 渲染期夹紧（2026-09-14）：
// SceneEditor 跨场景类型切换**不重挂载**（SceneEditorPage.tsx 渲染 <SceneEditor> 无 key），
// rightTab 会带着旧场景的索引进入新场景的第一帧：
//   代码场景停在 AI（rightTab=5，6 栏）→ 切到书场景（3 栏）：value=5 命不中任何子 Tab
//   → MUI "provided to the Tabs component is invalid" + 指示条乱跑 + 内容栏空白一帧。
// post-render 的 setRightTab(0) 复位 effect 只归一状态，救不了那一帧 —— 必须渲染期夹紧。

/** 右栏 tab 总数：书场景 3 栏（要素/详情/AI），代码场景 6 栏。 */
export function rightTabCount(isBookScene: boolean): number {
  return isBookScene ? 3 : 6;
}

/** 越界（含负值防御）一律回第一栏。 */
export function clampRightTab(tab: number, isBookScene: boolean): number {
  return tab >= 0 && tab < rightTabCount(isBookScene) ? tab : 0;
}
