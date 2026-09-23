import { describe, it, expect } from "vitest";
import { buildRelationBoard, buildStoryboard, buildWorldviewBoard, buildStatsBoard } from "../writingBoards";
import type { ProjectFile } from "../../services/tauri";

function chapterFile(opts: {
  id: string;
  title: string;
  relPath: string;
  size: number;
  volume?: string;
  appearances?: { id: string; name: string; count: number; kind?: string }[];
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

describe("buildStoryboard", () => {
  it("空书：0 镜头", () => {
    const r = buildStoryboard([]);
    expect(r.chapterCount).toBe(0);
    expect(r.cards.length).toBe(0);
  });

  it("横向时间轴：镜头从左到右按章序推进，卷头领起本卷且锁定", () => {
    const r = buildStoryboard([
      chapterFile({ id: "c1", title: "第一章", relPath: "01-第一章.md", size: 100, volume: "第一卷" }),
      chapterFile({ id: "c2", title: "第二章", relPath: "02-第二章.md", size: 200, volume: "第一卷" }),
      chapterFile({ id: "c3", title: "第三章", relPath: "03-第三章.md", size: 300, volume: "第二卷" }),
    ]);
    expect(r.chapterCount).toBe(3);
    expect(r.volumeCount).toBe(2);
    const shots = r.cards.filter((c) => c.type === "writing-chapter");
    const vols = r.cards.filter((c) => c.type === "writing-outline");
    expect(shots.length).toBe(3);
    expect(vols.length).toBe(2);
    expect(vols.every((v) => v.locked)).toBe(true);
    // 顺序即叙事顺序：x 严格递增
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].x).toBeGreaterThan(shots[i - 1].x);
    }
    // 镜头序号从 1 起，与章序一致
    expect(shots.map((s) => s.config.shotNo)).toEqual([1, 2, 3]);
    // 同卷镜头在同一行（y 相同），换卷后仍在卷头之下
    expect(shots[0].y).toBe(shots[1].y);
  });

  it("镜头卡带本场人物（最多 3 个 + 总数），供卡片渲染 +N", () => {
    const r = buildStoryboard([
      chapterFile({
        id: "c1",
        title: "第一章",
        relPath: "01-第一章.md",
        size: 100,
        appearances: [
          { id: "s1", name: "林越", count: 1, kind: "character" },
          { id: "s2", name: "沈青", count: 5, kind: "character" },
          { id: "s3", name: "阿澈", count: 3, kind: "character" },
          { id: "s4", name: "顾寒", count: 2, kind: "character" },
        ],
      }),
    ]);
    const shot = r.cards.find((c) => c.type === "writing-chapter")!;
    const cast = shot.config.cast as { name: string; count: number }[];
    expect(cast.length).toBe(3);
    // 按本章提及次数降序（主角先出现）
    expect(cast[0].name).toBe("沈青");
    expect(shot.config.castTotal).toBe(4);
    // 双击跳正文的两个字段必须都在
    expect(shot.config.fileId).toBe("c1");
    expect(String(shot.config.filePath).startsWith("writing://")).toBe(true);
  });
});

