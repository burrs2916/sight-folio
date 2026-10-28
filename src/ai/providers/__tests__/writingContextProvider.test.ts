import { describe, it, expect, beforeEach } from 'vitest';
import { useWritingStore } from '../../../store/writingStore';
import { writingContextProvider, WRITING_MODULE_ID } from '../writingContextProvider';
import type {
  WritingBook,
  WritingChapter,
  WritingOutline,
  WritingSetting,
  WritingTimelineEvent,
  WritingStoryline,
  WritingForeshadowing,
} from '../../../services/tauri';

const BOOK_ID = 'book_test';

function makeBook(): WritingBook {
  return {
    id: BOOK_ID,
    title: '测试之书',
    description: '一个测试用的故事',
    genre: '',
    medium: '',
    status: 'draft',
    coverColor: '#4A338F',
    dailyGoal: 0,
    extra: '{}',
    createdAt: 1000,
    updatedAt: 2000,
  };
}

function makeChapter(partial: Partial<WritingChapter>): WritingChapter {
  return {
    id: `chap_${Math.random().toString(36).slice(2, 8)}`,
    bookId: BOOK_ID,
    title: '第一章',
    content: '<p>林越推开门，雨声涌了进来。</p>',
    sortOrder: 1,
    wordCount: 12,
    status: 'draft',
    volume: '',
    parentId: null,
    kind: '章',
    extra: '{}',
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  } as WritingChapter;
}

function makeSetting(partial: Partial<WritingSetting>): WritingSetting {
  return {
    id: `set_${Math.random().toString(36).slice(2, 8)}`,
    bookId: BOOK_ID,
    kind: 'character',
    name: '林越',
    subtitle: '主角',
    description: '沉默寡言的前刑警，怕水。',
    extra: '{}',
    sortOrder: 1,
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  };
}

