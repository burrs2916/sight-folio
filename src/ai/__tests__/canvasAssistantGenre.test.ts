/**
 * ㉤ AI-6：画布排版助手在 prompt 组装层的锁（2026-11-10 轮 17）。
 *
 * 轮 13 交账时抓出的病灶（状态文件 §队列 AI-6）：`canvasAssistant.ts` 整体不吃体裁——
 * schema id 原样进 prompt、进度栏名与量词写死、栏题小说腔、人设写死小说工作台。
 * 这不是叫法不准：诗集作者的画布收到「你在给小说排版」，与 ㉑ 拦下的「把一出戏排成
 * 散文段落」是同一类越界。
 *
 * 锁的形状沿用轮 9-16 一族：
 *  1. **novel 逐字零回归**——空/未设体裁的成品串与改造前逐字节相同（基线四串由脚本
 *     从改前磁盘态程序化取出，见 `.tmp/r17_baseline.json`，本文件独立另存逐字）；
 *     带 `genre:'novel'` 与脏值的书**只允许那一处括号**从 schema id 变显示名（队列点名的 bug 级修复）。
 *  2. 四支各领各的词，**整串 toEqual**（不是 toContain——半接也会红，AU-7 ⑨）；
 *  3. 词必须住在现成键里：人设 zh ↔ `genreTagLabelKey`、栏题 ↔ 货架 `writing-outline` 模板名、
 *     en 量词 ↔ `volumeSummary*`、en 单位短语 ↔ `continueDesc*`，逐格反查；
 *  4. 接线源码锁：canvasAssistant.ts 里禁再出现裸体裁字面量与裸 `book.genre` 插值。
 *
 * ㉦（2026-11-10 轮 19 · AI-6′）追加两把嘴的锁：**硬性规则第 7 条的贴合清单**与**空画布报错的
 * book 级词**。轮 17 把上下文块里的【世界观设定】按页签表对四支闸了，规则句却还叫模型去贴合那一头；
 * 报错句「先生成＿＿总览」也仍焊着小说那一格 —— 同一文件里的小说腔残余，零审批。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { aiAddableTypesForGenre, applyCanvasOps, buildCanvasOpsMessage, buildCanvasWritingContext, parseCanvasOps, runCanvasAssistantTask } from '../canvasAssistant';
import { agentApi } from '../../services/tauri';
import { registerBuiltinComponents } from '../../editor/registry';
import { useWritingStore } from '../../store/writingStore';
import { useAgentStore } from '../../store/agentStore';
import { useEditorStore } from '../../store/editorStore';
import { useSceneStore } from '../../store/sceneStore';
import { getLang, setLang, t } from '../../i18n';
import { canCreateEntityForGenre, genreTagLabelKey, hiddenViewKindsForGenre, shelfFor, studioPaneHintKey, WRITING_GENRES } from '../../utils/writingSchema';
import { quickActionTermsFor } from '../quickActionPrompts';

// ── 夹具（与轮 17 取基线时的同一份数据，逐字段一致；改一个字段 = 五串基线全要重取） ──
const book = (genre: string) => ({
  id: 'b1',
  title: '长夜行',
  description: null,
  genre,
  medium: 'serial',
  status: 'writing',
  coverColor: '#222',
  dailyGoal: 0,
  extra: '',
  createdAt: 0,
  updatedAt: 0,
});
const chapter = (id: string, title: string, status: string) => ({
  id,
  bookId: 'b1',
  title,
  content: '',
  sortOrder: 0,
  wordCount: 1200,
  status,
  volume: '',
  kind: 'chapter',
  extra: '',
  createdAt: 0,
  updatedAt: 0,
});

function setup(genre: string) {
  const prev = useWritingStore.getState() as any;
  const snapshot = {
    books: prev.books,
    activeBookId: prev.activeBookId,
    chapters: prev.chapters,
    activeChapterId: prev.activeChapterId,
    settings: prev.settings,
    outlines: prev.outlines,
  };
  useWritingStore.setState((s: any) => {
    s.books = [book(genre)];
    s.activeBookId = 'b1';
    s.chapters = [chapter('ch1', '第一章 雨夜', 'completed'), chapter('ch2', '第二章 晨光', 'draft')];
    s.activeChapterId = 'ch2';
    s.settings = [
      { id: 'w1', bookId: 'b1', kind: 'worldbuilding', name: '灵潮体系', subtitle: '修行', description: '灵气复苏', extra: '' },
      { id: 'c1', bookId: 'b1', kind: 'character', name: '林越', subtitle: '主角', description: '退役侦探', extra: '' },
    ];
    s.outlines = [{ id: 'o1', bookId: 'b1', title: '追凶', summary: '林越在雨夜发现线索', chapterId: null, extra: '{}', sortOrder: 0, createdAt: 0, updatedAt: 0 }];
  });
  return snapshot;
}
function restore(snap: any) {
  useWritingStore.setState((s: any) => {
    s.books = snap.books;
    s.activeBookId = snap.activeBookId;
    s.chapters = snap.chapters;
    s.activeChapterId = snap.activeChapterId;
    s.settings = snap.settings;
    s.outlines = snap.outlines;
  });
}

// ── 改造前基线（逐字节，从改前磁盘态程序化抽取后独立另存） ──────────────────
const CTX_NO_BASE = [
  '【作品】《长夜行》 · 当前章《第二章 晨光》',
  '【全书进度】共 2 章，已完稿 1 章',
  '【人物档案】',
  '- 林越（主角）：退役侦探',
  '【大纲节拍】',
  '- 追凶：林越在雨夜发现线索',
  '【世界观设定】',
  '- 灵潮体系（修行）：灵气复苏',
].join('\n');
const CTX_NO_TAG_EN = [
  '[Book] "长夜行" · current chapter "第二章 晨光"',
  '[Progress] 2 chapters total, 1 completed',
  '[Characters]',
  '林越（主角）：退役侦探',
  '[Outline]',
  '追凶：林越在雨夜发现线索',
  '[Worldbuilding]',
  '灵潮体系（修行）：灵气复苏',
].join('\n');
const PERSONA_NOVEL_ZH = '你是小说创作工作台的画布排版助手。根据用户指令，输出一组对画布实体的结构化操作。';
const PERSONA_NOVEL_EN = "You are the canvas layout assistant of a novel-writing studio. Output a set of structured canvas operations per the user's instruction.";

// 四支的整串预期（全量 toEqual：半接也红）
const GENRE_CTX: Record<'essay' | 'poetry' | 'script' | 'diary', string> = {
  essay: [
    '【作品】《长夜行》（散文） · 当前篇《第二章 晨光》',
    '【全书进度】共 2 篇，已完稿 1 篇',
    '【人物卡】',
    '- 林越（主角）：退役侦探',
    '【构思】',
    '- 追凶：林越在雨夜发现线索',
  ].join('\n'),
  poetry: [
    '【作品】《长夜行》（诗歌） · 当前首《第二章 晨光》',
    '【全书进度】共 2 首，已完稿 1 首',
    '【人物卡】',
    '- 林越（主角）：退役侦探',
    '【意象素材】',
    '- 追凶：林越在雨夜发现线索',
  ].join('\n'),
  script: [
    '【作品】《长夜行》（剧本） · 当前场《第二章 晨光》',
    '【全剧进度】共 2 场，已完稿 1 场',
    '【角色表】',
    '- 林越（主角）：退役侦探',
    '【场次梗概】',
    '- 追凶：林越在雨夜发现线索',
  ].join('\n'),
  diary: [
    '【作品】《长夜行》（日记） · 当天条目《第二章 晨光》',
    '【全书进度】共 2 天，已完稿 1 天',
    '【人物卡】',
    '- 林越（主角）：退役侦探',
    '【当日要点】',
    '- 追凶：林越在雨夜发现线索',
  ].join('\n'),
};
const GENRE_CTX_EN: Record<'essay' | 'poetry' | 'script' | 'diary', string> = {
  essay: [
    '[Book] "长夜行" (Essay) · current piece "第二章 晨光"',
    '[Progress] 2 pieces total, 1 completed',
    '[Characters]',
    '林越（主角）：退役侦探',
    '[Outline]',
    '追凶：林越在雨夜发现线索',
  ].join('\n'),
  poetry: [
    '[Book] "长夜行" (Poetry) · current poem "第二章 晨光"',
    '[Progress] 2 poems total, 1 completed',
    '[Characters]',
    '林越（主角）：退役侦探',
    '[Outline]',
    '追凶：林越在雨夜发现线索',
  ].join('\n'),
  script: [
    '[Book] "长夜行" (Script) · current scene "第二章 晨光"',
    '[Progress] 2 scenes total, 1 completed',
    '[Characters]',
    '林越（主角）：退役侦探',
    '[Outline]',
    '追凶：林越在雨夜发现线索',
  ].join('\n'),
  diary: [
    '[Book] "长夜行" (Diary) · today\'s entry "第二章 晨光"',
    '[Progress] 2 days total, 1 completed',
    '[Characters]',
    '林越（主角）：退役侦探',
    '[Outline]',
    '追凶：林越在雨夜发现线索',
  ].join('\n'),
};

afterEach(() => {
  setLang('zh-CN');
});

describe('㉤ novel 零回归：改造前成品串逐字节在场', () => {
  it('未设体裁（空串）：上下文块与改造前逐字节相同', () => {
    const snap = setup('');
    try {
      expect(buildCanvasWritingContext()).toBe(CTX_NO_BASE);
    } finally {
      restore(snap);
    }
  });

  it('genre=novel：唯一的差异是那一枚括号从 schema id 换成显示名（队列点名的 bug 级）', () => {
    const snap = setup('novel');
    try {
      const ctx = buildCanvasWritingContext()!;
      expect(ctx).toContain('（小说）');
      expect(ctx).not.toContain('（novel）');
      expect(ctx).toBe(CTX_NO_BASE.replace('《长夜行》 ·', '《长夜行》（小说） ·'));
    } finally {
      restore(snap);
    }
  });

  it('脏体裁值（悬疑 / reportage）：与 novel 格同串，只换那一枚括号，其余逐字=改造前', () => {
    for (const g of ['悬疑', 'reportage']) {
      const snap = setup(g);
      try {
        expect(buildCanvasWritingContext()).toBe(CTX_NO_BASE.replace('《长夜行》 ·', '《长夜行》（小说） ·'));
      } finally {
        restore(snap);
      }
    }
  });

  it('人设句（含无活跃书 / 空 / novel / 脏值四种入口）zh 与 en 逐字 = 改造前', () => {
    // 无活跃书：改造前本文件不读 store，人设恒小说；改造后读不到书落 novel 格 = 同句
    const emptySnap = setup('novel');
    useWritingStore.setState((s: any) => {
      s.activeBookId = null;
    });
    try {
      expect(buildCanvasOpsMessage([], '把卡排成网格', null)).toContain(PERSONA_NOVEL_ZH);
    } finally {
      restore(emptySnap);
    }
    for (const g of ['novel', '', '悬疑']) {
      const snap = setup(g);
      try {
        expect(buildCanvasOpsMessage([], '把卡排成网格', null)).toContain(PERSONA_NOVEL_ZH);
      } finally {
        restore(snap);
      }
    }
    // 英文侧基线取自**空体裁**那本（改造前它就没有括号；带 genre 的书改造后多出的是显示名，
    // 属那一枚括号的 bug 级修复，novel 格在 zh 侧已单独钉过）
    const snap = setup('');
    try {
      setLang('en-US');
      expect(buildCanvasOpsMessage([], '把卡排成网格', null)).toContain(PERSONA_NOVEL_EN);
      expect(buildCanvasWritingContext()).toBe(CTX_NO_TAG_EN);
    } finally {
      restore(snap);
    }
  });
});

describe('㉤ 四支各领各的词（zh 整串 toEqual，半接也红）', () => {
  for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
    it(`${g}：显示名 / 单位 / 栏题 / 世界观闸全在这八行里`, () => {
      const snap = setup(g);
      try {
        expect(buildCanvasWritingContext()).toBe(GENRE_CTX[g]);
      } finally {
        restore(snap);
      }
    });
  }

  it('人设句四支各说各的载体（zh 全句逐字）', () => {
    for (const [g, noun] of [
      ['essay', '散文'],
      ['poetry', '诗歌'],
      ['script', '剧本'],
      ['diary', '日记'],
    ] as const) {
      const snap = setup(g);
      try {
        expect(buildCanvasOpsMessage([], '把卡排成网格', null)).toContain(
          `你是${noun}创作工作台的画布排版助手。根据用户指令，输出一组对画布实体的结构化操作。`,
        );
      } finally {
        restore(snap);
      }
    }
  });

  it('en 面同步：显示名、单位短语与进度量词全按支（切侧取证，finally 还 zh）', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      const snap = setup(g);
      try {
        setLang('en-US');
        expect(buildCanvasWritingContext()).toBe(GENRE_CTX_EN[g]);
        setLang('zh-CN');
      } finally {
        restore(snap);
      }
    }
    for (const [g, phrase] of [
      ['essay', 'a prose-essay studio'],
      ['poetry', 'a poetry studio'],
      ['script', 'a playwriting studio'],
      ['diary', 'a journal studio'],
    ] as const) {
      const snap = setup(g);
      try {
        setLang('en-US');
        expect(buildCanvasOpsMessage([], 'grid it', null)).toContain(
          `You are the canvas layout assistant of ${phrase}. Output a set of structured canvas operations per the user's instruction.`,
        );
      } finally {
        restore(snap);
        setLang('zh-CN');
      }
    }
  });

  it('按支禁词：剥掉作者自起书名后的成品串不许再说别支的单位', () => {
    const stripTitles = (s: string) => s.replace(/《[^》]*》/g, '《》').replace(/"[^"]*"/g, '""');
    const forbidden: Record<'essay' | 'poetry' | 'script' | 'diary', string[]> = {
      essay: ['章', '首', '幕', '场', '辑'],
      poetry: ['章', '幕', '场', '卷', '人设'],
      script: ['章', '首', '全书', '人物档案'],
      diary: ['章', '首', '幕', '场', '辑', '人设'],
    };
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      const snap = setup(g);
      try {
        const ctx = stripTitles(buildCanvasWritingContext()!);
        for (const w of forbidden[g]) {
          expect(ctx, `${g} 的画布上下文不许说「${w}」`).not.toContain(w);
        }
      } finally {
        restore(snap);
      }
    }
  });
});

describe('㉤ 词必须住在现成键里（逐格反查，不许自创）', () => {
  it('人设 zh 名 = genreTagLabelKey 五枚现成体裁键的显示值', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', 'diary']) {
      const snap = setup(g);
      try {
        expect(buildCanvasOpsMessage([], 'x', null)).toContain(`你是${t(genreTagLabelKey(g))}创作工作台的画布排版助手。`);
      } finally {
        restore(snap);
      }
    }
  });

  it('栏题 = 货架 writing-outline 模板名（四支；novel 那格是改造前画布字面「大纲节拍」，与货架名不同源是历史事实）', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary']) {
      const tpl = shelfFor(g).templates.find((x) => x.type === 'writing-outline');
      expect(tpl, `${g} 货架要有 outline 模板可对`).toBeDefined();
      expect(quickActionTermsFor(g).outlineBlockZh).toBe(t(tpl!.labelKey));
    }
    // novel 的画布栏题逐字锁在零回归基线串里（CTX_NO_BASE 第五行），不在此反查
    expect(quickActionTermsFor('novel').outlineBlockZh).toBe('大纲节拍');
  });

  it('unitTagZh 构造锁：三支=「当前」+量词，日记取现成「当天条目」（拼出「当前天」即红）', () => {
    for (const g of ['essay', 'poetry', 'script'] as const) {
      const terms = quickActionTermsFor(g);
      expect(terms.unitTagZh).toBe(`当前${terms.unitMeasure}`);
    }
    const d = quickActionTermsFor('diary');
    expect(d.unitTagZh).toBe(d.currentUnitLabel);
    expect(d.unitTagZh).not.toContain('当前');
  });

  it('progressUnitEn ⊂ volumeSummary* 英文侧；unitTagEn ⊂ continueDesc* 英文原句', () => {
    const VS: Record<string, string> = {
      essay: 'agent.writing.volumeSummaryPiece',
      poetry: 'agent.writing.volumeSummaryPoem',
      script: 'agent.writing.volumeSummaryScene',
      diary: 'agent.writing.volumeSummaryDay',
    };
    const CD: Record<string, string> = {
      essay: 'agent.welcome.continueDescPiece',
      poetry: 'agent.welcome.continueDescPoem',
      script: 'agent.welcome.continueDescScript',
      diary: 'agent.welcome.continueDescDay',
    };
    setLang('en-US');
    try {
      for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
        const terms = quickActionTermsFor(g);
        expect(t(VS[g]), `${g} 的 en 量词要能在 volumeSummary 里找到出处`).toContain(terms.progressUnitEn);
        expect(t(CD[g]), `${g} 的 en 单位短语要能在 continueDesc 里找到出处`).toContain(terms.unitTagEn);
      }
    } finally {
      setLang('zh-CN');
    }
  });
});

describe('㉤ 接线与绝迹（canvasAssistant.ts 源码锁，先剥注释防自伤 AU-7 ⑧）', () => {
  const raw = readFileSync('src/ai/canvasAssistant.ts', 'utf-8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('裸 schema-id 插值与体裁字面判断绝迹', () => {
    expect(code).not.toMatch(/\$\{\s*book\.genre\s*\}/);
    expect(code).not.toMatch(/\bgenre\s*===/);
  });

  it('小说单位与栏题的裸字面量绝迹（novel 口径全部来自 TERMS 表）', () => {
    for (const lit of ['全书进度', '当前章', '人物档案', '大纲节拍', '小说创作工作台', '章，已完稿']) {
      expect(code, `画布助手不许再自带裸字面「${lit}」`).not.toContain(lit);
    }
  });

  it('四张嘴全部接在解析器上（算了没接到行上 = AU-7 ⑨ 的形状，这里钉实在）', () => {
    for (const sym of ['quickActionTermsFor(', 'workbenchCommandSet(', 'genreTagLabelKey(', 'hiddenViewKindsForGenre(']) {
      expect(code).toContain(sym);
    }
    for (const slot of ['terms.unitTagZh', 'terms.unitTagEn', 'terms.progressLabel', 'terms.unitMeasure', 'terms.progressUnitEn', 'terms.personaBlockZh', 'terms.outlineBlockZh']) {
      expect(code, `${slot} 必须出现在实参/模板位`).toContain(slot);
    }
    expect(code).toContain('CANVAS_PERSONA_NOUN[workbenchCommandSet(');
  });

  it('世界观闸只查页签表，不许另立第二张判据', () => {
    expect(code).toContain('hiddenViewKindsForGenre(genre).includes(\'worldview\')');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ㉦ 轮 19 · AI-6′ —— 硬性规则第 7 条的「贴合对象」清单 + 空画布报错的 book 级词
// ═══════════════════════════════════════════════════════════════════════════

const RULE7_MARK = '7. 新增/改名/改文字时，内容优先贴合下方写作背景中的';
const RULE7_EN_MARK = '7. For add/rename/set_text, prefer content that fits the writing context below (';
/** novel 那格 = 改造前逐字（零回归线）：规则句用的是它自己的词，不是栏题名 */
const FIT_NOVEL_ZH = '书名、角色、世界观与大纲设定';
const FIT_NOVEL_EN = 'book title, characters, worldbuilding, outline';
/** 四支的贴合清单：词全部来自 `PromptTerms` 现成栏题，测试在此独立另存一份逐字（漂一格即红） */
const FIT_ZH: Record<'essay' | 'poetry' | 'script' | 'diary', string> = {
  essay: '书名、人物卡与构思',
  poetry: '书名、人物卡与意象素材',
  script: '书名、角色表与场次梗概',
  diary: '书名、人物卡与当日要点',
};
const FIT_EN = 'book title, characters, outline';
/** 空画布报错的 book 级词（同上：独立另存，与 overviewHint 现成首词的配对锁在 C 段） */
const BOOK_LEVEL: Record<'novel' | 'essay' | 'poetry' | 'script' | 'diary', string> = {
  novel: '全书', essay: '全书', poetry: '全诗集', script: '全剧', diary: '全本',
};

