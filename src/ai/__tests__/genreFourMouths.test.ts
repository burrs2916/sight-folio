// ㉟ genreFourMouths.test.ts —— AI-5（2026-11-10 轮 12）：四个「小说口径」prompt 口换词。
//
// 队列点名的四口（状态文件 §队列 AI-4 + AI-5 行）：
//  ① `aiCorpusChat` 语料参谋人设 + 一键生成指令的「当前章节」；
//  ② `inspirationExpand` 扩写人设与指令里的「可直接放进小说正文」；
//  ③ `writingCapture` 素材分析的「可以被小说直接使用的信息」；
//  ④ `useAiActions.buildChatContext` 自动注入块的 当前章节/全书章节骨架/人物档案/当前章正文
//     （这一块同时喂 AI 语料 / 灵感扩写 / 写作 AI 对话三处）。
// 每口两层：**novel 逐字对锁**（原文独立另存）+ **本体裁词在场 / 小说词绝迹**（人设段扫描；
// 共用的输出契约与人味约束尾段全载体同文，不进蹭词扫描——它与解析规则锁死，不许随体裁漂）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setLang } from '../../i18n';
import { corpusSystemHintFor, buildCorpusGeneratePrompt } from '../../utils/aiCorpusChat';
import { inspirationExpandSystemHintFor, buildInspirationExpandPrompt } from '../../utils/inspirationExpand';
import { buildCaptureAnalysisMessage } from '../writingCapture';
import { quickActionTermsFor } from '../quickActionPrompts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
/** 人设段 = 首个空行之前（共用契约段不进蹭词扫描） */
const persona = (hint: string) => hint.split('\n\n')[0];

describe('㉟ AI-5 ①：语料参谋人设 corpusSystemHintFor', () => {
  const NOVEL_PERSONA =
    '你现在的身份是「本书语料参谋」。请结合整篇作品（结构/人物/世界观/风格）与当前章节上下文作答，给出明确建议：这句是否可参考、参考哪句、直接引用还是改写、是否建议由你重写一段。';
  it('novel（含空/脏值）人设段与改造前逐字相同', () => {
    for (const g of ['', 'novel', 'zzz']) expect(persona(corpusSystemHintFor(g)), g).toBe(NOVEL_PERSONA);
  });
  it('共享契约尾段五支同文（>>> 行 + 可一键插入 + 人味约束五条）', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', 'diary']) {
      const h = corpusSystemHintFor(g);
      expect(h, g).toContain('>>> ');
      expect(h, g).toContain('可一键插入');
      expect(h, g).toContain('人味约束');
      expect(h, g).toContain('5. 给立场：明确倾向与判断，不回避表态，不用含糊词语填充。');
    }
  });
  it('诗集人设不说 世界观/章节/小说，说 分行与形式/当前诗作', () => {
    const p = persona(corpusSystemHintFor('poetry'));
    for (const bad of ['世界观', '章节', '小说', '情节']) expect(p, bad).not.toContain(bad);
    expect(p).toContain('当前诗作');
    expect(p).toContain('分行与形式');
  });
  it('剧本人设说 幕场结构/台词，不说 章节/小说', () => {
    const p = persona(corpusSystemHintFor('script'));
    expect(p).toContain('幕场结构');
    expect(p).toContain('当前场次');
    for (const bad of ['章节', '小说']) expect(p, bad).not.toContain(bad);
  });
  it('日记人设自带「不得替作者补写」硬线', () => {
    const p = persona(corpusSystemHintFor('diary'));
    expect(p).toContain('不得替作者补写');
    expect(p).toContain('当天条目');
    for (const bad of ['世界观', '章节']) expect(p, bad).not.toContain(bad);
  });
  it('一键生成指令：novel 整句逐字，其余换单位词', () => {
    expect(buildCorpusGeneratePrompt({ count: 3, purpose: 'dialogue' })).toBe(
      '请直接生成 3 条可用于当前章节的参考句（以对白为主，风格贴合本书），逐条单独成行并以 ">>> " 开头，不要输出其他内容。',
    );
    expect(buildCorpusGeneratePrompt({ count: 2, purpose: 'auto', genre: 'poetry' })).toContain('可用于当前诗作的参考句');
    expect(buildCorpusGeneratePrompt({ count: 2, purpose: 'auto', genre: 'diary' })).toContain('可用于当天条目的参考句');
    expect(buildCorpusGeneratePrompt({ count: 2, purpose: 'auto', genre: 'script' })).toContain('可用于当前场次的参考句');
  });
});

