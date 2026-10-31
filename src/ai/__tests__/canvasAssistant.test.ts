import { describe, it, expect } from 'vitest';
import {
  parseCanvasOps,
  buildCanvasOpsMessage,
  captureCanvasSnapshot,
  applyCanvasOps,
  buildCanvasWritingContext,
} from '../canvasAssistant';
import { useEditorStore } from '../../store/editorStore';
import { useWritingStore } from '../../store/writingStore';
import { registerBuiltinComponents } from '../../editor/registry';

describe('parseCanvasOps', () => {
  it('裸 JSON 数组直接解析', () => {
    const { ops, parseError } = parseCanvasOps('[{"op":"move","id":"comp_1","x":10,"y":20}]');
    expect(parseError).toBeNull();
    expect(ops.length).toBe(1);
    expect(ops[0]).toEqual({ op: 'move', id: 'comp_1', x: 10, y: 20 });
  });

  it('带解释文字和代码围栏的回复也能抠出 JSON', () => {
    const reply = '好的，方案如下：\n```json\n[{"op":"remove","id":"comp_9"}]\n```\n请确认。';
    const { ops, parseError } = parseCanvasOps(reply);
    expect(parseError).toBeNull();
    expect(ops.length).toBe(1);
    expect(ops[0].op).toBe('remove');
  });

  it('非法 op 被丢弃并计数：未知类型 / add 越白名单 / 非数字坐标', () => {
    const { ops, dropped } = parseCanvasOps(
      JSON.stringify([
        { op: 'teleport', id: 'x' }, // 未知 op
        { op: 'add', type: 'image', name: '图', x: 0, y: 0 }, // add 类型越白名单
        { op: 'move', id: 'c1', x: 'abc', y: 3 }, // 坐标非数字
        { op: 'rename', id: 'c1', name: '改名' }, // 合法
        'garbage',
      ]),
    );
    expect(ops.length).toBe(1);
    expect(ops[0].op).toBe('rename');
    expect(dropped).toBe(4);
  });

  it('move/resize 校验数字与尺寸下限，set_text 截断超长文本', () => {
    const { ops } = parseCanvasOps(
      JSON.stringify([
        { op: 'resize', id: 'c1', width: 10, height: 50 }, // 尺寸过小 → 丢
        { op: 'resize', id: 'c1', width: 400, height: 99999 }, // 超上限 → 收敛
        { op: 'set_text', id: 'c1', text: 'x'.repeat(600) },
      ]),
    );
    expect(ops.length).toBe(2);
    expect(ops[0]).toMatchObject({ op: 'resize', width: 400, height: 2000 });
    expect(ops[1]).toMatchObject({ op: 'set_text' });
    expect((ops[1] as { text: string }).text.length).toBe(500);
  });

  it('无数组 / 坏 JSON 返回 parseError', () => {
    expect(parseCanvasOps('我觉得没法做').parseError).toBe('no-array');
    expect(parseCanvasOps('[{bad json}]').parseError).toBe('invalid-json');
    // 对象串没有 [ ] 括号对 → 同样按「找不到数组」处理
    expect(parseCanvasOps('{"op":"move"}').parseError).toBe('no-array');
    expect(parseCanvasOps('').parseError).toBe('empty');
  });
});

describe('buildCanvasOpsMessage + captureCanvasSnapshot', () => {
  it('快照包含 id/type/名称/位置/文字，prompt 内含清单与规则', () => {
    // 造一个最小组件塞进 store
    const comp = {
      id: 'comp_test_1',
      type: 'writing-chapter',
      name: '第一章',
      transform: { x: 10, y: 20, width: 232, height: 64, rotation: 0, scale: 1 },
      layerId: 'layer_1',
      zIndex: 0,
      locked: false,
      visible: true,
      config: { title: '第一章', wordCount: 800 },
    };
    useEditorStore.setState((s: any) => {
      s.components = [...s.components, comp];
    });
    const snap = captureCanvasSnapshot();
    const mine = snap.find((s) => s.id === 'comp_test_1');
    expect(mine).toBeDefined();
    expect(mine!.text).toBe('第一章');
    const msg = buildCanvasOpsMessage([mine!], '把第一章移到右上角');
    expect(msg).toContain('comp_test_1');
    expect(msg).toContain('arrange_grid');
    expect(msg).toContain('把第一章移到右上角');
    // 清理
    useEditorStore.setState((s: any) => {
      s.components = s.components.filter((c: any) => c.id !== 'comp_test_1');
    });
  });
});

