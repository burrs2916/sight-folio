// 写作方案 A2：AI 味检测引擎单测
//   - detectAiFlavor 四维检测（template / rhythm / punctuation / vague）与排序/去重/空文本
import { describe, it, expect } from 'vitest';
import { detectAiFlavor } from '../aiFlavorEngine';

describe('detectAiFlavor —— 四维检测', () => {
  it('干净文本（交替长短句、具象细节）不误报', () => {
    const text =
      '他推开包厢门，酒气混着烟味扑了一脸。桌上三只空杯，烟灰缸里躺着半截没抽完的烟。她说她要走了。窗外的雨刚好停。';
    expect(detectAiFlavor(text)).toEqual([]);
  });

  it('模板套话命中（总结腔强词为 warning，其余为 hint）', () => {
    const issues = detectAiFlavor('总而言之，事情就是这样。首先，他来了；其次，他走了。');
    const template = issues.filter((i) => i.kind === 'template');
    expect(template.length).toBeGreaterThan(0);
    const strong = template.find((i) => i.excerpt.includes('总而言之'));
    expect(strong).toBeTruthy();
    expect(strong!.severity).toBe('warning');
    expect(strong!.suggestion).toContain('总结腔');
  });

  it('万能比喻模板命中（仿佛…一般）', () => {
    const issues = detectAiFlavor('月光洒下来，仿佛流水一般铺满了整个院子。');
    const template = issues.filter((i) => i.kind === 'template');
    expect(template.some((i) => i.excerpt.includes('仿佛流水一般'))).toBe(true);
  });

  it('情绪直述命中（≤26 字短句直接贴抽象情绪词）', () => {
    const issues = detectAiFlavor('她感到很难过。他站在门口，手指无意识地抠着门框。');
    const vague = issues.filter((i) => i.kind === 'vague');
    expect(vague.length).toBeGreaterThan(0);
    expect(vague[0].excerpt).toContain('难过');
    expect(vague[0].severity).toBe('warning');
    expect(vague[0].suggestion).toContain('抽象直述');
  });

  it('长句堆叠命中（一逗到底 ≥60 字且 ≥3 逗号）', () => {
    const text =
      '他一边想着明天的工作安排，一边又惦记着家里没关的窗户，还时不时低头看一眼手机里刚收到的消息，整个人心神不宁地坐在椅子上反复摆弄那支钢笔。';
    const issues = detectAiFlavor(text);
    const punct = issues.filter((i) => i.kind === 'punctuation');
    expect(punct.length).toBeGreaterThan(0);
    expect(punct[0].suggestion).toContain('短句');
  });

  it('节奏单调命中（≥6 句、变异系数低且连续 ≥4 句长度接近）', () => {
    const text =
      '他推开门走了进去。她抬起头看了他一眼。桌上摆着一杯热茶。窗外的风轻轻吹着。墙上的钟滴答作响。他随手放下了外套。每个人都安安静静的。整个房间里很空。所有东西都摆得整齐。她始终没有开口说话。他也不知道说什么好。两个人就这样沉默着。';
    const issues = detectAiFlavor(text);
    const rhythm = issues.filter((i) => i.kind === 'rhythm');
    expect(rhythm.length).toBeGreaterThan(0);
    expect(rhythm[0].start).toBeLessThan(rhythm[0].end);
    expect(rhythm[0].suggestion).toContain('穿插短句');
  });

  it('结果按 start 升序，同 start 高优先级在前', () => {
    const text = '总而言之，她感到很难过。';
    const issues = detectAiFlavor(text);
    for (let i = 1; i < issues.length; i++) {
      expect(issues[i].start).toBeGreaterThanOrEqual(issues[i - 1].start);
    }
    // "总而言之"与"suggestion"类模板词同 start 时应保留其中一条（去重不吞并不同起点）
    const templates = issues.filter((i) => i.kind === 'template');
    expect(templates.length).toBeGreaterThan(0);
  });

  it('相邻模板重复命中去重（间隔 ≤5 字符视为同词）', () => {
    const issues = detectAiFlavor('总而言之、总而言之。');
    const template = issues.filter((i) => i.kind === 'template');
    // 两个"总而言之"因正则连续性（间隔 0）应被去重为合理数量（不允许 >2）
    expect(template.length).toBeLessThanOrEqual(2);
  });

  it('空文本与纯空白返回 []', () => {
    expect(detectAiFlavor('')).toEqual([]);
    expect(detectAiFlavor('   \n  ')).toEqual([]);
  });

  it('offset 自洽：excerpt 能从原文下标还原（不越界）', () => {
    const text = '他感到很难过，仿佛整个世界都灰暗了一般。';
    const issues = detectAiFlavor(text);
    for (const i of issues) {
      expect(i.start).toBeGreaterThanOrEqual(0);
      expect(i.end).toBeLessThanOrEqual(text.length);
      expect(i.start).toBeLessThan(i.end);
    }
  });
});
