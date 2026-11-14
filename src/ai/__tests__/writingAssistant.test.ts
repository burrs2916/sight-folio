import { describe, it, expect, vi } from 'vitest';
import {
  buildContinueMessage,
  buildPolishMessage,
  buildRewriteMessage,
  buildSummarizeMessage,
  buildReviewMessage,
  buildInlineMessage,
  buildSettingCompletionMessage,
  parseSettingCompletion,
  parseReviewEntries,
  runInlineWritingTask,
  tailOf,
  textToParagraphHtml,
  TAIL_CHARS,
  type InlineWritingContext,
  type SettingCompletionContext,
} from '../writingAssistant';

// C 流式：runInlineWritingTask 依赖 agentStore（subscribe/streamingContent）与 agentApi.listMessages。
// mock 路径从 src/ai/__tests__ 到 src 是两级 ../../（层级错一级会静默失效）。
const h = vi.hoisted(() => {
  const listeners: Array<(s: unknown) => void> = [];
  const state = {
    agents: [{ id: 'a1', name: 'A' }],
    isStreaming: false,
    interruptRequested: false,
    streamingContent: '',
    stoppedConversationId: null as string | null,
    createConversation: vi.fn(async () => ({ id: 'conv_1' })),
    sendMessage: vi.fn(async () => {}),
    subscribe: vi.fn((fn: (s: unknown) => void) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
  };
  return {
    state,
    emit: () => listeners.forEach((fn) => fn(state)),
    listMessages: vi.fn(),
  };
});

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.state), {
    getState: () => h.state,
    subscribe: h.state.subscribe,
  }),
}));

vi.mock('../../services/tauri', () => ({
  agentApi: { listMessages: h.listMessages },
}));

function ctx(partial: Partial<InlineWritingContext> = {}): InlineWritingContext {
  return {
    bookTitle: '测试之书',
    bookDescription: '一个测试用的故事',
    chapterTitle: '第一章',
    chapterText: '林越推开门，雨声涌了进来。',
    characterLines: ['林越（主角）：沉默寡言的前刑警。'],
    outlineLines: ['雨夜重逢 → 第一章：林越再遇苏晚'],
    ...partial,
  };
}

