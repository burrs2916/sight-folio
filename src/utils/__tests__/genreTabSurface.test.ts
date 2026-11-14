/**
 * ㉚ T-A + T-E 措辞刀的接线与词表锁（2026-11-10 轮 5）。
 *
 * 这一刀的形状和 ㉙ 一模一样：**机制早就有，消费层没接**。
 * `surfaceKeyForGenre` 从 ㉓-1 起就在按体裁换词，`collectionPaneKeys` 的注释甚至写死了
 * 「免得设计卡叫诗作、大纲页签叫篇目」——可 L2 页签、载体卡副标、「章详情」这三处
 * 一直绕过它们直接 `t(硬键)`。所以这里的锁分三层，缺一条就可能重演「定义 100% / 运行时 20%」：
 *   ① 纯函数层：`viewKindLabelKey` 的覆盖与回落（回落 = 小说逐字不动的机制保证）；
 *   ② 接线层：七个调用点真的在调这两个函数，旧裸键在全仓绝迹；
 *   ③ 词表层：新键双语齐备、各说各话，且不留有译文没用户的孤儿键。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import {
  WRITING_GENRES,
  surfaceKeyForGenre,
  surfaceDefaultKey,
  viewKindLabelKey,
  type SurfaceSlot,
} from '../writingSchema';
import { t, setLang } from '../../i18n';

const zhJson = JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf-8'));
const enJson = JSON.parse(readFileSync('src/i18n/en-US.json', 'utf-8'));
const cjk = /[\u4e00-\u9fff]/;

/** 11 枚 L2 固定视图（与 `SceneTabBar.KIND_TABS` 同一清单，顺序一致） */
const ALL_KINDS = [
  'catalog', 'characters', 'worldview', 'timeline', 'storylines', 'foreshadowing',
  'inspiration', 'proofread', 'stats', 'overview', 'writing',
];
/** 只有这两枚随体裁改名（其余九枚是功能名，五种载体都这么叫） */
const GENRE_NAMED = ['catalog', 'characters'];

/** 本轮新登记的槽位（paneHint 是旧槽位、新覆盖） */
const NEW_SLOTS: SurfaceSlot[] = ['tabCatalog', 'tabCharacters', 'unitDetail', 'designHint', 'paneHint', 'paneLabel'];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return ['__tests__', '__bench__', 'node_modules'].includes(e.name) ? [] : walk(p);
    return p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : [];
  });

describe('㉚ viewKindLabelKey · 覆盖与回落', () => {
  it('小说 / 空 / 脏体裁 × 11 枚全部回落原键（小说页签一个字节都不能变）', () => {
    for (const genre of ['novel', '', 'diaryy', 'Novel']) {
      for (const kind of ALL_KINDS) {
        expect(viewKindLabelKey(genre, kind), `${genre || '(空)'} / ${kind}`)
          .toBe(`writing.viewKind.${kind}`);
      }
    }
  });

  it('散文/诗/剧本/日记：只有 catalog 与 characters 换词，其余九枚照旧', () => {
    for (const genre of ['essay', 'poetry', 'script', 'diary']) {
      for (const kind of ALL_KINDS) {
        const key = viewKindLabelKey(genre, kind);
        if (GENRE_NAMED.includes(kind)) {
          expect(key, `${genre} / ${kind}`).toBe(`writing.${genre}.tab${kind === 'catalog' ? 'Catalog' : 'Characters'}`);
        } else {
          expect(key, `${genre} / ${kind} 不该被改名`).toBe(`writing.viewKind.${kind}`);
        }
      }
    }
  });

  it('页签与「大纲 pane 栏头」不许同名异词：同一屏只看得到一种叫法', () => {
    // 这条断言在轮 5 当场抓出一次真分叉：页签改成「篇目」后，`WritingStudioPane` 的栏头
    // 仍吃 `paneLabel` 的回落键「大纲」—— 于是补登 essay/poetry/script 的 paneLabel 覆盖。
    // 比的是**渲染出来的句子**而不是键名：键可以各是各的（diary 就是两句不同的话），
    // 用户看到的是句子。
    setLang('zh-CN');
    for (const genre of ['novel', '', 'essay', 'poetry', 'script']) {
      expect(t(viewKindLabelKey(genre, 'catalog')), `genre=${genre || '(空)'}`)
        .toBe(t(surfaceKeyForGenre(genre, 'paneLabel')));
    }
    // 日记刻意的两句：页签=条目（一栏一行），栏头=年月 › 天（那一栏先按年与月归档）。
    // 写死在这儿，免得下一轮"顺手统一"把归档语义抹平。
    expect(viewKindLabelKey('diary', 'catalog')).toBe('writing.diary.tabCatalog');
    expect(surfaceKeyForGenre('diary', 'paneLabel')).toBe('writing.diary.paneLabel');
    expect(t(surfaceKeyForGenre('diary', 'paneLabel'))).toContain('年月');
  });
});

