// 「正文已保存」本地事件（WritingTodayChip 与统计弹窗共用）。
// 独立成文件：组件文件混导常量/函数会破坏 react-refresh（fast refresh）。

export const WRITING_SAVED_EVENT = 'writing-saved';

/** flushSave 成功后派发（WritingPage 调用）；底栏徽章与统计弹窗都可监听。 */
export function emitWritingSaved() {
  window.dispatchEvent(new CustomEvent(WRITING_SAVED_EVENT));
}