describe('㉟ AI-5 ②：灵感扩写人设与指令', () => {
  const NOVEL_PERSONA =
    '你现在的身份是「本书灵感扩写师」。用户会给你一条尚未成文的灵感念头（标题 + 摘要 + 可能挂载的角色/场景），你把它扩写成可直接放进小说正文的段落或场景。';
  it('novel（含空/脏值）人设段与改造前逐字相同', () => {
    for (const g of ['', 'novel', 'zzz']) expect(persona(inspirationExpandSystemHintFor(g)), g).toBe(NOVEL_PERSONA);
  });
  it('版本切分契约（>>> 标题行）五支同文', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', 'diary']) {
      expect(inspirationExpandSystemHintFor(g), g).toContain('标题行会被前端解析为版本切分标记');
    }
  });
  it('诗集扩写要分行、禁排成散文段落；日记扩写自带不补记忆', () => {
    const p = persona(inspirationExpandSystemHintFor('poetry'));
    expect(p).toContain('按分行写');
    expect(p).toContain('不要排成散文段落');
    const d = persona(inspirationExpandSystemHintFor('diary'));
    expect(d).toContain('不得替作者补写');
  });
  it('指令尾句：novel 逐字，其余换成品形状', () => {
    const base = { title: '雨巷', summary: '伞沿滴水', count: 2 };
    expect(buildInspirationExpandPrompt(base)).toContain(
      '请基于以上灵感扩写 2 个可直接放进小说正文的候选段落/场景（每个版本以 ">>> " 标题行开头',
    );
    expect(buildInspirationExpandPrompt({ ...base, genre: 'poetry' })).toContain('可直接放进诗作的候选片段');
    expect(buildInspirationExpandPrompt({ ...base, genre: 'script' })).toContain('角色名起行、台词另起一行');
    expect(buildInspirationExpandPrompt({ ...base, genre: 'diary' })).toContain('不替作者补记忆');
    expect(buildInspirationExpandPrompt({ ...base, genre: 'poetry' })).not.toContain('小说正文的候选');
  });
});

describe('㉟ AI-5 ③：素材分析落点名词（L() 双支随 UI 语言，setLang 切侧取证 = 既有惯例）', () => {
  const ctx = { kind: 'text' as const, title: 't', sourceRaw: '', extractedText: '样本' };
  it('novel（含空/脏值）中英两句逐字在场', () => {
    try {
      setLang('zh-CN');
      for (const g of [undefined, '', 'novel', 'zzz'] as Array<string | undefined>) {
        expect(buildCaptureAnalysisMessage({ ...ctx, genre: g }), String(g)).toContain(
          '聚焦可以被小说直接使用的信息',
        );
      }
      setLang('en-US');
      for (const g of [undefined, '', 'novel', 'zzz'] as Array<string | undefined>) {
        expect(buildCaptureAnalysisMessage({ ...ctx, genre: g }), String(g)).toContain(
          'focus on information directly usable in fiction',
        );
      }
    } finally {
      setLang('zh-CN');
    }
  });
  it('四支非小说各自落点，且不再出现「被小说直接使用」', () => {
    const cases: Array<[string, string, string]> = [
      ['essay', '可以被散文直接使用', 'usable in a prose essay'],
      ['poetry', '可以被诗歌直接使用', 'usable in poetry'],
      ['script', '可以被剧本直接使用', 'usable in a play'],
      ['diary', '可以被日记直接使用', 'usable in a journal'],
    ];
    try {
      setLang('zh-CN');
      for (const [g, zhNeedle] of cases) {
        const m = buildCaptureAnalysisMessage({ ...ctx, genre: g });
        expect(m, g).toContain(zhNeedle);
        expect(m, g).not.toContain('可以被小说直接使用的信息');
      }
      setLang('en-US');
      for (const [g, , enNeedle] of cases) {
        expect(buildCaptureAnalysisMessage({ ...ctx, genre: g }), g).toContain(enNeedle);
      }
    } finally {
      setLang('zh-CN');
    }
  });
});

