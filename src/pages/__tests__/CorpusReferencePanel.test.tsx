// 写作台语料自动参考面板 · 回归锁（语料库 → 写作台闭环，自动模式）
//
// 背景：用户在写作中输入文字/词语时，面板应**自动**检索语料库并实时展示命中句子，
// 不再需要顶栏按钮手动点击（旧交互 WritingCorpusDialog 已整体移除）。
//
// 这条测试锁死：
// ① 挂载即弹可用性探针（corpusApi.status）；
// ② query 变化 → 300ms 防抖后自动检索 corpusApi.search(q, null, 8, 0)；
// ③ 命中卡片渲染（书名/章/句序 + 内容高亮）与「插入正文」回调；
// ④ 空 query 提示态（不检索）；⑤ 无命中空态；⑥ 不可用降级提示；⑦ 复制按钮。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
  status: vi.fn(),
  search: vi.fn(),
}));

vi.mock('../../services/tauri', () => ({
  corpusApi: {
    status: h.status,
    search: h.search,
  },
}));

import { CorpusReferencePanel } from '../writingPage/CorpusReferencePanel';
import type { CorpusSearchHit } from '../../services/tauri';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 未实现 PointerEvent：React 检测不到 pointer 事件支持会跳过 onPointerDown 注册。
// 提供最小 polyfill（基于 MouseEvent，带 clientX/pointerId），让拖拽路径在测试里真实可跑。
class PointerEventPolyfill extends MouseEvent {
  pointerId: number;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    // MouseEvent 构造器已支持 clientX/clientY/button 等；仅补齐 pointer 特有字段
    super(type, init as MouseEventInit);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}
if (typeof (globalThis as any).PointerEvent === 'undefined') {
  (globalThis as any).PointerEvent = PointerEventPolyfill;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
async function mountAsync(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}
/** 等待面板内部 300ms 防抖到期并 flush 检索 promise 微任务 */
async function flushDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 320));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

const hit = (over: Partial<CorpusSearchHit>): CorpusSearchHit => ({
  chunkId: 11,
  bookId: 1,
  bookTitle: '围城',
  seq: 3,
  kind: 'sentence',
  chapterTitle: '第一章',
  content: '婚姻是一座围城，城外的人想进去，城里的人想出来。',
  occurrenceCount: 1,
  occurrences: [],
  ...over,
});

function textEl(text: string): HTMLElement | null {
  const els = Array.from(document.body.querySelectorAll('*')) as HTMLElement[];
  return els.find((e) => e.textContent === text && e.children.length === 0) ?? null;
}

/** 按钮含 startIcon（SVG 包裹），用「文本包含」匹配按钮元素 */
function buttonByText(text: string): HTMLButtonElement | null {
  const btns = Array.from(document.body.querySelectorAll('button')) as HTMLButtonElement[];
  return btns.find((b) => b.textContent?.includes(text)) ?? null;
}

