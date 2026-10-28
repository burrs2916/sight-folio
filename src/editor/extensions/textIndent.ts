// 段落整体缩进扩展（批次⑥ 专业格式控件）：
// 官方无 indent 扩展，对齐能力已由 @tiptap/extension-text-align 提供，
// 缩进走自定义 block 属性 textIndent，渲染为 padding-left（em 相对字号），
// 前后端存档统一 getHTML()/setContent()，属性随文档持久化。
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';

/** 单挡缩进量（em，随正文字号缩放） */
export const TEXT_INDENT_STEP = 2;
/** 最大整体缩进（em） */
export const MAX_TEXT_INDENT = 8;
/** 参与缩进的块级节点类型 */
export const TEXT_INDENT_TYPES = ['paragraph', 'heading'] as const;

interface TextIndentOptions {
  /** 参与缩进的块级节点 */
  types: string[];
  /** 单挡步进（em） */
  step: number;
  /** 最大缩进（em） */
  max: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textIndent: {
      /** 整体缩进增加一挡（可传入自定义 em 值） */
      increaseIndent: (amount?: number) => ReturnType;
      /** 整体缩进减少一挡 */
      decreaseIndent: (amount?: number) => ReturnType;
      /** 清除整体缩进 */
      unsetIndent: () => ReturnType;
    };
  }
}

function currentIndent(node: Node): number {
  const raw = node.attrs.textIndent as number | null | undefined;
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

export const TextIndent = Extension.create<TextIndentOptions>({
  name: 'textIndent',

  addOptions() {
    return { types: [...TEXT_INDENT_TYPES], step: TEXT_INDENT_STEP, max: MAX_TEXT_INDENT };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textIndent: {
            default: 0,
            parseHTML: (element) => {
              // 向后兼容：若历史文档直接写了 padding-left，也折算为 em 缩进档位
              const pad = parseFloat(element.style.paddingLeft || '');
              if (Number.isFinite(pad) && pad > 0) {
                return Math.round((pad / 16) * 100) / 100;
              }
              const n = parseFloat(element.getAttribute('data-text-indent') || '');
              return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0;
            },
            renderHTML: (attributes) => {
              const v = attributes.textIndent as number | null | undefined;
              if (!v || v <= 0) return {};
              return { style: `padding-left: ${v}em`, 'data-text-indent': String(v) };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      increaseIndent:
        (amount?: number) =>
        ({ chain }) =>
          chain()
            .command(({ tr, state }) => {
              const step = amount ?? this.options.step;
              const { selection } = state;
              const handled = new Set<number>();
              state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
                if (!this.options.types.includes(node.type.name) || handled.has(pos)) return;
                handled.add(pos);
                const next = Math.min(this.options.max, currentIndent(node) + step);
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, textIndent: Math.round(next * 100) / 100 });
              });
              return handled.size > 0;
            })
            .run(),
      decreaseIndent:
        (amount?: number) =>
        ({ chain }) =>
          chain()
            .command(({ tr, state }) => {
              const step = amount ?? this.options.step;
              const { selection } = state;
              const handled = new Set<number>();
              state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
                if (!this.options.types.includes(node.type.name) || handled.has(pos)) return;
                handled.add(pos);
                const next = Math.max(0, currentIndent(node) - step);
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, textIndent: Math.round(next * 100) / 100 });
              });
              return handled.size > 0;
            })
            .run(),
      unsetIndent:
        () =>
        ({ chain }) =>
          chain()
            .command(({ tr, state }) => {
              const { selection } = state;
              const handled = new Set<number>();
              state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
                if (!this.options.types.includes(node.type.name) || handled.has(pos)) return;
                if (!currentIndent(node)) return;
                handled.add(pos);
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, textIndent: 0 });
              });
              return handled.size > 0;
            })
            .run(),
    };
  },
});
