/**
 * ㉳ T-B · L2 页签按体裁排序（2026-11-11 轮 34；判据 = 目标态卡 §2 定稿表）。
 *
 * 三层锁，各管一张脸：
 *  ① 表形层：tabOrderForGenre 的前三位 / 成员纪律（只排序不增减、被裁 kind 不入表、
 *     未上线的加法 kind 不留槽）/ 空表回落；
 *  ② 排序层：sortTabsForGenre 的「表外 kind 排尾 + 稳定」/ 不改入参 / 空体裁原样；
 *  ③ 真源层：SceneTabBar 只许有一处排序调用、键盘不许自拼序列（源码锁，防第二真源）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { tabOrderForGenre, sortTabsForGenre, hiddenViewKindsForGenre } from '../writingSchema';

/** SceneTabBar.KIND_TABS 的基准序（此处逐字重抄一遍是故意的：表形锁不许反向吃实现） */
const BASE_ORDER = [
  'catalog', 'characters', 'worldview', 'timeline', 'storylines', 'foreshadowing',
  'inspiration', 'proofread', 'stats', 'overview', 'writing',
];
const GENRES = ['novel', 'essay', 'poetry', 'script', 'diary'] as const;

describe('㉳ tabOrderForGenre · 序表表形', () => {
  it('小说前三 = 正文·目录·剧情线（目标态卡 §2）', () => {
    expect(tabOrderForGenre('novel').slice(0, 3)).toEqual(['writing', 'catalog', 'storylines']);
  });
  it('散文前三 = 正文·篇目·素材', () => {
    expect(tabOrderForGenre('essay').slice(0, 3)).toEqual(['writing', 'catalog', 'inspiration']);
  });
  it('诗歌前三 = 正文·诗作·素材（「形式」是 T-C 加法页签，落地前不留空槽）', () => {
    expect(tabOrderForGenre('poetry').slice(0, 3)).toEqual(['writing', 'catalog', 'inspiration']);
  });
  it('剧本前三 = 正文·幕场·角色表；动作线/铺垫呼应紧随其后（戏剧本体留在前段，⑮-2 同判据）', () => {
    const order = tabOrderForGenre('script');
    expect(order.slice(0, 3)).toEqual(['writing', 'catalog', 'characters']);
    expect(order.indexOf('storylines')).toBe(3);
    expect(order.indexOf('foreshadowing')).toBe(4);
    expect(order.indexOf('timeline')).toBe(5);
  });
  it('日记前二 = 正文·条目（目标态头名「日历」卡 P4，未上线不落位）', () => {
    expect(tabOrderForGenre('diary').slice(0, 2)).toEqual(['writing', 'catalog']);
  });

  it('成员纪律：表内无重复、无未知 kind、被裁 kind 一律不入表', () => {
    for (const g of GENRES) {
      const order = tabOrderForGenre(g);
      expect(new Set(order).size, `${g} 表内有重复`).toBe(order.length);
      for (const k of order) expect(BASE_ORDER, `${g} 表内混入未知 kind ${k}`).toContain(k);
      for (const h of hiddenViewKindsForGenre(g)) {
        expect(order, `${g} 的表不该收被裁 kind ${h}（裁不裁只归 hiddenViewKindsForGenre 管）`).not.toContain(h);
      }
    }
  });

  it('完备性：每个可见 kind 都必须在表里（缺席 = 被排尾，等于位次被暗中降级）', () => {
    for (const g of GENRES) {
      const hidden = hiddenViewKindsForGenre(g);
      for (const k of BASE_ORDER) {
        if (!hidden.includes(k)) expect(tabOrderForGenre(g), `${g} 缺 ${k}`).toContain(k);
      }
    }
  });

  it('空 / 脏体裁 = 空表（不改序 = 旧书零回归线）', () => {
    expect(tabOrderForGenre('')).toEqual([]);
    expect(tabOrderForGenre('diaryy')).toEqual([]);
    expect(tabOrderForGenre('Novel')).toEqual([]);
  });
});

describe('㉳ sortTabsForGenre · 唯一一份排序', () => {
  const tabs = BASE_ORDER.map((kind) => ({ kind }));

  it('小说：整排 = 小说那张表逐位一致（十一枚全可见，排序层不该有任何挪窝）', () => {
    expect(sortTabsForGenre('novel', tabs).map((x) => x.kind)).toEqual([...tabOrderForGenre('novel')]);
  });

  it('护栏形状：被裁但已建过的 kind（表外）排到尾部、保持基准相对序', () => {
    const sorted = sortTabsForGenre('essay', tabs).map((x) => x.kind);
    expect(sorted.slice(0, 8)).toEqual([...tabOrderForGenre('essay')]);
    // 散文被裁三件套按基准序（worldview→storylines→foreshadowing）落在尾部
    expect(sorted.slice(8)).toEqual(['worldview', 'storylines', 'foreshadowing']);
  });

  it('无 kind 项（自定义页签类）稳定排尾，不插进固定页签中间', () => {
    // 输入只给该体裁**可见**的固定 kind（被裁的不混进来 —— 它们的排尾形状上一条已单独锁）
    const diaryVisible = BASE_ORDER.filter((k) => !hiddenViewKindsForGenre('diary').includes(k));
    const withCustom = [...diaryVisible.map((kind) => ({ kind })), { kind: undefined }, { kind: undefined }];
    const sorted = sortTabsForGenre('diary', withCustom);
    expect(sorted.slice(-2).every((x) => x.kind === undefined)).toBe(true);
    expect(sorted.slice(0, -2).map((x) => x.kind)).toEqual([...tabOrderForGenre('diary')]);
  });

  it('空体裁原样返回；且**不改入参**（页签数组可能直接来自常量表）', () => {
    expect(sortTabsForGenre('', tabs).map((x) => x.kind)).toEqual(BASE_ORDER);
    const snapshot = tabs.slice();
    sortTabsForGenre('poetry', tabs);
    expect(tabs).toEqual(snapshot);
  });
});

describe('㉳ 真源层 · SceneTabBar 不许长出第二份序/第二份序列', () => {
  const src = readFileSync('src/editor/components/SceneTabBar.tsx', 'utf-8');

  it('排序只调用一次（渲染与键盘共用同一个 orderedKindTabs）', () => {
    expect(src.match(/sortTabsForGenre\(/g)?.length).toBe(1);
    expect(src).toContain('sortTabsForGenre(bookGenre, KIND_TABS)');
    // 键盘序列必须遍历排序后的表，而不是裸 KIND_TABS
    expect(src).toContain('for (const { kind } of orderedKindTabs)');
    expect(src).toContain('orderedKindTabs.filter(');
  });

  it('⌥1–9 只查 l2Switchable 位次；物理键判定走 e.code（macOS ⌥+数字的 e.key 是组合字符）', () => {
    expect(src).toContain('l2Switchable[altDigit]');
    expect(src).toContain('/^Digit[1-9]$/.test(e.code)');
  });
});