const rule7Line = (msg: string, mark = RULE7_MARK) => msg.split('\n').find((l) => l.includes(mark)) ?? '';

describe('㉦ 第 7 条的贴合清单按载体走（改造前它把小说那一格焊死在规则句里）', () => {
  it('novel / 未设体裁 / 脏值：zh 与 en 的规则句逐字 = 改造前', () => {
    for (const g of ['novel', '', '悬疑', 'reportage']) {
      const snap = setup(g);
      try {
        expect(rule7Line(buildCanvasOpsMessage([], 'x', null))).toContain(`${RULE7_MARK}${FIT_NOVEL_ZH}。`);
      } finally {
        restore(snap);
      }
    }
    const snap = setup('');
    try {
      setLang('en-US');
      expect(rule7Line(buildCanvasOpsMessage([], 'x', null), RULE7_EN_MARK)).toContain(`(${FIT_NOVEL_EN}).`);
    } finally {
      restore(snap);
      setLang('zh-CN');
    }
  });

  it('四支各领各的清单（zh 整句 toEqual 尾串，半接也红）', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      const snap = setup(g);
      try {
        const line = rule7Line(buildCanvasOpsMessage([], 'x', null));
        expect(line).toContain(`${RULE7_MARK}${FIT_ZH[g]}。`);
        expect(line, `${g} 的规则句不许再点名小说那格`).not.toContain(FIT_NOVEL_ZH);
      } finally {
        restore(snap);
      }
    }
  });

  it('en 侧只摘被裁那一头的名字：四支同串、且不再出现 worldbuilding', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      const snap = setup(g);
      try {
        setLang('en-US');
        const line = rule7Line(buildCanvasOpsMessage([], 'x', null), RULE7_EN_MARK);
        expect(line).toContain(`(${FIT_EN}).`);
        expect(line).not.toContain('worldbuilding');
      } finally {
        restore(snap);
        setLang('zh-CN');
      }
    }
  });

  it('一把尺两张嘴：规则句提不提「世界观」⇔ 上下文端不端【世界观设定】（判据反查页签表）', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', 'diary', '', '悬疑'] as const) {
      const snap = setup(g);
      try {
        const cut = hiddenViewKindsForGenre(g).includes('worldview');
        const line = rule7Line(buildCanvasOpsMessage([], 'x', null));
        const ctx = buildCanvasWritingContext() ?? '';
        expect(line.includes('世界观'), `${JSON.stringify(g)} 规则句的世界观与该支页签裁项不一致`).toBe(!cut);
        expect(ctx.includes('【世界观设定】'), `${JSON.stringify(g)} 上下文块的世界观栏与规则句分了家`).toBe(!cut);
      } finally {
        restore(snap);
      }
    }
  });

  it('规则句点名的两个栏题 = 上下文块实际端出的那两个栏题（AU-7 ⑨：说了却没端 / 端了没说都红）', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      const snap = setup(g);
      try {
        const terms = quickActionTermsFor(g);
        const line = rule7Line(buildCanvasOpsMessage([], 'x', null));
        const ctx = buildCanvasWritingContext() ?? '';
        expect(line).toContain(terms.personaBlockZh);
        expect(line).toContain(terms.outlineBlockZh);
        expect(ctx).toContain(`【${terms.personaBlockZh}】`);
        expect(ctx).toContain(`【${terms.outlineBlockZh}】`);
      } finally {
        restore(snap);
      }
    }
  });

  it('按支禁词：剧本不许领「人物档案/大纲」，合集型三支不许领「角色表/梗概」，四支一律不许领世界观', () => {
    const forbidden: Record<'essay' | 'poetry' | 'script' | 'diary', string[]> = {
      essay: ['世界观', '人物档案', '角色表', '梗概', '意象'],
      poetry: ['世界观', '人物档案', '角色表', '梗概', '构思'],
      script: ['世界观', '人物档案', '大纲', '构思', '意象'],
      diary: ['世界观', '人物档案', '角色表', '梗概', '意象'],
    };
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      const snap = setup(g);
      try {
        const line = rule7Line(buildCanvasOpsMessage([], 'x', null));
        for (const w of forbidden[g]) expect(line, `${g} 的规则句不许说「${w}」`).not.toContain(w);
      } finally {
        restore(snap);
      }
    }
  });

  it('无活跃书：读不到体裁 = 落 novel 那格（与改造前同一句，不是崩也不是空）', () => {
    const snap = setup('poetry');
    useWritingStore.setState((st: any) => { st.activeBookId = null; });
    try {
      expect(rule7Line(buildCanvasOpsMessage([], 'x', null))).toContain(`${RULE7_MARK}${FIT_NOVEL_ZH}。`);
    } finally {
      restore(snap);
    }
  });

  it('五种在册体裁全覆盖：每一支都取得到非空清单（新增体裁漏登行当场红）', () => {
    for (const g of WRITING_GENRES.map((x) => x.id)) {
      const snap = setup(g);
      try {
        const line = rule7Line(buildCanvasOpsMessage([], 'x', null));
        expect(line.length, `${g} 的规则句空了`).toBeGreaterThan((RULE7_MARK + FIT_NOVEL_ZH).length);
        expect(line).toContain('书名');
      } finally {
        restore(snap);
      }
    }
  });
});

