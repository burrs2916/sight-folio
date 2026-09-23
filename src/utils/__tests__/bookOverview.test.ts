import { describe, it, expect } from "vitest";
import { buildBookOverview } from "../bookOverview";
import type { ProjectFile } from "../../services/tauri";

function chapterFile(opts: {
  id: string;
  title: string;
  relPath: string;
  size: number;
  volume?: string;
  appearances?: { id: string; name: string; count: number }[];
}): ProjectFile {
  return {
    id: opts.id,
    analysisId: "wscan_b1",
    path: `writing://b1/${opts.id}`,
    relPath: opts.relPath,
    name: opts.title,
    extension: "md",
    language: "novel-zh",
    size: opts.size,
    lineCount: 3,
    contentHash: null,
    parentId: null,
    isDirectory: false,
    layerId: null,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    metadata: JSON.stringify({
      volume: opts.volume ?? "",
      chapterStatus: "draft",
      bookId: "b1",
      appearances: opts.appearances ?? [],
    }),
    scannedAt: 0,
  };
}

describe("buildBookOverview", () => {
  it("空书：0 章 0 人物，提示上游空态", () => {
    const r = buildBookOverview([]);
    expect(r.chapterCount).toBe(0);
    expect(r.cards.length).toBe(0);
  });

  it("章节按 rel_path 全局序号排序，人物跨章聚合按总提及降序", () => {
    const r = buildBookOverview([
      chapterFile({
        id: "wfile_c3",
        title: "第三章",
        relPath: "03-第三章.md",
        size: 900,
        appearances: [
          { id: "s1", name: "林越", count: 5 },
          { id: "s2", name: "沈青", count: 1 },
        ],
      }),
      chapterFile({
        id: "wfile_c1",
        title: "第一章",
        relPath: "01-第一章.md",
        size: 800,
        appearances: [{ id: "s1", name: "林越", count: 3 }],
      }),
      chapterFile({
        id: "wfile_c2",
        title: "第二章",
        relPath: "02-第二章.md",
        size: 700,
        appearances: [{ id: "s1", name: "林越", count: 2 }],
      }),
    ]);
    // 章节卡顺序 = 第一章 → 第二章 → 第三章（输入是乱的，靠序号还原）
    const chapterCards = r.cards.filter((c) => c.type === "writing-chapter");
    expect(chapterCards.map((c) => c.name)).toEqual(["第一章", "第二章", "第三章"]);
    // 人物：林越 10 次 3 章排第一，沈青 1 次第二
    expect(r.characterCount).toBe(2);
    const charCards = r.cards.filter((c) => c.type === "writing-character");
    expect(charCards[0].name).toBe("林越");
    expect(charCards[0].config.appearances).toBe(10);
    expect(charCards[0].config.chapterCount).toBe(3);
    expect(charCards[1].config.appearances).toBe(1);
    expect(r.totalWords).toBe(2400);
  });

  it("有卷时：卷头（writing-outline）横条 + 该卷章节组，卷头锁定", () => {
    const r = buildBookOverview([
      chapterFile({ id: "wfile_c1", title: "第一章", relPath: "01-第一章.md", size: 100 }),
      chapterFile({ id: "wfile_c2", title: "第二章", relPath: "第二卷/02-第二章.md", size: 100, volume: "第二卷" }),
      chapterFile({ id: "wfile_c3", title: "第三章", relPath: "第二卷/03-第三章.md", size: 100, volume: "第二卷" }),
    ]);
    const volumes = r.cards.filter((c) => c.type === "writing-outline");
    expect(volumes.length).toBe(1);
    expect(volumes[0].name).toBe("第二卷");
    expect(volumes[0].locked).toBe(true);
    expect(volumes[0].config.summary).toBe(2);
    expect(r.volumeCount).toBe(1);
    // 卷头在第二卷首章上方（y 小于该组章节的 y）
    const ch2 = r.cards.find((c) => c.name === "第二章");
    expect(volumes[0].y).toBeLessThan(ch2!.y);
    // 章节卡可拖拽
    const ch1 = r.cards.find((c) => c.name === "第一章");
    expect(ch1!.locked).toBe(false);
  });

  it("人物列存在时章节区右移，不与人物卡重叠", () => {
    const r = buildBookOverview([
      chapterFile({
        id: "wfile_c1",
        title: "第一章",
        relPath: "01-第一章.md",
        size: 100,
        appearances: [{ id: "s1", name: "林越", count: 3 }],
      }),
    ]);
    const charCard = r.cards.find((c) => c.type === "writing-character")!;
    const chCard = r.cards.find((c) => c.type === "writing-chapter")!;
    expect(chCard.x).toBeGreaterThanOrEqual(charCard.x + charCard.width);
  });

  it("metadata 损坏不阻断整板（按空卷/空出场处理）", () => {
    const bad = chapterFile({ id: "wfile_c1", title: "第一章", relPath: "01-第一章.md", size: 100 });
    (bad as any).metadata = "{broken json";
    const r = buildBookOverview([bad]);
    expect(r.chapterCount).toBe(1);
    expect(r.characterCount).toBe(0);
    expect(r.cards.filter((c) => c.type === "writing-chapter").length).toBe(1);
  });
});
