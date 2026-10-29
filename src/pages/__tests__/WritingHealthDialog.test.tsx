// 全书体检面板（批次② 增-1）组件级回归锁。
//
// 这个面板存在的意义就一件事：全书体检此前只在场景画布可见，写作台进不去。
// 所以最要紧的三条是：
// ① 一致性组真的出现在清单里（不传 settings 就整组消失）；
// ② 能在写作台内跳过去的（章 / 设定卡）要真跳；
// ③ 落点在别的页签的发现（时间线/念头/伏笔/剧情线/页签汇总行）必须能一键送到那个页签，
//    并且带着具体对象 id——体检报告是"只能看"还是"能修"，分水岭就在这条跳路上。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

// 跳转协议本身另有单测；这里只关心本面板有没有把载荷组对
const dispatched: unknown[] = [];
vi.mock('../../utils/writingDeskJump', () => ({
  dispatchChapterJump: (p: unknown) => dispatched.push(p),
}));

import { WritingHealthDialog } from '../writingPage/WritingHealthDialog';
import { useWritingStore } from '../../store/writingStore';
import { setLang } from '../../i18n';
import type { WritingChapter, WritingSetting, WritingTimelineEvent } from '../../services/tauri';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const BOOK = 'book_health';

const chapter = (id: string, content: string, sortOrder: number): WritingChapter =>
  ({
    id,
    bookId: BOOK,
    title: `第${sortOrder + 1}章`,
    content,
    sortOrder,
    wordCount: content.length,
    status: 'draft',
    volume: '',
    kind: '章',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
  }) as WritingChapter;

const setting = (id: string, name: string): WritingSetting =>
  ({
    id,
    bookId: BOOK,
    kind: 'character',
    name,
    subtitle: '',
    description: '',
    extra: '{}',
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingSetting;

const event = (id: string, storylineId: string | null): WritingTimelineEvent =>
  ({
    id,
    bookId: BOOK,
    settingId: null,
    at: '第1天',
    event: `事件 ${id}`,
    chapterId: null,
    storylineId,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingTimelineEvent;

let root: Root | null = null;
const onJumpChapter = vi.fn();
const onOpenSetting = vi.fn();
const onClose = vi.fn();

async function mount(ui: ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}

const dialog = () => (
  <WritingHealthDialog open onClose={onClose} onJumpChapter={onJumpChapter} onOpenSetting={onOpenSetting} />
);

const row = (key: string) => document.body.querySelector(`[data-testid="health-row-${key}"]`) as HTMLElement | null;

/** 灌入能同时触发「章账 / 章文本 / 一致性 / 剧情线」四组的数据 */
function seed(withSettings: boolean) {
  useWritingStore.setState({
    activeBookId: BOOK,
    chapters: [chapter('c1', '了了了 沈砚出现了。', 0), chapter('c2', '', 1)],
    outlines: [],
    timelineEvents: [event('e1', null)],
    foreshadowings: [],
    storylines: [],
    settings: withSettings ? [setting('s2', '从未出场的人物')] : [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dispatched.length = 0;
  setLang('zh-CN');
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('WritingHealthDialog', () => {
  it('一致性组出现在清单里，且组导航上能看到「一致性」', async () => {
    seed(true);
    await mount(dialog());

    expect(document.body.textContent).toContain('一致性');
    expect(row('cs:dead:s2')).toBeTruthy();
  });

  it('写作台能跳的（章）真的跳，并顺带关面板', async () => {
    seed(false);
    await mount(dialog());

    const r = row('c2:empty');
    expect(r).toBeTruthy();
    expect(r!.getAttribute('data-jumpable')).toBe('1');
    await act(async () => {
      r!.click();
    });
    expect(onJumpChapter).toHaveBeenCalledWith('c2');
    expect(onClose).toHaveBeenCalled();
  });

  it('一致性发现点开的是那张出问题的卡，不是泛泛跳页签', async () => {
    seed(true);
    await mount(dialog());

    const r = row('cs:dead:s2');
    expect(r!.getAttribute('data-jumpable')).toBe('1');
    await act(async () => {
      r!.click();
    });
    expect(onOpenSetting).toHaveBeenCalledWith('s2');
    expect(onJumpChapter).not.toHaveBeenCalled();
  });

  it('落点在别的页签的行：交给跳转协议精确联动，不再整行禁点', async () => {
    seed(false);
    await mount(dialog());

    const r = row('sl:unlined');
    expect(r).toBeTruthy();
    // 旧契约是 data-jumpable="0"（"宁可不可点也不要跳到作者找不到的界面"）。
    // 写作台是作者主要工作区，"只能看不能修"代价更高，而跳转协议本就支持跨窗口
    // emit + 主窗口接管并置前，所以改为代跳。见 utils/writingDeskJump。
    expect(r!.getAttribute('data-jumpable')).toBe('1');
    await act(async () => {
      r!.click();
    });
    expect(dispatched.length).toBe(1);
    expect(dispatched[0]).toMatchObject({ kind: 'storylines' });
    expect(onJumpChapter).not.toHaveBeenCalled();
    expect(onOpenSetting).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('切到「严重」过滤后，警告级行不再出现', async () => {
    seed(true);
    await mount(dialog());

    // 默认 all：警告级死设定在
    expect(row('cs:dead:s2')).toBeTruthy();

    const blockBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('严重'),
    ) as HTMLButtonElement | null;
    expect(blockBtn).toBeTruthy();
    await act(async () => {
      blockBtn!.click();
    });

    expect(row('cs:dead:s2')).toBeNull();
  });
});