describe('㉦ 空画布报错按支（真调用 runCanvasAssistantTask，不是源码扫）', () => {
  const seed = (genre: string) => {
    const w = useWritingStore.getState() as any;
    const a = useAgentStore.getState() as any;
    const e = useEditorStore.getState() as any;
    const prev = { w, a, e };
    useWritingStore.setState((st: any) => {
      st.books = [book(genre)];
      st.activeBookId = 'b1';
    });
    useAgentStore.setState({
      agents: [{ id: 'a1' } as never],
      isStreaming: false,
      createConversation: async () => {
        throw new Error('SENTINEL_PASSED_GATE');
      },
    } as never);
    useEditorStore.setState({ components: [] } as never);
    return prev;
  };
  const clean = (prev: any) => {
    useWritingStore.setState((st: any) => {
      st.books = prev.w.books;
      st.activeBookId = prev.w.activeBookId;
    });
    useAgentStore.setState({ agents: prev.a.agents, isStreaming: prev.a.isStreaming, createConversation: prev.a.createConversation } as never);
    useEditorStore.setState({ components: prev.e.components } as never);
  };

  it('novel / 未设 / 脏值：报错整句逐字 = 改造前', async () => {
    for (const g of ['novel', '', '悬疑']) {
      const prev = seed(g);
      try {
        await expect(runCanvasAssistantTask({ agentId: 'a1', instruction: '把卡排成网格' })).rejects.toThrowError(
          '画布是空的，先生成全书总览或插入实体',
        );
      } finally {
        clean(prev);
      }
    }
  });

  it('四支各领 overviewHint 那格专名：全诗集 / 全剧 / 全本（散文本就全书）', async () => {
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      const prev = seed(g);
      try {
        await expect(runCanvasAssistantTask({ agentId: 'a1', instruction: '把卡排成网格' })).rejects.toThrowError(
          `画布是空的，先生成${BOOK_LEVEL[g]}总览或插入实体`,
        );
      } finally {
        clean(prev);
      }
    }
  });

  it('en 侧逐字 = 改造前（那句本就不含 book 级名词，本轮一格未加）', async () => {
    const prev = seed('poetry');
    setLang('en-US');
    try {
      await expect(runCanvasAssistantTask({ agentId: 'a1', instruction: 'grid it' })).rejects.toThrowError('Canvas is empty');
    } finally {
      clean(prev);
      setLang('zh-CN');
    }
  });

  it('判据一格未动：指令含「插入」时空画布照样放行（本轮只换措辞，没改闸）', async () => {
    const prev = seed('poetry');
    try {
      await expect(runCanvasAssistantTask({ agentId: 'a1', instruction: '插入一张人物卡' })).rejects.toThrowError(
        'SENTINEL_PASSED_GATE',
      );
    } finally {
      clean(prev);
    }
  });
});