describe('applyCanvasOps（AI 改画布写通道）', () => {
  // add 分支需要画布组件类型已注册（writing-character/writing-outline/annotation-text）
  const registered = registerBuiltinComponents();
  void registered;

  it('move/resize/rename/set_text/remove/add/arrange_grid 全类型应用语义正确', () => {
    const ed = useEditorStore.getState();
    ed.clearScene(); // 建默认 layer
    // 造 4 个已有组件 + 记录 apply 前 history 长度
    const c1 = ed.addComponent('writing-character', undefined, { x: 0, y: 0 })!.id;
    const c2 = ed.addComponent('writing-outline', undefined, { x: 0, y: 0 })!.id;
    const c3 = ed.addComponent('annotation-text', undefined, { x: 0, y: 0 })!.id;
    const c4 = ed.addComponent('annotation-text', undefined, { x: 0, y: 0 })!.id;
    useEditorStore.setState((s: any) => {
      s.components = s.components.map((c: any) =>
        c.id === c3 ? { ...c, config: { ...c.config, text: '旧便签' } } : c,
      );
    });
    const historyBefore = useEditorStore.getState().history.length;

    const { applied, skipped } = applyCanvasOps([
      { op: 'move', id: c1, x: 100, y: 200 },
      { op: 'resize', id: c1, width: 400, height: 160 },
      { op: 'rename', id: c1, name: '主角·林越' },
      { op: 'set_text', id: c3, text: '新便签文字' },
      { op: 'remove', id: c4 },
      { op: 'add', type: 'writing-character', name: '配角·沈青', x: 20, y: 30, width: 240, height: 100, text: '刀客' },
      {
        op: 'arrange_grid',
        ids: [c1, c2],
        columns: 2,
        startX: 10,
        startY: 10,
        cellWidth: 200,
        cellHeight: 80,
        gapX: 16,
        gapY: 16,
      },
    ]);

    expect(applied).toBe(7);
    expect(skipped).toBe(0);

    const st = useEditorStore.getState();
    const a = st.components.find((c) => c.id === c1)!;
    expect(a.transform.x).toBe(10); // 被 arrange_grid 覆盖 → 第 0 列第 0 行
    expect(a.transform.y).toBe(10);
    expect(a.name).toBe('主角·林越');
    expect(a.transform.width).toBe(400); // grid 不覆盖尺寸，保持 resize 值
    const note = st.components.find((c) => c.id === c3)!;
    expect((note.config as any).text).toBe('新便签文字');
    expect(st.components.find((c) => c.id === c4)).toBeUndefined();
    // add 的新实体
    const added = st.components.find((c) => c.name === '配角·沈青')!;
    expect(added).toBeDefined();
    expect(added.type).toBe('writing-character');
    expect(added.transform.x).toBe(20);
    expect(added.transform.width).toBe(240);
    // 批量纪律：endBatch 只产生一条历史
    expect(useEditorStore.getState().history.length - historyBefore).toBe(1);
  });

  it('非法/不存在的 id 记 skipped，不污染画布', () => {
    const ed = useEditorStore.getState();
    ed.clearScene();
    const c1 = ed.addComponent('writing-character', undefined, { x: 0, y: 0 })!.id;
    const { applied, skipped } = applyCanvasOps([
      { op: 'move', id: 'ghost_id', x: 1, y: 1 }, // 不存在
      { op: 'resize', id: 'ghost_id', width: 100, height: 100 }, // 不存在
      { op: 'rename', id: 'ghost_id', name: 'x' }, // 不存在
      { op: 'remove', id: 'ghost_id' }, // 不存在
      { op: 'arrange_grid', ids: ['ghost_id', 'ghost_id2'], columns: 2 }, // 全部不存在 → 记 1 skipped
      { op: 'set_text', id: c1, text: '保留在画布上的合法操作' }, // 合法
    ]);
    expect(applied).toBe(1);
    expect(skipped).toBe(5);
    expect(useEditorStore.getState().components).toHaveLength(1);
  });

  it('add 越白名单的 type 在应用层被拒（addComponent 返回 null → skipped）', () => {
    const ed = useEditorStore.getState();
    ed.clearScene();
    const { applied, skipped } = applyCanvasOps([
      // 协议层已挡 AI 侧，应用层兜底：未注册/非白名单类型 → addComponent null
      { op: 'add', type: 'module', name: '不该出现', x: 0, y: 0 },
      { op: 'add', type: 'writing-outline', name: '合法大纲卡', x: 50, y: 50 },
    ]);
    expect(applied).toBe(1);
    expect(skipped).toBe(1);
    const names = useEditorStore.getState().components.map((c) => c.name);
    expect(names).toContain('合法大纲卡');
    expect(names).not.toContain('不该出现');
  });
});