describe('writingAssistant', () => {
  it('续写消息：内嵌尾部原文 + 人设卡 + 大纲，且明确禁解释', () => {
    const msg = buildContinueMessage(ctx());
    expect(msg).toContain('林越推开门');
    expect(msg).toContain('林越（主角）：沉默寡言的前刑警。');
    expect(msg).toContain('雨夜重逢 → 第一章');
    expect(msg).toContain('不要任何解释');
  });

  it('续写消息：无人设卡时声明盲区，而不是让模型凭空编关系', () => {
    const msg = buildContinueMessage(ctx({ characterLines: [], outlineLines: [] }));
    expect(msg).toContain('还没有人设卡');
    expect(msg).not.toContain('雨夜重逢');
  });

  it('tailOf：超长文本只保留末尾并以省略号起头', () => {
    const long = 'a'.repeat(TAIL_CHARS + 100) + '尾部文本';
    const tail = tailOf(long);
    expect(tail.startsWith('…')).toBe(true);
    expect(tail.endsWith('尾部文本')).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(TAIL_CHARS + 1);
    // 不超长时原样返回
    expect(tailOf('短文本')).toBe('短文本');
  });

  it('润色消息：携带全文（不截断），并约束不改情节', () => {
    const longText = 'x'.repeat(TAIL_CHARS + 500);
    const msg = buildPolishMessage(ctx({ chapterText: longText }));
    expect(msg).toContain(longText);
    expect(msg).toContain('不得改变');
  });

  it('B 选区级润色：只喂选中片段 + 前后文语境，约束输出可无缝拼回', () => {
    const msg = buildPolishMessage(
      ctx({
        selectionText: '他缓缓抬起头，眼神里有一种说不清的东西。',
        beforeText: '门外的雨停了。',
        afterText: '苏晚推门进来，看到的就是这一幕。',
      }),
    );
    // 选区分支：只喂片段，不喂整章
    expect(msg).toContain('【选中片段】');
    expect(msg).toContain('他缓缓抬起头');
    expect(msg).not.toContain('林越推开门，雨声涌了进来。');
    // 前后文作语境（含「选区」标记，模型不会把语境当改写对象）
    expect(msg).toContain('【选区前文（结尾）】');
    expect(msg).toContain('门外的雨停了。');
    expect(msg).toContain('【选区后文（开头）】');
    expect(msg).toContain('苏晚推门进来');
    // 衔接约束：输出必须能拼回原位
    expect(msg).toContain('无缝拼回');
    // 不喂整章 → 整章原文标记不应出现
    expect(msg).not.toContain('【原文】');
  });

  it('B 整章润色保持原行为：无选区字段时不出选区分支', () => {
    const msg = buildPolishMessage(ctx());
    expect(msg).toContain('【原文】');
    expect(msg).not.toContain('【选中片段】');
    expect(msg).not.toContain('【选区前文（结尾）】');
  });

  it('C 流式：onDelta 转发 streamingContent；结束后退订（迟到分片不再进入回调）', async () => {
    h.state.sendMessage.mockImplementation(async () => {
      h.state.streamingContent = '部分';
      h.emit();
      h.state.streamingContent = '部分全文';
      h.emit();
    });
    h.listMessages.mockResolvedValue([{ role: 'assistant', content: '最终正文' }]);

    const deltas: string[] = [];
    const res = await runInlineWritingTask({
      agentId: 'a1',
      kind: 'continue',
      ctx: ctx(),
      onDelta: (full) => deltas.push(full),
    });

    expect(h.state.createConversation).toHaveBeenCalledWith('a1', expect.stringContaining('续写'));
    expect(deltas).toEqual(['部分', '部分全文']);
    expect(res.text).toBe('最终正文');
    expect(res.interrupted).toBeUndefined();

    // 退订生效：流结束后的迟到分片不再触发回调
    h.state.streamingContent = '迟到的分片';
    h.emit();
    expect(deltas.length).toBe(2);
  });

  it('C 取消：stoppedConversationId 命中 → 返回 interrupted，不拉消息、不抛错', async () => {
    h.state.sendMessage.mockImplementation(async () => {
      h.state.stoppedConversationId = 'conv_1';
    });
    h.listMessages.mockClear(); // hoisted mock 模块级共享，清掉上一用例的调用计数
    const res = await runInlineWritingTask({
      agentId: 'a1',
      kind: 'polish',
      ctx: ctx(),
      onDelta: () => {},
    });
    expect(res.interrupted).toBe(true);
    expect(res.text).toBe('');
    expect(h.listMessages).not.toHaveBeenCalled();
  });

  it('textToParagraphHtml：空行分段、XML 转义、段内换行保留', () => {
    const html = textToParagraphHtml('第一段<内容>\n第二行\n\n第二段');
    expect(html).toBe('<p>第一段&lt;内容&gt;<br>第二行</p><p>第二段</p>');
  });

  it('P8 参数化：目标字数替换默认字数档，走向要求融入且要求不复述', () => {
    const msg = buildContinueMessage(ctx({ targetWords: 1200, directive: '结尾苏晚发现秘密' }));
    expect(msg).toContain('约 1200 字');
    expect(msg).not.toContain('300～600');
    expect(msg).toContain('【走向要求】');
    expect(msg).toContain('结尾苏晚发现秘密');
    expect(msg).toContain('不要在输出里复述或解释这些要求');
  });

  it('P8 风格档：refine/vivid/plain 各有风格行，default 不附加', () => {
    expect(buildPolishMessage(ctx({ style: 'refine' }))).toContain('精炼紧凑');
    expect(buildPolishMessage(ctx({ style: 'vivid' }))).toContain('文笔华美');
    expect(buildPolishMessage(ctx({ style: 'plain' }))).toContain('平实口语');
    expect(buildPolishMessage(ctx({ style: 'default' }))).not.toContain('风格要求');
  });

  it('P0 改写选区级：只喂片段 + 语境；允许重构句式但不改情节，输出可拼回', () => {
    const msg = buildRewriteMessage(
      ctx({
        selectionText: '他缓缓抬起头，眼神里有一种说不清的东西。',
        beforeText: '门外的雨停了。',
        afterText: '苏晚推门进来，看到的就是这一幕。',
        style: 'vivid',
      }),
    );
    expect(msg).toContain('【选中片段】');
    expect(msg).toContain('他缓缓抬起头');
    expect(msg).not.toContain('林越推开门，雨声涌了进来。');
    expect(msg).toContain('【选区前文（结尾）】');
    expect(msg).toContain('【选区后文（开头）】');
    // 改写允许重构表达，但仍禁止改故事事实
    expect(msg).toContain('允许调整句式长短');
    expect(msg).toContain('无缝拼回');
    // 风格档同样生效
    expect(msg).toContain('文笔华美');
  });

  it('P0 改写整章：携带全文且约束不改情节、保留分段', () => {
    const msg = buildRewriteMessage(ctx());
    expect(msg).toContain('【原文】');
    expect(msg).toContain('林越推开门，雨声涌了进来。');
    expect(msg).toContain('增删故事事实');
    expect(msg).not.toContain('【选中片段】');
  });

  it('P0 文风一致性：开关开 + 指纹 → 续写/润色/改写消息注入文风块', () => {
    const fp = '句式：短句 62%；段落均长：3 句；对话占比：28%；动词倾向：动作直陈。';
    const base = { styleConsistency: true, styleFingerprint: fp };
    for (const msg of [
      buildContinueMessage(ctx(base)),
      buildPolishMessage(ctx(base)),
      buildRewriteMessage(ctx(base)),
      buildPolishMessage(ctx({ ...base, selectionText: '选中句。', beforeText: '前文', afterText: '后文' })),
      buildRewriteMessage(ctx({ ...base, selectionText: '选中句。', beforeText: '前文', afterText: '后文' })),
    ]) {
      expect(msg).toContain('【文风要求】');
      expect(msg).toContain(fp);
    }
  });

  it('P0 文风一致性：开关关 / 无指纹 / 非生成类任务不注入文风块', () => {
    const fp = '句式：短句 62%；段落均长：3 句；对话占比：28%；动词倾向：动作直陈。';
    expect(buildContinueMessage(ctx({ styleConsistency: false, styleFingerprint: fp }))).not.toContain('【文风要求】');
    expect(buildContinueMessage(ctx({ styleConsistency: true, styleFingerprint: '  ' }))).not.toContain('【文风要求】');
    expect(buildContinueMessage(ctx({ styleConsistency: true }))).not.toContain('【文风要求】');
    // summarize / review 不属于生成类任务，即使开关开也不注入
    expect(buildSummarizeMessage(ctx({ styleConsistency: true, styleFingerprint: fp }))).not.toContain('【文风要求】');
    expect(buildReviewMessage(ctx({ styleConsistency: true, styleFingerprint: fp }))).not.toContain('【文风要求】');
  });

  it('P0 总结选区级：只总结选中片段、不喂整章、限定篇幅', () => {
    const msg = buildSummarizeMessage(ctx({ selectionText: '林越推开门，雨声涌了进来。' }));
    expect(msg).toContain('【选中片段】');
    expect(msg).toContain('200 字以内');
    expect(msg).not.toContain('【原文】');
    expect(msg).not.toContain('【大纲】'); // 选区分支不带大纲上下文
  });

  it('P0 总结整章：喂全文并限定篇幅与范围', () => {
    const msg = buildSummarizeMessage(ctx());
    expect(msg).toContain('【原文】');
    expect(msg).toContain('400 字以内');
    expect(msg).toContain('不要补充本章之外的情节');
  });

  it('P0 buildInlineMessage 按 kind 分发到对应构建器', () => {
    expect(buildInlineMessage('rewrite', ctx())).toContain('【原文】');
    expect(buildInlineMessage('summarize', ctx())).toContain('400 字以内');
    expect(buildInlineMessage('polish', ctx())).toContain('不得改变');
    expect(buildInlineMessage('review', ctx())).toContain('逐句语法审校');
  });

  it('逐句审校消息：整章模式喂全文，只列问题句、输出规则含修改建议与无问题兜底', () => {
    const msg = buildReviewMessage(ctx());
    expect(msg).toContain('【原文】');
    expect(msg).toContain('林越推开门，雨声涌了进来。');
    expect(msg).toContain('只列出存在问题的句子');
    expect(msg).toContain('修改建议');
    expect(msg).toContain('未发现明显语法问题');
    expect(msg).toContain('评价文风');
    expect(msg).not.toContain('【选中片段】');
  });

  it('逐句审校选区级：只审校选中片段并标记原文来源非整章', () => {
    const msg = buildReviewMessage(ctx({ selectionText: '他缓缓抬起头，眼神里有一种说不清的东西。' }));
    expect(msg).toContain('【选中片段】');
    expect(msg).toContain('他缓缓抬起头');
    expect(msg).not.toContain('林越推开门，雨声涌了进来。');
  });

  it('P0 设定卡补全消息：内嵌卡片名/已有字段/缺失键，且只输出 JSON', () => {
    const sctx: SettingCompletionContext = {
      kind: 'character',
      settingName: '林越',
      subtitle: '男主',
      description: '前刑警，沉默寡言。',
      existing: { appearance: '高个子', personality: '', motivation: '', catchphrase: '', notes: '' },
      missingKeys: ['personality', 'motivation', 'catchphrase', 'notes'],
    };
    const msg = buildSettingCompletionMessage(sctx);
    expect(msg).toContain('人物设定卡');
    expect(msg).toContain('林越');
    expect(msg).toContain('appearance');
    expect(msg).toContain('personality, motivation, catchphrase, notes');
    expect(msg).toContain('只输出一个 JSON 对象');
  });

  it('P0 parseSettingCompletion：容忍围栏与前后缀，只取允许键且跳过空值', () => {
    const allowed = ['appearance', 'personality', 'motivation', 'catchphrase', 'notes'];
    const fields = parseSettingCompletion(
      '```json\n{"appearance":"175cm","personality":"沉默寡言","catchphrase":"","foobar":"x"}\n```',
      allowed,
    );
    expect(fields).toEqual([
      { key: 'appearance', value: '175cm' },
      { key: 'personality', value: '沉默寡言' },
    ]);
  });

  it('P0 parseSettingCompletion：非 JSON 输出返回空数组（UI 走未解析提示）', () => {
    expect(parseSettingCompletion('不好意思，我补充如下：一番话…', ['personality'])).toEqual([]);
  });
});

