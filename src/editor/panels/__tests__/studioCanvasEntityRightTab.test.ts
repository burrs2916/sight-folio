// 工作室画布选中实体 → 右栏切「详情」栏 · 回归锁（2026-10-31，第十四轮）
//
// 断链（三栏联动,用户点名审查项）：书场景画布选中**非写作实体**（插画链路 H2 落画的
// image 实体）时，右栏联动旧条件 `type.startsWith('writing-')` 直接早退不切栏。
// 后果：创作者从素材库给章节配插画、在画布点选该插画后，右栏停在「要素」栏——
// WritingInspectorPanel 读的是章/人物/设定，对插画全是空字段；真正渲染插画
// （预览/替换图源/尺寸）的 EntityPortraitPanel 在「详情」栏 fallback 分支里，
// 看不见 = 选中了却"改不了"，与写作卡已修复过的同款观感问题。
//
// 修法：联动放宽为「任意选中实体都切详情栏」（仍只在停在要素栏时切，不抢用户
// 手动停留的栏位）；写作实体路径行为不变。锁三段：
// ① 联动不再按 writing- 前缀早退；② 保留 cur===0→1 的不抢占语义；
// ③ 详情栏 fallback 仍是 EntityPortraitPanel（放宽的语义前提）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(`${process.cwd()}/src/editor/SceneEditor.tsx`, 'utf8');

describe('书场景画布选中实体→详情栏联动', () => {
  it('联动不再按 writing- 前缀早退（image/asset 也切详情栏）', () => {
    expect(SRC).not.toMatch(
      /if \(!selectedComponent\?\.type\.startsWith\('writing-'\)\) return;\n\s*setRightTab\(\(cur\) => \(cur === 0 \? 1 : cur\)\);/,
    );
    expect(SRC).toMatch(/if \(!selectedComponent\) return;\n\s*setRightTab\(\(cur\) => \(cur === 0 \? 1 : cur\)\);/);
  });
  it('保留「不抢占」语义：仅当前停在要素栏(0)才切到详情栏(1)', () => {
    expect(SRC).toMatch(/setRightTab\(\(cur\) => \(cur === 0 \? 1 : cur\)\)/);
  });
  it('语义前提在位：详情栏 fallback 渲染 EntityPortraitPanel', () => {
    // 详情栏分派链尾部：<EntityPortraitPanel entity={selectedComponent} />（画像面板，
    // 插画/代码实体共用）；放宽前缀条件正是让非写作实体落到这里。
    expect(SRC).toMatch(/<EntityPortraitPanel entity=\{selectedComponent\} \/>/);
  });
});