describe("buildRelationBoard", () => {
  it("不足两张设定卡：不产卡片（上游提示空态）", () => {
    const r = buildRelationBoard([
      chapterFile({ id: "c1", title: "第一章", relPath: "01-第一章.md", size: 10 }),
    ]);
    expect(r.nodeCount).toBe(0);
    expect(r.cards.length).toBe(0);
  });

  it("同章共现成边：共现章数即权重，世界观卡用独立实体类型", () => {
    const files = [
      chapterFile({
        id: "c1",
        title: "第一章",
        relPath: "01-第一章.md",
        size: 10,
        appearances: [
          { id: "s1", name: "林越", count: 3, kind: "character" },
          { id: "s2", name: "沈青", count: 2, kind: "character" },
          { id: "w1", name: "青云宗", count: 1, kind: "worldbuilding" },
        ],
      }),
      chapterFile({
        id: "c2",
        title: "第二章",
        relPath: "02-第二章.md",
        size: 10,
        appearances: [{ id: "s1", name: "林越", count: 1, kind: "character" }, { id: "s2", name: "沈青", count: 1, kind: "character" }],
      }),
      chapterFile({
        id: "c3",
        title: "第三章",
        relPath: "03-第三章.md",
        size: 10,
        appearances: [{ id: "s2", name: "沈青", count: 1, kind: "character" }, { id: "w1", name: "青云宗", count: 4, kind: "worldbuilding" }],
      }),
    ];
    const r = buildRelationBoard(files);
    expect(r.nodeCount).toBe(3);
    // s1-s2 同场 2 章；s2-w1 同场 1 章（c1 与 c3）；s1-w1 同场 1 章（c1）
    expect(r.edgeCount).toBe(3);
    expect(r.maxCo).toBe(2);
    const nodes = r.cards.filter((c) => c.type !== "dependency-edge");
    expect(nodes.length).toBe(3);
    expect(nodes.filter((n) => n.type === "writing-worldview").length).toBe(1);
    // 边的坐标相对自身包围盒左上角（与 structure 边同一约定）
    const edges = r.cards.filter((c) => c.type === "dependency-edge");
    for (const e of edges) {
      expect(e.config.depType).toBe("cooccur");
      const fx = e.config.fromX as number;
      const fy = e.config.fromY as number;
      expect(fx).toBeLessThanOrEqual(e.width);
      expect(fy).toBeLessThanOrEqual(e.height);
      expect(fx).toBeGreaterThanOrEqual(0);
    }
    // 最强的一条边应是 s1⇄s2（共现 2 章）
    const strongest = edges.find((e) => e.config.coChanges === 2)!;
    expect(strongest.config.degree).toBe(1);
  });

  it("设定卡挂主出场章节：双击有落点，不是死节点", () => {
    const r = buildRelationBoard([
      chapterFile({
        id: "c1",
        title: "第一章",
        relPath: "01-第一章.md",
        size: 10,
        appearances: [{ id: "s1", name: "林越", count: 2, kind: "character" }],
      }),
      chapterFile({
        id: "c2",
        title: "第二章",
        relPath: "02-第二章.md",
        size: 10,
        appearances: [
          { id: "s1", name: "林越", count: 7, kind: "character" },
          { id: "s2", name: "沈青", count: 1, kind: "character" },
        ],
      }),
    ]);
    const node = r.cards.find((c) => c.type === "writing-character")!;
    // 提及最多的是第二章 → 双击跳第二章，而不是第一条或空串
    expect(node.config.fileId).toBe("c2");
    expect(String(node.config.filePath).endsWith("c2")).toBe(true);
    expect(node.config.topChapter).toBe("第二章");
  });

  it("同章多次提及只算一次同场（共现是「是否同场」而非「提及次数」）", () => {
    const r = buildRelationBoard([
      chapterFile({
        id: "c1",
        title: "第一章",
        relPath: "01-第一章.md",
        size: 10,
        appearances: [
          { id: "s1", name: "林越", count: 9, kind: "character" },
          { id: "s2", name: "沈青", count: 7, kind: "character" },
        ],
      }),
    ]);
    expect(r.edgeCount).toBe(1);
    expect(r.maxCo).toBe(1);
  });
});

describe("buildWorldviewBoard", () => {
  it("空书 / 无 worldbuilding 设定：0 卡", () => {
    expect(buildWorldviewBoard([]).cardCount).toBe(0);
    expect(
      buildWorldviewBoard([
        chapterFile({
          id: "c1",
          title: "第一章",
          relPath: "01-第一章.md",
          size: 100,
          appearances: [{ id: "s1", name: "林越", count: 2, kind: "character" }],
        }),
      ]).cardCount
    ).toBe(0);
  });

  it("只取 worldbuilding 设定卡，按提及降序网格铺开，双击落点齐全", () => {
    const r = buildWorldviewBoard([
      chapterFile({
        id: "c1",
        title: "第一章",
        relPath: "01-第一章.md",
        size: 100,
        appearances: [
          { id: "w1", name: "青云宗", count: 3, kind: "worldbuilding" },
          { id: "w2", name: "玄天塔", count: 8, kind: "worldbuilding" },
          { id: "s1", name: "林越", count: 9, kind: "character" },
        ],
      }),
      chapterFile({
        id: "c2",
        title: "第二章",
        relPath: "02-第二章.md",
        size: 100,
        appearances: [{ id: "w1", name: "青云宗", count: 1, kind: "worldbuilding" }],
      }),
    ]);
    expect(r.cardCount).toBe(2);
    const cards = r.cards;
    expect(cards.every((c) => c.type === "writing-worldview")).toBe(true);
    // 提及降序：玄天塔(8) 在青云宗(4) 前
    expect(cards[0].name).toBe("玄天塔");
    expect(cards[1].name).toBe("青云宗");
    // 网格铺开：不同卡不同坐标，不重叠
    expect(cards[0].x).not.toBe(cards[1].x);
    // 双击跳正文落点（主出场章）
    expect(cards[0].config.fileId).toBe("c1");
    expect(cards[1].config.fileId).toBe("c1");
    expect(cards[1].config.appearances).toBe(4);
    expect(cards[1].config.chapterCount).toBe(2);
  });
});

