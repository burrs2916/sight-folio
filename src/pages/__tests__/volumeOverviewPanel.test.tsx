// 归类节点（卷/部/篇/自定义层级）在写作台里只有只读概览，没有可编辑正文框。
// 2026-11-07 李先生点名的问题：点卷也进得去详情、还能在正文框里打字。
//
// 面板本身用组件测试钉行为；"写作台把归类节点接到这块面板上"是 WritingPage 里
// 那一个渲染分支，它藏在五千行、依赖 tauri invoke 的整页组件里，替身成本高于收益，
// 因此那一条按本仓既有做法用源码审计（同 WritingHealthJump 的词典审计）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VolumeOverviewPanel from '../VolumeOverviewPanel';
import { setLang } from '../../i18n';
import type { WritingChapter } from '../../services/tauri';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = (id: string, over: Partial<WritingChapter> = {}): WritingChapter =>
  ({
    id,
    bookId: 'b1',
    title: id,
    content: '',
    sortOrder: 0,
    wordCount: 0,
    status: 'draft',
    volume: '',
    kind: '卷',
    parentId: null,
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as WritingChapter;

let root: Root | null = null;
const opened: string[] = [];

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
}
const text = () => document.body.textContent ?? '';
const qa = (sel: string) => document.querySelector(sel) as HTMLElement | null;

beforeEach(() => {
  setLang('zh-CN');
  opened.length = 0;
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('VolumeOverviewPanel —— 归类节点的只读概览', () => {
  const book: WritingChapter[] = [
    node('v1', { title: '第一卷' }),
    node('c1', { kind: '章', parentId: 'v1', title: '玄武门', wordCount: 1200, content: '<p>正文</p>' }),
    node('c2', {
      kind: '章',
      parentId: 'v1',
      title: '渭水',
      wordCount: 800,
      status: 'finished',
      content: '<p>正文</p>',
    }),
  ];

  it('只给数字与章列表，不挂载任何可编辑正文面', () => {
    mount(<VolumeOverviewPanel node={book[0]} chapters={book} onOpenChapter={(id) => opened.push(id)} />);
    expect(text()).toContain('第一卷');
    expect(text()).toContain('玄武门');
    expect(text()).toContain('渭水');
    // 2 章 / 2000 字 / 1 章完稿：卷自身不写字，容器也不该被算进账里
    expect(text()).toContain('2 章');
    expect(text()).toContain('2000 字');
    // 只读的三个证据：没有 contenteditable、没有 textarea、没有 tiptap 的编辑器宿主
    expect(qa('[contenteditable]')).toBeNull();
    expect(qa('textarea')).toBeNull();
    expect(qa('.ProseMirror')).toBeNull();
    expect(qa('[data-testid="volume-overview-readonly"]')).toBeTruthy();
  });

  it('点概览里的章行 = 去写那一章（面板自己不写任何东西）', async () => {
    mount(<VolumeOverviewPanel node={book[0]} chapters={book} onOpenChapter={(id) => opened.push(id)} />);
    const row = qa('[data-testid="volume-overview-row-c2"]');
    expect(row).toBeTruthy();
    await act(async () => row!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(opened).toEqual(['c2']);
  });

  it('空卷：直说这里还没有章，而不是摆一个空编辑框', () => {
    const only = [node('v9', { title: '第九卷' })];
    mount(<VolumeOverviewPanel node={only[0]} chapters={only} onOpenChapter={(id) => opened.push(id)} />);
    expect(qa('[data-testid="volume-overview-empty"]')).toBeTruthy();
    expect(qa('[contenteditable]')).toBeNull();
    expect(qa('textarea')).toBeNull();
  });

  it('自定义层级（部 / 幕）同样适用：概览不认死"卷"这个字', () => {
    const tree = [
      node('bu', { kind: '部', title: '上部的部' }),
      node('c1', { kind: '节', parentId: 'bu', title: '一场' }),
    ];
    mount(<VolumeOverviewPanel node={tree[0]} chapters={tree} onOpenChapter={vi.fn()} />);
    expect(text()).toContain('上部的部');
    expect(text()).toContain('一场');
    // 部是容器：章数只算它下面的叶章
    expect(text()).toContain('1 章');
  });
});

describe('写作台把归类节点接到只读概览（源码审计）', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/pages/WritingPage.tsx'), 'utf8');

  it('内容区第一优先分支是 VolumeOverviewPanel，判定来自 writingStats 那一棵树', () => {
    expect(src).toContain('isVolumeNode(volumeResolver, activeChapter)');
    expect(src).toContain('<VolumeOverviewPanel');
    // 概览必须在 `rightTab === 'details'` 之前拦截：否则卷还是先被塞进章详情
    expect(src.indexOf('<VolumeOverviewPanel')).toBeLessThan(src.indexOf("rightTab === 'details' ? ("));
  });

  it('正控：普通章仍走正文/章详情两个页签（不许为了卷把页签整体删掉）', () => {
    expect(src).toContain('<Tabs\n            value={rightTab}');
    expect(src).toContain('value="body"');
    expect(src).toContain('value="details"');
  });
});