describe('逐句审校结构化输出（批次④ T3）', () => {
  it('buildReviewMessage 要求四段竖线格式与示例行', () => {
    const msg = buildReviewMessage(ctx());
    expect(msg).toContain('竖线 | 分隔四个字段');
    expect(msg).toContain('第1句|他是我的一个朋友。|成分赘余|他是我朋友。');
    expect(msg).toContain('未发现明显语法问题');
  });

  it('parseReviewEntries：四段完整条目（竖线/全角竖线/冒号连接均解析）', () => {
    const text = [
      '第1句|他是我的一个朋友。|成分赘余|他是我朋友。',
      '第2句｜她认真地学习，成绩很好。｜语序不当｜她学习得很认真，成绩很好。',
      '第3句：他不但聪明，而且很努力。|关联词不当|他不但聪明，而且很努力（原句无问题则不应列出）。',
      '第4句|她穿着一件白色上衣。|搭配不当',
    ].join('\n');
    const entries = parseReviewEntries(text);
    expect(entries.length).toBe(3);
    expect(entries[0]).toEqual({
      index: 1,
      original: '他是我的一个朋友。',
      issue: '成分赘余',
      suggestion: '他是我朋友。',
    });
    expect(entries[1].index).toBe(2);
    expect(entries[1].issue).toBe('语序不当');
    expect(entries[2].index).toBe(3);
    expect(entries[2].suggestion).toContain('他不但聪明');
  });

  it('parseReviewEntries：缺问题类型的 3 段条目按 原句|建议 解析', () => {
    const entries = parseReviewEntries('第5句|他做事马马虎虎的。|他做事马马虎虎。');
    expect(entries).toEqual([{ index: 5, original: '他做事马马虎虎的。', issue: '', suggestion: '他做事马马虎虎。' }]);
  });

  it('parseReviewEntries：无问题兜底/自由文本/缺字段行被跳过', () => {
    expect(parseReviewEntries('未发现明显语法问题')).toEqual([]);
    expect(parseReviewEntries('整体读下来很通顺。\n第2句|只有原句没有建议\n另外一行自由文本')).toEqual([]);
  });

  it('parseReviewEntries：重复条目去重', () => {
    const entries = parseReviewEntries(
      ['第1句|他是我的一个朋友。|成分赘余|他是我朋友。', '第1句|他是我的一个朋友。|成分赘余|他是我朋友。'].join('\n'),
    );
    expect(entries.length).toBe(1);
  });
});