describe("buildStatsBoard", () => {
  it("空书：0 卡、0 字数、平均章长不除零", () => {
    const r = buildStatsBoard([]);
    expect(r.cards.length).toBe(0);
    expect(r.totalWords).toBe(0);
    expect(r.chapterCount).toBe(0);
    expect(r.volumeCount).toBe(0);
    expect(r.avgWords).toBe(0);
  });

  it("体量口径：总字数 = Σ 章 size，设定数跨章按 id 去重，平均章长四舍五入", () => {
    const r = buildStatsBoard([
      chapterFile({
        id: "c1", title: "第一章", relPath: "01-第一章.md", size: 100, volume: "第一卷",
        appearances: [
          { id: "s1", name: "林昭", count: 3, kind: "character" },
          { id: "s2", name: "青云宗", count: 1, kind: "worldbuilding" },
        ],
      }),
      chapterFile({
        id: "c2", title: "第二章", relPath: "02-第二章.md", size: 201, volume: "第一卷",
        // s1 在第二章再次出现：设定数应仍是 2（去重），不是 3
        appearances: [{ id: "s1", name: "林昭", count: 2, kind: "character" }],
      }),
    ]);
    expect(r.totalWords).toBe(301);
    expect(r.chapterCount).toBe(2);
    expect(r.settingCount).toBe(2);
    expect(r.volumeCount).toBe(1);
    // 301 / 2 = 150.5 → 151
    expect(r.avgWords).toBe(151);
  });

  it("三带布局：KPI 一行横排、卷卡按卷归组、章节卡带 fileId 可双击跳正文", () => {
    const r = buildStatsBoard([
      chapterFile({ id: "c1", title: "第一章", relPath: "01-第一章.md", size: 100, volume: "第一卷" }),
      chapterFile({ id: "c2", title: "第二章", relPath: "02-第二章.md", size: 300, volume: "第一卷" }),
      chapterFile({ id: "c3", title: "第三章", relPath: "03-第三章.md", size: 200, volume: "第二卷" }),
    ]);
    const kpi = r.cards.filter((c) => c.config.shape === "kpi");
    const vol = r.cards.filter((c) => c.config.shape === "volume");
    const ch = r.cards.filter((c) => c.config.shape === "chapter");
    expect(kpi.length).toBe(5);
    expect(vol.length).toBe(2);
    expect(ch.length).toBe(3);
    // KPI 横排：y 全等、x 严格递增
    expect(new Set(kpi.map((c) => c.y)).size).toBe(1);
    expect(kpi[1].x).toBeGreaterThan(kpi[0].x);
    // 卷卡在 KPI 之下
    expect(vol[0].y).toBeGreaterThan(kpi[0].y);
    // 章节卡在卷卡带之下
    expect(ch[0].y).toBeGreaterThan(vol[0].y);
    // 章节卡可跳转：卡片用 writing-outline（早退到 stat 版式），但必须带 fileId
    expect(ch.every((c) => c.type === "writing-outline" && c.config.kind === "stat")).toBe(true);
    expect(ch.map((c) => c.config.fileId)).toEqual(["c1", "c2", "c3"]);
  });

  it("占比条归一：最大卷/最大章 = 1，其余按比例", () => {
    const r = buildStatsBoard([
      chapterFile({ id: "c1", title: "第一章", relPath: "01-第一章.md", size: 100, volume: "第一卷" }),
      chapterFile({ id: "c2", title: "第二章", relPath: "02-第二章.md", size: 400, volume: "第二卷" }),
    ]);
    const ch = r.cards.filter((c) => c.config.shape === "chapter");
    const vol = r.cards.filter((c) => c.config.shape === "volume");
    expect(r.maxChapterWords).toBe(400);
    expect(ch[1].config.pct).toBe(1);
    expect(ch[0].config.pct).toBe(0.25);
    expect(vol[1].config.pct).toBe(1);
    expect(vol[0].config.pct).toBe(0.25);
  });

  it("未分卷不计入卷数，但章节仍进章节带与字数口径", () => {
    const r = buildStatsBoard([
      chapterFile({ id: "c1", title: "第一章", relPath: "01-第一章.md", size: 100, volume: "" }),
      chapterFile({ id: "c2", title: "第二章", relPath: "02-第二章.md", size: 100, volume: "第一卷" }),
    ]);
    // 卷数只数真有卷名的卷
    expect(r.volumeCount).toBe(1);
    // 但未分卷那张章卡照样存在，字数也照算
    expect(r.cards.filter((c) => c.config.shape === "chapter").length).toBe(2);
    expect(r.totalWords).toBe(200);
    // 卷卡里会有一张「未分卷」组（名字留空，由渲染器兜底文案）
    const vol = r.cards.filter((c) => c.config.shape === "volume");
    expect(vol.length).toBe(2);
    expect(vol.some((c) => c.config.volumeName === "")).toBe(true);
  });
});



