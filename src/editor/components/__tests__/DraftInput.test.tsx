// DraftInput 回归锁（2026-09-22）
//
// 用户报告：在大纲等编辑面输入时「敲一个键出来一串字」，中文输入法尤其明显。
//
// 根因：输入框的值直接取自 store，而 store 是 `await` 完 IPC 落库之后才 set 的 ——
// 每敲一个键，await 期间 store 仍是旧值，写库返回后 React 会用**旧值程序化改写输入框**；
// 正在组字的输入法缓冲区被重复提交，于是「一个按键出一串字」。
//
// 这份测试锁死修复后的契约（先全部会红，再变绿）：
//   ① 打字期间父组件用旧值重渲染，输入框**不被改写**（含「在途落库」窗口）
//   ② 组字（IME）期间既不落库、也不被外部值改写；compositionend 之后才落库
//   ③ 连续输入按防抖合并成一次落库
//   ④ 失焦立即落库（不等防抖）
//   ⑤ 无未落库 / 在途编辑时，外部值变化正常同步（切换对象能换值）
//   ⑥ entityKey 变化丢弃未落库草稿、硬跟随新对象，且不写回旧对象
//   ⑦ 单行输入回车立即落库；textarea 回车是换行、不落库
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, useEffect, useReducer, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DraftInput } from '../DraftInput';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── 模拟 store：落库 = 「await IPC 之后才 set」，期间 value 仍是旧值 ───
let storeValue = '';
let commits: string[] = [];
let writeMs = 20;
/** 按落库次序消费的延迟队列（未列出的用 writeMs）：用来把某次写入推出测试窗口 */
let writeQueue: number[] = [];
let force: () => void = () => {};

type HarnessProps = { delayMs?: number; as?: 'input' | 'textarea'; entityKey?: string };

function Harness({ delayMs = 40, as = 'input', entityKey = 'e1' }: HarnessProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    force = bump;
  });
  return (
    <DraftInput
      as={as}
      delay={delayMs}
      entityKey={entityKey}
      value={storeValue}
      onCommit={(v) => {
        commits.push(v);
        const delay = writeQueue.length > 0 ? writeQueue.shift()! : writeMs;
        return new Promise<void>((resolve) => {
          window.setTimeout(() => {
            storeValue = v;
            force();
            resolve();
          }, delay);
        });
      }}
      aria-label="field"
    />
  );
}

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

/** 等真实计时器推进；包 act —— 其间落库回调触发的重渲染也算在 act 内 */
async function settle(ms: number) {
  await act(async () => {
    await new Promise((r) => window.setTimeout(r, ms));
  });
}

function field(): HTMLInputElement | HTMLTextAreaElement {
  return document.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement;
}

/** 受控输入设值（native setter 触发 React onChange，与仓库既有夹具同款） */
async function type(text: string) {
  const el = field();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function fire(el: Element, type: string) {
  await act(async () => {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  });
}

async function pressEnter() {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

beforeEach(() => {
  storeValue = '';
  commits = [];
  writeMs = 20;
  writeQueue = [];
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

describe('DraftInput：受控输入 × 异步回写', () => {
  it('① 打字期间父组件用旧值重渲染，输入框不被改写（含在途落库窗口）', async () => {
    storeValue = '初始';
    // 第 1 次落库 150ms 后落地（期间 store 仍是「初始」）；第 2 次推远，好让断言
    // 正好落在「store 已回写到落后快照、用户却已多打一个字」的那一刻。
    writeQueue = [150, 60000];
    mount(<Harness delayMs={40} />);
    expect(field().value).toBe('初始');

    await type('甲');
    await settle(80);
    expect(commits).toEqual(['甲']);
    expect(field().value).toBe('甲');

    // 在途期间继续输入；随后那次写入落地，store 值变成落后于草稿的「甲」
    await type('甲乙');
    await settle(160);
    expect(field().value, '在途落库落地后，不得把用户新输入改写回旧值').toBe('甲乙');
  });

  it('② 组字期间不落库、不被外部值改写；compositionend 之后才落库', async () => {
    storeValue = '初始';
    mount(<Harness delayMs={40} />);

    await fire(field(), 'compositionstart');
    await type('xue'); // 组字中的拼音串
    await settle(120);
    expect(commits, '组字期间不得落库').toEqual([]);
    expect(field().value, '组字期间不得被程序化改写').toBe('xue');

    await fire(field(), 'compositionend');
    await settle(120);
    expect(commits, '组字结束才落库').toEqual(['xue']);
  });

  it('③ 连续输入按防抖合并成一次落库', async () => {
    mount(<Harness delayMs={40} />);
    await type('a');
    await type('ab');
    await type('abc');
    await settle(150);
    expect(commits).toEqual(['abc']);
  });

  it('④ 失焦立即落库（不等防抖）', async () => {
    mount(<Harness delayMs={5000} />);
    await type('x');
    expect(commits).toEqual([]);
    await fire(field(), 'focusout');
    expect(commits, '失焦必须兜底落库').toEqual(['x']);
  });

  it('⑤ 无未落库 / 在途编辑时，外部值变化正常同步（切换对象能换值）', async () => {
    storeValue = '甲';
    mount(<Harness delayMs={40} />);
    expect(field().value).toBe('甲');

    await act(async () => {
      storeValue = '乙';
      force();
    });
    expect(field().value).toBe('乙');
  });

  it('⑥ entityKey 变化丢弃未落库草稿、硬跟随新对象，且不写回旧对象', async () => {
    storeValue = '章一';
    mount(<Harness delayMs={5000} entityKey="c1" />); // 防抖很长 → 草稿一直待落库
    await type('章一改');
    expect(field().value).toBe('章一改');

    await act(async () => {
      storeValue = '章二';
      root!.render(<Harness delayMs={5000} entityKey="c2" />);
    });
    // 此刻有排队中的落库 → 外部值同步被守卫挡住，只有「换对象」这条路径能让显示跟过去
    expect(field().value).toBe('章二');
    expect(commits, '未落库草稿应被丢弃，不得写回旧对象').toEqual([]);
  });

  it('⑦ 单行输入回车立即落库', async () => {
    mount(<Harness delayMs={5000} as="input" />);
    await type('x');
    await pressEnter();
    expect(commits).toEqual(['x']);
  });

  it('⑦ textarea 回车是换行，不落库', async () => {
    mount(<Harness delayMs={5000} as="textarea" />);
    await type('y');
    await pressEnter();
    expect(commits).toEqual([]);
  });
});
