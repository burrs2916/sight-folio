import { describe, it, expect } from "vitest";
import type { AiContextSection, AiSectionStamp } from "../contextTypes";
import {
  decidePersistMode,
  packDigestFromSections,
  sectionDigest,
  stampSections,
  toStampMap,
} from "../sectionDiff";

/**
 * 分节级增量的测试重点不是「函数能跑」，而是守住三条一旦破掉
 * 增量就会静默退化为全量、且没人会立刻发现的性质：
 *   1. 未变分节必须继承旧 updatedAt（否则 Agent 侧 since 过滤永远命中全部）；
 *   2. 包指纹必须与分节指纹同源且与顺序无关（否则「某节变了包没变」或反之）；
 *   3. 库内状态不可信时必须整包重写（否则残缺状态被永久固化）。
 */

function sec(key: string, content: string, priority = 0): AiContextSection {
  return {
    key,
    title: key,
    summary: `${key} summary`,
    content,
    tokenEstimate: content.length,
    priority,
    digest: "",
    updatedAt: 0,
  };
}

describe("sectionDigest", () => {
  it("同内容同指纹，不同内容不同指纹", () => {
    expect(sectionDigest(sec("a", "hello"))).toBe(sectionDigest(sec("a", "hello")));
    expect(sectionDigest(sec("a", "hello"))).not.toBe(sectionDigest(sec("a", "hello!")));
  });

  it("同内容不同 key 指纹不同：防止两节内容恰好相同时相互串味", () => {
    expect(sectionDigest(sec("a", "same"))).not.toBe(sectionDigest(sec("b", "same")));
  });

  it("只认正文，标题/摘要抖动不算内容变化", () => {
    const base = sec("a", "body");
    const renamed: AiContextSection = { ...base, title: "别的标题", summary: "别的摘要" };
    expect(sectionDigest(renamed)).toBe(sectionDigest(base));
  });
});

describe("stampSections", () => {
  it("首次构建：全部判为变化，updatedAt 取 now", () => {
    const { sections, changed, unchanged } = stampSections([sec("a", "x"), sec("b", "y")], undefined, 1000);
    expect(changed).toEqual(["a", "b"]);
    expect(unchanged).toEqual([]);
    expect(sections.every((s) => s.updatedAt === 1000)).toBe(true);
    expect(sections.every((s) => s.digest.length > 0)).toBe(true);
  });

  it("内容未变的分节继承旧 updatedAt —— 增量机制的支点", () => {
    const first = stampSections([sec("a", "x"), sec("b", "y")], undefined, 1000);
    const prev = toStampMap(first.sections);

    // 第二轮只有 b 变了
    const second = stampSections([sec("a", "x"), sec("b", "y2")], prev, 2000);

    expect(second.changed).toEqual(["b"]);
    expect(second.unchanged).toEqual(["a"]);
    // a 必须停留在 1000：若被刷成 2000，Agent 用 since=1000 查会误判 a 也变了
    expect(second.sections.find((s) => s.key === "a")!.updatedAt).toBe(1000);
    expect(second.sections.find((s) => s.key === "b")!.updatedAt).toBe(2000);
  });

  it("连续多轮无变化时 updatedAt 始终不漂移", () => {
    let stamps: Record<string, AiSectionStamp> | undefined;
    let last = 0;
    for (const now of [1000, 2000, 3000, 4000]) {
      const r = stampSections([sec("a", "stable")], stamps, now);
      stamps = toStampMap(r.sections);
      last = r.sections[0].updatedAt;
    }
    expect(last).toBe(1000);
  });

  it("新增分节判为变化", () => {
    const first = stampSections([sec("a", "x")], undefined, 1000);
    const second = stampSections([sec("a", "x"), sec("c", "z")], toStampMap(first.sections), 2000);
    expect(second.changed).toEqual(["c"]);
    expect(second.unchanged).toEqual(["a"]);
  });

  it("上一轮指纹为空（历史数据/未打戳）时保守判为变化", () => {
    const prev: Record<string, AiSectionStamp> = { a: { digest: "", updatedAt: 999 } };
    const r = stampSections([sec("a", "x")], prev, 2000);
    expect(r.changed).toEqual(["a"]);
    expect(r.sections[0].updatedAt).toBe(2000);
  });
});

describe("packDigestFromSections", () => {
  it("分节顺序变化不影响包指纹（预设裁剪会改变构建顺序）", () => {
    const a = stampSections([sec("a", "x"), sec("b", "y")], undefined, 1).sections;
    const b = stampSections([sec("b", "y"), sec("a", "x")], undefined, 1).sections;
    expect(packDigestFromSections("scope", 2, a)).toBe(packDigestFromSections("scope", 2, b));
  });

  it("任一分节内容变化都会带动包指纹变化", () => {
    const base = stampSections([sec("a", "x"), sec("b", "y")], undefined, 1).sections;
    const moved = stampSections([sec("a", "x"), sec("b", "y2")], undefined, 1).sections;
    expect(packDigestFromSections("s", 2, base)).not.toBe(packDigestFromSections("s", 2, moved));
  });

  it("scope 与协议版本参与指纹：不同项目/版本不会互相命中", () => {
    const secs = stampSections([sec("a", "x")], undefined, 1).sections;
    expect(packDigestFromSections("s1", 2, secs)).not.toBe(packDigestFromSections("s2", 2, secs));
    expect(packDigestFromSections("s1", 1, secs)).not.toBe(packDigestFromSections("s1", 2, secs));
  });
});

describe("decidePersistMode", () => {
  const allKeys = ["a", "b", "c", "d", "e"];
  const base = {
    allKeys,
    knownKeys: allKeys,
    knownSchemaVersion: 2,
    schemaVersion: 2,
  };

  it("无变化 → skip", () => {
    expect(decidePersistMode({ ...base, changed: [] })).toBe("skip");
  });

  it("少量变化 → partial", () => {
    expect(decidePersistMode({ ...base, changed: ["b"] })).toBe("partial");
    expect(decidePersistMode({ ...base, changed: ["b", "c"] })).toBe("partial");
  });

  it("变化面过大 → full（逐节 upsert 反而不划算）", () => {
    expect(decidePersistMode({ ...base, changed: ["a", "b", "c"] })).toBe("full");
  });

  it("库内状态未水合 → full，即便看起来没有变化", () => {
    expect(
      decidePersistMode({ ...base, changed: [], knownKeys: null, knownSchemaVersion: null }),
    ).toBe("full");
  });

  it("协议升版 → full，绝不让新旧字段混存", () => {
    expect(decidePersistMode({ ...base, changed: ["a"], knownSchemaVersion: 1 })).toBe("full");
  });

  it("分节集合增删 → full，否则部分写会留下孤儿分节", () => {
    // 库里多一个已下线的分节
    expect(
      decidePersistMode({ ...base, changed: ["a"], knownKeys: [...allKeys, "legacy"] }),
    ).toBe("full");
    // 本次多一个新分节
    expect(
      decidePersistMode({ ...base, changed: ["f"], allKeys: [...allKeys, "f"] }),
    ).toBe("full");
    // 集合大小相同但成员不同（改名）
    expect(
      decidePersistMode({ ...base, changed: ["a"], knownKeys: ["a", "b", "c", "d", "X"] }),
    ).toBe("full");
  });

  it("阈值可调", () => {
    expect(decidePersistMode({ ...base, changed: ["a", "b", "c"], fullRewriteRatio: 0.9 })).toBe(
      "partial",
    );
  });
});
