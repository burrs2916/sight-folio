// 书属性卡（封面）回归锁（2026-09-14）
//
// 封面落点：右栏「详情」tab 无选中分支。数据零迁移：assets/writing/covers-{bookId}/
// 有文件=有封面，一书一图（新图落盘成功后清旧图）。
// 这条测试锁死：空态/上传/更换清旧图/清除确认 四条链路。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 清除封面走全局危险确认出口（③e 全仓禁原生 window.confirm），测试直接驱动这个 store
import { useConfirmStore } from '../../../store/confirmStore';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
  writing: {
    books: [
      {
        id: 'b1',
        title: '长夜',
        description: '一个关于灯的故事',
        genre: 'novel',
        medium: 'serial',
        status: 'draft',
        dailyGoal: 0,
        cover_color: '#4A338F',
      },
    ] as any[],
    loadBooks: vi.fn(async () => {}),
    renameBook: vi.fn(async () => {}),
    setBookMeta: vi.fn(async () => {}),
    setDailyGoal: vi.fn(async () => {}),
    setBookGoal: vi.fn(async () => {}),
  },
  toast: { showToast: vi.fn() },
  assetApi: {
    list: vi.fn(async () => [] as any[]),
    save: vi.fn(async () => ({ name: 'cover-new.png', path: '/assets/writing/covers-b1/2-cover-new.png' })),
    remove: vi.fn(async () => true),
    thumbnail: vi.fn(async () => 'data:image/png;base64,thumb'),
  },
  writingApi: { listChapters: vi.fn(async () => [] as any[]) },
  writingStatsApi: { listDailyStats: vi.fn(async () => [] as any[]) },
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock('../../../store/toastStore', () => ({
  useToastStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.toast), {
    getState: () => h.toast,
  }),
}));
vi.mock('../../../services/tauri', async (importOriginal) => {
  // 保留真实 parseBookGoal / isChapterDeleted（纯函数），仅替换数据 IO 三件套
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, assetApi: h.assetApi, writingApi: h.writingApi, writingStatsApi: h.writingStatsApi };
});

import { BookMetaPanel } from '../BookMetaPanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

/** mount 后 flush 微任务（封面 list/thumbnail 是异步的，首帧在 loading 态） */
async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assetApi.list.mockResolvedValue([]);
  // jsdom 的 File 可能没有 arrayBuffer，补一个最小实现
  if (!(File.prototype as any).arrayBuffer) {
    (File.prototype as any).arrayBuffer = function () {
      return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
    };
  }
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