// 2026-11-08 李先生：「散文跟小说肯定不一样」。以前四条 prompt 一律写「整章小说」
// 「不得改变情节、人物行为、时间线」——散文没有情节链，这条约束既误导模型也禁掉了正常的删改。
describe('散文体裁的 prompt', () => {
  const essay = { genre: 'essay' };

  it('正文单位叫「篇目」，不叫「章节」', () => {
    expect(buildPolishMessage(ctx(essay))).toContain('【当前篇目】');
    expect(buildSummarizeMessage(ctx(essay))).toContain('【当前篇目】');
  });

  it('约束换成散文的：保立意与所写细节、禁止虚构经历', () => {
    const msg = buildPolishMessage(ctx(essay));
    expect(msg).toContain('立意');
    expect(msg).toContain('不得虚构');
    expect(msg).not.toContain('整章小说');
  });

  it('改写不许替作者补足他没写的结论', () => {
    const msg = buildRewriteMessage(ctx(essay));
    expect(msg).toContain('立意');
    expect(msg).not.toContain('整章小说');
  });

  it('审校按散文说，不再出现「小说文本」', () => {
    const msg = buildReviewMessage(ctx(essay));
    expect(msg).toContain('请对下面的散文文本');
    expect(msg).not.toContain('小说文本');
  });

  it('回归锁：小说（含没设 genre 的旧书）文案与改造前逐字一致', () => {
    for (const g of [undefined, '']) {
      expect(buildPolishMessage(ctx({ genre: g }))).toContain('请润色下面的整章小说');
      expect(buildRewriteMessage(ctx({ genre: g }))).toContain('请改写下面的整章小说');
      expect(buildSummarizeMessage(ctx({ genre: g }))).toContain('请总结本章小说');
      expect(buildReviewMessage(ctx({ genre: g }))).toContain('请对下面的小说文本');
      expect(buildPolishMessage(ctx({ genre: g }))).toContain('【当前章节】');
    }
  });
});

