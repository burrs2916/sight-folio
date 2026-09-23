// 书场景的 projectRoot 是 `writing://{bookId}/` 伪 URI —— 磁盘上没有这个目录。
// 拿它去体检新鲜度，Rust 侧只会返回「路径不存在: writing://book_xxx/」，
// 而且 `setActiveAnalysis` 每次切场景都调一次 → 控制台被灌满同名报错。
//
// 这一层锁两件事：
//   ① 伪 URI 必须**在 invoke 之前**就被挡掉（不是靠 catch 兜住报错）；
//   ② 真实代码场景的体检路径一行未变（零回归）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  analysisGet: vi.fn(),
  checkScanFreshness: vi.fn(),
}));

vi.mock("../../services/tauri", () => ({
  analysisApi: { get: h.analysisGet },
  projectScanApi: { checkScanFreshness: h.checkScanFreshness },
  fileWatcherApi: {},
  aiContextApi: {},
}));
vi.mock("../../ai/contextRegistry", () => ({ aiContextRegistry: {} }));
vi.mock("../../ai/contextPersist", () => ({
  persistModuleContext: vi.fn(),
  resetContextPersistCache: vi.fn(),
}));
vi.mock("../../store/insightOverlayStore", () => ({ useInsightOverlayStore: () => ({}) }));
vi.mock("../../store/toastStore", () => ({
  useToastStore: Object.assign(() => ({}), { getState: () => ({ showToast: vi.fn() }) }),
}));

import { useProjectStore, isFilesystemProjectRoot } from "../projectStore";

let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
});

describe("isFilesystemProjectRoot", () => {
  it("真实文件系统路径 → true", () => {
    expect(isFilesystemProjectRoot("/Users/x/proj")).toBe(true);
    expect(isFilesystemProjectRoot("C:\\proj\\app")).toBe(true);
    expect(isFilesystemProjectRoot("\\\\server\\share")).toBe(true);
    expect(isFilesystemProjectRoot("  ./relative  ")).toBe(true);
  });

  it("伪 URI 与空值 → false", () => {
    expect(isFilesystemProjectRoot("writing://book_x/")).toBe(false);
    expect(isFilesystemProjectRoot("")).toBe(false);
    expect(isFilesystemProjectRoot("   ")).toBe(false);
    expect(isFilesystemProjectRoot(null)).toBe(false);
    expect(isFilesystemProjectRoot(undefined)).toBe(false);
  });
});

describe("checkFreshness", () => {
  it("书场景（writing://）→ 在 invoke 之前就跳过，且不打任何报错", async () => {
    h.analysisGet.mockResolvedValue({ id: "wscan_b1", projectRoot: "writing://book_x/" });

    await useProjectStore.getState().checkFreshness("wscan_b1");

    // 关键：不是「调用失败后被 catch 吞掉」，而是根本没调用
    expect(h.checkScanFreshness).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    expect(useProjectStore.getState().scanFreshness).toBeNull();
    // 忙碌位必须落回 false，否则 UI 上的「体检中」永远转圈
    expect(useProjectStore.getState().scanFreshnessChecking).toBe(false);
  });

  it("书场景跳过时顺手清掉上一次的新鲜度（别把别的场景的「已过时」横幅带过来）", async () => {
    h.analysisGet.mockResolvedValue({ id: "a1", projectRoot: "/tmp/proj" });
    h.checkScanFreshness.mockResolvedValue({ stale: true, reason: "disk changed" });
    await useProjectStore.getState().checkFreshness("a1");
    expect(useProjectStore.getState().scanFreshness).not.toBeNull();

    h.analysisGet.mockResolvedValue({ id: "wscan_b1", projectRoot: "writing://book_x/" });
    await useProjectStore.getState().checkFreshness("wscan_b1");
    expect(useProjectStore.getState().scanFreshness).toBeNull();
  });

  it("普通代码场景 → 体检路径零变化（零回归）", async () => {
    h.analysisGet.mockResolvedValue({ id: "a1", projectRoot: "/tmp/proj" });
    h.checkScanFreshness.mockResolvedValue({ stale: false, reason: "" });

    await useProjectStore.getState().checkFreshness("a1");

    expect(h.checkScanFreshness).toHaveBeenCalledTimes(1);
    expect(h.checkScanFreshness).toHaveBeenCalledWith("a1", "/tmp/proj");
    expect(useProjectStore.getState().scanFreshness).toMatchObject({ stale: false });
  });

  it("没有 projectRoot 时照旧直接返回（既有行为不变）", async () => {
    h.analysisGet.mockResolvedValue({ id: "a1", projectRoot: "" });

    await useProjectStore.getState().checkFreshness("a1");

    expect(h.checkScanFreshness).not.toHaveBeenCalled();
    expect(useProjectStore.getState().scanFreshnessChecking).toBe(false);
  });
});