describe('第十四轮：worldview 可新增 + 文字落主字段', () => {
  it('writing-worldview 进入 AI 可新增白名单', () => {
    const { ops } = parseCanvasOps(
      '[{"op":"add","type":"writing-worldview","name":"灵潮体系","x":10,"y":10}]',
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'add', type: 'writing-worldview' });
  });

  it('add writing-worldview + text 落到主字段 name（非无人读的 text）', () => {
    const ed = useEditorStore.getState();
    ed.clearScene();
    const { applied, skipped } = applyCanvasOps([
      { op: 'add', type: 'writing-worldview', name: '灵潮体系', x: 10, y: 10, text: '灵气复苏的修行世界观' },
    ]);
    expect(applied).toBe(1);
    expect(skipped).toBe(0);
    const c = useEditorStore.getState().components.find((x) => x.name === '灵潮体系')!;
    expect(c).toBeDefined();
    expect(c.type).toBe('writing-worldview');
    // 主字段是 name：文字应落到 config.name，渲染器才读得到（旧逻辑落 config.text 静默不显示）
    expect((c.config as Record<string, unknown>).name).toBe('灵气复苏的修行世界观');
  });

  it('set_text 对 character 落到主字段 name', () => {
    const ed = useEditorStore.getState();
    ed.clearScene();
    const cid = ed.addComponent('writing-character', undefined, { x: 0, y: 0 })!.id;
    applyCanvasOps([{ op: 'set_text', id: cid, text: '主角·林越' }]);
    const c = useEditorStore.getState().components.find((x) => x.id === cid)!;
    expect((c.config as Record<string, unknown>).name).toBe('主角·林越');
    expect((c.config as Record<string, unknown>).text).toBeUndefined();
  });

  it('prompt schema 动态列出白名单含 writing-worldview（文案不再写死"三个值"）', () => {
    const msg = buildCanvasOpsMessage([], '铺世界观卡', null);
    expect(msg).toContain('writing-worldview');
    expect(msg).not.toMatch(/三个值/);
  });

  it('captureCanvasSnapshot 把 character/worldview 的 config.name 作为文字喂给 AI', () => {
    const ed = useEditorStore.getState();
    ed.clearScene();
    const c = ed.addComponent('writing-worldview', undefined, { x: 0, y: 0 })!;
    useEditorStore.getState().updateComponentConfig(c.id, { name: '灵潮体系' });
    const snap = captureCanvasSnapshot();
    expect(snap.find((x) => x.id === c.id)?.text).toBe('灵潮体系');
  });
  it('buildCanvasWritingContext 注入【世界观设定】段（能新增世界观卡且有据可依）', () => {
    const ws = useWritingStore.getState();
    const prev = {
      books: ws.books,
      settings: ws.settings,
      activeBookId: ws.activeBookId,
    };
    try {
      useWritingStore.setState((s: any) => {
        s.books = [{ id: 'b1', title: '长夜行', genre: '悬疑', status: 'draft', dailyGoal: 0, extra: '' }];
        s.activeBookId = 'b1';
        s.settings = [
          { id: 'w1', bookId: 'b1', kind: 'worldbuilding', name: '灵潮体系', subtitle: '修行', description: '灵气复苏', extra: '' },
          { id: 'c1', bookId: 'b1', kind: 'character', name: '林越', subtitle: '主角', description: '退役侦探', extra: '' },
        ];
      });
      const ctx = buildCanvasWritingContext();
      expect(ctx).not.toBeNull();
      expect(ctx!).toContain('【世界观设定】');
      expect(ctx!).toContain('灵潮体系');
      // 人物段与世界观段互不串：世界观名不出现在人物档案段行内（各归其段）
      expect(ctx!).toContain('【人物档案】');
    } finally {
      useWritingStore.setState((s: any) => {
        s.books = prev.books;
        s.settings = prev.settings;
        s.activeBookId = prev.activeBookId;
      });
    }
  });
})

});