describe('㉚ 词表层 · 新键双语齐备且各说各话', () => {
  afterEach(() => setLang('zh-CN'));

  it('writing.{diary,essay,poetry,script} 的新键在中英两份里一一对应（禁只加中文）', () => {
    for (const genre of ['diary', 'essay', 'poetry', 'script']) {
      for (const slot of NEW_SLOTS) {
        const zhLeaf = zhJson.writing[genre]?.[slot];
        const enLeaf = enJson.writing[genre]?.[slot];
        expect(typeof zhLeaf, `zh 缺 writing.${genre}.${slot}`).toBe('string');
        expect(typeof enLeaf, `en 缺 writing.${genre}.${slot}`).toBe('string');
        expect(zhLeaf, `${genre}.${slot} 中文侧不许是英文`).toMatch(cjk);
        expect(enLeaf, `${genre}.${slot} 英文侧不许夹汉字`).not.toMatch(cjk);
        // 表里登记的每一条都必须真的解析到自己的键（拼错一个字母就印裸 key）
        expect(surfaceKeyForGenre(genre, slot), `${genre}.${slot} 没登记进覆盖表`).toBe(`writing.${genre}.${slot}`);
      }
    }
  });

  it('不许蹭邻居体裁的正文单位词（章/篇/首/幕/场/天 各有其主）', () => {
    setLang('zh-CN');
    const FOREIGN: Record<string, string[]> = {
      essay: ['章', '诗', '幕', '这天', '日记'],
      poetry: ['章', '篇', '幕', '这天', '日记'],
      script: ['章', '篇', '诗', '这天', '日记'],
      diary: ['章', '卷', '幕', '辑'],
    };
    const OWN: Record<string, string[]> = {
      essay: ['篇'], poetry: ['诗'], script: ['场'], diary: ['条目', '天'],
    };
    for (const genre of Object.keys(FOREIGN)) {
      const rendered = NEW_SLOTS.map((slot) => t(surfaceKeyForGenre(genre, slot))).join(' / ');
      const scanned = rendered.replace(/场景/g, ''); // 「场景」是设定卡实体名，不是正文单位词
      for (const bad of FOREIGN[genre]) expect(scanned, `${genre} 的页签/副标不许说「${bad}」`).not.toContain(bad);
      for (const own of OWN[genre]) expect(rendered, `${genre} 至少要说自己的「${own}」`).toContain(own);
    }
  });

  it('日记侧「场」这个字也不许出现（它是正文单位词，不是"场景"的残字）', () => {
    setLang('zh-CN');
    const rendered = NEW_SLOTS.map((slot) => t(surfaceKeyForGenre('diary', slot)))
      .join(' / ').replace(/场景/g, '');
    expect(rendered, '日记页签/副标不许说「场」').not.toContain('场');
  });

  it('T-E：伏笔预警那条不再写死「跨章」', () => {
    setLang('zh-CN');
    const label = t('writing.overviewWarn.foreshadowOverdue');
    expect(label).not.toContain('跨章');
    for (const unit of ['章', '篇', '首', '场', '天']) expect(label, `预警条不许绑定单位「${unit}」`).not.toContain(unit);
    expect(label).toContain('伏笔');
  });
});