describe('㉦ 词住在现成键里 + 接线绝迹', () => {
  it('bookLevelZh = 该支 overviewHint 的首词（后接「总览」），一格不许自创', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', 'diary'] as const) {
      const hint = t(studioPaneHintKey(g, 'overview'));
      const w = quickActionTermsFor(g).bookLevelZh;
      expect(hint.startsWith(w) && hint.startsWith(`${w}总览`), `${g} 的「${w}」在 ${hint.slice(0, 12)} 里找不到出处`).toBe(true);
    }
  });

  it('四支清单里的两个人物/大纲名词必须就是 terms 现成格（不许另造第三个词）', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      const terms = quickActionTermsFor(g);
      expect(FIT_ZH[g]).toBe(`书名、${terms.personaBlockZh}与${terms.outlineBlockZh}`);
    }
  });

  it('接线：清单表吃 workbenchCommandSet，规则句与报错句都在模板插值位（AU-7 ⑨ 的形状）', () => {
    const raw = readFileSync('src/ai/canvasAssistant.ts', 'utf-8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('CANVAS_FIT_LIST[workbenchCommandSet(');
    expect(code).toContain('贴合下方写作背景中的${fit.zh}');
    expect(code).toContain('fits the writing context below (${fit.en})');
    expect(code).toContain('.bookLevelZh}总览或插入实体');
    expect(code).toContain('canvasFitListFromTerms(');
  });

  it('绝迹：小说那格只许住在表里一次；报错句不再自带 book 级词；体裁字面判断仍零', () => {
    const raw = readFileSync('src/ai/canvasAssistant.ts', 'utf-8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.split(FIT_NOVEL_ZH).length - 1).toBe(1);
    expect(code).not.toContain('先生成全书总览');
    expect(code.split('画布是空的，先生成').length - 1).toBe(1);
    expect(code).not.toMatch(/\bgenre\s*===/);
    expect(code).not.toMatch(/\$\{\s*book\.genre\s*\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ㉨ 轮 21 · AI-6″ —— AI「可新增实体」白名单按体裁裁
//
// 轮 19 在册的病灶：`AI_ADDABLE_TYPES` 是全局常量、不吃体裁。世界观这四道闸口
// （L2 页签 `SceneTabBar.tsx:245` / 现场建视图 `studioBook.ts:641` / 货架模板
// `writingSchema.ts:594` 只登 novel / 写作台「＋」`WritingPage.tsx:2789`）都关着，
// 唯独画布 AI 这一道开着：`:290/:296/:297` 逐字端给模型、`normalizeOp` 按同一枚全局表放行。
//
// 轮 19 留的**待验项本轮取证完毕**（台账规矩：不许拿注释当结论）——这张卡对被裁四支
// **并非不可见**：`editor/sceneEditor/renderers.tsx:58` 无条件映射渲染器，双击
// `canvasEntityNode.tsx:248-302` → `openWritingDesk({bookId, settingId})` →
// `WritingPage.tsx:804-808` 落 leftTab='settings'，那条列表按数据可见性护栏不裁
// （`WritingPage.tsx:2786` 原话「只关新建口；已有条目照旧列出」）。
// ⇒ 本刀定性不是「拦库里长毛的死数据」，而是⑲/⑳ 那条更根本的口径：
//   **这本书的体裁不该长出这类实体，就不该存在任何一条创建路径 —— AI 也是创建路径。**
//
// 锁的形状沿用轮 17/19 一族：① novel（含未设/脏体裁）三张嘴逐字 = 改造前全表；
// ② 四支整串等值（半接也红）；③ **真调用** `parseCanvasOps` / `runCanvasAssistantTask`
// 拿落地读数（AU-7 ⑨：源码锁拦不住「算好了没接到行上」）；④ 五张嘴同源反查页签表；
// ⑤ 接线与绝迹源码锁。
// ═══════════════════════════════════════════════════════════════════════════

/** 改造前的全局总表：小说与旧书领到的就是这四枚、这个顺序（逐字零回归基线） */
const ALL_ADD_TYPES = ['writing-character', 'writing-worldview', 'writing-outline', 'annotation-text'];
/** 被裁四支领到的：只摘掉 worldview，其余三枚顺序不变 */
const CUT_ADD_TYPES = ['writing-character', 'writing-outline', 'annotation-text'];
const WORLDVIEW_TYPE = 'writing-worldview';

const schemaLine = (msg: string) => msg.split('\n').find((l) => l.includes('"op":"add"')) ?? '';
const rule3Zh = (msg: string) => {
  const l = msg.split('\n').find((x) => x.includes('3. 新增实体的 type 只能取白名单里的值')) ?? '';
  return l.match(/（([^）]*)）/)?.[1] ?? '';
};
const rule3En = (msg: string) => {
  const l = msg.split('\n').find((x) => x.includes('3. add.type must be one of the whitelisted values')) ?? '';
  return l.match(/\(([^)]*)\)/)?.[1] ?? '';
};

describe('㉨ aiAddableTypesForGenre：小说那四枚逐字 = 改造前总表', () => {
  it('novel / 未设体裁旧书 / 脏值：四枚逐字、顺序不动（判据回落 = 改造前全放行）', () => {
    for (const g of ['novel', '', '悬疑', 'reportage']) {
      expect(aiAddableTypesForGenre(g), `${JSON.stringify(g)} 不许被裁`).toEqual(ALL_ADD_TYPES);
      expect(aiAddableTypesForGenre(g)).toContain(WORLDVIEW_TYPE);
    }
  });

  it('被裁四支：只剩三枚，worldview 一格不剩', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      expect(aiAddableTypesForGenre(g)).toEqual(CUT_ADD_TYPES);
      expect(aiAddableTypesForGenre(g)).not.toContain(WORLDVIEW_TYPE);
    }
  });

  it('五种在册体裁全覆盖 + ⊂ 总表（不许长出新 type，也不许清空）', () => {
    for (const g of WRITING_GENRES.map((x) => x.id)) {
      const list = aiAddableTypesForGenre(g);
      expect(list.length, `${g} 的白名单空了`).toBeGreaterThanOrEqual(3);
      for (const tp of list) expect(ALL_ADD_TYPES, `${g} 长出总表外的 ${tp}`).toContain(tp);
    }
  });

  it('判据只有一张嘴：裁不裁 ⇔ canCreateEntityForGenre ⇔ hiddenViewKindsForGenre', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', 'diary', '', '悬疑']) {
      const cut = hiddenViewKindsForGenre(g).includes('worldview');
      expect(canCreateEntityForGenre(g, 'worldview'), `${JSON.stringify(g)} 创建闸与页签表分了家`).toBe(!cut);
      expect(aiAddableTypesForGenre(g).includes(WORLDVIEW_TYPE), `${JSON.stringify(g)} 白名单与创建闸分了家`).toBe(!cut);
    }
  });
});

describe('㉨ prompt 三张嘴按支端白名单（改造前它把四枚全表焊死在 schema 与规则句里）', () => {
  it('novel / 未设 / 脏值：schema 行 + zh 规则句 + en 规则句逐字 = 改造前', () => {
    const ALL_ZH = 'writing-character、writing-worldview、writing-outline、annotation-text';
    for (const g of ['novel', '', '悬疑', 'reportage']) {
      const snap = setup(g);
      try {
        const msg = buildCanvasOpsMessage([], 'x', null);
        expect(schemaLine(msg)).toContain(`"type":"${ALL_ADD_TYPES.join('|')}"`);
        expect(rule3Zh(msg)).toBe(ALL_ZH);
      } finally {
        restore(snap);
      }
    }
    const snap = setup('');
    try {
      setLang('en-US');
      expect(rule3En(buildCanvasOpsMessage([], 'x', null))).toBe('writing-character, writing-worldview, writing-outline, annotation-text');
    } finally {
      restore(snap);
      setLang('zh-CN');
    }
  });

  it('四支：整条 prompt 里 writing-worldview 绝迹（schema 行与规则句一起检）', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      const snap = setup(g);
      try {
        const msg = buildCanvasOpsMessage([], 'x', null);
        expect(schemaLine(msg)).toContain(`"type":"${CUT_ADD_TYPES.join('|')}"`);
        expect(rule3Zh(msg)).toBe('writing-character、writing-outline、annotation-text');
        expect(msg, `${g} 的 prompt 还在给模型发世界观钥匙`).not.toContain(WORLDVIEW_TYPE);
      } finally {
        restore(snap);
      }
    }
  });

  it('en 面同步（切侧取证，finally 还 zh）', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      const snap = setup(g);
      try {
        setLang('en-US');
        const msg = buildCanvasOpsMessage([], 'x', null);
        expect(rule3En(msg)).toBe(CUT_ADD_TYPES.join(', '));
        expect(msg).not.toContain(WORLDVIEW_TYPE);
      } finally {
        restore(snap);
        setLang('zh-CN');
      }
    }
  });

  it('无活跃书：读不到体裁 = 落全表（改造前对任何书都发四枚，这一条不许变严）', () => {
    const snap = setup('poetry');
    useWritingStore.setState((st: any) => { st.activeBookId = null; });
    try {
      expect(schemaLine(buildCanvasOpsMessage([], 'x', null))).toContain(`"type":"${ALL_ADD_TYPES.join('|')}"`);
    } finally {
      restore(snap);
    }
  });
});