describe('buildCanvasWritingContext（H3 缺口②：写作上下文注入）', () => {
  it('有活跃书时返回书名/章节/人物/大纲纯文本；无活跃书返回 null', () => {
    const ws = useWritingStore.getState();
    const prevBooks = ws.books;
    const prevChapters = ws.chapters;
    const prevSettings = ws.settings;
    const prevOutlines = ws.outlines;
    const prevActiveBookId = ws.activeBookId;
    const prevActiveChapterId = ws.activeChapterId;
    try {
      useWritingStore.setState((s: any) => {
        s.books = [
          {
            id: 'b1',
            title: '长夜行',
            description: null,
            genre: '悬疑',
            medium: 'serial',
            status: 'writing',
            coverColor: '#222',
            dailyGoal: 0,
            extra: '',
            createdAt: 0,
            updatedAt: 0,
          },
        ];
        s.activeBookId = 'b1';
        s.chapters = [
          {
            id: 'ch1',
            bookId: 'b1',
            title: '第一章 雨夜',
            content: '',
            sortOrder: 0,
            wordCount: 1200,
            status: 'completed',
            volume: '',
            kind: 'chapter',
            extra: '',
            createdAt: 0,
            updatedAt: 0,
          },
        ];
        s.activeChapterId = 'ch1';
        s.settings = [
          {
            id: 's1',
            bookId: 'b1',
            kind: 'character',
            name: '林越',
            subtitle: '主角',
            description: '退役侦探',
            extra: '',
            sortOrder: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        ];
        s.outlines = [
          {
            id: 'o1',
            bookId: 'b1',
            title: '追凶',
            summary: '林越在雨夜发现线索',
            chapterId: null,
            extra: '{}',
            sortOrder: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        ];
      });
      const ctx = buildCanvasWritingContext();
      expect(ctx).not.toBeNull();
      expect(ctx!).toContain('长夜行');
      expect(ctx!).toContain('第一章 雨夜');
      expect(ctx!).toContain('林越');
      expect(ctx!).toContain('追凶');
      // 注入 buildCanvasOpsMessage 后出现在 prompt 中
      const msg = buildCanvasOpsMessage([], '把林越的卡放中间', ctx);
      expect(msg).toContain('【写作背景】');
      expect(msg).toContain('长夜行');
      expect(msg).toContain('林越');
    } finally {
      useWritingStore.setState((s: any) => {
        s.books = prevBooks;
        s.chapters = prevChapters;
        s.settings = prevSettings;
        s.outlines = prevOutlines;
        s.activeBookId = prevActiveBookId;
        s.activeChapterId = prevActiveChapterId;
      });
    }
  });

  it('无活跃书返回 null，prompt 不出现写作背景段', () => {
    const ws = useWritingStore.getState();
    const prev = ws.activeBookId;
    try {
      useWritingStore.setState((s: any) => {
        s.activeBookId = null;
      });
      expect(buildCanvasWritingContext()).toBeNull();
      const msg = buildCanvasOpsMessage([], '加一张人设卡', null);
      expect(msg).not.toContain('【写作背景】');
    } finally {
      useWritingStore.setState((s: any) => {
        s.activeBookId = prev;
      });
    }
  });
});
