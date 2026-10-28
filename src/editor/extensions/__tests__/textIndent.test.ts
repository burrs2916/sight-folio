// 批次⑥ 专业格式控件：段落缩进扩展与对齐扩展命令单测。
// 用 Tiptap 真实 Editor 实例验证命令产出 HTML 属性与清除行为。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextIndent, TEXT_INDENT_STEP, MAX_TEXT_INDENT } from '../textIndent';

function makeEditor() {
  return new Editor({
    extensions: [StarterKit, TextAlign.configure({ types: ['paragraph', 'heading'] }), TextIndent],
    content: '<p>第一段</p><p>第二段</p>',
  });
}

describe('TextIndent 扩展', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = makeEditor();
  });
  afterEach(() => {
    editor.destroy();
  });

  it('increaseIndent 给选区覆盖的段落加 padding-left 并持久化到 HTML', () => {
    editor.chain().selectAll().increaseIndent().run();
    const html = editor.getHTML();
    expect(html).toContain(`padding-left: ${TEXT_INDENT_STEP}em`);
    // 属性同时落盘 data-text-indent，保证 getHTML/setContent 往返不丢
    expect(html).toContain(`data-text-indent="${TEXT_INDENT_STEP}"`);
  });

  it('decreaseIndent 逐步减小且不为负', () => {
    editor.chain().selectAll().increaseIndent().increaseIndent().run();
    expect(editor.getHTML()).toContain(`padding-left: ${TEXT_INDENT_STEP * 2}em`);
    editor.chain().selectAll().decreaseIndent().run();
    expect(editor.getHTML()).toContain(`padding-left: ${TEXT_INDENT_STEP}em`);
    // 连续减到 0 应移除属性
    editor.chain().selectAll().decreaseIndent().decreaseIndent().run();
    expect(editor.getHTML()).not.toContain('padding-left');
    expect(editor.getHTML()).not.toContain('data-text-indent');
  });

  it('缩进上限收敛到 MAX_TEXT_INDENT，不无限累加', () => {
    for (let i = 0; i < 10; i += 1) editor.chain().selectAll().increaseIndent().run();
    expect(editor.getHTML()).toContain(`padding-left: ${MAX_TEXT_INDENT}em`);
  });

  it('unsetIndent 单次清除全部缩进', () => {
    editor.chain().selectAll().increaseIndent().increaseIndent().run();
    editor.chain().selectAll().unsetIndent().run();
    expect(editor.getHTML()).not.toContain('padding-left');
  });

  it('标题同样参与缩进（types 覆盖 heading）', () => {
    editor.commands.setContent('<h2>章节标题</h2>');
    editor.chain().selectAll().increaseIndent().run();
    expect(editor.getHTML()).toContain('padding-left');
  });

  it('缩进属性经 setContent 往返后仍可识别（向后兼容解析）', () => {
    editor.commands.setContent('<p style="padding-left: 2em">旧文档</p>');
    editor.chain().selectAll().decreaseIndent().run();
    expect(editor.getHTML()).not.toContain('padding-left');
  });
});

describe('TextAlign 扩展接入', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = makeEditor();
  });
  afterEach(() => {
    editor.destroy();
  });

  it('居中/右对齐/两端对齐写入 text-align，左对齐清除属性', () => {
    editor.chain().selectAll().setTextAlign('center').run();
    let html = editor.getHTML();
    expect(html).toContain('text-align: center');
    editor.chain().selectAll().setTextAlign('right').run();
    html = editor.getHTML();
    expect(html).toContain('text-align: right');
    editor.chain().selectAll().setTextAlign('justify').run();
    html = editor.getHTML();
    expect(html).toContain('text-align: justify');
    // 左对齐（默认）应去掉对齐属性而非显式写 left
    editor.chain().selectAll().unsetTextAlign().run();
    html = editor.getHTML();
    expect(html).not.toContain('text-align');
  });

  it('isActive 可识别对齐态（左对齐为无属性默认态）', () => {
    editor.chain().selectAll().setTextAlign('center').run();
    expect(editor.isActive({ textAlign: 'center' })).toBe(true);
    expect(editor.isActive({ textAlign: 'left' })).toBe(false);
  });
});
