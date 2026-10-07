import { describe, it, expect, vi} from "vitest";
import {
  buildContinueMessage,
  buildPolishMessage,
  runInlineWritingTask,
  tailOf,
  textToParagraphHtml,
  TAIL_CHARS,
  type InlineWritingContext} from "../writingAssistant";

// C 流式：runInlineWritingTask 依赖 agentStore（subscribe/streamingContent）与 agentApi.listMessages。
// mock 路径从 src/ai/__tests__ 到 src 是两级 ../../（层级错一级会静默失效）。
const h = vi.hoisted(() => {
  const listeners: Array<(s: unknown) => void> = [];
  const state = {
    agents: [{ id: "a1", name: "A" }],
    isStreaming: false,
    interruptRequested: false,
    streamingContent: "",
    stoppedConversationId: null as string | null,
    createConversation: vi.fn(async () => ({ id: "conv_1" })),
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

vi.mock("../../store/agentStore", () => ({
  useAgentStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.state), {
    getState: () => h.state,
    subscribe: h.state.subscribe,
  }),
}));

vi.mock("../../services/tauri", () => ({
  agentApi: { listMessages: h.listMessages },
}));

function ctx(partial: Partial<InlineWritingContext> = {}): InlineWritingContext {
  return {
    bookTitle: "测试之书",
    bookDescription: "一个测试用的故事",
    chapterTitle: "第一章",
    chapterText: "林越推开门，雨声涌了进来。",
    characterLines: ["林越（主角）：沉默寡言的前刑警。"],
    outlineLines: ["雨夜重逢 → 第一章：林越再遇苏晚"],
    ...partial,
  };
}

describe("writingAssistant", () => {
  it("续写消息：内嵌尾部原文 + 人设卡 + 大纲，且明确禁解释", () => {
    const msg = buildContinueMessage(ctx());
    expect(msg).toContain("林越推开门");
    expect(msg).toContain("林越（主角）：沉默寡言的前刑警。");
    expect(msg).toContain("雨夜重逢 → 第一章");
    expect(msg).toContain("不要任何解释");
  });

  it("续写消息：无人设卡时声明盲区，而不是让模型凭空编关系", () => {
    const msg = buildContinueMessage(ctx({ characterLines: [], outlineLines: [] }));
    expect(msg).toContain("还没有人设卡");
    expect(msg).not.toContain("雨夜重逢");
  });

  it("tailOf：超长文本只保留末尾并以省略号起头", () => {
    const long = "a".repeat(TAIL_CHARS + 100) + "尾部文本";
    const tail = tailOf(long);
    expect(tail.startsWith("…")).toBe(true);
    expect(tail.endsWith("尾部文本")).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(TAIL_CHARS + 1);
    // 不超长时原样返回
    expect(tailOf("短文本")).toBe("短文本");
  });

  it("润色消息：携带全文（不截断），并约束不改情节", () => {
    const longText = "x".repeat(TAIL_CHARS + 500);
    const msg = buildPolishMessage(ctx({ chapterText: longText }));
    expect(msg).toContain(longText);
    expect(msg).toContain("不得改变");
  });

  it("B 选区级润色：只喂选中片段 + 前后文语境，约束输出可无缝拼回", () => {
    const msg = buildPolishMessage(
      ctx({
        selectionText: "他缓缓抬起头，眼神里有一种说不清的东西。",
        beforeText: "门外的雨停了。",
        afterText: "苏晚推门进来，看到的就是这一幕。",
      }),
    );
    // 选区分支：只喂片段，不喂整章
    expect(msg).toContain("【选中片段】");
    expect(msg).toContain("他缓缓抬起头");
    expect(msg).not.toContain("林越推开门，雨声涌了进来。");
    // 前后文作语境（含「选区」标记，模型不会把语境当改写对象）
    expect(msg).toContain("【选区前文（结尾）】");
    expect(msg).toContain("门外的雨停了。");
    expect(msg).toContain("【选区后文（开头）】");
    expect(msg).toContain("苏晚推门进来");
    // 衔接约束：输出必须能拼回原位
    expect(msg).toContain("无缝拼回");
    // 不喂整章 → 整章原文标记不应出现
    expect(msg).not.toContain("【原文】");
  });

  it("B 整章润色保持原行为：无选区字段时不出选区分支", () => {
    const msg = buildPolishMessage(ctx());
    expect(msg).toContain("【原文】");
    expect(msg).not.toContain("【选中片段】");
    expect(msg).not.toContain("【选区前文（结尾）】");
  });

  it("C 流式：onDelta 转发 streamingContent；结束后退订（迟到分片不再进入回调）", async () => {
    h.state.sendMessage.mockImplementation(async () => {
      h.state.streamingContent = "部分";
      h.emit();
      h.state.streamingContent = "部分全文";
      h.emit();
    });
    h.listMessages.mockResolvedValue([{ role: "assistant", content: "最终正文" }]);

    const deltas: string[] = [];
    const res = await runInlineWritingTask({
      agentId: "a1",
      kind: "continue",
      ctx: ctx(),
      onDelta: (full) => deltas.push(full),
    });

    expect(h.state.createConversation).toHaveBeenCalledWith("a1", expect.stringContaining("续写"));
    expect(deltas).toEqual(["部分", "部分全文"]);
    expect(res.text).toBe("最终正文");
    expect(res.interrupted).toBeUndefined();

    // 退订生效：流结束后的迟到分片不再触发回调
    h.state.streamingContent = "迟到的分片";
    h.emit();
    expect(deltas.length).toBe(2);
  });

  it("C 取消：stoppedConversationId 命中 → 返回 interrupted，不拉消息、不抛错", async () => {
    h.state.sendMessage.mockImplementation(async () => {
      h.state.stoppedConversationId = "conv_1";
    });
    h.listMessages.mockClear(); // hoisted mock 模块级共享，清掉上一用例的调用计数
    const res = await runInlineWritingTask({
      agentId: "a1",
      kind: "polish",
      ctx: ctx(),
      onDelta: () => {},
    });
    expect(res.interrupted).toBe(true);
    expect(res.text).toBe("");
    expect(h.listMessages).not.toHaveBeenCalled();
  });

  it("textToParagraphHtml：空行分段、XML 转义、段内换行保留", () => {
    const html = textToParagraphHtml("第一段<内容>\n第二行\n\n第二段");
    expect(html).toBe(
      "<p>第一段&lt;内容&gt;<br>第二行</p><p>第二段</p>",
    );
  });

  it("P8 参数化：目标字数替换默认字数档，走向要求融入且要求不复述", () => {
    const msg = buildContinueMessage(ctx({ targetWords: 1200, directive: "结尾苏晚发现秘密" }));
    expect(msg).toContain("约 1200 字");
    expect(msg).not.toContain("300～600");
    expect(msg).toContain("【走向要求】");
    expect(msg).toContain("结尾苏晚发现秘密");
    expect(msg).toContain("不要在输出里复述或解释这些要求");
  });

  it("P8 风格档：refine/vivid/plain 各有风格行，default 不附加", () => {
    expect(buildPolishMessage(ctx({ style: "refine" }))).toContain("精炼紧凑");
    expect(buildPolishMessage(ctx({ style: "vivid" }))).toContain("文笔华美");
    expect(buildPolishMessage(ctx({ style: "plain" }))).toContain("平实口语");
    expect(buildPolishMessage(ctx({ style: "default" }))).not.toContain("风格要求");
  });
});
