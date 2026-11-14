// ㊽ 入口族收口锁（2026-11-11 轮 29）：书场景输入条的快捷 chip 必须跟着体裁裁。
//
// 为什么又要开一个真渲染文件：W-0a 那轮的教训是「定义 100% / 运行时 20%」——判据写在
// writingSchema 里全仓都能查，唯独消费点没查。本刀同形：`hiddenViewKindsForGenre` 早就把
// worldview / storylines / foreshadowing 对四种载体裁掉了，页签也裁了，但输入条上那两枚
// 以它们为判据的快捷动作（审情节节奏 / 全书设定一致性）一直无条件渲染，诗集与日记照领。
// 所以这里必须**真渲染**输入条看 chip 排的是哪几枚（AU-7 ⑨：源码锁 + 纯函数锁拦不住
// 「算好了没接到行上」），另加两条源码锁防后人把 genre 又从中途拆掉。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { WorkbenchInputBarCtx } from '../workbenchComponents';
import { viewKindVisibleForGenre } from '../../../utils/writingSchema';

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (sel: (s: { interruptRequested: boolean }) => unknown) => sel({ interruptRequested: false }),
    { getState: () => ({ requestInterrupt: vi.fn(), interruptRequested: false }) },
  ),
}));

vi.mock('../speechInput', () => ({
  isSpeechRecognitionSupported: () => false,
  ensureMicPermission: async () => 'denied' as const,
  requestSpeechAuthorization: async () => 'denied' as const,
  createSpeechInput: () => ({ start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }),
}));

vi.mock('../../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ showToast: vi.fn() }) },
}));

import { WorkbenchInputBar } from '../workbenchComponents';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function makeCtx(over: Partial<WorkbenchInputBarCtx> = {}): WorkbenchInputBarCtx {
  return {
    view: 'chat',
    input: '',
    setInput: vi.fn(),
    editInput: '',
    setEditInput: vi.fn(),
    inputRef: { current: null },
    editInputRef: { current: null },
    submitInput: vi.fn(),
    detectHashMention: vi.fn(),
    detectSlashCommand: vi.fn(),
    setSlashAnchor: vi.fn(),
    setSlashQuery: vi.fn(),
    setSlashTarget: vi.fn(),
    slashAnchor: null,
    slashQuery: '',
    slashTarget: 'chat',
    fileDiagnostics: [],
    fixErrors: vi.fn(),
    quickAction: vi.fn(),
    queued: [],
    isBookScene: true,
    agents: [],
    selectedAgentId: null,
    selectAgent: vi.fn(),
    ...over,
  };
}

/** 真渲染输入条，按渲染顺序读出这一排 chip 的标签（selection 传 null，选区那两枚不参与本轮判据） */
async function chipLabels(over: Partial<WorkbenchInputBarCtx> = {}): Promise<string[]> {
  host = document.createElement('div');
  document.body.appendChild(host);
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
  root = createRoot(host);
  await act(async () => {
    root!.render(<WorkbenchInputBar ctx={makeCtx(over)} selection={null} isStreaming={false} />);
  });
  return Array.from(document.querySelectorAll('.MuiChip-root'))
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean);
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