describe('㉨ 校验层真调用 parseCanvasOps（源码锁拦不住的那张嘴，按 AU-7 ⑨ 直接取落地读数）', () => {
  const reply = (types: string[]) =>
    JSON.stringify(types.map((tp, i) => ({ op: 'add', type: tp, name: `卡${i}`, x: i * 10, y: i * 20 })));

  it('诗集：worldview 那条被丢、dropped 记 1（界面「忽略 N 条无效」有数，不静默）', () => {
    const r = parseCanvasOps(reply(['writing-character', WORLDVIEW_TYPE]), 'poetry');
    expect(r.parseError).toBeNull();
    expect(r.ops.map((o: any) => o.type)).toEqual(['writing-character']);
    expect(r.dropped).toBe(1);
  });

  it('novel / 未设 / 脏值：两条照旧全通过、dropped=0（改造前行为逐字不变）', () => {
    for (const g of ['novel', '', '悬疑']) {
      const r = parseCanvasOps(reply(['writing-character', WORLDVIEW_TYPE]), g);
      expect(r.ops.map((o: any) => o.type), `${JSON.stringify(g)} 被本轮改严了`).toEqual(['writing-character', WORLDVIEW_TYPE]);
      expect(r.dropped).toBe(0);
    }
  });

  it('被裁四支不是整类 add 被砍：outline / annotation-text 仍放行', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      const r = parseCanvasOps(reply(['writing-outline', 'annotation-text']), g);
      expect(r.ops).toHaveLength(2);
      expect(r.dropped).toBe(0);
    }
  });

  it('非 add 类 op 一律不受本轮影响（move/remove 不吃白名单）', () => {
    const r = parseCanvasOps(
      JSON.stringify([
        { op: 'move', id: 'c1', x: 1, y: 2 },
        { op: 'remove', id: 'c2' },
        { op: 'add', type: WORLDVIEW_TYPE, name: '灵潮', x: 3, y: 4 },
      ]),
      'poetry',
    );
    expect(r.ops.map((o: any) => o.op)).toEqual(['move', 'remove']);
    expect(r.dropped).toBe(1);
  });
});

describe('㉨ 真链路 runCanvasAssistantTask：发出去的白名单与实际放行的白名单是同一本书', () => {
  const REPLY = JSON.stringify([
    { op: 'add', type: 'writing-character', name: '林越', x: 10, y: 10 },
    { op: 'add', type: WORLDVIEW_TYPE, name: '灵潮体系', x: 10, y: 200 },
  ]);
  function seedRun(genre: string) {
    const w = useWritingStore.getState() as any;
    const a = useAgentStore.getState() as any;
    const e = useEditorStore.getState() as any;
    const prev = {
      books: w.books, activeBookId: w.activeBookId,
      agents: a.agents, isStreaming: a.isStreaming, createConversation: a.createConversation, sendMessage: a.sendMessage,
      components: e.components,
    };
    const sent: string[] = [];
    useWritingStore.setState((st: any) => { st.books = [book(genre)]; st.activeBookId = 'b1'; });
    useEditorStore.setState({
      components: [{ id: 'c1', type: 'annotation-text', name: '便签', transform: { x: 0, y: 0, width: 120, height: 60, rotation: 0, scale: 1 }, layerId: 'l1', zIndex: 0, locked: false, visible: true, config: {} }],
    } as never);
    useAgentStore.setState({
      agents: [{ id: 'a1' } as never],
      isStreaming: false,
      createConversation: async () => ({ id: 'conv1' }),
      sendMessage: async (_id: string, msg: string) => { sent.push(msg); },
    } as never);
    const spy = vi.spyOn(agentApi, 'listMessages').mockResolvedValue([{ role: 'assistant', content: REPLY } as never]);
    return { prev, sent, spy };
  }
  function cleanRun(prev: any, spy: any) {
    spy.mockRestore();
    useWritingStore.setState((st: any) => { st.books = prev.books; st.activeBookId = prev.activeBookId; });
    useAgentStore.setState({ agents: prev.agents, isStreaming: prev.isStreaming, createConversation: prev.createConversation, sendMessage: prev.sendMessage } as never);
    useEditorStore.setState({ components: prev.components } as never);
  }

  it('诗集：模型硬造的那张世界观卡进不了 ops，dropped=1', async () => {
    const { prev, sent, spy } = seedRun('poetry');
    try {
      const res = await runCanvasAssistantTask({ agentId: 'a1', instruction: '把主要设定铺几张卡' });
      expect(res.ops.map((o: any) => o.type)).toEqual(['writing-character']);
      expect(res.dropped).toBe(1);
      // 同一次调用发出去的那条 prompt 也没端 worldview（一张嘴两端）
      expect(sent).toHaveLength(1);
      expect(sent[0]).not.toContain(WORLDVIEW_TYPE);
    } finally {
      cleanRun(prev, spy);
    }
  });

  it('小说：两条都在、dropped=0，prompt 仍端全表（改造前逐字）', async () => {
    const { prev, sent, spy } = seedRun('novel');
    try {
      const res = await runCanvasAssistantTask({ agentId: 'a1', instruction: '把主要设定铺几张卡' });
      expect(res.ops.map((o: any) => o.type)).toEqual(['writing-character', WORLDVIEW_TYPE]);
      expect(res.dropped).toBe(0);
      expect(sent[0]).toContain(`"type":"${ALL_ADD_TYPES.join('|')}"`);
    } finally {
      cleanRun(prev, spy);
    }
  });

  it('未设体裁旧书：与小说同读数（回落线不许本轮收紧）', async () => {
    const { prev, spy } = seedRun('');
    try {
      const res = await runCanvasAssistantTask({ agentId: 'a1', instruction: '铺卡' });
      expect(res.ops).toHaveLength(2);
      expect(res.dropped).toBe(0);
    } finally {
      cleanRun(prev, spy);
    }
  });
});

