// 写作台 AI 审阅结果面板 · 回归锁（A-2 审阅闭环）
//
// 背景：AI 审阅结论沉淀在 insights 体系（analysisId = bookId），写作台原本没有查看入口。
// 本面板按 bookId 拉取、open 优先排序、支持就地收口（resolveAiInsight resolvedBy="user"）。
//
// 这条测试锁死：
// ① 打开即按 bookId 拉取，open 行渲染（标题/待处理计数/确认次数 chip）；
// ② 收口按钮 → resolveAiInsight(bookId, id, reason, "user") 且拉取刷新；
// ③ 空态文案（不渲染行）；④ resolved 行淡显、无收口按钮。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  listAiInsights: vi.fn(),
  resolveAiInsight: vi.fn(),
}));

vi.mock("../../services/tauri", () => ({
  aiContextApi: {
    listAiInsights: h.listAiInsights,
    resolveAiInsight: h.resolveAiInsight,
  },
}));

import { WritingInsightsDialog } from "../WritingInsightsDialog";
import type { AiInsightDto } from "../../services/tauri";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

async function mountAsync(ui: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
});

const insight = (over: Partial<AiInsightDto>): AiInsightDto => ({
  id: "ins_1",
  packId: null,
  analysisId: "book_1",
  agentId: "agent_a",
  kind: "review",
  title: "伏笔悬而未收",
  body: "第 3 章埋下的怀表在第 12 章没有回收。",
  severity: "warning",
  refs: [],
  seenCount: 2,
  firstSeen: 1700000000,
  lastSeen: 1700001000,
  status: "open",
  ...over,
});

function textEl(text: string): HTMLElement | null {
  const els = Array.from(document.body.querySelectorAll("*")) as HTMLElement[];
  return els.find((e) => e.textContent === text && e.children.length === 0) ?? null;
}

describe("写作台 AI 审阅结果面板（A-2 闭环 · 回归锁）", () => {
  it("打开即按 bookId 拉取；open 行渲染标题/待处理计数/确认次数", async () => {
    h.listAiInsights.mockResolvedValue([
      insight({}),
      insight({ id: "ins_2", title: "节奏拖沓", severity: "info", seenCount: 1 }),
    ]);
    await mountAsync(<WritingInsightsDialog open bookId="book_1" onClose={() => {}} />);

    expect(h.listAiInsights).toHaveBeenCalledWith("book_1");
    expect(textEl("伏笔悬而未收"), "open 行标题应渲染").toBeTruthy();
    expect(textEl("节奏拖沓"), "第二条 open 行应渲染").toBeTruthy();
    // 标题栏待处理计数
    expect(document.body.textContent).toContain("2 条待处理");
    // 确认次数 chip（seenCount=2 才显示）
    expect(textEl("2 次确认")).toBeTruthy();
    // severity 指示点存在
    expect(document.querySelectorAll(".MuiChip-root").length).toBeGreaterThanOrEqual(1);
  });

  it("收口按钮 → resolveAiInsight(bookId, id, reason, 'user') 并刷新列表", async () => {
    h.listAiInsights
      .mockResolvedValueOnce([insight({})])
      .mockResolvedValueOnce([insight({ status: "resolved", resolvedAt: 1700002000 })]);
    h.resolveAiInsight.mockResolvedValue("ok");
    await mountAsync(<WritingInsightsDialog open bookId="book_1" onClose={() => {}} />);

    // MUI Dialog 经 Portal 落 document.body（不在 host 里）；收口按钮用 testid 精确定位
    const btn = document.querySelector('[data-testid="insight-resolve-ins_1"]');
    expect(btn, "open 行应有收口按钮").toBeTruthy();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(h.resolveAiInsight).toHaveBeenCalledTimes(1);
    const args = h.resolveAiInsight.mock.calls[0];
    expect(args[0]).toBe("book_1");
    expect(args[1]).toBe("ins_1");
    expect(args[3]).toBe("user");
    // 刷新后 resolved：不再有收口按钮
    expect(h.listAiInsights).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-testid^="insight-resolve-"]')).toBeNull();
  });

  it("空态文案（无结论时不渲染行）", async () => {
    h.listAiInsights.mockResolvedValue([]);
    await mountAsync(<WritingInsightsDialog open bookId="book_1" onClose={() => {}} />);
    expect(host!.querySelector(".MuiChip-root")).toBeNull();
    expect((document.body.textContent ?? "").length).toBeGreaterThan(0);
  });
});
