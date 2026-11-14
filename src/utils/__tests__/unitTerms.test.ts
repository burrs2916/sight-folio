// 单位名词插值的锁（⑰-1，2026-11-10）
//
// 这一刀把 6 条写作台高频文案从写死的「章节」改成 {unit}/{Unit}/{unitShort} 插值。
// 真正要守的是**两件相反的事**：小说侧必须逐字不变（历史文案零回归），
// 另外三个体裁必须立刻换口（不然改了等于没改）。
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { t, setLang } from '../../i18n';
import { unitTermParams } from '../unitTerms';
import { unitWordKey, aiChatEmptyKey } from '../writingSchema';

const KEYS = ['writing.newChapter', 'writing.chapterName', 'writing.renameChapterTitle',
  'writing.selectChapter', 'writing.deleteChapterTitle', 'writing.cmdCatChapter'] as const;

// 改造前 HEAD 的原文，逐字抄（不是插值拼的）
const NOVEL_ZH: Record<string, string> = {
  'writing.newChapter': '新建章节',
  'writing.chapterName': '章节名称',
  'writing.renameChapterTitle': '重命名章节',
  'writing.selectChapter': '选择或新建一章开始写作',
  'writing.deleteChapterTitle': '删除章节',
  'writing.cmdCatChapter': '章节',
};
const NOVEL_EN: Record<string, string> = {
  'writing.newChapter': 'New Chapter',
  'writing.chapterName': 'Chapter title',
  'writing.renameChapterTitle': 'Rename Chapter',
  'writing.selectChapter': 'Pick or create a chapter to start writing',
  'writing.deleteChapterTitle': 'Delete chapter',
  'writing.cmdCatChapter': 'Chapter',
};

describe('unitTermParams 插值', () => {
  it('小说（含未设置体裁）：六条与改造前逐字相同，中英都是', () => {
    setLang('zh-CN');
    for (const g of ['novel', '']) {
      for (const k of KEYS) expect(t(k, unitTermParams(g)), `${g}/${k}`).toBe(NOVEL_ZH[k]);
    }
    setLang('en-US');
    for (const g of ['novel', '']) {
      for (const k of KEYS) expect(t(k, unitTermParams(g)), `${g}/${k}`).toBe(NOVEL_EN[k]);
    }
  });

  it('散文 / 诗歌 / 剧本各自换口，且中文量词那句不能写成「新建一章」', () => {
    setLang('zh-CN');
    expect(t('writing.newChapter', unitTermParams('essay'))).toBe('新建篇目');
    expect(t('writing.newChapter', unitTermParams('poetry'))).toBe('新建诗作');
    expect(t('writing.newChapter', unitTermParams('script'))).toBe('新建场次');
    expect(t('writing.selectChapter', unitTermParams('essay'))).toBe('选择或新建一篇开始写作');
    expect(t('writing.selectChapter', unitTermParams('poetry'))).toBe('选择或新建一首开始写作');
    expect(t('writing.selectChapter', unitTermParams('script'))).toBe('选择或新建一场开始写作');
  });

  it('四个体裁的单位名词互不相同，且没有插值残留花括号', () => {
    setLang('zh-CN');
    const words = ['', 'essay', 'poetry', 'script'].map((g) => t(unitWordKey(g)));
    expect(new Set(words).size).toBe(4);
    for (const g of ['', 'essay', 'poetry', 'script']) {
      for (const k of KEYS) {
        const out = t(k, unitTermParams(g));
        expect(out, `${g}/${k}`).not.toMatch(/[{}]/);
        expect(out, `${g}/${k}`).not.toBe(k);
      }
    }
  });
});