describe('㉨ 接线与绝迹（canvasAssistant.ts 源码锁，先剥注释防自伤 AU-7 ⑧）', () => {
  const raw = readFileSync('src/ai/canvasAssistant.ts', 'utf-8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('全局总表不再直接进任何一张嘴：三张嘴一律吃按支的 addable', () => {
    expect(code).not.toMatch(/AI_ADDABLE_TYPES\.join\(/);
    expect(code.split('addable.join(').length - 1).toBe(3);
    expect(code).toContain('const addable = aiAddableTypesForGenre(activeBookGenre());');
  });

  it('校验层签名翻面 + 实参接线（漏传体裁要编译不过）', () => {
    expect(code).toMatch(/function normalizeOp\(raw: unknown, addableTypes: readonly string\[\]\)/);
    expect(code).toContain('if (!addableTypes.includes(type)) return null;');
    expect(code).toContain('normalizeOp(raw, addableTypes)');
    expect(code).toMatch(/export function parseCanvasOps\(\s*reply: string,\s*genre: string,\s*\)/);
    expect(code).toContain('const addableTypes = aiAddableTypesForGenre(genre);');
    expect(code).toContain('parseCanvasOps(lastAssistant.content, activeBookGenre())');
  });

  it('总表四枚未削：世界观还在总表里（小说侧那把钥匙没被折断）', () => {
    expect(code).toContain("export const AI_ADDABLE_TYPES = ['writing-character', 'writing-worldview', 'writing-outline', 'annotation-text'] as const;");
    expect(code.split(WORLDVIEW_TYPE).length - 1).toBe(3); // 总表 + 映射表 + primaryTextKey
  });

  it('判据零新表：只准调 canCreateEntityForGenre；体裁字面判断绝迹', () => {
    expect(code).toContain("'writing-worldview': 'worldview',");
    expect(code).toContain('canCreateEntityForGenre(genre, gated)');
    expect(code).not.toMatch(/\bgenre\s*===/);
    expect(code).not.toMatch(/\$\{\s*book\.genre\s*\}/);
  });
});

// ═══ ㉩ AI-6‴（2026-11-10 轮 22）：applyCanvasOps 动作本体自锁（第二层）═══════════
// 病灶（状态文件 §队列 AI-6‴，轮 21 交账时抓出）：轮 21 把 add 白名单按体裁裁到**解析层**后，
// 应用层的 `case 'add'` 只剩「type 未注册 → addComponent 返回 null」这一道挡乱码的闸，而
// writing-worldview 是注册过的类型——这道闸只剩一层。本仓双层口径的原文在
// `InspirationPanels.tsx:296`：「双层：UI 藏口 + 动作本体自锁（这个动作以后被别人复用时，不会绕过口径）」。
//
// 取证结论（轮 22 实测，不拿注释当结论）：弹窗为模态 Dialog（`CanvasAiDialog.tsx:139`），指针路径的
// 切书被 backdrop 挡住；但 ① `activeBookId` 与画布场景不同步（切场景无代码写 setActiveBook），
// ② 全局 Cmd+Shift+P 命令面板浮在弹窗之上（`SceneEditorPage.tsx:531-541` 的 keydown 监听不看
// `canvasAiOpen`），其 `openWriting` 动作写 `setActiveBook`（`:881`）⇒ **预览到应用之间换书可达**。
//
// 锁的形状：① 诗集真调用 `applyCanvasOps`——手搓进来的 worldview add 必须被 skip（绕过解析层也拦）；
// ② 被裁支其余三枚 add 照旧（自锁不砍整类）；非 add op 不受闸；③ novel/空/脏 = 改造前逐字；
// ④ **换书仿真**：小说 parse 产出的 ops 在应用那一刻撞上诗集 → 只丢那张世界观卡；
// ⑤ 两层一张嘴（应用层与解析层吃同一枚 `aiAddableTypesForGenre(genre)`，源码计数钉死）；
// ⑥ 唯一生产调用方吃默认实参 = 应用那一刻现读体裁。
// ═════════════════════════════════════════════════════════════════════════════

describe('㉩ applyCanvasOps 动作本体自锁（第二层）：add 按应用那一刻的体裁复查', () => {
  const registered = registerBuiltinComponents();
  void registered;

  function seedCanvas(genre: string) {
    const w = setup(genre);
    const e = useEditorStore.getState() as any;
    const prevComponents = e.components;
    e.clearScene();
    return { w, prevComponents };
  }
  function cleanCanvas(seed: { w: any; prevComponents: any }) {
    useEditorStore.setState({ components: seed.prevComponents } as never);
    restore(seed.w);
  }

  it('诗集：手搓的 worldview add 在动作层被 skip，画布不落那张卡', () => {
    const seed = seedCanvas('poetry');
    try {
      const { applied, skipped } = applyCanvasOps([
        { op: 'add', type: WORLDVIEW_TYPE, name: '灵潮体系', x: 10, y: 10, text: '灵气复苏' },
      ]);
      expect(applied).toBe(0);
      expect(skipped).toBe(1);
      expect(useEditorStore.getState().components.some((c) => c.type === WORLDVIEW_TYPE)).toBe(false);
    } finally {
      cleanCanvas(seed);
    }
  });

  it('诗集：其余三枚 add 照旧合法（自锁不砍整类）', () => {
    const seed = seedCanvas('poetry');
    try {
      const { applied, skipped } = applyCanvasOps([
        { op: 'add', type: 'writing-character', name: '林越', x: 0, y: 0 },
        { op: 'add', type: 'writing-outline', name: '追凶', x: 100, y: 0 },
        { op: 'add', type: 'annotation-text', name: '便签', x: 200, y: 0 },
      ]);
      expect(applied).toBe(3);
      expect(skipped).toBe(0);
    } finally {
      cleanCanvas(seed);
    }
  });

  it('诗集：非 add 类 op 不受白名单闸（rename/move/remove 旧卡照旧）', () => {
    const seed = seedCanvas('poetry');
    try {
      const ed = useEditorStore.getState() as any;
      const cid = ed.addComponent('writing-character', undefined, { x: 0, y: 0 })!.id;
      const { applied, skipped } = applyCanvasOps([
        { op: 'rename', id: cid, name: '林越·改' },
        { op: 'move', id: cid, x: 40, y: 60 },
        { op: 'remove', id: cid },
      ]);
      expect(applied).toBe(3);
      expect(skipped).toBe(0);
    } finally {
      cleanCanvas(seed);
    }
  });

  it('小说 / 未设体裁旧书 / 脏值：add worldview = 改造前（零回归，含主字段落 name）', () => {
    for (const g of ['novel', '', '悬疑']) {
      const seed = seedCanvas(g);
      try {
        const { applied, skipped } = applyCanvasOps([
          { op: 'add', type: WORLDVIEW_TYPE, name: '灵潮体系', x: 10, y: 10, text: '灵气复苏的修行世界观' },
        ]);
        expect(applied, `${JSON.stringify(g)} 被误裁`).toBe(1);
        expect(skipped).toBe(0);
        const c = useEditorStore.getState().components.find((x) => x.name === '灵潮体系');
        expect(c).toBeDefined();
        expect((c!.config as Record<string, unknown>).name).toBe('灵气复苏的修行世界观');
      } finally {
        cleanCanvas(seed);
      }
    }
  });

  it('换书仿真（取证的那条可达路）：小说 parse 的 ops，应用一刻书换成诗集 → 只丢世界观卡，人物卡照落', () => {
    const seed = seedCanvas('novel');
    try {
      const reply = JSON.stringify([
        { op: 'add', type: 'writing-character', name: '林越', x: 10, y: 10 },
        { op: 'add', type: WORLDVIEW_TYPE, name: '灵潮体系', x: 10, y: 200 },
      ]);
      const { ops, dropped } = parseCanvasOps(reply, 'novel');
      expect(dropped).toBe(0); // 小说口径下两条都进了预览
      expect(ops).toHaveLength(2);
      // 预览之后、点「应用到画布」之前，命令面板 openWriting 把活跃书换成了这本诗集
      useWritingStore.setState((s: any) => {
        s.books = [book('poetry')];
      });
      const { applied, skipped } = applyCanvasOps(ops); // 不传 genre = 吃应用那一刻的现读书
      expect(applied).toBe(1);
      expect(skipped).toBe(1);
      const types = useEditorStore.getState().components.map((c) => c.type);
      expect(types).toContain('writing-character');
      expect(types).not.toContain(WORLDVIEW_TYPE);
    } finally {
      cleanCanvas(seed);
    }
  });
});

