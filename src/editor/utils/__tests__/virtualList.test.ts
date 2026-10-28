import { describe, it, expect } from "vitest";
import {
  computeVirtualWindow,
  tokenizeQuery,
  matchesTokens,
  matchesFields,
  filterByTokens,
  countLabel,
} from "../virtualList";

describe("computeVirtualWindow", () => {
  it("空列表返回空窗口", () => {
    const w = computeVirtualWindow({ itemCount: 0, rowHeight: 30, scrollTop: 0, viewportHeight: 300 });
    expect(w).toEqual({ startIndex: 0, endIndex: 0, offsetY: 0, totalHeight: 0 });
  });

  it("容器未测量（高度 0）时回退全量渲染，绝不出现空白列表", () => {
    const w = computeVirtualWindow({ itemCount: 500, rowHeight: 30, scrollTop: 0, viewportHeight: 0 });
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(500);
    expect(w.totalHeight).toBe(15000);
  });

  it("行高非法时回退全量渲染", () => {
    const w = computeVirtualWindow({ itemCount: 100, rowHeight: 0, scrollTop: 50, viewportHeight: 300 });
    expect(w.endIndex).toBe(100);
  });

  it("顶部滚动时窗口从 0 开始，末尾带 overscan", () => {
    const w = computeVirtualWindow({ itemCount: 1000, rowHeight: 30, scrollTop: 0, viewportHeight: 300, overscan: 5 });
    expect(w.startIndex).toBe(0);
    // 可视 10 行 + overscan 5 + 1
    expect(w.endIndex).toBe(16);
    expect(w.offsetY).toBe(0);
    expect(w.totalHeight).toBe(30000);
  });

  it("滚动到中部时窗口跟随，offsetY 与 startIndex 严格对齐", () => {
    const w = computeVirtualWindow({ itemCount: 1000, rowHeight: 30, scrollTop: 3000, viewportHeight: 300, overscan: 5 });
    expect(w.startIndex).toBe(95); // 100 - 5
    expect(w.offsetY).toBe(95 * 30);
    expect(w.endIndex).toBe(116); // 100 + 10 + 5 + 1
  });

  it("滚动到底部时 endIndex 被夹到总数，不越界", () => {
    const w = computeVirtualWindow({ itemCount: 50, rowHeight: 30, scrollTop: 1200, viewportHeight: 300, overscan: 5 });
    expect(w.endIndex).toBe(50);
    expect(w.startIndex).toBeLessThan(50);
  });

  it("负 scrollTop（橡皮筋回弹）按 0 处理", () => {
    const w = computeVirtualWindow({ itemCount: 100, rowHeight: 30, scrollTop: -80, viewportHeight: 300 });
    expect(w.startIndex).toBe(0);
    expect(w.offsetY).toBe(0);
  });

  it("渲染行数远小于总数（虚拟化确实生效）", () => {
    const w = computeVirtualWindow({ itemCount: 4000, rowHeight: 28, scrollTop: 10000, viewportHeight: 280 });
    expect(w.endIndex - w.startIndex).toBeLessThan(40);
  });
});

describe("查询匹配", () => {
  it("tokenize 小写化并去空", () => {
    expect(tokenizeQuery("  User   Service ")).toEqual(["user", "service"]);
    expect(tokenizeQuery("")).toEqual([]);
  });

  it("多 token 是 AND 关系", () => {
    const tokens = tokenizeQuery("user service");
    expect(matchesTokens("src/UserServiceImpl.ts", tokens)).toBe(true);
    expect(matchesTokens("src/user.ts", tokens)).toBe(false);
  });

  it("空查询命中一切", () => {
    expect(matchesTokens("anything", [])).toBe(true);
    expect(matchesFields([null, undefined], [])).toBe(true);
  });

  it("token 可分散命中不同字段", () => {
    const tokens = tokenizeQuery("login critical");
    expect(matchesFields(["登录失败 login retry", "critical"], tokens)).toBe(true);
    expect(matchesFields(["登录失败 login retry", "warning"], tokens)).toBe(false);
  });

  it("字段全空时不命中（避免空条目混进结果）", () => {
    expect(matchesFields([null, undefined, ""], tokenizeQuery("x"))).toBe(false);
  });

  it("filterByTokens 保持原顺序且空查询原样返回", () => {
    const items = [{ n: "alpha" }, { n: "beta" }, { n: "alphabet" }];
    expect(filterByTokens(items, [], (i) => [i.n])).toHaveLength(3);
    const r = filterByTokens(items, tokenizeQuery("alpha"), (i) => [i.n]);
    expect(r.map((i) => i.n)).toEqual(["alpha", "alphabet"]);
  });
});

describe("countLabel", () => {
  it("无搜索只显示总数", () => {
    expect(countLabel(40, 3814, false)).toBe("3814");
  });
  it("有搜索显示命中/总数", () => {
    expect(countLabel(12, 3814, true)).toBe("12/3814");
  });
  it("命中等于总数时不显示分数（避免 3814/3814 的噪声）", () => {
    expect(countLabel(3814, 3814, true)).toBe("3814");
  });
});