describe('writingContextProvider', () => {
  beforeEach(() => {
    useWritingStore.setState({
      books: [makeBook()],
      activeBookId: BOOK_ID,
      activeChapterId: null,
      chapters: [makeChapter({})],
      settings: [makeSetting({})],
      activeSettingId: null,
      timelineEvents: [],
    });
  });

  it('isAvailable 仅对当前激活书为真', () => {
    expect(writingContextProvider.isAvailable(BOOK_ID)).toBe(true);
    expect(writingContextProvider.isAvailable('book_other')).toBe(false);
  });

  it('未激活的书 buildPack 返回 null', () => {
    useWritingStore.setState({ activeBookId: null });
    expect(writingContextProvider.buildPack(BOOK_ID)).toBeNull();
  });

  it('buildPack 产出八个分节，正文为纯文本', () => {
    useWritingStore.setState({ activeChapterId: null, chapters: [makeChapter({ id: 'chap_a' })] });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 });
    expect(pack).not.toBeNull();
    expect(pack!.moduleId).toBe(WRITING_MODULE_ID);
    expect(pack!.scopeLabel).toBe('测试之书');
    const keys = pack!.sections.map((s) => s.key);
    // P0-2：写作域五组语料接入后 4 → 8（时间线·剧情线 / 伏笔 / 灵感 / 校对）
    expect(keys).toEqual([
      'book-overview',
      'active-chapter',
      'characters',
      'worldbuilding',
      'timeline-storylines',
      'foreshadowing',
      'inspirations',
      'proofread',
    ]);

    // 正文分节：无选中章节 → empty + 明确盲区声明
    const chapterSection = pack!.sections.find((s) => s.key === 'active-chapter')!;
    expect(chapterSection.dataQuality?.status).toBe('empty');

    // 人设卡有数据 → ok，且 facts 带结构化名单
    const charSection = pack!.sections.find((s) => s.key === 'characters')!;
    expect(charSection.dataQuality?.status ?? 'ok').toBe('ok');
    expect(charSection.facts).toMatchObject({ count: 1, names: ['林越'] });
  });

  it('正文分节在选中章节时剥离 HTML 标签', () => {
    useWritingStore.setState({ activeChapterId: 'chap_a', chapters: [makeChapter({ id: 'chap_a' })] });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const chapterSection = pack.sections.find((s) => s.key === 'active-chapter')!;
    expect(chapterSection.dataQuality?.status ?? 'ok').toBe('ok');
    expect(chapterSection.content).toContain('林越推开门');
    expect(chapterSection.content).not.toContain('<p>');
  });

  it('没有人设卡时 characters 分节声明 empty 并解释后果（不把没数据读成没问题）', () => {
    useWritingStore.setState({ settings: [] });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const charSection = pack.sections.find((s) => s.key === 'characters')!;
    expect(charSection.dataQuality?.status).toBe('empty');
    expect(charSection.dataQuality?.reason).toBeTruthy();
  });

  it('人设卡时间线（独立表 writing_timeline_events）渲染进 characters 分节（D 全书级实体）', () => {
    const setting = makeSetting({
      extra: JSON.stringify({
        relations: [{ target: '苏晚', type: '旧搭档' }],
      }),
    });
    const ev: WritingTimelineEvent = {
      id: 'ev_1',
      bookId: BOOK_ID,
      settingId: setting.id,
      at: '第一章前',
      event: '离开刑警队',
      chapterId: null,
      storylineId: null,
      outlineId: null,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    useWritingStore.setState({ settings: [setting], timelineEvents: [ev] });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const charSection = pack.sections.find((s) => s.key === 'characters')!;
    expect(charSection.content).toContain('苏晚(旧搭档)');
    expect(charSection.content).toContain('第一章前：离开刑警队');
    expect(charSection.facts).toMatchObject({ count: 1, relationsTotal: 1, timelineTotal: 1 });
  });

  it('人设卡 extra 是坏 JSON 时按空数据处理，不让 pack 构建崩掉', () => {
    useWritingStore.setState({ settings: [makeSetting({ extra: '{not-json' })] });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const charSection = pack.sections.find((s) => s.key === 'characters')!;
    expect(charSection.facts).toMatchObject({ count: 1, relationsTotal: 0, timelineTotal: 0 });
  });

  it('book-overview 渲染大纲节拍（P5）：已落章显示章节名，梗概跟随', () => {
    useWritingStore.setState({
      activeChapterId: 'chap_a',
      chapters: [makeChapter({ id: 'chap_a' })],
      outlines: [
        {
          id: 'o1',
          bookId: BOOK_ID,
          title: '雨夜重逢',
          summary: '林越再遇苏晚',
          chapterId: 'chap_a',
          extra: '{}',
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        } satisfies WritingOutline,
      ],
    });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const overview = pack.sections.find((s) => s.key === 'book-overview')!;
    expect(overview.content).toContain('雨夜重逢 → 第一章');
    expect(overview.content).toContain('林越再遇苏晚');
    expect(overview.facts).toMatchObject({ outlineCount: 1 });
  });

  it('提供写作预设，且不写死 agent / 模型', () => {
    const presets = writingContextProvider.presets ?? [];
    expect(presets.map((p) => p.key)).toContain('character-consistency');
    expect(presets.map((p) => p.key)).toContain('plot-review');
    // 预设协议里没有 agent 字段——agentId 永远由用户在发起时选择
    for (const p of presets) {
      expect((p as unknown as Record<string, unknown>).agentId).toBeUndefined();
    }
  });

  it('P1·A1 审校预设扩展：新增情感浓度/AI 味/节奏张力/逻辑连续性四档，prompt 双语且带评分约束', () => {
    const presets = writingContextProvider.presets ?? [];
    const keys = presets.map((p) => p.key);
    expect(keys).toContain('emotional-intensity');
    expect(keys).toContain('ai-flavor');
    expect(keys).toContain('pacing-tension');
    expect(keys).toContain('logical-continuity');

    const byKey = new Map(presets.map((p) => [p.key, p]));

    // 情感浓度：要求 1-5 分、原文证据句、提升方向
    const emotion = byKey.get('emotional-intensity')!;
    expect(emotion.title['zh-CN']).toContain('情感');
    expect(emotion.prompt['zh-CN']).toContain('1-5');
    expect(emotion.prompt['zh-CN']).toContain('证据');
    expect(emotion.prompt['en-US']).toContain('1-5');
    expect(emotion.prompt['en-US']).toContain('evidence');

    // AI 味：识别模板套话/节奏单调/情绪直述等 AI 腔
    const aiFlavor = byKey.get('ai-flavor')!;
    expect(aiFlavor.prompt['zh-CN']).toContain('模板');
    expect(aiFlavor.prompt['zh-CN']).toContain('节奏单调');
    expect(aiFlavor.prompt['en-US']).toContain('template');
    expect(aiFlavor.prompt['en-US']).toContain('told emotions');

    // 节奏张力：张力值分档 + 与全书字数分布对照
    const pacing = byKey.get('pacing-tension')!;
    expect(pacing.prompt['zh-CN']).toContain('张力');
    expect(pacing.prompt['zh-CN']).toContain('字数分布');
    expect(pacing.sectionKeys ?? []).toContain('active-chapter');

    // 逻辑连续性：场景衔接/时间线/动机/设定遵守/伏笔衔接
    const logic = byKey.get('logical-continuity')!;
    expect(logic.prompt['zh-CN']).toContain('时间线');
    expect(logic.prompt['zh-CN']).toContain('伏笔');
    const logicSections = logic.sectionKeys ?? [];
    expect(logicSections).toContain('timeline-storylines');
    expect(logicSections).toContain('foreshadowing');

    // 四档都走既有写作 group，加入自动轮转池
    for (const key of ['emotional-intensity', 'ai-flavor', 'pacing-tension', 'logical-continuity']) {
      expect(byKey.get(key)!.group).toBe('writing');
    }
  });

  it('相同内容两次构建 digest 一致（增量闸门的前提）', () => {
    useWritingStore.setState({ activeChapterId: 'chap_a', chapters: [makeChapter({ id: 'chap_a' })] });
    const p1 = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const p2 = writingContextProvider.buildPack(BOOK_ID, { now: 6000 })!;
    expect(p1.digest).toBe(p2.digest);
  });

  it('写作域语料分节（P0-2）：时间线/伏笔/灵感渲染进 pack 且带计数 facts', () => {
    const storyline: WritingStoryline = {
      id: 'sl_1',
      bookId: BOOK_ID,
      name: '复仇线',
      color: '#4fc3f7',
      description: '主线',
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const ev: WritingTimelineEvent = {
      id: 'ev_t1',
      bookId: BOOK_ID,
      settingId: null,
      at: '第一章',
      event: '林越收到匿名信',
      chapterId: null,
      storylineId: 'sl_1',
      outlineId: null,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const foreshadowing: WritingForeshadowing = {
      id: 'fs_1',
      bookId: BOOK_ID,
      title: '雨夜的怀表',
      description: '林越口袋里多了一块不属于他的怀表',
      plantChapterId: null,
      payoffChapterId: null,
      status: 'pending',
      storylineId: null,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    useWritingStore.setState({
      timelineEvents: [ev],
      storylines: [storyline],
      foreshadowings: [foreshadowing],
      outlines: [
        {
          id: 'o_loose',
          bookId: BOOK_ID,
          title: '苏晚也许知道真相',
          summary: '',
          chapterId: null,
          extra: '{}',
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        } satisfies WritingOutline,
      ],
    });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;

    const timeline = pack.sections.find((s) => s.key === 'timeline-storylines')!;
    expect(timeline.content).toContain('林越收到匿名信');
    expect(timeline.facts).toMatchObject({ eventCount: 1, storylineCount: 1 });

    const fs = pack.sections.find((s) => s.key === 'foreshadowing')!;
    expect(fs.content).toContain('雨夜的怀表');
    expect(fs.facts).toMatchObject({ count: 1 });

    const insp = pack.sections.find((s) => s.key === 'inspirations')!;
    expect(insp.content).toContain('苏晚也许知道真相');
    expect(insp.facts).toMatchObject({ looseCount: 1 });
  });

  it('空库时四个语料分节仍产出（builder 自带「暂无」兜底，不崩、不丢分节）', () => {
    useWritingStore.setState({
      activeChapterId: null,
      timelineEvents: [],
      storylines: [],
      foreshadowings: [],
      outlines: [],
    });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    for (const key of ['timeline-storylines', 'foreshadowing', 'inspirations', 'proofread']) {
      const sec = pack.sections.find((s) => s.key === key);
      expect(sec, `${key} 分节应存在`).toBeTruthy();
      expect((sec!.content ?? '').length).toBeGreaterThan(0);
    }
  });

  it('人设卡 profile 结构化字段（外貌/性格/动机/口头禅/备注）渲染进 characters 分节', () => {
    useWritingStore.setState({
      settings: [
        makeSetting({
          extra: JSON.stringify({
            profile: {
              appearance: '短发',
              personality: '沉默',
              motivation: '追查真相',
              catchphrase: '再等等',
              notes: '怕水',
            },
          }),
        }),
      ],
    });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const charSection = pack.sections.find((s) => s.key === 'characters')!;
    expect(charSection.content).toContain('外貌=短发');
    expect(charSection.content).toContain('性格=沉默');
    expect(charSection.content).toContain('动机=追查真相');
    expect(charSection.content).toContain('口头禅=再等等');
    expect(charSection.content).toContain('备注=怕水');
  });

  it('世界观结构化字段（类型/规则/例外/关联/关系/备注）渲染进 worldbuilding 分节', () => {
    useWritingStore.setState({
      settings: [
        makeSetting({
          kind: 'worldbuilding',
          name: '雨城',
          extra: JSON.stringify({
            worldbuildingProfile: {
              type: '城市',
              rules: '常下雨',
              exceptions: '五月不下',
              linkedTo: '林越',
              notes: '潮湿',
            },
            relations: [{ target: '林越', type: '故土' }],
          }),
        }),
      ],
    });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const wbSection = pack.sections.find((s) => s.key === 'worldbuilding')!;
    expect(wbSection.content).toContain('类型=城市');
    expect(wbSection.content).toContain('规则=常下雨');
    expect(wbSection.content).toContain('例外=五月不下');
    expect(wbSection.content).toContain('关联=林越');
    expect(wbSection.content).toContain('关系=[林越]');
    expect(wbSection.content).toContain('备注=潮湿');
  });

  it('bookId 守卫：其他书的 settings 不串入当前书 pack', () => {
    useWritingStore.setState({
      settings: [
        makeSetting({ id: 'char_own', name: '林越' }),
        makeSetting({ id: 'char_other', name: '他书角色', bookId: 'book_other' }),
      ],
    });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const charSection = pack.sections.find((s) => s.key === 'characters')!;
    expect(charSection.content).toContain('林越');
    expect(charSection.content).not.toContain('他书角色');
    expect(charSection.facts).toMatchObject({ count: 1, names: ['林越'] });
  });
});
