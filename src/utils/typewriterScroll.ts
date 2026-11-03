// 打字机滚动（光标所在段自动滚到视窗中部）的**唯一**执行体。
//
// 为什么要抽出来（第二十七轮）：这条逻辑此前只有一份、写死在 WritingPage 的 tiptap
// `onSelectionUpdate` 回调里。而同一份正文在**画布章节编辑器**（WritingChapterEditor，纸面卡与
// 容器页签两处）里也能编辑，那边压根没有这个回调 —— 于是设置项「打字机滚动」在画布里选了
// 任何一档都没反应，用户读到的还是那句「设置没生效」。
//
// 口径与第 25 轮定下的两条教训一致：
//  ① 生效范围（关 / 仅禅模式 / 总是）只由 `writingPrefsStore.shouldCenterCaret` 判定，
//     本模块**不再各写一份 if**，两个消费点共用；
//  ② 档位必须**现取**（`useWritingPrefsStore.getState()` 在调用时读）：tiptap 的回调在
//     `useEditor` 建立时就固定了闭包，用订阅来的变量会把档位冻在旧值 —— 那样改完设置要重开窗口才生效。
import type { Editor } from '@tiptap/react';

/**
 * 把光标所在块级元素滚到视窗中部。
 *
 * @param editor   tiptap 编辑器实例
 * @param scrollEl 显式滚动容器（写作台传自己的 `editorScrollRef`，那边滚动发生在外层 div）；
 *                 不传则用编辑面自身 —— 画布章节编辑器正是这种：`canvasEntity.css` 把
 *                 `overflow-y: auto` 给的是 `.ps-workbench .tiptap / .ProseMirror` 这一个节点
 *                 （tiptap v3 两个 class 同在 contenteditable 元素上，不是父子两层），
 *                 也就是 `editor.view.dom` 本身。刻意不用 `view.scrollDOM`：prosemirror-view
 *                 1.42 的类型里没有这个字段，写了过不了 tsc，而这里要的节点本来就不是它。
 *                 两处几何口径同一条规则：只在「离中部超过 1/4 视高」时才滚，避免打字时微幅跳动。
 */
export function centerCaretInViewport(editor: Editor, scrollEl?: HTMLElement | null): void {
  const sel = editor.state.selection;
  // 有选区时不滚：那是「选中了一段」而不是「写到这里」，跳中点会打断拖拽
  if (!sel.empty) return;
  const container = scrollEl ?? (editor.view.dom as HTMLElement | null);
  if (!container) return;

  const dom = editor.view.domAtPos(sel.from);
  // 向上找块级元素（段落 / 标题 / 列表项）：键盘导航时跳动最小
  let node: HTMLElement | null = dom.node as HTMLElement | null;
  while (node && node !== container && node.parentElement !== container) {
    node = node.parentElement;
  }
  if (!node || node === container) return;

  const rect = node.getBoundingClientRect();
  const scrollRect = container.getBoundingClientRect();
  const viewH = container.clientHeight;
  if (viewH <= 0) return;
  const offsetFromCenter = rect.top - scrollRect.top + rect.height / 2 - viewH / 2;
  if (Math.abs(offsetFromCenter) < viewH / 4) return;
  container.scrollTop += offsetFromCenter;
}