describe('㉩ 接线与绝迹：应用层第二层（源码锁，先剥注释防自伤 AU-7 ⑧）', () => {
  const raw = readFileSync('src/ai/canvasAssistant.ts', 'utf-8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('applyCanvasOps 签名翻面 + add 复查行在位', () => {
    expect(code).toMatch(/export function applyCanvasOps\(ops: CanvasAiOp\[\], genre: string = activeBookGenre\(\)\)/);
    expect(code).toContain('if (!addableTypes.includes(op.type))');
  });

  it('两层一张嘴：`aiAddableTypesForGenre(genre)` 全文件只许解析层与应用层两枚', () => {
    expect(code.split('const addableTypes = aiAddableTypesForGenre(genre);').length - 1).toBe(2);
  });

  it('唯一生产调用方吃默认实参（应用那一刻现读体裁，不是生成那一刻的旧书）', () => {
    const dialog = readFileSync('src/editor/panels/CanvasAiDialog.tsx', 'utf-8');
    expect(dialog).toContain('applyCanvasOps(ops);');
  });
});

// ═══ ㉪ AI-6⁗（2026-11-10 轮 23）：画布助手**认书** = 场景根优先 ═══════════════
// 病灶（状态文件 §队列 AI-6⁗ · 轮 22 取证时抓出）：`activeBookGenre()` 过去吃
// `writingStore.activeBookId`（写作台最后碰的那本书），而**画布场景**的书住在
// `scene.projectRoot`（`writing://{bookId}/`）。轮 23 取证（实测，不拿轮 22 的注释当结论）：
//   ① 画布切书 = `SceneTabBar.handleBookSwitch:332` → `openBookInStudio`（`utils/studioBook.ts:55-93`），
//      整条只切场景 + 接 projectStore，**不写 `setActiveBook`**（写点在 `createBookNamed:115`，
//      不在 openBookInStudio 里）——轮 22 记的「全仓只有五处写点、没有一处是换场景」是带
//      `include` 过滤的漏读（AU-7 ⑦ 同族第五例）。
//   ② 渲染层另有六处写点（WritingDocsRenderer:86 / WritingStudioPane:110 / WritingDesignView:51 /
//      WritingChapterEditor:182 / WritingTreeTab:138 / WritingInspectorPanel:1492），但每一处都要
//      **那张卡恰好挂在当前视图**才把活跃书扳到场景书——当前视图是纯画布/统计板时不扳。
//   ③ `writingStore` 无持久化 → 重启直达书场景那一刻 `activeBookId` 仍是初始 `null`（`:395`），
//      体裁落 `''` = 全表白名单，诗集画布此刻连「不能建世界观卡」这道闸都没有。
// ⇒ 越界成立且可达；轮 22 那一刀只把**应用那一刻**扳到新书，**生成那一刻**仍端旧书。
//
// 落刀 = 队列**换源案**（零审批）：`canvasBookId()` 现取场景根，复用现成解析器
// `parseBookIdFromScene()`（`utils/studioBook.ts:421`，画布取色 `SceneEditorPage.tsx:458` 早已在吃），
// 非书场景回落活跃书 = 改造前行为；判据链（`*ForGenre` / `workbenchCommandSet`）一字未动。
// 另一案（换场景时接线 setActiveBook）会把写作台一起扳到 B 书 = 产品口径 → **P13 待拍板**。
//
// 锁的形状：① 三张嘴 + 语境块 + 两层闸全换成场景书，小说那一格**整串绝迹**（防 AU-7 ⑨ 半接）；
// ② 无场景 / 非书场景 / 同书 = 改造前逐字（零回归线，全仓既有 307 套的读数靠这几条守）；
// ③ 语境宁缺不错：另一端书的章数 / 人名 / 大纲 / 世界观全绝迹；
// ④ 真链路 + 真调用各验一次**反向换书**（轮 22 只验了「应用时撞上新书」这一向）。
// ══════════════════════════════════════════════════════════════════════════════

