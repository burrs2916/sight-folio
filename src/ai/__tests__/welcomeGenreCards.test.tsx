/**
 * ㉜ AI-2（2026-11-10 轮 7）：`/ai` 空态按体裁出卡 + 引导语接线锁。
 *
 * 病灶（v3 分析 §3 实测，本轮复核成立）：`WelcomeView` 从 ⑰-1 起就在 props 里收了
 * `currentBook.genre`，**全文件再无一字引用它**（孤儿 prop）。于是五种载体在 AI 空态
 * 领到完全相同的东西：诗集作者看到一张「世界观：构建或完善世界规则、文化与历史设定」
 * 的卡，而诗集在 `hiddenViewKindsForGenre`（⑮-2）里 worldview 早就是被裁视图 ——
 * 一边锁着门不让建，一边发钥匙叫他去建，是自相矛盾。
 *
 * 锁的形状沿用 ㉚/㉛ 三层（本仓已为「定义 100% / 运行时 0%」付过四次钱）：
 *   ① 纯函数层：`aiQuickActionVisible` / `aiWelcomeDescKey` 的可见性与回落；
 *   ② 真渲染层：五体裁 + 无书 + 脏体裁值，看界面上**到底出现哪几张卡、哪句话**；
 *   ③ 接线层：孤儿 prop 必须真的被读、组件里不许长出 `genre ===` 字面判断、
 *      被收编的通用键只准住在 writingSchema 的回落表里。
 *
 * 零回归线：小说（含 genre 未设的旧书、脏值）六张卡与那句通用引导语**逐字不变**。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { WelcomeView, type QuickActionKind } from '../WelcomeView';
import {
  aiQuickActionVisible,
  aiWelcomeDescKey,
  aiChatEmptyKey,
  hiddenViewKindsForGenre,
} from '../../utils/writingSchema';
import { t, setLang } from '../../i18n';

const NON_NOVEL = ['essay', 'poetry', 'script', 'diary'];
/** 小说口径的满配六张（顺序 = 界面上的阅读顺序） */
const ALL_ACTIONS: QuickActionKind[] = ['continue', 'polish', 'analyze', 'outline', 'character', 'world'];
/** 小说侧逐字锁：改造前界面上就是这一句（逐字抄自 i18n，不用插值拼） */
const NOVEL_DESC =
  '选择或创建一个对话，开始与 AI 进行协作创作。支持内容生成、风格润色、结构分析等功能。';

const TITLE_OF: Record<QuickActionKind, string> = {
  continue: 'agent.welcome.continue',
  polish: 'agent.welcome.polish',
  analyze: 'agent.welcome.impact',
  outline: 'agent.welcome.outline',
  character: 'agent.welcome.character',
  world: 'agent.welcome.world',
};

let root: Root | null = null;
const mount = async (ui: ReactElement) => {
  if (root) act(() => root!.unmount());
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
};

/** 卡面本体 = 带 icon-box 的那张 Paper（提示芯片与徽章 Chip 同样挂 MuiPaper-root，必须这样筛） */
const cards = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('.MuiPaper-root')).filter((p) => p.querySelector('.icon-box'));

/** 卡面标题：卡片本体的文案 = 标题 + 描述 */
const cardTitles = () => cards().map((p) => (p.textContent ?? '').trim());

const cardCount = () => cards().length;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  setLang('zh-CN');
});

describe('㉜ aiQuickActionVisible · 纯函数层', () => {
  it('小说 / 空 / 脏体裁：六张卡全可见（旧书零回归）', () => {
    for (const genre of ['novel', '', 'diaryy', 'Novel', 'script ']) {
      for (const kind of ALL_ACTIONS) {
        expect(aiQuickActionVisible(genre, kind), `${genre || '(空)'} 不该裁掉 ${kind}`).toBe(true);
      }
    }
  });

  it('四支非小说：世界观卡不可见（worldview 是它们的被裁视图）', () => {
    for (const genre of NON_NOVEL) {
      expect(hiddenViewKindsForGenre(genre), `${genre} 应当裁掉 worldview`).toContain('worldview');
      expect(aiQuickActionVisible(genre, 'world'), `${genre} 不该再拿世界观卡`).toBe(false);
    }
  });

  it('角色卡五支全可见 —— 日记/诗集的人物栏没被裁，卡也不该跟着消失', () => {
    for (const genre of ['novel', '', ...NON_NOVEL]) {
      expect(hiddenViewKindsForGenre(genre)).not.toContain('characters');
      expect(aiQuickActionVisible(genre, 'character'), `${genre} 的 character 卡被误裁`).toBe(true);
    }
  });

  it('没有家视图的卡恒可见：判据只认表，不认体裁名（新增卡不必改判据）', () => {
    for (const genre of ['poetry', 'diary', '']) {
      for (const kind of ['continue', 'polish', 'analyze', 'outline']) {
        expect(aiQuickActionVisible(genre, kind)).toBe(true);
      }
      expect(aiQuickActionVisible(genre, 'someFutureCard')).toBe(true);
    }
  });
});

