/**
 * ㉣ N-22（2026-11-11 轮 72 续）：日记「谁在写」的口径锁。
 * 锁四件事：① 宽容解析（空/坏 JSON/脏人称一律回落第一人称）② 合并序列化**不许吃掉别的键**
 * （extra 同时住着全书目标、日更、关系挂线）③ 三档人称文案键互不相同且双语都有实值
 * ④ 提示词侧成句文案带人称与主角（这条是 AI 那张嘴，缺了就等于没接）。
 */
import { describe, expect, it } from 'vitest';
import {
  DIARY_PERSONS,
  diaryNarratorPromptLine,
  diaryPersonLabelKey,
  parseBookNarrator,
  serializeBookNarrator,
} from '../writing';
import zh from '../../i18n/zh-CN.json';
import en from '../../i18n/en-US.json';

const pick = (bag: Record<string, unknown>, key: string) => {
  const diary = (bag as { writing?: { diary?: Record<string, unknown> } }).writing?.diary;
  return diary ? (diary[key] as unknown) : undefined;
};

describe('㉣ N-22 · 日记叙述视角解析（宽容回落）', () => {
  it('空 / 坏 JSON / 缺字段 = 第一人称且姓名为空（旧书行为逐字不变）', () => {
    expect(parseBookNarrator(undefined)).toEqual({ person: 'first', name: '' });
    expect(parseBookNarrator('')).toEqual({ person: 'first', name: '' });
    expect(parseBookNarrator('{坏 JSON')).toEqual({ person: 'first', name: '' });
    expect(parseBookNarrator('{"targetWords":80000}')).toEqual({ person: 'first', name: '' });
    // 脏人称（表外值）不许把界面搞崩
    expect(parseBookNarrator('{"diaryNarrator":{"person":"fourth","name":123}}')).toEqual({
      person: 'first',
      name: '',
    });
  });

  it('三档都认，名字超 40 字截断（防粘一整段进来）', () => {
    for (const p of DIARY_PERSONS) {
      expect(parseBookNarrator(JSON.stringify({ diaryNarrator: { person: p, name: '阿明' } }))).toEqual({
        person: p,
        name: '阿明',
      });
    }
    expect(parseBookNarrator(JSON.stringify({ diaryNarrator: { person: 'third', name: '长'.repeat(60) } })).name).toHaveLength(40);
  });

  it('合并序列化不许吃掉 extra 里的既有键（全书目标 / 日更等同住一个 JSON）', () => {
    const base = JSON.stringify({ targetWords: 80000, targetChapters: 24, weirdUnknown: { a: 1 } });
    const merged = JSON.parse(serializeBookNarrator(base, { person: 'second', name: '阿明' }));
    expect(merged.targetWords).toBe(80000);
    expect(merged.targetChapters).toBe(24);
    expect(merged.weirdUnknown).toEqual({ a: 1 });
    expect(merged.diaryNarrator).toEqual({ person: 'second', name: '阿明' });
    // 坏 base 也不许抛
    expect(() => serializeBookNarrator('坏 JSON', { person: 'first', name: '' })).not.toThrow();
  });

  it('往返：写进去读回来逐字一致（存的就是这一点，不许有第二个真源）', () => {
    const extra = serializeBookNarrator('{}', { person: 'third', name: '沈砚' });
    expect(parseBookNarrator(extra)).toEqual({ person: 'third', name: '沈砚' });
  });
});

describe('㉣ N-22 · 三档人称的双语与提示词', () => {
  it('三档键互不相同，zh/en 都有非空实值，且不许说章/首/篇/卷', () => {
    const keys = DIARY_PERSONS.map((p) => diaryPersonLabelKey(p));
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual(['writing.diary.person_first', 'writing.diary.person_second', 'writing.diary.person_third']);
    const leaf = keys.map((k) => k.split('.').pop() as string);
    const seen: string[] = [];
    for (const k of leaf) {
      const z = pick(zh, k);
      const e = pick(en, k);
      expect(typeof z, `zh 缺 ${k}`).toBe('string');
      expect((z as string).length, `zh 空 ${k}`).toBeGreaterThan(0);
      expect(typeof e, `en 缺 ${k}`).toBe('string');
      expect((e as string).length, `en 空 ${k}`).toBeGreaterThan(0);
      for (const s of [z as string, e as string]) {
        expect(s).not.toMatch(/章|卷|首|篇/);
      }
      seen.push(z as string);
    }
    expect(new Set(seen).size).toBe(3);
    expect(seen[0]).toContain('我');
    expect(seen[1]).toContain('你');
  });

  it('提示词侧成句：人称 + 主角都要在句子里（AI 那张嘴的实值）', () => {
    const first = diaryNarratorPromptLine({ person: 'first', name: '' });
    expect(first.zh).toContain('第一人称');
    expect(first.zh).not.toContain('主角');
    expect(first.en).toContain('first person');
    const withName = diaryNarratorPromptLine({ person: 'third', name: '沈砚' });
    expect(withName.zh).toContain('第三人称');
    expect(withName.zh).toContain('沈砚');
    expect(withName.en).toContain('third person');
    expect(withName.en).toContain('沈砚');
    expect(diaryNarratorPromptLine({ person: 'second', name: '阿明' }).zh).toContain('第二人称');
  });
});