describe('㉪ 认书换源：场景根赢过活跃书（诗集画布不端小说语境）', () => {
  const SNAP = [
    { id: 'c1', type: 'annotation-text', name: '便签', text: '', x: 0, y: 0, width: 120, height: 60 },
  ];
  const POETRY_ADD_TYPES = ['writing-character', 'writing-outline', 'annotation-text'];

  /** A《长夜行》= 活跃书（默认小说）；B《海上有风》= 诗歌（场景书）。章/人物/大纲/世界观夹具全挂在 A 名下。 */
  function pair(activeBookId: string, sceneRoot: string | null, activeGenre = 'novel') {
    const w = setup(activeGenre) as any;
    const s = useSceneStore.getState() as any;
    const prevScene = { scenes: s.scenes, activeSceneId: s.activeSceneId };
    const prevLang = getLang();
    setLang('zh-CN');
    useWritingStore.setState((st: any) => {
      st.books = [book(activeGenre), { ...book('poetry'), id: 'b2', title: '海上有风' }];
      st.activeBookId = activeBookId;
    });
    useSceneStore.setState({
      scenes: sceneRoot ? [{ id: 'sc1', name: '画布场景', projectRoot: sceneRoot } as never] : [],
      activeSceneId: sceneRoot ? 'sc1' : null,
    } as never);
    return { w, prevScene, prevLang };
  }
  function unpair(h: { w: any; prevScene: any; prevLang: any }) {
    useSceneStore.setState({ scenes: h.prevScene.scenes, activeSceneId: h.prevScene.activeSceneId } as never);
    setLang(h.prevLang);
    restore(h.w);
  }

  it('诗集画布 + 活跃书仍是小说：人设 / 贴合清单 / schema 白名单三张嘴全换成 B', () => {
    const h = pair('b1', 'writing://b2/');
    try {
      const msg = buildCanvasOpsMessage(SNAP as never, '把主要设定铺几张卡', null);
      expect(msg).toContain('诗歌创作工作台');
      expect(msg).toContain(FIT_ZH.poetry);
      expect(msg).toContain(`"type":"${POETRY_ADD_TYPES.join('|')}"`);
      expect(msg).not.toContain(PERSONA_NOVEL_ZH);
      expect(msg).not.toContain(FIT_NOVEL_ZH);
      expect(msg).not.toContain(WORLDVIEW_TYPE);
    } finally {
      unpair(h);
    }
  });

  it('同一本书（活跃 = 场景）：小说三张嘴逐字 = 改造前（零回归线）', () => {
    const h = pair('b1', 'writing://b1/');
    try {
      const msg = buildCanvasOpsMessage(SNAP as never, '把主要设定铺几张卡', null);
      expect(msg).toContain(PERSONA_NOVEL_ZH);
      expect(msg).toContain(FIT_NOVEL_ZH);
      expect(msg).toContain(`"type":"${ALL_ADD_TYPES.join('|')}"`);
    } finally {
      unpair(h);
    }
  });

  it('非书场景（根不是 writing://）：回落活跃书 = 改造前（未设体裁旧书语境块逐字节）', () => {
    const h = pair('b1', '/Users/me/plain-project', '');
    try {
      expect(buildCanvasOpsMessage(SNAP as never, '铺卡', null)).toContain(PERSONA_NOVEL_ZH);
      expect(buildCanvasWritingContext()).toBe(CTX_NO_BASE);
    } finally {
      unpair(h);
    }
  });

  it('无场景（重启前 / 既有测试态）：回落活跃书 —— 全仓 307 套的读数由这条守着', () => {
    const h = pair('b1', null, '');
    try {
      expect(buildCanvasOpsMessage(SNAP as never, '铺卡', null)).toContain(PERSONA_NOVEL_ZH);
      expect(buildCanvasWritingContext()).toBe(CTX_NO_BASE);
    } finally {
      unpair(h);
    }
  });

  it('场景书不在书目里（未装载 / 脏 id）：宁缺不错，认不到书就不端语境', () => {
    const h = pair('b1', 'writing://ghost/');
    try {
      expect(buildCanvasWritingContext()).toBeNull();
    } finally {
      unpair(h);
    }
  });

  it('两本都是小说也要宁缺不错：世界观/人物段吃的必须是场景书那份 settings（与页签闸无关）', () => {
    // 这一条专防「门只挡住了被裁支」：换源后世界观段的门若被摘掉，诗集那一向仍有
    // hiddenViewKindsForGenre 兜着、报不出红，只有**同为小说的两本之间换书**才抓得住。
    const w = setup('novel') as any;
    const s = useSceneStore.getState() as any;
    const prevScene = { scenes: s.scenes, activeSceneId: s.activeSceneId };
    const prevLang = getLang();
    setLang('zh-CN');
    useWritingStore.setState((st: any) => {
      st.books = [book('novel'), { ...book('novel'), id: 'b9', title: '北风' }];
      st.activeBookId = 'b1';
    });
    useSceneStore.setState({
      scenes: [{ id: 'sc9', name: '画布场景', projectRoot: 'writing://b9/' } as never],
      activeSceneId: 'sc9',
    } as never);
    try {
      const ctx = buildCanvasWritingContext();
      expect(ctx).toBe('【作品】《北风》（小说）');
      for (const leaked of ['长夜行', '灵潮体系', '林越', '追凶', '共 2 章', '第二章 晨光']) {
        expect(ctx, `A 书泄漏：${leaked}`).not.toContain(leaked);
      }
    } finally {
      useSceneStore.setState({ scenes: prevScene.scenes, activeSceneId: prevScene.activeSceneId } as never);
      setLang(prevLang);
      restore(w);
    }
  });

  it('语境块宁缺不错：场景 = B 而集合属于 A 时只端 B 的作品行，A 的章数/人名/大纲/世界观全绝迹', () => {
    const h = pair('b1', 'writing://b2/');
    try {
      const ctx = buildCanvasWritingContext();
      expect(ctx).toBe('【作品】《海上有风》（诗歌）');
      for (const leaked of ['长夜行', '全书进度', '共 2', '第二章 晨光', '林越', '追凶', '灵潮体系']) {
        expect(ctx, `A 书泄漏：${leaked}`).not.toContain(leaked);
      }
    } finally {
      unpair(h);
    }
  });

  it('真链路（生成那一刻）· 反向换书：发出去的 prompt 认 B，模型硬造的世界观卡 dropped=1', async () => {
    registerBuiltinComponents();
    const h = pair('b1', 'writing://b2/');
    const a = useAgentStore.getState() as any;
    const e = useEditorStore.getState() as any;
    const prev = {
      agents: a.agents,
      isStreaming: a.isStreaming,
      createConversation: a.createConversation,
      sendMessage: a.sendMessage,
      components: e.components,
    };
    const sent: string[] = [];
    useEditorStore.setState({
      components: [
        {
          id: 'c1',
          type: 'annotation-text',
          name: '便签',
          transform: { x: 0, y: 0, width: 120, height: 60, rotation: 0, scale: 1 },
          layerId: 'l1',
          zIndex: 0,
          locked: false,
          visible: true,
          config: {},
        },
      ],
    } as never);
    useAgentStore.setState({
      agents: [{ id: 'a1' } as never],
      isStreaming: false,
      createConversation: async () => ({ id: 'conv1' }),
      sendMessage: async (_id: string, msg: string) => {
        sent.push(msg);
      },
    } as never);
    const spy = vi.spyOn(agentApi, 'listMessages').mockResolvedValue([
      {
        role: 'assistant',
        content: JSON.stringify([
          { op: 'add', type: 'writing-character', name: '林越', x: 10, y: 10 },
          { op: 'add', type: WORLDVIEW_TYPE, name: '灵潮体系', x: 10, y: 200 },
        ]),
      } as never,
    ] as never);
    try {
      const res = await runCanvasAssistantTask({ agentId: 'a1', instruction: '把主要设定铺几张卡' });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain('诗歌创作工作台');
      expect(sent[0]).toContain('海上有风');
      expect(sent[0]).not.toContain('长夜行');
      expect(sent[0]).not.toContain(WORLDVIEW_TYPE);
      expect(res.ops.map((o: any) => o.type)).toEqual(['writing-character']);
      expect(res.dropped).toBe(1);
    } finally {
      spy.mockRestore();
      useAgentStore.setState(
        { agents: prev.agents, isStreaming: prev.isStreaming, createConversation: prev.createConversation, sendMessage: prev.sendMessage } as never,
      );
      useEditorStore.setState({ components: prev.components } as never);
      unpair(h);
    }
  });

  it('动作本体自锁 · 反向换书：B（诗集）画布 + 活跃书 A（小说）的 worldview add 被 skip', () => {
    registerBuiltinComponents();
    const h = pair('b1', 'writing://b2/');
    const e = useEditorStore.getState() as any;
    const prevComponents = e.components;
    e.clearScene();
    try {
      const { applied, skipped } = applyCanvasOps([
        { op: 'add', type: WORLDVIEW_TYPE, name: '灵潮体系', x: 10, y: 10, text: '灵气复苏' },
      ]);
      expect(applied).toBe(0);
      expect(skipped).toBe(1);
      expect(useEditorStore.getState().components.some((c) => c.type === WORLDVIEW_TYPE)).toBe(false);
    } finally {
      useEditorStore.setState({ components: prevComponents } as never);
      unpair(h);
    }
  });
});

describe('㉪ 接线与绝迹：认书只有一个源（源码锁，先剥注释防自伤 AU-7 ⑧）', () => {
  const raw = readFileSync('src/ai/canvasAssistant.ts', 'utf-8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('canvasBookId 现取场景根（复用现成解析器，不另立第二份认书口径）', () => {
    expect(code).toMatch(
      /function canvasBookId\(\): string \{\s*return parseBookIdFromScene\(\) \|\| useWritingStore\.getState\(\)\.activeBookId \|\| '';/,
    );
  });

  it('旧认书口径绝迹：全文件不得再用「活跃书」找书（换源不许半接）', () => {
    expect(code).not.toContain('b.id === ws.activeBookId');
  });

  it('buildCanvasWritingContext 认书走 canvasBookId，且集合门早于每一处集合读取', () => {
    const fn = code.slice(code.indexOf('export function buildCanvasWritingContext'));
    const gate = 'const collectionsMatchScene = ws.activeBookId === book.id;';
    expect(fn).toContain('canvasBookId()');
    const gateAt = fn.indexOf(gate);
    expect(gateAt, '门本身不在位').toBeGreaterThan(-1);
    for (const read of ['ws.chapters.find', 'ws.settings', 'ws.outlines', 'ws.chapters.filter', 'ws.chapters.length']) {
      expect(fn.indexOf(read, gateAt), `${read} 未落在门后`).toBeGreaterThan(-1);
    }
  });

  it('门在位且真被消费：collectionsMatchScene 全文件恰好七枚（定义 + 六处消费）', () => {
    expect(code.split('collectionsMatchScene').length - 1).toBe(7);
  });
});