describe('㉜ aiWelcomeDescKey · 纯函数层', () => {
  it('无书 / 未设 / 脏值 / 小说 → 回落改造前那条通用键，一个字节不动', () => {
    for (const genre of [undefined, null, '', 'novel', 'diaryy', 'Poetry']) {
      expect(aiWelcomeDescKey(genre as string | null | undefined)).toBe('agent.welcome.desc');
    }
  });

  it('四支非小说 → 复用 ⑰-1 那四句整句（不新造第二套 AI 空态文案）', () => {
    for (const genre of NON_NOVEL) {
      expect(aiWelcomeDescKey(genre)).toBe(aiChatEmptyKey(genre));
    }
  });

  it('四支的空态句互不相同，且诗/散两支不再问「伏笔 / 人设卡 / 章节」', () => {
    setLang('zh-CN');
    const lines = NON_NOVEL.map((g) => t(aiWelcomeDescKey(g)));
    expect(new Set(lines).size, '四支共用一句 = 覆盖没生效').toBe(4);
    expect(lines).not.toContain(t('agent.welcome.desc'));
    for (const g of ['essay', 'poetry']) {
      const line = t(aiWelcomeDescKey(g));
      for (const bad of ['伏笔', '人设卡', '章节']) {
        expect(line, `${g} 的 AI 空态不许再说「${bad}」`).not.toContain(bad);
      }
    }
  });
});