describe('AI 对话空态整句按体裁（这句不能插值，必须整支换）', () => {
  afterEach(() => setLang('zh-CN'));

  it('小说那支是原句逐字（零回归）', () => {
    expect(t(aiChatEmptyKey('novel'))).toBe(
      '向 AI 提问吧：剧情走向、人物动机、伏笔安排，都可以聊。首轮消息会自动附带当前章节与人设卡摘要。',
    );
    expect(aiChatEmptyKey('')).toBe('writing.aiChatEmpty');
  });

  it('诗 / 散文 / 剧本三支各自问各自的事，且不许再出现小说专属词', () => {
    const poem = t(aiChatEmptyKey('poetry'));
    const piece = t(aiChatEmptyKey('essay'));
    const play = t(aiChatEmptyKey('script'));
    expect(new Set([poem, piece, play]).size).toBe(3);
    expect(poem).toContain('分行');
    expect(poem).toContain('诗作');
    expect(piece).toContain('立意');
    expect(play).toContain('幕场');
    for (const line of [poem, piece]) {
      expect(line).not.toContain('伏笔');
      expect(line).not.toContain('人设卡');
      expect(line).not.toContain('章节');
    }
    expect(play).not.toContain('人设卡');
  });

  it('英文侧四支都能翻出来且互不相同', () => {
    setLang('en-US');
    const four = ['', 'essay', 'poetry', 'script'].map((g) => t(aiChatEmptyKey(g)));
    expect(new Set(four).size).toBe(4);
    for (const line of four) expect(line).not.toBe('writing.aiChatEmpty');
  });
});

// ─── A6-2：手艺面板空态两句按体裁取量词（⑰-1 同机制，独立锁不动上方 KEYS）───
describe('面板空态「本章…」按体裁（A6-2）', () => {
  const PANEL_KEYS = ['writing.emotionArcEmpty', 'writing.showTellEmpty'] as const;
  // 改造前 HEAD 原文逐字抄（novel 零回归对照线）
  const NOVEL_ZH: Record<string, string> = {
    'writing.emotionArcEmpty': '本章暂无情感波动可分析',
    'writing.showTellEmpty': '本章没有需要提示的情绪直述句',
  };
  const NOVEL_EN: Record<string, string> = {
    'writing.emotionArcEmpty': 'No emotional movement to analyze in this chapter',
    'writing.showTellEmpty': 'No told emotion found in this chapter',
  };

  it('小说（含未设置体裁）：两句与改造前逐字相同，中英都是', () => {
    setLang('zh-CN');
    for (const g of ['novel', '']) {
      for (const k of PANEL_KEYS) expect(t(k, unitTermParams(g)), `${g}/${k}`).toBe(NOVEL_ZH[k]);
    }
    setLang('en-US');
    for (const g of ['novel', '']) {
      for (const k of PANEL_KEYS) expect(t(k, unitTermParams(g)), `${g}/${k}`).toBe(NOVEL_EN[k]);
    }
  });

  it('四体裁各自换口且无花括号残留（诗/剧本/日记不再说「本章」）', () => {
    setLang('zh-CN');
    for (const g of ['essay', 'poetry', 'script', 'diary']) {
      for (const k of PANEL_KEYS) {
        const out = t(k, unitTermParams(g));
        expect(out, `${g}/${k}`).not.toContain('{');
        // 四体裁量词=篇/首/场/篇，全都不该再出现「章」（diary 也是「本篇」）
        expect(out, `${g}/${k} 不该再说章`).not.toContain('章');
      }
    }
    // 诗确实说「本首」量词口径（书面但正确；见 unitClassifier.poetry=首）
    expect(t('writing.emotionArcEmpty', unitTermParams('poetry'))).toContain('首');
    expect(t('writing.showTellEmpty', unitTermParams('script'))).toContain('本场');
    setLang('en-US');
    expect(t('writing.emotionArcEmpty', unitTermParams('poetry'))).toContain('this poem');
    expect(t('writing.showTellEmpty', unitTermParams('script'))).toContain('this scene');
  });

  it('接线在位：两个面板的 empty 传入点带 unitTermParams(genre)（防改回裸 t）', () => {
    const src = readFileSync('src/pages/WritingPage.tsx', 'utf8');
    expect(src).toContain("t('writing.emotionArcEmpty', unitTermParams(genre))");
    expect(src).toContain("t('writing.showTellEmpty', unitTermParams(genre))");
  });
});