describe('㉚ 按体裁 id 索引的文案表必须穷尽（本轮撞见的活缺陷）', () => {
  /**
   * 病灶：`WritingLeftTabs.tsx:97` 写的是 `t(\`writingDesign.genreDesc.${g.id}\`)`，
   * 而 genreDesc 只有 novel/essay/poetry/script 四条 —— 日记 2026-11-10 开闸时没人补这一条，
   * 于是左栏「日记」载体卡上直接印出 `writingDesign.genreDesc.diary`。
   * 这类键查不到时 i18n 不会抛错，只会把键本身印到界面上：**动态拼接的体裁词表
   * 必须有一张穷尽锁**，否则每次开闸都要再付一次钱。全仓这样的表只有两张
   * （另一张是 `GenreMediumFields.tsx:51` 的 writing.genre.*），两张一起钉。
   */
  const DYNAMIC_TABLES = ['writing.genre', 'writingDesign.genreDesc'];

  it('五体裁 × 两张表 × 中英两份：一条都不许缺', () => {
    for (const table of DYNAMIC_TABLES) {
      const [top, sub] = table.split('.');
      for (const json of [zhJson, enJson]) {
        const block = json[top]?.[sub] ?? json[top];
        for (const g of WRITING_GENRES) {
          const v = block?.[g.id];
          expect(typeof v, `${table}.${g.id} 缺（缺一条界面就印裸 key）`).toBe('string');
          expect((v as string).length, `${table}.${g.id} 不许是空串`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('中文侧含汉字、英文侧不含汉字（㉗ 那次是整族填反了文件）', () => {
    for (const g of WRITING_GENRES) {
      expect(zhJson.writingDesign.genreDesc[g.id], `zh genreDesc.${g.id}`).toMatch(cjk);
      expect(enJson.writingDesign.genreDesc[g.id], `en genreDesc.${g.id}`).not.toMatch(cjk);
    }
  });
});

describe('㉚ 接线层 · 七个调用点真的在吃解析器', () => {
  const read = (p: string) => readFileSync(p, 'utf-8');

  it('页签 / 视图名 / 总览维度 三张嘴共用 viewKindLabelKey', () => {
    expect(read('src/editor/components/SceneTabBar.tsx')).toContain('t(viewKindLabelKey(bookGenre, kind))');
    expect(read('src/utils/studioBook.ts')).toContain('t(viewKindLabelKey(genre, kind))');
    expect(read('src/editor/panels/BookOverviewPanel.tsx')).toContain('t(viewKindLabelKey(genre, d.kind))');
  });

  it('SceneTabBar 不再自带一份 labelKey 表（留着不用 = 下一轮的真源分身）', () => {
    const src = read('src/editor/components/SceneTabBar.tsx');
    expect(src).not.toContain("labelKey: 'writing.viewKind.");
    expect(src).toContain('const KIND_TABS: { kind: WritingViewKind; Icon: typeof AccountTreeOutlinedIcon }[]');
  });

  it('载体卡副标 / 详情标题两处走槽位', () => {
    expect(read('src/editor/renderers/WritingDesignView.tsx')).toContain('surfaceKeyForGenre(genre, "designHint")');
    expect(read('src/pages/WritingPage.tsx')).toContain("surfaceKeyForGenre(activeBook?.genre ?? '', 'unitDetail')");
    expect(read('src/pages/writingPage/WritingDrawer.tsx')).toContain("surfaceKeyForGenre(genre, 'unitDetail')");
    expect(read('src/editor/panels/ChapterMetaPanel.tsx')).toContain("surfaceKeyForGenre(book?.genre ?? '', 'unitDetail')");
  });

  it('被收编的裸键只许住在 writingSchema 的回落表里（全仓扫，含测试目录）', () => {
    for (const key of ['writingDesign.hint', 'writing.tabChapterDetails']) {
      for (const p of walk('src')) {
        if (p.endsWith('utils/writingSchema.ts')) continue;
        expect(readFileSync(p, 'utf-8'), `${p} 还在把 ${key} 当字面量用`).not.toContain(`'${key}'`);
      }
    }
  });

  it('不留孤儿键（㉖ 定过的规矩）：chapterDetailsTitle 已随接线消失，两语言一起删', () => {
    expect(zhJson.writing.chapterDetailsTitle).toBeUndefined();
    expect(enJson.writing.chapterDetailsTitle).toBeUndefined();
    // 顶替它的槽位回落键仍在，且两语言同值 —— 小说侧「章详情」三个字一个没动
    expect(surfaceDefaultKey('unitDetail')).toBe('writing.tabChapterDetails');
    setLang('zh-CN');
    expect(t(surfaceKeyForGenre('novel', 'unitDetail'))).toBe('章详情');
    expect(t(surfaceKeyForGenre('', 'unitDetail'))).toBe('章详情');
  });
});
