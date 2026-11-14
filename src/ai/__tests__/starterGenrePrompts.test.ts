// ㉟ starterGenrePrompts.test.ts —— AI-4a（2026-11-10 轮 12）：右栏「起步示例」按体裁。
//
// 钉三件事：
//  1. 五支各四枚、novel 逐字 = 改造前 `WorkbenchAiPanel.STARTER_PROMPTS_BOOK`
//     （原文对是从改造前的磁盘文件**逐字抄进本文件**的，不是凭印象）；
//  2. 非小说四支不领小说词（蹭词扫描）且本体裁单位词在场；新标签键双语穷尽；
//  3. 接线：面板真吃 `bookStartersFor(genre)`、旧表绝迹、SceneEditor 真把体裁传进来。
//     （AU-7 ⑨ 口径：本面板的重渲染无既有先例（Round42 同源做法是源码锁），
//      接线锁的牙齿由本轮反证给：摘掉 genre 实参 → 接线套必红。）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bookStartersFor } from '../starterPrompts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ── 改造前 `STARTER_PROMPTS_BOOK` 原文对（逐字抄录，独立另存 = 零回归对锁） ──
const NOVEL_ORIGINAL: Array<[string, string, string]> = [
  [
    'explain',
    '读懂这一章：它在全书里承担什么情节功能、与前后章如何衔接、写得好的地方与可改进点。',
    "Help me understand this chapter: what plot function it serves, how it connects to the surrounding chapters, and what works versus what could improve.",
  ],
  [
    'improve',
    '润色当前章节里最薄弱的一段：提升文笔、节奏与可读性，保持人设口吻与全文风格一致。',
    "Polish the weakest passage in this chapter: improve prose, pacing and readability while keeping the character's voice and the overall style consistent.",
  ],
  [
    'continue',
    '基于当前章节的结尾与已有设定，续写接下来的情节，保持风格连贯。',
    "Continue the story from this chapter's ending and the existing setting, keeping the style coherent.",
  ],
  [
    'plot',
    '审视当前章节的情节连贯性、伏笔回收与叙事节奏，指出断裂或矛盾并给出修改建议。',
    "Review this chapter's plot coherence, foreshadowing payoff and pacing; point out breaks or contradictions with revision suggestions.",
  ],
];

describe('㉟ AI-4a：五支各四枚，形状穷尽', () => {
  const ids = ['novel', 'essay', 'poetry', 'script', 'diary'] as const;
  it('每支恰四枚、key 不重、双语都在', () => {
    for (const g of ids) {
      const list = bookStartersFor(g);
      expect(list, g).toHaveLength(4);
      expect(new Set(list.map((s) => s.key)).size, g).toBe(4);
      for (const s of list) {
        expect(s.labelKey, `${g}/${s.key}`).toMatch(/^workbench\.aiStarter\.book\./);
        expect(s.prompt.length, `${g}/${s.key}`).toBeGreaterThan(10);
      }
    }
  });
  it('未设 / 空 / 脏体裁值 = 小说那支（回落判据 = workbenchCommandSet）', () => {
    for (const g of [undefined, null, '', 'novel', 'zzz', 'DIARY'] as Array<string | null | undefined>) {
      expect(bookStartersFor(g as string)).toEqual(bookStartersFor('novel'));
    }
  });
});

describe('㉟ AI-4a：novel 零回归（逐字对锁）', () => {
  it('四枚 prompt 与改造前逐字相同（中英各一）', () => {
    const novel = bookStartersFor('novel');
    expect(novel.map((s) => s.key)).toEqual(NOVEL_ORIGINAL.map(([k]) => k));
    NOVEL_ORIGINAL.forEach(([key, zh, en], i) => {
      expect(novel[i].prompt, key).toBe(zh); // 默认测试语言 zh
      // 英文侧不进 prompt（语种锁在渲染层），但源串必须在模块里逐字在场
      const src = read('src/ai/starterPrompts.ts');
      expect(src, `${key} en 逐字`).toContain(en);
    });
  });
  it('四枚 labelKey 与改造前逐字相同', () => {
    expect(bookStartersFor('novel').map((s) => s.labelKey)).toEqual([
      'workbench.aiStarter.book.explain',
      'workbench.aiStarter.book.improve',
      'workbench.aiStarter.book.continue',
      'workbench.aiStarter.book.plot',
    ]);
  });
  it('improve / continue 两枚标签五支共用（现成键本来无体裁词，不换键）', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary']) {
      const byKey = Object.fromEntries(bookStartersFor(g).map((s) => [s.key, s.labelKey]));
      expect(byKey.improve, g).toBe('workbench.aiStarter.book.improve');
      expect(byKey.continue, g).toBe('workbench.aiStarter.book.continue');
    }
  });
});