describe('㊽ 书场景快捷 chip 按体裁裁（真渲染）', () => {
  // ㉕（轮 32 P14）：「读懂」那一枚的**措辞**按体裁换词（读懂这篇/这首/这场/这天，
  // 槽位表 `chipUnderstand`）；本文件的判据是**裁不裁**（该不在场的必须不在场），
  // 裁集一条不松——只是不再替新措辞背旧字符串的书签。
  it('诗集：审情节节奏 / 全书设定一致性 两枚都不许在场，但读懂与查一致性仍在', async () => {
    const chips = await chipLabels({ genre: 'poetry' });
    expect(chips).toEqual(['读懂这首', '检查一致性']);
    for (const forbidden of ['审情节节奏', '全书设定一致性', '读懂本章']) {
      expect(chips, `诗集输入条不该再递「${forbidden}」`).not.toContain(forbidden);
    }
  });

  it('散文集 / 日记与诗集同一判据（三者都裁 storylines + worldview）', async () => {
    const unitWords: Record<string, string> = { essay: '读懂这篇', diary: '读懂这天' };
    for (const genre of ['essay', 'diary']) {
      const chips = await chipLabels({ genre });
      expect(chips, `${genre} 输入条`).toEqual([unitWords[genre], '检查一致性']);
      expect(chips, `${genre} 不许再顶着「读懂本章」`).not.toContain('读懂本章');
    }
  });

  it('剧本：只摘「全书设定一致性」——剧情线（动作线）是戏剧本体，不许连它一起摘', async () => {
    expect(await chipLabels({ genre: 'script' })).toEqual(['读懂这场', '检查一致性', '审情节节奏']);
  });

  it('小说零回归：未设 / 空串 / novel / 脏值 四种入参，那一排与改动前逐字同序同集', async () => {
    const NOVEL = ['读懂本章', '检查一致性', '审情节节奏', '全书设定一致性'];
    expect(await chipLabels()).toEqual(NOVEL);
    expect(await chipLabels({ genre: '' })).toEqual(NOVEL);
    expect(await chipLabels({ genre: 'novel' })).toEqual(NOVEL);
    expect(await chipLabels({ genre: 'scribble' })).toEqual(NOVEL); // 脏值只许回落，不许猜
  });

  it('代码场景不受影响（isBookScene=false 一律不读 genre，仍是 explain/test/review 那一支）', async () => {
    expect(await chipLabels({ isBookScene: false, genre: 'poetry' })).toEqual([
      '解释当前文件',
      '生成单元测试',
      '审查当前文件',
    ]);
  });
});

describe('㊽ viewKindVisibleForGenre 判据本体（与页签表同源）', () => {
  const CASES: Array<[string, boolean, boolean, boolean]> = [
    // genre, worldview, storylines, foreshadowing（foreshadowing 与 storylines 同进同退）
    ['novel', true, true, true],
    ['essay', false, false, false],
    ['poetry', false, false, false],
    ['script', false, true, true],
    ['diary', false, false, false],
    ['', true, true, true],
    ['scribble', true, true, true],
  ];
  it.each(CASES)('%s：三类被闸栏的可见性与 hiddenViewKindsForGenre 逐位一致', (genre, w, s, f) => {
    expect(viewKindVisibleForGenre(genre, 'worldview')).toBe(w);
    expect(viewKindVisibleForGenre(genre, 'storylines')).toBe(s);
    expect(viewKindVisibleForGenre(genre, 'foreshadowing')).toBe(f);
  });

  it('未被闸的栏对五种载体恒可见（时间线/人物/素材/便签不许被顺手摘掉）', () => {
    for (const genre of ['novel', 'essay', 'poetry', 'script', 'diary']) {
      for (const kind of ['timeline', 'characters', 'inspiration', 'proofread', 'stats', 'overview', 'writing', 'catalog']) {
        expect(viewKindVisibleForGenre(genre, kind), `${genre}/${kind}`).toBe(true);
      }
    }
  });
});

describe('㊽ 源码锁（判据不许再分叉、genre 不许半路掉）', () => {
  const read = (rel: string): string => readFileSync(`${process.cwd()}/${rel}`, 'utf8');

  it('输入条两枚 chip 必须现查页签表，不得回潮为无条件渲染', () => {
    const src = read('src/editor/panels/workbenchComponents.tsx');
    expect(src).toContain(`viewKindVisibleForGenre(ctx.genre ?? '', 'storylines')`);
    expect(src).toContain(`viewKindVisibleForGenre(ctx.genre ?? '', 'worldview')`);
  });

  it('体裁判断只准调 *ForGenre 判据，输入条里不得再写字面体裁名比较', () => {
    // 禁令型锁：这里刻意不在注释里举例被禁的那个形状（轮 7 教训 ⑧：注释里的反例会被自己的锁抓住）
    const src = read('src/editor/panels/workbenchComponents.tsx');
    expect(src).not.toMatch(/genre\s*===\s*['"]/);
  });

  it('单一真源：canCreateEntityForGenre 与 aiQuickActionVisible 都必须走 viewKindVisibleForGenre', () => {
    const src = read('src/utils/writingSchema.ts');
    expect(src).toMatch(/function canCreateEntityForGenre[\s\S]{0,160}return viewKindVisibleForGenre\(/);
    expect(src).toMatch(/function aiQuickActionVisible[\s\S]{0,220}viewKindVisibleForGenre\(/);
  });
});