// 2026-11-09 诗歌实装（审计 docs/诗歌剧本体裁实装审计-2026-11-09.md 刀 2）。
// 诗与小说在 prompt 上真正不同的地方只有一件：**分行与节次就是本体**。
// 模型"顺手"把三行合成一段，诗就被它改没了 —— 所以这条必须写死在每条生成类约束里。
describe('诗歌体裁的 prompt', () => {
  const poem = { genre: 'poetry' };

  it('正文单位叫「诗作」，不叫「章节」也不叫「篇目」', () => {
    for (const build of [buildPolishMessage, buildSummarizeMessage, buildRewriteMessage, buildReviewMessage]) {
      const msg = build(ctx(poem));
      expect(msg).toContain('【当前诗作】');
      expect(msg).not.toContain('【当前章节】');
      expect(msg).not.toContain('【当前篇目】');
    }
  });

  it('润色：先保分行与节次，再谈炼字；不许把诗排成散文段落', () => {
    const msg = buildPolishMessage(ctx(poem));
    expect(msg).toContain('分行与节次就是诗的本体');
    expect(msg).toContain('把诗排成散文段落');
    expect(msg).not.toContain('整章小说');
  });

  it('润色/改写都不许替作者解读诗意（诗最容易被 AI 加成"表达了作者…"）', () => {
    expect(buildPolishMessage(ctx(poem))).toContain('不得替作者解释');
    expect(buildRewriteMessage(ctx(poem))).toContain('不得补上作者没写的结论');
  });

  it('改写可以动断句位置，但不许增删节数', () => {
    const msg = buildRewriteMessage(ctx(poem));
    expect(msg).toContain('行的断句位置');
    expect(msg).toContain('不得增删节数');
  });

  it('总结只说它写了什么，不替它"思想感情"', () => {
    const msg = buildSummarizeMessage(ctx(poem));
    expect(msg).toContain('意象');
    expect(msg).toContain('不要替它解释');
    expect(msg).not.toContain('请总结本章小说');
  });

  it('续写按"再长出一节"说，并且仍按分行排布', () => {
    const msg = buildContinueMessage(ctx(poem));
    expect(msg).toContain('请接着下面这首诗往下写');
    expect(msg).toContain('保持分行');
    expect(msg).not.toContain('小说片段续写');
    // 用户给了目标字数也不能被丢掉（只是换成按诗的量词说）
    expect(buildContinueMessage(ctx({ genre: 'poetry', targetWords: 120 }))).toContain('约 120 字');
  });

  it('审校：按诗歌说，并追加"跨行/省标点/倒装不算病句"这一条件', () => {
    const msg = buildReviewMessage(ctx(poem));
    expect(msg).toContain('请对下面的诗歌文本');
    expect(msg).not.toContain('小说文本');
    // 源文里「不要」两侧带 ** 强调标记，断言取它后面那段纯文本
    expect(msg).toContain('把跨行、省标点、倒装判为病句');
  });

  it('回归锁：小说（含没设 genre 的旧书）续写文案与改造前逐字一致', () => {
    for (const g of [undefined, '']) {
      const msg = buildContinueMessage(ctx({ genre: g }));
      expect(msg).toContain('请为下面的小说片段续写');
      expect(msg).toContain('从上面的末尾无缝接着往下写 300～600 字');
      expect(msg).toContain('【当前章节】');
      // 诗歌专用那条附加规则绝不能挂到小说身上
      expect(msg).not.toContain('跨行');
    }
    expect(buildReviewMessage(ctx({ genre: '' }))).not.toContain('跨行');
  });

  it('散文体裁不受本刀影响（诗歌分支插在散文之前，散文分支照旧命中）', () => {
    expect(buildPolishMessage(ctx({ genre: 'essay' }))).toContain('请润色下面这篇散文');
    expect(buildReviewMessage(ctx({ genre: 'essay' }))).toContain('请对下面的散文文本');
    expect(buildReviewMessage(ctx({ genre: 'essay' }))).not.toContain('跨行');
    expect(buildContinueMessage(ctx({ genre: 'essay' }))).toContain('请为下面的小说片段续写');
  });
});

