// 章内批注 Mark（批次② T4）：选区批注/便签
//
// 正文 HTML 中表现为 `<span class="writing-annotation" data-annotation-id="...">`，
// 批注正文（文字内容）持久化在 SQLite writing_annotations 表，正文只存引用 id——
// 恢复/换设备不丢批注，且不污染正文字符流（字数统计、导出文本天然不含批注内容）。
import { Mark, mergeAttributes } from '@tiptap/core';
import type { AnnotationManager } from './annotationManager';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    writingAnnotation: {
      setWritingAnnotation: (id: string) => ReturnType;
      unsetWritingAnnotation: (id: string) => ReturnType;
    };
  }
}

/** 渲染为 span 还是 mark：与文本高亮（<mark>）区隔，避免语义混叠。 */
export const WritingAnnotation = Mark.create({
  name: 'writingAnnotation',

  addOptions() {
    return {
      /** 运行时由宿主注入的批注管理器（读写 SQLite 的薄封装） */
      annotationManager: null as AnnotationManager | null,
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-annotation-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-annotation-id': attrs.id } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-annotation-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'writing-annotation' }), 0];
  },

  addCommands() {
    return {
      setWritingAnnotation:
        (id: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { id }),
      unsetWritingAnnotation:
        (id: string) =>
        ({ state, dispatch }) => {
          if (!dispatch) return true;
          const { tr } = state;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (node.isText && node.marks.some((m) => m.type.name === this.name && m.attrs.id === id)) {
              const from = pos;
              const to = pos + node.nodeSize;
              tr.removeMark(from, to, this.type);
              changed = true;
            }
            return true;
          });
          if (changed) {
            dispatch(tr);
          }
          return changed;
        },
    };
  },
});
