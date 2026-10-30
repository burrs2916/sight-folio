// AI 语料生成卡片「删除 × 就地编辑」下标校正回归锁（2026-10-31，第十一轮 批④）
//
// 事故：生成结果区每张卡同时挂着「编辑」和「删除」。正在编辑第 2 张时点掉第 1 张的删除
// 是正常操作；旧 deleteCard 只处理 cur === i 归零，漏了前移分支 →
// cards 收缩后 editingIdx 不跟着走：指向别的卡片时，保存把当前草稿**覆盖到错误的卡片**
// （数据损坏）；指向越界时保存静默丢失。抽成纯函数逐情形钉死。
import { describe, it, expect } from 'vitest';
import { shiftEditIndexAfterDelete } from '../corpusEditIndex';

describe('shiftEditIndexAfterDelete', () => {
  it('不在编辑态（null）时任何删除都保持 null', () => {
    expect(shiftEditIndexAfterDelete(null, 0)).toBeNull();
    expect(shiftEditIndexAfterDelete(null, 3)).toBeNull();
  });

  it('删掉的正是正在编辑那张 → 退出编辑态', () => {
    expect(shiftEditIndexAfterDelete(2, 2)).toBeNull();
  });

  it('删的是编辑项之前的卡 → 下标前移 1（仍指向同一张卡）', () => {
    expect(shiftEditIndexAfterDelete(2, 0)).toBe(1);
    expect(shiftEditIndexAfterDelete(2, 1)).toBe(1);
  });

  it('删的是编辑项之后的卡 → 下标不动', () => {
    expect(shiftEditIndexAfterDelete(1, 2)).toBe(1);
    expect(shiftEditIndexAfterDelete(0, 5)).toBe(0);
  });

  it('与数组实际收缩结果一致：校正后的下标仍指向原来那张卡', () => {
    const cards = ['A', 'B', 'C', 'D'];
    for (let editIdx = 0; editIdx < cards.length; editIdx++) {
      for (let delIdx = 0; delIdx < cards.length; delIdx++) {
        if (editIdx === delIdx) continue; // 该情形按设计退出编辑态
        const next = cards.filter((_, j) => j !== delIdx);
        const fixed = shiftEditIndexAfterDelete(editIdx, delIdx);
        expect(next[fixed!]).toBe(cards[editIdx]);
      }
    }
  });
});