describe('㉜ WelcomeView · 真渲染层（界面上到底出现哪几张卡）', () => {
  it('小说书：六张卡，含「世界观」，引导语仍是原句', async () => {
    setLang('zh-CN');
    await mount(<WelcomeView currentBook={{ title: '长夜', genre: 'novel' }} />);
    expect(cardCount()).toBe(6);
    const cards = cardTitles();
    for (const kind of ALL_ACTIONS) {
      expect(cards.some((c) => c.includes(t(TITLE_OF[kind]))), `小说少了 ${kind} 卡`).toBe(true);
    }
    expect(document.body.textContent).toContain(t('agent.welcome.world'));
    expect(document.body.textContent).toContain(NOVEL_DESC);
  });

  it('无书（代码项目 / 未开书）：仍是六张卡 + 原句，零回归', async () => {
    setLang('zh-CN');
    await mount(<WelcomeView />);
    expect(cardCount()).toBe(6);
    expect(document.body.textContent).toContain(NOVEL_DESC);
  });

  it('genre 未设的旧书（null / 空串 / 脏值）：与小说完全同形', async () => {
    setLang('zh-CN');
    for (const genre of [null, '', 'myself']) {
      await mount(<WelcomeView currentBook={{ title: '旧书', genre }} />);
      expect(cardCount(), `genre=${JSON.stringify(genre)} 卡数变了`).toBe(6);
      expect(document.body.textContent).toContain(NOVEL_DESC);
    }
  });

  it('诗集 / 散文集 / 剧本 / 日记本：五张卡，「世界观」一张都不许出现', async () => {
    setLang('zh-CN');
    for (const genre of NON_NOVEL) {
      await mount(<WelcomeView currentBook={{ title: '书', genre }} />);
      expect(cardCount(), `${genre} 应当只剩五张卡`).toBe(5);
      // 只对**卡面**取证，不扫整页：「试试问」那四枚芯片里也有一句「世界观设定有没有漏洞？」
      // （它们没有 onClick、点了不动，是另一笔账 AI-2c）。整屏扫描会把那枚芯片当成卡，
      // 与轮 6「误伤清单要当断言写进测试注释」是同一条教训。
      const faces = cardTitles();
      expect(
        faces.some((f) => f.includes(t('agent.welcome.world'))),
        `${genre} 仍出现世界观卡`,
      ).toBe(false);
      const text = document.body.textContent ?? '';
      // 角色卡留下：人物栏没被裁（日记尤其要留，见 hiddenViewKindsForGenre 注释）
      expect(text, `${genre} 的角色卡被误裁`).toContain(t('agent.welcome.character'));
      expect(text, `${genre} 的续写卡被误裁`).toContain(t('agent.welcome.continue'));
    }
  });

  it('诗集的空态句换成诗那句；散文/剧本/日记各说各话', async () => {
    setLang('zh-CN');
    await mount(<WelcomeView currentBook={{ title: '诗集', genre: 'poetry' }} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain(t('writing.aiChatEmptyPoem'));
    expect(text, '诗集空态仍在说小说那句').not.toContain(NOVEL_DESC);
    for (const [genre, key] of [['essay', 'writing.aiChatEmptyPiece'], ['script', 'writing.aiChatEmptyScript'], ['diary', 'writing.aiChatEmptyDay']] as const) {
      await mount(<WelcomeView currentBook={{ title: '书', genre }} />);
      expect(document.body.textContent ?? '', `${genre} 没领到自己那句`).toContain(t(key));
    }
  });

  it('卡片仍能点到：过滤后 onClick 传的是这张卡自己的 kind', async () => {
    const calls: QuickActionKind[] = [];
    setLang('zh-CN');
    await mount(
      <WelcomeView
        currentBook={{ title: '诗集', genre: 'poetry' }}
        onQuickAction={(k) => calls.push(k)}
      />,
    );
    const papers = cards();
    expect(papers.length).toBe(5);
    await act(async () => {
      papers[0].click();
    });
    await act(async () => {
      papers[3].click();
    });
    expect(calls).toEqual(['continue', 'outline']);
  });
});

describe('㉜ 接线层 · 孤儿 prop 必须死透', () => {
  const src = readFileSync('src/ai/WelcomeView.tsx', 'utf-8');

  it('genre 真的被读了：卡片过滤与空态句都吃它（孤儿 prop 复活就红）', () => {
    expect(src).toContain("const genre = currentBook?.genre ?? '';");
    expect(src).toContain('aiQuickActionVisible(genre, item.kind)');
    expect(src).toContain('t(aiWelcomeDescKey(genre))');
  });

  it('通用引导语裸键在组件里绝迹，只准住在 writingSchema 的回落表里', () => {
    expect(src).not.toContain("'agent.welcome.desc'");
    const schema = readFileSync('src/utils/writingSchema.ts', 'utf-8');
    expect(schema).toContain("return 'agent.welcome.desc';");
    for (const p of ['src/pages/AiAgentPage.tsx', 'src/editor/panels/WorkbenchAiPanel.tsx']) {
      expect(readFileSync(p, 'utf-8'), `${p} 还在硬编码通用空态句`).not.toContain("'agent.welcome.desc'");
    }
  });

  it('组件里不许长出体裁判据（判据单一真源 = writingSchema 的 *ForGenre）', () => {
    expect(src).not.toMatch(/genre\s*===\s*'/);
    expect(src).not.toMatch(/genre\s*!==\s*'/);
  });

  it('卡表只剩一份：kind 同时是 key、点击参数与过滤入参（不留第二张动作表）', () => {
    expect(src).not.toContain('action: () => onQuickAction');
    expect(src).toContain('key={item.kind}');
    expect(src).toContain('onClick={() => onQuickAction?.(item.kind)}');
  });

  it('小说六张卡的 i18n 键一个都不许删（它们是回落态，删了就印裸键）', () => {
    const zh = JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf-8'));
    const en = JSON.parse(readFileSync('src/i18n/en-US.json', 'utf-8'));
    const cjk = /[\u4e00-\u9fff]/;
    for (const kind of ALL_ACTIONS) {
      const leaf = TITLE_OF[kind].split('.').pop() as string;
      expect(typeof zh.agent.welcome[leaf], `zh 缺 agent.welcome.${leaf}`).toBe('string');
      expect(typeof en.agent.welcome[leaf], `en 缺 agent.welcome.${leaf}`).toBe('string');
      expect(zh.agent.welcome[leaf]).toMatch(cjk);
      expect(en.agent.welcome[leaf]).not.toMatch(cjk);
    }
  });
});
