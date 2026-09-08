/**
 * insightOverlayStore 测试 —— 重点是「双挂载不打两遍库」与「关掉开关后画布彻底安静」。
 *
 * 这两条都不是功能正确性问题，而是**性能与体验的隐性退化**：查两遍库不会报错，
 * 只会让每次进画布都多一次 IPC；开关关掉后如果选择器还返回对象，几百个渲染器
 * 会照常被唤醒重渲染。两者都不会有任何红色提示，只能靠测试守住。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const listAiInsights = vi.fn();

vi.mock("../../services/tauri", () => ({
  aiContextApi: {
    listAiInsights: (...args: unknown[]) => listAiInsights(...args),
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { useInsightOverlayStore, selectFileMark, selectDirMark } = await import("../insightOverlayStore");

const KNOWN = ["src/a.ts", "src/deep/b.ts"];

const ROWS = [
  {
    id: "i1",
    packId: null,
    analysisId: "an1",
    agentId: null,
    kind: "finding",
    title: "改动放大器",
    body: "",
    severity: "critical",
    refs: ["src/a.ts:12"],
  },
  {
    id: "i2",
    packId: null,
    analysisId: "an1",
    agentId: null,
    kind: "recommendation",
    title: "低危提示",
    body: "",
    severity: "info",
    refs: ["src/deep/b.ts"],
  },
];

beforeEach(() => {
  listAiInsights.mockReset();
  listAiInsights.mockResolvedValue(ROWS);
  useInsightOverlayStore.setState({
    scopeId: "",
    loadedScope: "",
    insights: [],
    fileMarks: {},
    dirMarks: {},
    unresolved: [],
    canvasEnabled: true,
    minSeverity: "medium",
    loading: false,
  });
});

describe("load", () => {
  it("加载后按严重度阈值生成文件与目录标记", async () => {
    await useInsightOverlayStore.getState().load("an1", KNOWN);
    const s = useInsightOverlayStore.getState();
    expect(s.insights).toHaveLength(2);
    expect(s.fileMarks["src/a.ts"].severity).toBe("critical");
    // info 级低于默认阈值 medium，不上画布（但仍在 insights 列表里）
    expect(s.fileMarks["src/deep/b.ts"]).toBeUndefined();
    expect(s.dirMarks["src"].severity).toBe("critical");
  });

  it("同一 scope 重复 load 只查一次库（画布与面板各挂一次同步钩子）", async () => {
    const { load } = useInsightOverlayStore.getState();
    await load("an1", KNOWN);
    await load("an1", KNOWN);
    await load("an1", KNOWN);
    expect(listAiInsights).toHaveBeenCalledTimes(1);
  });

  it("force 时强制回库（Agent 跑完 / 手动刷新）", async () => {
    const { load } = useInsightOverlayStore.getState();
    await load("an1", KNOWN);
    await load("an1", KNOWN, true);
    expect(listAiInsights).toHaveBeenCalledTimes(2);
  });

  it("换 scope 会重新查库", async () => {
    const { load } = useInsightOverlayStore.getState();
    await load("an1", KNOWN);
    await load("an2", KNOWN);
    expect(listAiInsights).toHaveBeenCalledTimes(2);
  });

  it("scope 为空时清空，不查库", async () => {
    await useInsightOverlayStore.getState().load("an1", KNOWN);
    await useInsightOverlayStore.getState().load("", KNOWN);
    expect(useInsightOverlayStore.getState().insights).toHaveLength(0);
    expect(useInsightOverlayStore.getState().fileMarks).toEqual({});
  });

  it("查库失败不抛出，也不清掉已有数据（洞察是增强信息，不该打断画布）", async () => {
    await useInsightOverlayStore.getState().load("an1", KNOWN);
    listAiInsights.mockRejectedValueOnce(new Error("db down"));
    await expect(useInsightOverlayStore.getState().load("an2", KNOWN)).resolves.toBeUndefined();
    expect(useInsightOverlayStore.getState().loading).toBe(false);
    expect(useInsightOverlayStore.getState().insights).toHaveLength(2);
  });
});

describe("rebuild", () => {
  it("文件清单变化后重新对齐，不查库", async () => {
    await useInsightOverlayStore.getState().load("an1", []);
    // 扫描前没有 relPath 可对齐，角标点不亮
    expect(useInsightOverlayStore.getState().fileMarks["src/a.ts"]).toBeUndefined();

    useInsightOverlayStore.getState().rebuild(KNOWN);
    expect(useInsightOverlayStore.getState().fileMarks["src/a.ts"]).toBeDefined();
    expect(listAiInsights).toHaveBeenCalledTimes(1);
  });
});

describe("minSeverity", () => {
  it("放宽阈值后低severity洞察进入画布", async () => {
    await useInsightOverlayStore.getState().load("an1", KNOWN);
    useInsightOverlayStore.getState().setMinSeverity("info");
    useInsightOverlayStore.getState().rebuild(KNOWN);
    expect(useInsightOverlayStore.getState().fileMarks["src/deep/b.ts"]).toBeDefined();
  });
});

describe("选择器", () => {
  it("关掉画布标注后一律返回 undefined，渲染器不会被唤醒", async () => {
    await useInsightOverlayStore.getState().load("an1", KNOWN);
    const s1 = useInsightOverlayStore.getState();
    expect(selectFileMark("src/a.ts")(s1)).toBeDefined();
    expect(selectDirMark("src")(s1)).toBeDefined();

    useInsightOverlayStore.getState().setCanvasEnabled(false);
    const s2 = useInsightOverlayStore.getState();
    expect(selectFileMark("src/a.ts")(s2)).toBeUndefined();
    expect(selectDirMark("src")(s2)).toBeUndefined();
  });

  it("路径为空时安全返回 undefined（手动拖进画布的空实体没有 filePath）", () => {
    const s = useInsightOverlayStore.getState();
    expect(selectFileMark(undefined)(s)).toBeUndefined();
    expect(selectDirMark("")(s)).toBeUndefined();
  });

  it("同一路径连续取值引用相同，不会造成无意义重渲染", async () => {
    await useInsightOverlayStore.getState().load("an1", KNOWN);
    const s = useInsightOverlayStore.getState();
    expect(selectFileMark("src/a.ts")(s)).toBe(selectFileMark("src/a.ts")(s));
  });
});