describe('㉟ AI-5 ④：buildChatContext 的 PromptTerms 表（块内四栏名）', () => {
  it('novel 八项 = useAiActions 改造前字面量逐字', () => {
    for (const g of ['', 'novel', 'zzz']) {
      const t = quickActionTermsFor(g);
      expect(t.currentUnitLabel, g).toBe('当前章节');
      expect(t.ctxUnitEn, g).toBe('Current chapter');
      expect(t.skeletonZh, g).toBe('全书章节骨架');
      expect(t.skeletonEn, g).toBe('Book chapter skeleton');
      expect(t.personaBlockZh, g).toBe('人物档案');
      expect(t.personaBlockEn, g).toBe('Character profiles');
      expect(t.tailBlockZh, g).toBe('当前章正文');
      expect(t.tailBlockEn, g).toBe('Current chapter text');
    }
  });
  it('诗集骨架叫「全本书作骨架」，剧本人物栏叫「角色表」，日记单位栏是当天', () => {
    expect(quickActionTermsFor('poetry').skeletonZh).toBe('全本书作骨架');
    expect(quickActionTermsFor('script').personaBlockZh).toBe('角色表');
    expect(quickActionTermsFor('diary').currentUnitLabel).toBe('当天条目');
    expect(quickActionTermsFor('diary').ctxUnitEn).toBe("Today's entry");
  });
});

describe('㉟ AI-5：四口接线与旧常量绝迹（源码锁）', () => {
  it('buildChatContext 吃 ct 表，块内不再写死小说栏名', () => {
    const f = read('src/pages/writingPage/useAiActions.ts');
    expect(f).toContain("quickActionTermsFor(activeBook?.genre ?? '')");
    expect(f).toContain('${ct.currentUnitLabel}：');
    expect(f).toContain('${ct.skeletonZh}：');
    expect(f).toContain('${ct.personaBlockZh}（前');
    expect(f).toContain('${ct.tailBlockZh}（末尾）');
    expect(f).not.toMatch(/\\n当前章节：\$\{/);
    expect(f).not.toMatch(/\\nCurrent chapter: \$\{/);
  });
  it('AiCorpusPanel 两处都吃 corpusSystemHintFor(genre)，旧常量绝迹', () => {
    const f = read('src/pages/writingPage/AiCorpusPanel.tsx');
    expect(f.match(/corpusSystemHintFor\(genre\)/g)?.length).toBe(2);
    expect(f).not.toContain('AI_CORPUS_SYSTEM_HINT');
  });
  it('InspirationExpandPanel 吃人设函数并把 genre 传进指令', () => {
    const f = read('src/pages/writingPage/InspirationExpandPanel.tsx');
    expect(f).toContain('inspirationExpandSystemHintFor(genre)');
    expect(f).not.toContain('INSPIRATION_EXPAND_SYSTEM_HINT');
  });
  it('素材两口（面板/对话框）都把 genre 递进 buildCaptureAnalysisMessage', () => {
    expect(read('src/pages/writingPage/ExternalCapturePanel.tsx')).toMatch(/genre: useWritingStore\.getState\(\)/);
    expect(read('src/pages/writingPage/ExternalCaptureDialog.tsx')).toMatch(/genre: bookId \?/);
  });
  it('四个改口文件里两个旧常量名绝迹——不留第二张嘴', () => {
    for (const f of [
      'src/utils/aiCorpusChat.ts',
      'src/utils/inspirationExpand.ts',
      'src/pages/writingPage/AiCorpusPanel.tsx',
      'src/pages/writingPage/InspirationExpandPanel.tsx',
    ]) {
      const s = read(f);
      expect(s, f).not.toMatch(/AI_CORPUS_SYSTEM_HINT|INSPIRATION_EXPAND_SYSTEM_HINT/);
    }
  });
});
