// ㉣ N-22（2026-11-11 轮 72 续）：日记书人物栏顶部「谁在写」条的**真渲染**锁。
//
// 为什么要渲染级：这把刀的全部意义是「李先生点开日记的人物栏能看见并当场改」。
// 只做源码锁（grep 文件里有没有 DiaryNarratorBar）测不到三件真会错的事：
//   ① 非日记体裁被误挂（人物栏凭白多出三条按钮 = 零回归线破了）
//   ② 默认态没选中（extra 空 → 该亮「第一人称」）
//   ③ 点击落库带的参数不对（名字丢了 / 人称写错）
// 挂载法沿用本目录 ChapterPicker.tree.test.tsx 的 createRoot + act 口径。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

import { DiaryNarratorBar } from '../writingPanes';
import { useWritingStore } from '../../../store/writingStore';
import { setLang } from '../../../i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function seedBook(genre: string, extra = '{}') {
  const book = {
    id: 'b1',
    title: '某本日记',
    description: '',
    genre,
    status: 'drafting',
    coverColor: '#0ea8a8',
    medium: '',
    extra,
    createdAt: 0,
    updatedAt: 0,
  };
  const spy = vi.fn(async (_bookId: string, _narrator: { person: string; name: string }) => {});
  useWritingStore.setState({ books: [book], setBookNarrator: spy } as never);
  return spy;
}

const text = () => host?.textContent ?? '';
const buttons = () => Array.from(host?.querySelectorAll('button') ?? []) as HTMLButtonElement[];

describe('㉣ N-22 · 人物栏「谁在写」条', () => {
  it('日记书：三档人称都在场，默认第一人称亮着，主角框带占位', () => {
    setLang('zh-CN');
    const spy = seedBook('diary');
    mount(<DiaryNarratorBar bookId="b1" accent="#0ea8a8" />);
    expect(text()).toContain('谁在写');
    expect(text()).toContain('第一人称（我）');
    expect(text()).toContain('第二人称（你）');
    expect(text()).toContain('第三人称（他/她）');
    expect(buttons()).toHaveLength(3);
    // 默认态要看得见「亮着哪一颗」：miniBtn 是幽灵钮，选中态走**描边 + 文字色**，不是底色
    const sig = (b: Element) => {
      const s = (b as HTMLButtonElement).style;
      return `${s.border}|${s.borderColor}|${s.color}|${s.background}`;
    };
    expect(sig(buttons()[0]), '默认第一人称必须与未选中档不同').not.toBe(sig(buttons()[1]));
    expect(sig(buttons()[1])).toBe(sig(buttons()[2]));
    expect(`${buttons()[0].style.borderColor}${buttons()[0].style.color}`).toMatch(/0ea8a8|14, 168, 168/i);
    const input = host?.querySelector('input') as HTMLInputElement;
    expect(input.placeholder).toContain('主角称谓');
    expect(spy).not.toHaveBeenCalled();
  });

  it('点「第二人称」→ 落库带 person=second 且**保留已填主角**', () => {
    setLang('zh-CN');
    const spy = seedBook('diary', JSON.stringify({ diaryNarrator: { person: 'first', name: '阿明' } }));
    mount(<DiaryNarratorBar bookId="b1" accent="#0ea8a8" />);
    const btn = buttons().find((b) => b.textContent?.includes('第二人称'));
    expect(btn, '找不到第二人称按钮').toBeTruthy();
    act(() => btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('b1');
    expect(spy.mock.calls[0][1]).toEqual({ person: 'second', name: '阿明' });
  });

  it('零回归线：小说 / 散文 / 诗集 / 剧本 / 未设体裁 —— 整条不渲染', () => {
    setLang('zh-CN');
    for (const g of ['novel', 'essay', 'poetry', 'script', '']) {
      seedBook(g);
      mount(<DiaryNarratorBar bookId="b1" accent="#000" />);
      expect(text(), `体裁 ${g || '(空)'} 不该出现「谁在写」`).toBe('');
      expect(host?.querySelector('input')).toBeNull();
      act(() => root?.unmount());
      root = null;
      host?.remove();
      host = null;
    }
  });

  it('bookId 缺 / 书查不到 → 不渲染也不炸（面板在无书态要活着）', () => {
    setLang('zh-CN');
    useWritingStore.setState({ books: [] } as never);
    mount(<DiaryNarratorBar bookId="nope" accent="#000" />);
    expect(text()).toBe('');
    mount(<DiaryNarratorBar accent="#000" />);
    expect(text()).toBe('');
  });
});