describe('㉟ AI-4a：非小说四支的蹭词与本体词', () => {
  const zhOf = (g: string) => bookStartersFor(g).map((s) => s.prompt).join('\n');
  it('诗歌四枚：没有 章/小说/情节/伏笔/人设，且「分行」在场', () => {
    const zh = zhOf('poetry');
    for (const bad of ['章节', '小说', '情节', '伏笔', '人设']) {
      expect(zh, `诗出现「${bad}」`).not.toContain(bad);
    }
    expect(zh).toContain('分行');
  });
  it('散文四枚：没有 章/诗/首/幕，且「立意」在场', () => {
    const zh = zhOf('essay');
    for (const bad of ['章节', '小说', '一首', '幕']) {
      expect(zh, `散文出现「${bad}」`).not.toContain(bad);
    }
    expect(zh).toContain('立意');
  });
  it('剧本四枚：没有 章/小说/意象，且「台词」「舞台」在场', () => {
    const zh = zhOf('script');
    for (const bad of ['章节', '小说', '意象']) {
      expect(zh, `剧本出现「${bad}」`).not.toContain(bad);
    }
    expect(zh).toContain('台词');
    expect(zh).toContain('舞台');
  });
  it('日记四枚：没有 章/小说/情节/伏笔，且「当天」与「不替作者」纪律在场', () => {
    const zh = zhOf('diary');
    for (const bad of ['章节', '小说', '情节', '伏笔']) {
      expect(zh, `日记出现「${bad}」`).not.toContain(bad);
    }
    expect(zh).toContain('当天');
    expect(zh).toContain('不替作者');
  });
});

describe('㉟ AI-4a：新标签键双语穷尽 + 零孤儿', () => {
  const NEW_KEYS = [
    'explainPiece',
    'explainPoem',
    'explainScene',
    'explainDay',
    'plotThesis',
    'plotLineation',
    'plotConflict',
    'plotFacts',
  ];
  const zh = JSON.parse(read('src/i18n/zh-CN.json')).workbench.aiStarter.book;
  const en = JSON.parse(read('src/i18n/en-US.json')).workbench.aiStarter.book;
  const src = read('src/ai/starterPrompts.ts');
  it.each(NEW_KEYS)('键 %s 双语在场且被模块消费', (k) => {
    expect(zh[k], `${k} zh`).toBeTruthy();
    expect(en[k], `${k} en`).toBeTruthy();
    expect(src, `${k} 消费点`).toContain(`workbench.aiStarter.book.${k}`);
  });
  it('模块里出现的 book.* 标签键全部能在双语包解析（裸键事故的第 12 次防线）', () => {
    const used = [...src.matchAll(/workbench\.aiStarter\.book\.([A-Za-z]+)/g)].map((m) => m[1]);
    for (const k of new Set(used)) {
      expect(zh[k], `zh 缺 ${k}`).toBeTruthy();
      expect(en[k], `en 缺 ${k}`).toBeTruthy();
    }
  });
});

describe('㉟ AI-4a：接线与旧表绝迹（源码锁）', () => {
  const panel = read('src/editor/panels/WorkbenchAiPanel.tsx');
  it('面板 import 并消费 bookStartersFor(genre)', () => {
    expect(panel).toContain("from '../../ai/starterPrompts'");
    expect(panel).toMatch(/bookStartersFor\(genre \?\? ''\)/);
  });
  it('genre prop 已进接口并解构', () => {
    expect(panel).toMatch(/genre\?: string \| null;/);
    expect(panel).toMatch(/\n {2}genre,\n/);
  });
  it('旧表 STARTER_PROMPTS_BOOK 在面板里绝迹（不留第二份真源）', () => {
    expect(panel).not.toMatch(/const STARTER_PROMPTS_BOOK\b/);
  });
  it('SceneEditor 把 writingGenre 传给书场景 AI 面板', () => {
    const se = read('src/editor/SceneEditor.tsx');
    expect(se).toContain('genre={writingGenre}');
  });
});