// ── A-1 选区三件套体裁硬边界锁 ──────────────────────────────────────────────
// 整篇三件套早已 genre 化；本锁确保「选中片段」分支不再共用小说口径，
// 各体裁拿到自己的硬边界（诗禁排散文、剧本禁台词改叙述、日记禁增补记忆、
// 散文禁虚构经历），且 novel 选区文案逐字不变（零回归线）。
describe('选区三件套按体裁给硬边界（A-1）', () => {
  const sel = (partial: Partial<InlineWritingContext>) =>
    ctx({ selectionText: '片段内容。', beforeText: '前文', afterText: '后文', ...partial });

  it('诗歌：选区润色禁把诗排成散文，且不出现小说"情节/人物行为"约束', () => {
    const msg = buildPolishMessage(sel({ genre: 'poetry' }));
    expect(msg).toContain('分行与节次就是诗的本体');
    expect(msg).toContain('不许把诗排成散文段落');
    expect(msg).not.toContain('情节、人物行为、时间线');
  });

  it('剧本：选区润色保护台词/舞台指示，不被当成叙述', () => {
    const msg = buildPolishMessage(sel({ genre: 'script' }));
    expect(msg).toContain('台词是人物');
    expect(msg).toContain('不得把台词改成叙述');
  });

  it('日记：选区改写禁增补记忆，且不出现小说"人物行为"约束', () => {
    const msg = buildRewriteMessage(sel({ genre: 'diary' }));
    expect(msg).toContain('不得增补记忆');
    expect(msg).not.toContain('情节、人物行为、时间线');
  });

  it('散文：选区改写禁虚构原文没有的经历', () => {
    const msg = buildRewriteMessage(sel({ genre: 'essay' }));
    expect(msg).toContain('**不要**虚构原文没有的经历、场景或引语');
  });

  it('总结也分体裁：诗列意象不解读思想感情，剧本按人物要/挡/得', () => {
    const poetry = buildSummarizeMessage(ctx({ genre: 'poetry', selectionText: '两句诗。' }));
    expect(poetry).toContain('列出它用了哪些意象');
    expect(poetry).toContain('不要替它解释');
    const script = buildSummarizeMessage(ctx({ genre: 'script', selectionText: '一段对白。' }));
    expect(script).toContain('各自要什么、谁挡着');
  });

  it('零回归：小说（含未设 genre 旧书）选区文案逐字保持原口径', () => {
    for (const g of ['novel', undefined]) {
      const p = buildPolishMessage(ctx({ genre: g, selectionText: '选中句。' }));
      const r = buildRewriteMessage(ctx({ genre: g, selectionText: '选中句。' }));
      const s = buildSummarizeMessage(ctx({ genre: g, selectionText: '选中句。' }));
      expect(p).toContain('提升文字表现力（节奏、画面、对话质感），但**不得改变**情节、人物行为、时间线与信息量');
      expect(r).toContain('保留情节、人物行为、时间线与全部信息量');
      expect(s).toContain('提炼这一段发生的情节、人物动向与关键信息');
    }
  });
});