describe('写作台语料自动参考面板（自动检索 · 回归锁）', () => {
  it('挂载即弹可用性探针；query 变化防抖 300ms 后自动检索并渲染命中卡片', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    h.search.mockResolvedValue({ books: [], hits: [hit({})] });
    const inserted: string[] = [];
    await mountAsync(<CorpusReferencePanel query="" onInsertText={(t) => inserted.push(t)} />);

    expect(h.status).toHaveBeenCalledTimes(1);
    // 初始 query 空：不触发检索
    expect(h.search).not.toHaveBeenCalled();

    // 用户在输入过程中（打字间隙），query 更新
    await act(async () => {
      root!.render(<CorpusReferencePanel query="围城" onInsertText={(t) => inserted.push(t)} />);
    });
    // 防抖未到期：尚未检索
    expect(h.search).not.toHaveBeenCalled();
    await flushDebounce();

    // 自动检索（复用 corpusApi.search，bookId=null 全库，limit=8）
    expect(h.search).toHaveBeenCalledTimes(1);
    expect(h.search).toHaveBeenCalledWith('围城', null, 8, 0);
    // 命中卡片渲染：书名/章/句序/正文
    expect(textEl('《围城》'), '命中卡片应显示书名').toBeTruthy();
    expect(textEl('第一章')).toBeTruthy();
    expect(textEl('第 4 句')).toBeTruthy();
    expect(document.body.textContent).toContain('婚姻是一座围城');
  });

  it('命中高亮 + 点击「插入正文」回调原文', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    h.search.mockResolvedValue({ books: [], hits: [hit({})] });
    const inserted: string[] = [];
    await mountAsync(<CorpusReferencePanel query="" onInsertText={(t) => inserted.push(t)} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="围城" onInsertText={(t) => inserted.push(t)} />);
    });
    await flushDebounce();

    const content = '婚姻是一座围城，城外的人想进去，城里的人想出来。';
    expect(inserted).toEqual([]);
    const btn = buttonByText('插入正文');
    expect(btn, '命中卡片应有插入正文按钮').toBeTruthy();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(inserted).toEqual([content]);
  });

  it('复制按钮 → navigator.clipboard.writeText 原文', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    h.search.mockResolvedValue({ books: [], hits: [hit({})] });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="围城" onInsertText={() => {}} />);
    });
    await flushDebounce();

    const btn = buttonByText('复制');
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('婚姻是一座围城，城外的人想进去，城里的人想出来。');
  });

  it('空 query：显示输入即参考的提示，不调用检索', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    expect(h.search).not.toHaveBeenCalled();
    expect(textEl('输入时自动检索已导入语料库的句子，点击「插入正文」写入当前章节')).toBeTruthy();
  });

  it('无命中：显示空态文案', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    h.search.mockResolvedValue({ books: [], hits: [] });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="不存在的词" onInsertText={() => {}} />);
    });
    await flushDebounce();
    expect(textEl('没有匹配的语料句子')).toBeTruthy();
  });

  it('多条命中：总数来自 total（旧服务端缺失时兜底 hits.length），翻页以新 offset 重新检索', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    const page1 = Array.from({ length: 8 }, (_, i) => hit({ chunkId: i + 1, content: `围城句子 ${i + 1}` }));
    h.search.mockResolvedValue({ books: [], hits: page1, total: 17 });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="围城" onInsertText={() => {}} />);
    });
    await flushDebounce();
    // 第 1 页：limit=8, offset=0；计数 Chip 用服务端 total（17）
    expect(h.search).toHaveBeenCalledTimes(1);
    expect(h.search).toHaveBeenCalledWith('围城', null, 8, 0);
    expect(textEl('匹配 17 条句子')).toBeTruthy();
    // 总数 > 每页 8 条 → 渲染分页器（17/8 → 3 页）
    const page2Btn = document.querySelector('[aria-label="Go to page 2"]');
    expect(page2Btn, '应渲染分页器且可翻到第 2 页').toBeTruthy();
    // 翻页 → 同 query 新 offset 重新检索
    h.search.mockResolvedValue({ books: [], hits: [hit({ chunkId: 99, content: '下一页的围城句子' })], total: 17 });
    await act(async () => {
      page2Btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushDebounce();
    expect(h.search).toHaveBeenLastCalledWith('围城', null, 8, 8);
    expect(document.body.textContent).toContain('下一页的围城句子');
    // 翻到第 2 页后计数仍为总数
    expect(textEl('匹配 17 条句子')).toBeTruthy();
  });

  it('多页时 ←/→ 方向键翻页：面板内键盘事件冒泡翻页（← 回退、→ 前进），首尾页不越界', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    const page1 = Array.from({ length: 8 }, (_, i) => hit({ chunkId: i + 1, content: `围城句子 ${i + 1}` }));
    h.search.mockResolvedValue({ books: [], hits: page1, total: 17 });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="围城" onInsertText={() => {}} />);
    });
    await flushDebounce();
    // 分页器（3 页）渲染为键盘操作的锚点：先点一次第 2 页让焦点进入面板内部
    const page2Btn = document.querySelector('[aria-label="Go to page 2"]') as HTMLElement;
    expect(page2Btn, '应渲染分页器').toBeTruthy();
    h.search.mockResolvedValue({ books: [], hits: [hit({ chunkId: 99, content: '下一页的围城句子' })], total: 17 });
    await act(async () => {
      page2Btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushDebounce();
    // → 再进一页（第 3 页，offset=16）
    h.search.mockResolvedValue({ books: [], hits: [hit({ chunkId: 100, content: '末页的围城句子' })], total: 17 });
    await act(async () => {
      page2Btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    await flushDebounce();
    expect(h.search).toHaveBeenLastCalledWith('围城', null, 8, 16);
    expect(document.body.textContent).toContain('末页的围城句子');
    // ← 回退一页（offset=8）
    h.search.mockResolvedValue({ books: [], hits: [hit({ chunkId: 99, content: '下一页的围城句子' })], total: 17 });
    await act(async () => {
      page2Btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    await flushDebounce();
    expect(h.search).toHaveBeenLastCalledWith('围城', null, 8, 8);
    // 首页再往 ←：不越界，仍停留在第 1 页（offset=0）
    await act(async () => {
      page2Btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    await flushDebounce();
    expect(h.search).toHaveBeenLastCalledWith('围城', null, 8, 0);
    // 末页再往 →（第 3 页已是最后一页，不越界）
    h.search.mockResolvedValue({ books: [], hits: [hit({ chunkId: 101, content: '末页的围城句子 2' })], total: 17 });
    await act(async () => {
      page2Btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      page2Btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    await flushDebounce();
    expect(h.search).toHaveBeenLastCalledWith('围城', null, 8, 16);
  });

  it('带修饰键（Shift/Ctrl/Alt/⌘）的方向键不触发翻页，放行给上层', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    const page1 = Array.from({ length: 8 }, (_, i) => hit({ chunkId: i + 1, content: `围城句子 ${i + 1}` }));
    h.search.mockResolvedValue({ books: [], hits: page1, total: 17 });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="围城" onInsertText={() => {}} />);
    });
    await flushDebounce();
    const page2Btn = document.querySelector('[aria-label="Go to page 2"]') as HTMLElement;
    expect(page2Btn, '应渲染分页器').toBeTruthy();
    // 带修饰键的方向键：不拦截、不翻页（后续检索仍应停留在 offset=0）
    await act(async () => {
      page2Btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
      page2Btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }));
      page2Btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
      page2Btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true, bubbles: true }));
    });
    await flushDebounce();
    expect(h.search).toHaveBeenLastCalledWith('围城', null, 8, 0);
  });

  it('卡片书脊色循环：每张卡取紫/蓝/绿/金四色之一且按序轮换（去单调）', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    const many = Array.from({ length: 8 }, (_, i) => hit({ chunkId: i + 1, content: `围城句子 ${i + 1}` }));
    h.search.mockResolvedValue({ books: [], hits: many, total: 17 });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="围城" onInsertText={() => {}} />);
    });
    await flushDebounce();

    const spines = Array.from(document.body.querySelectorAll('[data-corpus-bookspine]')) as HTMLElement[];
    // 每行卡片都有书脊色条；8 张卡按 4 色循环 → 每色恰好 2 条
    const colors = spines.map((s) => s.getAttribute('data-corpus-bookspine'));
    expect(colors).toHaveLength(8);
    expect([...new Set(colors)]).toEqual(['primary', 'info', 'success', 'warning']);
    expect(colors).toEqual(['primary', 'info', 'success', 'warning', 'primary', 'info', 'success', 'warning']);
  });

  it('命中卡片渲染字数/词数；不渲染主谓宾识别标签与「未识别」占位', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    h.search.mockResolvedValue({
      books: [],
      hits: [
        hit({
          analysis: {
            charCount: 21,
            tokenCount: 9,
          },
        }),
        hit({ chunkId: 22, content: '无分析的旧版句子', analysis: null }),
      ],
    });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="围城" onInsertText={() => {}} />);
    });
    await flushDebounce();

    // 字数/词数
    expect(document.body.textContent).toContain('21 字 · 9 词');
    // 语法识别标签已移除：不出现主谓宾标签及「未识别」占位
    expect(document.body.textContent).not.toContain('主语');
    expect(document.body.textContent).not.toContain('谓语');
    expect(document.body.textContent).not.toContain('宾语');
    expect(document.body.textContent).not.toContain('未识别');
    // 旧版命中（analysis 为空）不渲染字数区：字数区只出现 1 次
    const charCountEls = Array.from(document.body.querySelectorAll('*')).filter(
      (e) => e.textContent === '21 字 · 9 词' && e.children.length === 0,
    );
    expect(charCountEls).toHaveLength(1);
    // 第二张卡（无分析）正常渲染原文
    expect(document.body.textContent).toContain('无分析的旧版句子');
  });

  it('书命中（书名/作者层命中）置顶渲染，提示语料覆盖范围', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    h.search.mockResolvedValue({
      books: [
        {
          id: 7,
          title: '斗破苍穹',
          author: '天蚕土豆',
          language: 'zh',
          source: '',
          category: '',
          tags: [],
          sourcePath: '',
          wordCount: 0,
          chunkCount: 0,
          createdAt: 0,
        },
      ],
      hits: [hit({})],
    });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="萧薰儿" onInsertText={() => {}} />);
    });
    await flushDebounce();

    expect(document.body.textContent).toContain('命中书籍 1 本');
    expect(document.body.textContent).toContain('《斗破苍穹》天蚕土豆');
  });

  it('重复句出处可展开：默认收起，点击「查看出处」列出各出处（章节 · 句序 · 书名）', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    h.search.mockResolvedValue({
      books: [],
      hits: [
        hit({
          occurrenceCount: 2,
          occurrences: [
            { chunkId: 11, bookId: 1, bookTitle: '围城', seq: 3, chapterTitle: '第一章' },
            { chunkId: 55, bookId: 2, bookTitle: '呐喊', seq: 8, chapterTitle: '狂人日记' },
          ],
        }),
      ],
    });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="围城" onInsertText={() => {}} />);
    });
    await flushDebounce();

    // 默认收起：可见「出现 2 次」但与出处列表不可见
    expect(document.body.textContent).not.toContain('狂人日记');
    const more = buttonByText('查看出处');
    expect(more, '重复句应有「查看出处」入口').toBeTruthy();
    await act(async () => {
      more!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // 展开后：章节 · 句序 · 书名俱全，且可收起
    expect(document.body.textContent).toContain('第一章 · 第 4 句（围城）');
    expect(document.body.textContent).toContain('狂人日记 · 第 9 句（呐喊）');
    const less = buttonByText('收起出处');
    expect(less).toBeTruthy();
    await act(async () => {
      less!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.body.textContent).not.toContain('狂人日记');
  });

  it('命中卡片渲染参考价值分层：high 强调标记、medium 常规标记；缺省不渲染', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    h.search.mockResolvedValue({
      books: [],
      hits: [
        hit({ chunkId: 33, content: '他回头看了一眼，脚下是万丈深渊！', referenceTier: 'high' }),
        hit({ chunkId: 34, content: '孤独是宿命。', referenceTier: 'medium' }),
        hit({ chunkId: 35, content: '无分层的旧版句子', referenceTier: null }),
      ],
    });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="围城" onInsertText={() => {}} />);
    });
    await flushDebounce();

    expect(document.body.textContent).toContain('高参考价值');
    expect(document.body.textContent).toContain('常规句');
    // 无分层（旧服务端数据）：高/常规标记只各出现 1 次
    expect(document.body.textContent.match(/高参考价值/g)).toHaveLength(1);
    expect(document.body.textContent.match(/常规句/g)).toHaveLength(1);
  });

  it('命中卡片渲染重复出现次数徽标与字数/词数；不渲染句式类型 chip 与词性悬停提示', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    h.search.mockResolvedValue({
      books: [],
      hits: [
        hit({
          occurrenceCount: 3,
          analysis: {
            charCount: 10,
            tokenCount: 4,
          },
        }),
        hit({
          chunkId: 22,
          content: '无字词数的旧版句子',
          analysis: {
            charCount: 8,
            tokenCount: 3,
          },
        }),
      ],
    });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    await act(async () => {
      root!.render(<CorpusReferencePanel query="围城" onInsertText={() => {}} />);
    });
    await flushDebounce();

    // 重复次数徽标（出现 3 次）与字数/词数
    expect(document.body.textContent).toContain('出现 3 次');
    expect(document.body.textContent).toContain('10 字 · 4 词');
    // 语法识别标签已移除：不出现句式类型 chip 与词性悬停 title
    expect(document.body.textContent).not.toContain('把字句');
    const body = document.body.textContent ?? '';
    expect(body, '命中正文仍在').toContain('婚姻是一座围城');
    const titled = Array.from(document.body.querySelectorAll('[title]')) as HTMLElement[];
    expect(
      titled.every((e) => !e.title.includes('/r') && !e.title.includes('/v') && !e.title.includes('/n')),
      '正文不应带词性 title',
    ).toBe(true);
    // 旧版命中（无 analysis）不渲染字数区：字数区只出现 1 次
    const charCountEls = Array.from(document.body.querySelectorAll('*')).filter(
      (e) => e.textContent === '10 字 · 4 词' && e.children.length === 0,
    );
    expect(charCountEls).toHaveLength(1);
    expect(document.body.textContent).toContain('无字词数的旧版句子');
  });

  it('双击拖拽手柄：宽度复位为默认值并写入 localStorage', async () => {
    localStorage.setItem('sight-folio:writing.corpusPanelWidth', '480');
    h.status.mockResolvedValue({ available: true, error: '' });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    // 读回偏好 480
    const panel = Array.from(document.body.querySelectorAll('div')).find(
      (el) => getComputedStyle(el).width === '480px',
    );
    expect(panel, '应读取保存的宽度偏好 480px').toBeTruthy();

    const handle = document.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement;
    // 双击 → 复位默认 300 并记忆
    await act(async () => {
      handle!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(getComputedStyle(panel!).width).toBe('300px');
    expect(localStorage.getItem('sight-folio:writing.corpusPanelWidth')).toBe('300');
  });

  it('语料库不可用：面板整体降级提示，不检索', async () => {
    h.status.mockResolvedValue({ available: false, error: 'corpus.db 初始化失败' });
    await mountAsync(<CorpusReferencePanel query="围城" onInsertText={() => {}} />);
    expect(h.search).not.toHaveBeenCalled();
    expect(textEl('corpus.db 初始化失败')).toBeTruthy();
  });

  it('左缘拖拽手柄可调宽度，全局松开后写入 localStorage（跨会话记忆）', async () => {
    localStorage.removeItem('sight-folio:writing.corpusPanelWidth');
    h.status.mockResolvedValue({ available: true, error: '' });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    // 默认宽度 300 的面板主体（emotion 样式类生效，用 computed style 取实际宽度）
    const panel = Array.from(document.body.querySelectorAll('div')).find(
      (el) => getComputedStyle(el).width === '300px',
    );
    expect(panel, '默认宽度应为 300px').toBeTruthy();

    // 手柄：role=separator 的水平拖拽分隔条
    const handle = document.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement;
    expect(handle, '应渲染左缘拖拽手柄').toBeTruthy();

    // 按下（x=400，此时宽度 300）→ 向左拖 80px（x=320）→ 宽度变宽为 380
    await act(async () => {
      dispatchPointer(handle, 'pointerdown', 400);
    });
    await act(async () => {
      dispatchPointer(window, 'pointermove', 320);
    });
    expect(getComputedStyle(panel!).width).toBe('380px');
    // 松手 → 偏好写入 localStorage
    await act(async () => {
      dispatchPointer(window, 'pointerup', 320);
    });
    expect(localStorage.getItem('sight-folio:writing.corpusPanelWidth')).toBe('380');
    // 拖拽结束清理（再次 move 不再改变宽度）
    await act(async () => {
      dispatchPointer(window, 'pointermove', 200);
    });
    expect(getComputedStyle(panel!).width).toBe('380px');
  });

  it('C1 手法拆解：命中句含手法标签时渲染「手法」入口与标签 chip，展开显示节奏/用词/模板/仿写，收起可复位', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    h.search.mockResolvedValue({
      books: [],
      hits: [hit({ chunkId: 77, content: '她拉开门，雨声涌进来。' })],
    });
    await act(async () => {
      root!.render(<CorpusReferencePanel query="雨声" onInsertText={() => {}} />);
    });
    await flushDebounce();

    // 标签：短句点刹 + 动作呈现（短句[<=10字]与动作词命中）
    expect(textEl('短句点刹'), '应渲染短句点刹手法标签').toBeTruthy();
    expect(textEl('动作呈现'), '应渲染动作呈现手法标签').toBeTruthy();

    // 未展开时不渲染拆解详情
    expect(textEl('可迁移模板')).toBeNull();

    // 点击「手法」→ 展开拆解视图（节奏/情感逻辑/用词/模板/仿写）
    const craftBtn = buttonByText('手法')!;
    expect(craftBtn).toBeTruthy();
    await act(async () => {
      craftBtn.click();
    });
    const body = document.body.textContent ?? '';
    expect(body).toContain('可迁移模板');
    expect(body).toContain('仿写示范');
    expect(body).toContain('动作词: 拉');

    // 点击「收起」复位
    await act(async () => {
      buttonByText('收起')!.click();
    });
    expect(document.body.textContent ?? '').not.toContain('可迁移模板');
  });

  it('C1 手法拆解：情绪直述句展示「把情绪名词换成行为」模板与情绪词用词块', async () => {
    h.status.mockResolvedValue({ available: true, error: '' });
    await mountAsync(<CorpusReferencePanel query="" onInsertText={() => {}} />);
    h.search.mockResolvedValue({
      books: [],
      hits: [hit({ chunkId: 88, content: '她很伤心。' })],
    });
    await act(async () => {
      root!.render(<CorpusReferencePanel query="伤心" onInsertText={() => {}} />);
    });
    await flushDebounce();

    expect(textEl('情绪直述'), '应渲染情绪直述手法标签').toBeTruthy();
    const craftBtn = buttonByText('手法')!;
    await act(async () => {
      craftBtn.click();
    });
    // 拆解视图正文含「把情绪名词换成可被看见的行为」与情绪词块
    const body = document.body.textContent ?? '';
    expect(body).toContain('可迁移模板');
    expect(body).toContain('行为');
    expect(body).toContain('情绪词: 伤心');
  });
});

/** 派发带 clientX 的指针事件（用上面的 PointerEvent polyfill，保证 React 接管 onPointerDown） */
function dispatchPointer(target: EventTarget, type: string, clientX: number) {
  const ev = new PointerEventPolyfill(type, { bubbles: true, clientX });
  target.dispatchEvent(ev);
}