function buttonOf(text: string): HTMLButtonElement | null {
  return (
    (Array.from(document.body.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      (b.textContent ?? '').includes(text),
    ) ?? null
  );
}

describe('书属性卡 · 封面管理（回归锁）', () => {
  it('无封面：显示书名/简介 + 占位 + 「设封面」按钮', async () => {
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    // 第十四轮：书名 / 简介升级为就地编辑控件（受控 input/textarea，value 不进 textContent），
    // 封面占位文案仍是普通节点可 textContent 断言。
    const titleInput = document.querySelector('input') as HTMLInputElement | null;
    const descArea = document.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(titleInput?.value).toBe('长夜');
    expect(descArea?.value).toBe('一个关于灯的故事');
    expect(document.body.textContent).toContain('还没有封面');
    expect(buttonOf('设封面')).toBeTruthy();
    expect(buttonOf('清除封面')).toBeNull();
    // 编辑面在位：体裁·载体 / 创作状态 / 日更目标 三段小标题可见
    expect(document.body.textContent).toContain('体裁 · 载体');
    expect(document.body.textContent).toContain('创作状态');
    expect(document.body.textContent).toContain('日更目标');
  });

  it('有封面：缩略图渲染 + 「更换/清除」；清除须经全局确认出口，取消不删、确认才删', async () => {
    h.assetApi.list.mockResolvedValue([{ name: '1-old.png', path: '/assets/writing/covers-b1/1-old.png' }]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();

    expect(h.assetApi.thumbnail).toHaveBeenCalledWith('/assets/writing/covers-b1/1-old.png', 480);
    expect(document.querySelector('img')).toBeTruthy();
    expect(buttonOf('更换封面')).toBeTruthy();
    expect(buttonOf('清除封面')).toBeTruthy();

    // 一点即删是禁止的：点击只发起确认，不许真删文件
    await act(async () => {
      buttonOf('清除封面')!.click();
    });
    const pending = useConfirmStore.getState().pending;
    expect(pending, '清除必须先经 confirmDestructive 出口').toBeTruthy();
    useConfirmStore.getState().settle(false);
    expect(h.assetApi.remove, '用户取消就不该删磁盘文件').not.toHaveBeenCalled();

    // 确认后才真的 remove，并回到空态
    await act(async () => {
      buttonOf('清除封面')!.click();
    });
    expect(useConfirmStore.getState().pending, '第二次点击要重新发起确认').toBeTruthy();
    await act(async () => {
      useConfirmStore.getState().settle(true);
    });
    expect(h.assetApi.remove).toHaveBeenCalledWith('/assets/writing/covers-b1/1-old.png');
    expect(buttonOf('设封面'), '清除后回到空态按钮').toBeTruthy();
  });

  it('上传：save 走 covers-{bookId} 分类；替换时旧图被清；成功出 toast', async () => {
    h.assetApi.list.mockResolvedValue([{ name: '1-old.png', path: '/assets/writing/covers-b1/1-old.png' }]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();

    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(['x'], 'new.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(h.assetApi.save).toHaveBeenCalledWith('writing', 'covers-b1', 'new.png', expect.any(Uint8Array));
    // 一书一封面：新图落盘后旧图被清
    expect(h.assetApi.remove).toHaveBeenCalledWith('/assets/writing/covers-b1/1-old.png');
    expect(h.toast.showToast).toHaveBeenCalledWith('封面已更新', 'success');
  });
});

// ─── 全书目标 + 达成进度（第十五轮 · 工作室补齐，服务创作者规划本书）───
function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, val: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function fieldByLabel(label: string): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
  return (
    inputs.find((i) => {
      const wrap = i.closest('div');
      const lbl = wrap?.parentElement?.querySelector('label')?.textContent ?? '';
      return lbl.includes(label);
    }) ?? null
  );
}

describe('书属性卡 · 全书目标 + 达成进度（回归锁）', () => {
  it('未设全书目标：三个编辑入口在位 + 未设提示，不画进度条', async () => {
    h.writing.books[0].extra = '';
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    expect(document.body.textContent).toContain('全书目标');
    expect(fieldByLabel('总字数')).toBeTruthy();
    expect(fieldByLabel('章节数')).toBeTruthy();
    expect(document.body.querySelector('input[type="date"]')).toBeTruthy();
    // 未设目标 → 展示未设提示（非进度条）
    expect(document.body.textContent).toContain('还未设定总字数目标');
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('设目标 + 有体量：达成率进度条按本卡 bookId 章节实派生（跨书不错位）', async () => {
    h.writing.books[0].extra = JSON.stringify({ targetWords: 10000, targetChapters: 10, deadline: 0 });
    // 本卡 bookId 直查：5 活跃章 + 1 软删章（应被过滤，不计入分母/章数）
    h.writingApi.listChapters.mockResolvedValue([
      { id: 'c1', bookId: 'b1', wordCount: 1000 },
      { id: 'c2', bookId: 'b1', wordCount: 1200 },
      { id: 'c3', bookId: 'b1', wordCount: 800 },
      { id: 'c4', bookId: 'b1', wordCount: 1000 },
      { id: 'c5', bookId: 'b1', wordCount: 1000 },
      { id: 'c6', bookId: 'b1', wordCount: 99999, extra: JSON.stringify({ deletedAt: 1700000000 }) },
    ]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([]); // 无快照 → 退回章实时和（5000）
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    const bars = document.querySelectorAll('[role="progressbar"]');
    expect(bars.length).toBe(2); // 字数 + 章节两条
    // 软删章不计入：当前小结应显示 5 章、5000 字（非 6 章 / 104999 字）
    expect(document.body.textContent).toContain('当前 5 章 · 5,000 字');
    // 5000/10000=50%、5/10=50%
    expect(document.body.textContent).toContain('50%');
  });

  it('日快照优先于章实时和（贴近落库口径）', async () => {
    h.writing.books[0].extra = JSON.stringify({ targetWords: 10000, targetChapters: 0, deadline: 0 });
    h.writingApi.listChapters.mockResolvedValue([{ id: 'c1', bookId: 'b1', wordCount: 100 }]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([
      { day: '2026-10-30', wordCount: 6400 },
      { day: '2026-10-31', wordCount: 8000 },
    ]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    // 用最近快照 8000 而非章和 100 → 80%
    expect(document.body.textContent).toContain('80%');
    expect(document.body.textContent).toContain('当前 1 章 · 8,000 字');
  });

  it('提交总字数：仅改该字段，其余沿用当前目标（无覆盖清零）', async () => {
    const DEADLINE = Math.floor(new Date(2026, 11, 31).getTime() / 1000); // 本地零点，往返一致
    h.writing.books[0].extra = JSON.stringify({ targetWords: 5000, targetChapters: 12, deadline: DEADLINE });
    h.writingApi.listChapters.mockResolvedValue([]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    const wordsInput = fieldByLabel('总字数')!;
    setInputValue(wordsInput, '120000');
    act(() => {
      // React onBlur 经 focusout 冒泡实现，blur 事件不会触发
      wordsInput.dispatchEvent(new Event('focusout', { bubbles: true }));
    });
    expect(h.writing.setBookGoal).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ targetWords: 120000, targetChapters: 12, deadline: DEADLINE }),
    );
  });

  it('截止日期提交：YYYY-MM-DD → 本地当日零点 Unix 秒（与写作台同一换算）', async () => {
    h.writing.books[0].extra = '';
    h.writingApi.listChapters.mockResolvedValue([]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    setInputValue(dateInput, '2026-12-31');
    act(() => {
      dateInput.dispatchEvent(new Event('focusout', { bubbles: true }));
    });
    const expected = Math.floor(new Date(2026, 11, 31).getTime() / 1000);
    expect(h.writing.setBookGoal).toHaveBeenCalledWith('b1', expect.objectContaining({ deadline: expected }));
  });

  it('未改动提交不落库（脏值回退，不触发 setBookGoal）', async () => {
    h.writing.books[0].extra = JSON.stringify({ targetWords: 5000, targetChapters: 0, deadline: 0 });
    h.writingApi.listChapters.mockResolvedValue([]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    const wordsInput = fieldByLabel('总字数')!;
    setInputValue(wordsInput, '5000'); // 与原值同
    act(() => {
      wordsInput.dispatchEvent(new Event('focusout', { bubbles: true }));
    });
    expect(h.writing.setBookGoal).not.toHaveBeenCalled();
  });
});

// ─── 日更目标今日进度（收口「规划本书」三项目标体验一致）───
describe('书属性卡 · 日更今日进度（回归锁）', () => {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  it('设了日更目标且今日有新增：进度条按快照差分末位渲染（与写作台同口径）', async () => {
    h.writing.books[0].dailyGoal = 1000;
    const now = new Date();
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    h.writingApi.listChapters.mockResolvedValue([{ id: 'c1', bookId: 'b1', wordCount: 20600 }]);
    // 昨 20000 → 今 20600，差分末位 = 今日新增 600
    h.writingStatsApi.listDailyStats.mockResolvedValue([
      { day: fmt(y), wordCount: 20000 },
      { day: fmt(now), wordCount: 20600 },
    ]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    expect(document.body.textContent).toContain('今日已写 600 / 目标 1,000 字');
    expect(document.body.textContent).toContain('60%');
  });

  it('未设日更目标：不渲染今日进度条', async () => {
    h.writing.books[0].dailyGoal = 0;
    h.writingApi.listChapters.mockResolvedValue([{ id: 'c1', bookId: 'b1', wordCount: 500 }]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    expect(document.body.textContent).not.toContain('今日已写');
  });
});

// ─── 第十六轮：节奏预测可视化（单一权威派生，挂载存在性锁）───
describe('书属性卡 · 节奏预测', () => {
  const TODAY = new Date(2026, 9, 31);
  const secOf = (y: number, mo: number, d: number) => Math.floor(new Date(y, mo - 1, d).getTime() / 1000);
  // diffDailyStats 需要 day 键为本地日串；构造窗口内「今天」往前的快照序列
  const localDay = (d: Date) => {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dd}`;
  };
  // 近 N 天「全书总字数快照」逐日递增 → 差分出每日新增；末位 = 今天
  function statsRising(dailyWords: number, days: number, base = 0): any[] {
    const out: any[] = [];
    // 快照按「累计总量」存：第一天 base，之后每天 +dailyWords
    let cum = base;
    // diffDailyStats 需要 WINDOW_DAYS+1 天的连续序列，缺天沿用最近已知；这里铺满窗口
    for (let i = 30; i >= 0; i--) {
      const d = new Date(TODAY);
      d.setDate(d.getDate() - i);
      out.push({ day: localDay(d), wordCount: cum });
      cum += dailyWords;
    }
    return out;
  }

  function paceText(): string {
    const el = Array.from(document.body.querySelectorAll('*')).find((n) => (n.textContent ?? '').includes('节奏预测'));
    return el ? (document.body.textContent ?? '') : '';
  }

  it('设了总字数目标 + 有产出 → 渲染节奏预测块（含结论徽标 / 均速）', async () => {
    h.writing.books[0] = {
      ...h.writing.books[0],
      extra: JSON.stringify({ targetWords: 10000, targetChapters: 0, deadline: secOf(2026, 11, 30) }),
    };
    h.writingApi.listChapters.mockResolvedValue([]);
    h.writingStatsApi.listDailyStats.mockResolvedValue(statsRising(1000, 30));
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    const body = document.body.textContent ?? '';
    expect(body).toContain('节奏预测');
    // 日均 1000、有产出；behind/ontrack 视具体数字，至少含均速文案「字」与「产出」
    expect(body).toMatch(/日均|w\/day/);
  });

  it('未设任何目标（extra 空）→ 不渲染节奏预测块', async () => {
    h.writing.books[0] = { ...h.writing.books[0], extra: '' };
    h.writingApi.listChapters.mockResolvedValue([]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    expect(document.body.textContent ?? '').not.toContain('节奏预测');
  });

  it('有总字数目标但无产出数据 → 渲染并诚实提示（不报错）', async () => {
    h.writing.books[0] = {
      ...h.writing.books[0],
      extra: JSON.stringify({ targetWords: 10000, targetChapters: 0, deadline: secOf(2026, 11, 30) }),
    };
    h.writingApi.listChapters.mockResolvedValue([]);
    // stats 空 → diffDailyStats 仍产出窗口（全 0 delta）→ windowDays>0 但 avg=0 → stalled
    h.writingStatsApi.listDailyStats.mockResolvedValue([]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    expect(document.body.textContent ?? '').toContain('节奏预测');
  });
});

describe('书属性卡 · 创作状态四态（2026-11-03 插单六）', () => {
  it('旧值 draft 仍渲染，且四枚按钮齐备、选中态归一到「连载中」', async () => {
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    const labels = ['连载中', '已完结', '暂停更新', '已弃坑'];
    for (const l of labels) expect(buttonOf(l), `缺状态按钮：${l}`).not.toBeNull();
    // status='draft' → 归一 ongoing → 只有「连载中」带 pressed
    const pressed = Array.from(document.body.querySelectorAll("button[aria-pressed='true']"))
      .map((b) => b.textContent)
      .filter((x) => labels.includes(x ?? ''));
    expect(pressed).toEqual(['连载中']);
  });

  it('点「已弃坑」→ setBookMeta 落规范码 abandoned（不是中文标签、不是 draft）', async () => {
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    await act(async () => {
      buttonOf('已弃坑')!.click();
    });
    expect(h.writing.setBookMeta).toHaveBeenCalledTimes(1);
    const call = h.writing.setBookMeta.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[0]).toBe('b1');
    expect(call[1]).toEqual({ status: 'abandoned' });
  });

  it('库里是 draft、点「连载中」= 无变化 → 不落库不广播（避免纯无谓写）', async () => {
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    await act(async () => {
      buttonOf('连载中')!.click();
    });
    expect(h.writing.setBookMeta).not.toHaveBeenCalled();
  });

  it('已是 abandoned → 再点 abandoned 不落库；点「已完结」则落 finished', async () => {
    h.writing.books[0] = { ...h.writing.books[0], status: 'abandoned' };
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    await act(async () => {
      buttonOf('已弃坑')!.click();
    });
    expect(h.writing.setBookMeta).not.toHaveBeenCalled();
    await act(async () => {
      buttonOf('已完结')!.click();
    });
    expect(h.writing.setBookMeta).toHaveBeenCalledTimes(1);
    const call = h.writing.setBookMeta.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[1]).toEqual({ status: 'finished' });
  });
});
