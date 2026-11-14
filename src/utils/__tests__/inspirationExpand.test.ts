// sight-folio: 灵感扩写（O7）· 版本切分/提示词约定/插入闭环（纯函数回归锁）
import { describe, it, expect } from 'vitest';
import {
  INSPIRATION_EXPAND_MAX_VERSIONS,
  inspirationExpandSystemHintFor,
  buildInspirationExpandPrompt,
  extractInspirationVersions,
} from '../inspirationExpand';
import { textToParagraphHtml } from '../../ai/writingAssistant';

// ㉟ AI-5（轮 12）：人设常量改函数。本文件原有断言全部跑**小说口径**（空 genre = 未设旧书），
// 因此同时是 novel 逐字零回归锁；非小说支的锁在 `src/ai/__tests__/genreFourMouths.test.ts`。
const INSPIRATION_EXPAND_SYSTEM_HINT = inspirationExpandSystemHintFor('');

describe('extractInspirationVersions（AI 回复 → 候选版本）', () => {
  it('按 ">>> " 标题行切分版本，正文多段保留空行', () => {
    const versions = extractInspirationVersions(
      [
        '>>> 版本一：雨巷重逢',
        '雨丝在巷口织成一层薄幕。',
        '',
        '她撑伞的手顿了顿，伞沿露出一截旧伤疤。',
        '',
        '>>> 版本二：门后的旧信',
        '抽屉最深处压着一封没贴邮票的信，纸边已经泛黄。',
      ].join('\n'),
    );
    expect(versions).toHaveLength(2);
    expect(versions[0].title).toBe('版本一：雨巷重逢');
    expect(versions[0].body).toBe('雨丝在巷口织成一层薄幕。\n\n她撑伞的手顿了顿，伞沿露出一截旧伤疤。');
    expect(versions[1].title).toBe('版本二：门后的旧信');
    expect(versions[1].body).toBe('抽屉最深处压着一封没贴邮票的信，纸边已经泛黄。');
  });

  it('无 ">>> " 标记时整体回退为单版本（标题序号兜底）', () => {
    const versions = extractInspirationVersions('只有一段正文，模型没按协议输出版本标记。');
    expect(versions).toHaveLength(1);
    expect(versions[0].title).toBe('版本 1');
    expect(versions[0].body).toBe('只有一段正文，模型没按协议输出版本标记。');
  });

  it('空内容 / 全空白返回空数组', () => {
    expect(extractInspirationVersions('')).toEqual([]);
    expect(extractInspirationVersions('   \n  ')).toEqual([]);
  });

  it('版本块之间与正文内的空行收敛（版本间空行不落入正文边界）', () => {
    const versions = extractInspirationVersions(
      ['>>> A 版', '首段。', '', '', '次段。', '', '', '>>> B 版', 'B 正文。'].join('\n'),
    );
    expect(versions).toHaveLength(2);
    expect(versions[0].body).toBe('首段。\n\n次段。');
    expect(versions[1].body).toBe('B 正文。');
  });

  it('标题行带多个 > 与多余空白也识别（容错强度）', () => {
    const versions = extractInspirationVersions('>>>>   带空格标题  \n正文。');
    expect(versions).toHaveLength(1);
    expect(versions[0].title).toBe('带空格标题');
    expect(versions[0].body).toBe('正文。');
  });

  it('空标题行回退为序号标题', () => {
    const versions = extractInspirationVersions(['>>>', '正文。', '>>>   ', '第二版正文。'].join('\n'));
    expect(versions).toHaveLength(2);
    expect(versions[0].title).toBe('版本 1');
    expect(versions[1].title).toBe('版本 2');
  });
});

describe('buildInspirationExpandPrompt（扩写指令构造）', () => {
  it('标题+摘要+角色+场景拼接完整且 count 收敛到 1–3', () => {
    const zh = buildInspirationExpandPrompt({
      title: '重逢在旧码头',
      summary: '多年后回老家的码头，遇到少时玩伴。',
      castNames: ['阿城', '小满'],
      sceneNames: ['江边码头'],
      count: 4,
    });
    expect(zh).toContain('重逢在旧码头');
    expect(zh).toContain('多年后回老家的码头');
    expect(zh).toContain('阿城、小满');
    expect(zh).toContain('江边码头');
    expect(zh).toContain(`扩写 ${INSPIRATION_EXPAND_MAX_VERSIONS} 个`);
  });

  it('空标题用摘要首句兜底，空摘要回退未命名念头', () => {
    expect(buildInspirationExpandPrompt({ title: '', summary: '一句有价值的念头。' })).toContain('一句有价值的念头。');
    expect(buildInspirationExpandPrompt({ title: '', summary: '' })).toContain('未命名念头');
  });

  it('count 缺省为 1，小于 1 收敛到 1，越界收敛到上限', () => {
    expect(buildInspirationExpandPrompt({ title: 'x' })).toContain('扩写 1 个');
    expect(buildInspirationExpandPrompt({ title: 'x', count: 0 })).toContain('扩写 1 个');
    expect(buildInspirationExpandPrompt({ title: 'x', count: 9 })).toContain(
      `扩写 ${INSPIRATION_EXPAND_MAX_VERSIONS} 个`,
    );
  });

  it('无角色/场景时不产生空块标记', () => {
    const prompt = buildInspirationExpandPrompt({ title: 'x', summary: 's' });
    expect(prompt).not.toContain('【角色】');
    expect(prompt).not.toContain('【场景】');
    expect(prompt).toContain('【摘要】s');
  });
});

describe('扩展版本 → 正文插入闭环（textToParagraphHtml 承接）', () => {
  it('版本多段正文按空行分段为独立 <p>，与 onInsertText 插入链路一致', () => {
    const versions = extractInspirationVersions(
      ['>>> 雨巷重逢', '雨丝在巷口织成薄幕。', '', '伞沿露出一截旧伤疤。'].join('\n'),
    );
    expect(versions).toHaveLength(1);
    const html = textToParagraphHtml(versions[0].body);
    expect(html).toBe('<p>雨丝在巷口织成薄幕。</p><p>伞沿露出一截旧伤疤。</p>');
  });

  it('单段正文生成单个 <p>，特殊字符被转义（防 HTML 注入）', () => {
    const html = textToParagraphHtml('他说：“快走 <跑> & 别回头。”');
    expect(html).toBe('<p>他说：“快走 &lt;跑&gt; &amp; 别回头。”</p>');
  });
});

describe('INSPIRATION_EXPAND_SYSTEM_HINT（首轮注入约定）', () => {
  it('含扩写师人设、版本输出约定与人味约束，且与解析规则同源', () => {
    expect(INSPIRATION_EXPAND_SYSTEM_HINT).toContain('本书灵感扩写师');
    expect(INSPIRATION_EXPAND_SYSTEM_HINT).toContain('>>> ');
    expect(INSPIRATION_EXPAND_SYSTEM_HINT).toContain('人味约束');
    expect(INSPIRATION_EXPAND_SYSTEM_HINT).toContain(`${INSPIRATION_EXPAND_MAX_VERSIONS} 个以内`);
  });
});
