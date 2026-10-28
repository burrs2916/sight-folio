// P0 文风一致性引擎（utils/writingStyleFingerprint）单测：
// 覆盖句式 / 段落 / 对话密度 / 标点偏好 / 高频词 / 预算截断 / 最小样本判定。
// 守的是「统计画像正确、输出预算受控」这条契约。
import { describe, it, expect } from 'vitest';
import { analyzeStyleFingerprint, buildStyleFingerprint, formatStyleFingerprint } from '../writingStyleFingerprint';
import { STYLE_FINGERPRINT_MAX_CHARS, STYLE_FINGERPRINT_MIN_CHARS } from '../writingCorpusBudget';
import type { WritingChapter } from '../../services/tauri';

function ch(id: string, sortOrder: number, content: string): WritingChapter {
  return {
    id,
    bookId: 'b1',
    title: `第${id}章`,
    content,
    sortOrder,
    wordCount: content.length,
    status: 'draft',
    createdAt: 0,
    updatedAt: 0,
  } as WritingChapter;
}

const SHORT_SENTENCE_FILLER = '他抬头望着天。风很轻。云很慢。心却乱。';

const DIALOGUE_SAMPLE = [
  '“你来了？”她问。',
  '“嗯，刚忙完。”他拉开椅子坐下。',
  '“那杯咖啡还热着。”她指了指桌角。',
  '他没说话，只是端起杯子。',
].join('\n');

describe('analyzeStyleFingerprint', () => {
  it('从短句样本识别出高短句占比与低平均句长', () => {
    const fp = analyzeStyleFingerprint([SHORT_SENTENCE_FILLER]);
    expect(fp.sentenceStats.shortPct).toBeGreaterThanOrEqual(60);
    expect(fp.sentenceStats.avgChars).toBeLessThanOrEqual(10);
    expect(fp.sampleChars).toBeGreaterThan(0);
  });

  it('从长句样本识别出高长句占比', () => {
    const long = '当他终于沿着那道被雨水冲刷得发亮的青石板路走到巷子尽头的时候，';
    const fp = analyzeStyleFingerprint([long + long + long]);
    expect(fp.sentenceStats.longPct).toBeGreaterThan(50);
  });

  it('对话样本的引号密度 > 0', () => {
    const fp = analyzeStyleFingerprint([DIALOGUE_SAMPLE]);
    expect(fp.dialoguePct).toBeGreaterThan(0);
    expect(fp.sentenceCount).toBeGreaterThan(3);
  });

  it('标点偏好按每千字统计且逗号按每句统计', () => {
    const fp = analyzeStyleFingerprint(['你……你……怎么会在这里？！快说，坦白，从宽。']);
    expect(fp.punctuation.ellipsisPerThousand).toBeGreaterThan(0);
    expect(fp.punctuation.exclaimPerThousand).toBeGreaterThan(0);
    expect(fp.punctuation.questionPerThousand).toBeGreaterThan(0);
    expect(fp.punctuation.commaPerSentence).toBeGreaterThan(0);
  });

  it('提取高频中文双字窗口与英文高频词', () => {
    const fp = analyzeStyleFingerprint([
      '夜色夜色夜色笼罩着城市，城市城市沉默地呼吸着。wind wind wind blows over the hills.'.repeat(3),
    ]);
    expect(fp.topWordsZh.length).toBeGreaterThan(0);
    expect(fp.topWordsZh[0]).toMatch(/夜色|城市/);
    expect(fp.topWordsEn[0]).toBe('wind');
  });
});

describe('buildStyleFingerprint', () => {
  it('空章节/无正文样本返回 null', () => {
    expect(buildStyleFingerprint([ch('a', 0, '<p></p>'), ch('b', 1, '')])).toBeNull();
    expect(buildStyleFingerprint([])).toBeNull();
  });

  it('样本总量截断到预算字符', () => {
    const massive = '啊'.repeat(STYLE_FINGERPRINT_MAX_CHARS * 2);
    const fp = buildStyleFingerprint([ch('a', 0, massive)]);
    expect(fp).not.toBeNull();
    const sampleChars = fp!.zh.match(/约 ([0-9,]+) 字样本/)![1].replace(/,/g, '');
    expect(Number(sampleChars)).toBeLessThanOrEqual(STYLE_FINGERPRINT_MAX_CHARS);
  });

  it('按 sortOrder 取前 N 章且最少样本数判定生效', () => {
    const enough = ch('a', 0, SHORT_SENTENCE_FILLER.repeat(30));
    const fp = buildStyleFingerprint([ch('b', 1, ''), enough]);
    expect(fp).not.toBeNull();
    expect(STYLE_FINGERPRINT_MIN_CHARS).toBeGreaterThan(0);
  });

  it('输出双语格式且包含关键统计', () => {
    const fp = buildStyleFingerprint([ch('a', 0, DIALOGUE_SAMPLE.repeat(20))]);
    expect(fp).not.toBeNull();
    expect(fp!.zh).toContain('句式');
    expect(fp!.zh).toContain('对话');
    expect(fp!.en).toContain('Sentence');
    expect(fp!.en).toContain('Dialogue');
  });
});

describe('formatStyleFingerprint', () => {
  it('零风险空样本也能格式化（不崩溃）', () => {
    const empty = analyzeStyleFingerprint(['']);
    expect(formatStyleFingerprint(empty, 'zh')).toContain('文风指纹');
    expect(formatStyleFingerprint(empty, 'en')).toContain('Style fingerprint');
  });
});
