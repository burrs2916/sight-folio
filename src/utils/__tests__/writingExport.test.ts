// 导出取数口径测试（写作台「另存为」六格式的唯一入口）。
//
// 为什么必须锁成测试：完结作品页的层级在 Rust 侧按 kind+parent_id 重建，写作台这条路
// 由前端传载荷。两侧口径一旦分叉，就会出现「成品页导出有卷、写作台导出没卷」——
// 这正是本轮修掉的缺陷，所以把先序 / 容器判据 / 封面不借图 / 旧模型回退四件事钉死。
import { describe, it, expect } from 'vitest';
import { flattenForExport, volumeRuleForText } from '../writingExport';
import type { WritingChapter } from '../../services/tauri';

function n(
  id: string,
  parentId: string | null,
  kind: string,
  sortOrder: number,
  extra: Record<string, unknown> = {},
  volume = '',
): WritingChapter {
  return {
    id,
    bookId: 'b1',
    title: id,
    content: `<p>${id} 正文</p>`,
    sortOrder,
    wordCount: 4,
    status: 'draft',
    volume,
    parentId,
    kind,
    extra: JSON.stringify(extra),
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('flattenForExport（目录树先序 + 层级）', () => {
  // 库里真实形态：卷排 sort 1-2、章排 3-5 —— 扁平排序会把卷整堆在最前面
  const tree = [
    n('卷1', null, '卷', 1, { coverImage: 'assets/writing/illustrations/v1.png' }),
    n('卷2', null, '卷', 2),
    n('章1', '卷1', '章', 3),
    n('章2', '卷1', '章', 4, { coverImage: 'assets/writing/illustrations/c2.png' }),
    n('章3', '卷2', '章', 5),
  ];
  const rows = flattenForExport(tree);

  it('顺序 = 树面板自上而下（父紧跟子），不是按 sortOrder 扁平排', () => {
    expect(rows.map((r) => r.title)).toEqual(['卷1', '章1', '章2', '卷2', '章3']);
  });

  it('容器带 isVolume/depth，内容章深度为 1', () => {
    expect(rows[0]).toMatchObject({ title: '卷1', depth: 0, isVolume: true, kind: '卷' });
    expect(rows[1]).toMatchObject({ title: '章1', depth: 1, isVolume: false });
    // 空卷不丢（用户口径：不由导出侧判断空不空）
    expect(rows.map((r) => r.title)).toContain('卷2');
  });

  it('结构书不填遗留 volume 字符串（否则卷题会被打两遍）', () => {
    expect(rows.every((r) => r.volume === undefined)).toBe(true);
  });

  it('封面各自独立：章只带自己那张，绝不借卷封面', () => {
    // 行序（先序）：0 卷1 / 1 章1 / 2 章2 / 3 卷2 / 4 章3
    expect(rows.map((r) => r.title)).toEqual(['卷1', '章1', '章2', '卷2', '章3']);
    expect(rows[0].cover).toBe('assets/writing/illustrations/v1.png');
    expect(rows[1].cover).toBeNull(); // 章1 没设封面 → null，不继承卷1 那张
    expect(rows[2].cover).toBe('assets/writing/illustrations/c2.png');
  });

  it('旧模型书（全书无 parentId）回退遗留 volume 字符串、不带层级字段', () => {
    const legacy = [
      n('老章1', null, '', 1, {}, '第一卷'),
      n('老章2', null, '', 2, {}, '第一卷'),
      n('老章3', null, '', 3, {}, '第二卷'),
    ];
    const out = flattenForExport(legacy);
    expect(out.map((r) => r.title)).toEqual(['老章1', '老章2', '老章3']);
    expect(out.map((r) => r.volume)).toEqual(['第一卷', '第一卷', '第二卷']);
    expect(out.every((r) => r.depth === undefined && r.isVolume === undefined)).toBe(true);
  });

  it('自定义层级（部/节）靠「确有子级」兜底识别为容器', () => {
    const out = flattenForExport([
      n('部1', null, '部', 1),
      n('卷A', '部1', '卷', 1),
      n('节x', '卷A', '节', 1),
    ]);
    expect(out.map((r) => [r.title, r.depth, r.isVolume])).toEqual([
      ['部1', 0, true],
      ['卷A', 1, true],
      ['节x', 2, false],
    ]);
  });
});

describe('volumeRuleForText（txt 卷题分隔行与后端同口径）', () => {
  it('深度越高分量越轻', () => {
    expect(volumeRuleForText('卷 1', 0)).toBe('════ 卷 1 ════');
    expect(volumeRuleForText('部 A', 1)).toBe('──── 部 A ────');
    expect(volumeRuleForText('节 x', 3)).toBe('···· 节 x ····');
  });
});
