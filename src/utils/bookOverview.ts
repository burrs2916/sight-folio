// 全书总览画板布局（H1）：把一本书的章节虚拟文件（writing:// 场景的
// project_files 行）铺成「人物列 + 章节网格（按卷分组）」两区画布。
//
// 设计约束：
// - 纯函数：输入 projectStore.files，输出卡片数组（type/x/y/w/h/config/locked），
//   由调用方走 addComponentsBulk 批量落库 —— 与代码场景的 buildTreeLayout 同一模式。
// - 双击跳转：章节卡 config 带 fileId（wfile_*），复用 SceneEditor 画布
//   「带 fileId 的实体双击跳源码」通用兜底 → 命中 read_source_file 的 writing:// 分支。
// - 章节排序：rel_path 由后端按全局序号生成（{卷/}{序号2位}-{标题}.md），
//   提取序号数字排序即还原作者目录里的章节顺序。
// - 人物聚合：metadata.appearances（每章各设定卡提及次数，后端 F2 落库）跨章求和。

import type { ProjectFile } from "../services/tauri";

export interface BookOverviewCard {
  type: "writing-chapter" | "writing-character" | "writing-outline";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 卷头是结构性装饰，锁定防拖乱；章节/人物卡可自由拖拽排版 */
  locked: boolean;
  config: Record<string, unknown>;
}

export interface BookOverviewResult {
  cards: BookOverviewCard[];
  chapterCount: number;
  characterCount: number;
  volumeCount: number;
  totalWords: number;
}

export interface ChapterRow {
  file: ProjectFile;
  volume: string;
  status: string;
  appearances: { id: string; name: string; count: number; kind?: string }[];
}

/** 提取 rel_path 里的全局章节序号（{卷/}{2位序}-{标题}.md → 序号） */
function chapterNo(relPath: string): number {
  const m = relPath.match(/(\d+)-/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * 章节行解析 + 按作者目录顺序排序（H5 抽出：全书总览 / 分镜板 / 人物关系板共用同一口径）。
 * 排序键：后端生成的全局序号（rel_path 前缀）优先，同序号时按路径兜底，保证稳定。
 */
export function parseWritingChapters(files: ProjectFile[]): ChapterRow[] {
  return files
    .filter((f) => !f.isDirectory)
    .map((f) => {
      let volume = "";
      let status = "";
      let appearances: ChapterRow["appearances"] = [];
      try {
        const meta = JSON.parse(f.metadata || "{}") as Record<string, unknown>;
        if (typeof meta.volume === "string") volume = meta.volume;
        if (typeof meta.chapterStatus === "string") status = meta.chapterStatus;
        if (Array.isArray(meta.appearances)) {
          const raw = meta.appearances as Record<string, unknown>[];
          appearances = raw
            .filter(
              (a) => a && typeof a.id === "string" && typeof a.name === "string" && typeof a.count === "number"
            )
            .map((a) => ({
              id: a.id as string,
              name: a.name as string,
              count: a.count as number,
              // kind 由 scan_writing_book 落库（character/worldbuilding）；旧数据缺失按人物兜底
              kind: typeof a.kind === "string" ? (a.kind as string) : undefined,
            }));
        }
      } catch {
        /* metadata 损坏按空处理，不阻断整板 */
      }
      return { file: f, volume, status, appearances };
    })
    .sort((a, b) => chapterNo(a.file.relPath) - chapterNo(b.file.relPath) || a.file.relPath.localeCompare(b.file.relPath));
}

export function buildBookOverview(files: ProjectFile[]): BookOverviewResult {
  // 1) 章节行解析 + 排序（按后端生成的全局序号，稳定还原章节顺序）
  const chapters = parseWritingChapters(files);

  const totalWords = chapters.reduce((sum, c) => sum + (c.file.size || 0), 0);

  // 2) 人物聚合（跨章求提及次数与出现章数，按总提及降序）
  //    同时记下「主出场章节」（提及最多的那一章，并列取靠前的）：设定卡自己不是文件，
  //    没有它双击就是死节点 —— 挂上后复用画布「带 fileId 实体双击跳正文」通用兜底，
  //    点人物卡 = 直接到他戏份最重的那一章。
  const charMap = new Map<
    string,
    { id: string; name: string; total: number; chapters: number; top: ChapterRow | null; topCount: number }
  >();
  for (const ch of chapters) {
    for (const a of ch.appearances) {
      const acc =
        charMap.get(a.id) ?? { id: a.id, name: a.name, total: 0, chapters: 0, top: null as ChapterRow | null, topCount: 0 };
      acc.total += a.count;
      acc.chapters += 1;
      if (a.count > acc.topCount) {
        acc.topCount = a.count;
        acc.top = ch;
      }
      charMap.set(a.id, acc);
    }
  }
  const characters = [...charMap.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name)
  );

  // 3) 布局：左列人物，右侧章节网格（按卷分组，卷头横条）
  const cards: BookOverviewCard[] = [];
  const CHAR_W = 176;
  const CHAR_H = 56;
  const CHAR_GAP = 14;
  const HAS_CHAR = characters.length > 0;
  const GRID_X = HAS_CHAR ? CHAR_W + 64 : 0;
  const CH_W = 232;
  const CH_H = 64;
  const GAP_X = 16;
  const GAP_Y = 16;
  const COLS = 4;
  const GRID_W = COLS * CH_W + (COLS - 1) * GAP_X;

  characters.forEach((c, i) => {
    cards.push({
      type: "writing-character",
      name: c.name,
      x: 0,
      y: i * (CHAR_H + CHAR_GAP),
      width: CHAR_W,
      height: CHAR_H,
      locked: false,
      config: {
        name: c.name,
        appearances: c.total,
        chapterCount: c.chapters,
        // 主出场章节：双击跳正文的落点（见上方聚合注释）。
        // 没有主出场章（理论上不会出现）就根本不写这两个键 —— 写空串会被通用兜底
        // 当成「有 fileId」去跳，弹一个莫名其妙的失败 toast。
        topChapter: c.top?.file.name ?? "",
        ...(c.top ? { fileId: c.top.file.id, filePath: c.top.file.path } : {}),
      },
    });
  });

  let y = 0;
  let volumeCount = 0;
  let idx = 0;
  while (idx < chapters.length) {
    const vol = chapters[idx].volume;
    let end = idx;
    while (end < chapters.length && chapters[end].volume === vol) end++;
    const group = chapters.slice(idx, end);
    if (vol) {
      volumeCount += 1;
      cards.push({
        type: "writing-outline",
        name: vol,
        x: GRID_X,
        y,
        width: GRID_W,
        height: 34,
        locked: true,
        config: {
          title: vol,
          summary: group.length,
          kind: "volume",
          // 卷头双击跳本卷第一章（结构性装饰也得可点击，不然是死节点）
          topChapter: group[0].file.name,
          ...(group[0]
            ? { fileId: group[0].file.id, filePath: group[0].file.path }
            : {}),
        },
      });
      y += 46;
    }
    group.forEach((ch, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      cards.push({
        type: "writing-chapter",
        name: ch.file.name,
        x: GRID_X + col * (CH_W + GAP_X),
        y: y + row * (CH_H + GAP_Y),
        width: CH_W,
        height: CH_H,
        locked: false,
        config: {
          fileId: ch.file.id,
          filePath: ch.file.path,
          title: ch.file.name,
          volume: ch.volume,
          wordCount: ch.file.size || 0,
          chapterStatus: ch.status,
        },
      });
    });
    const rows = Math.ceil(group.length / COLS);
    y += rows * (CH_H + GAP_Y) + 22;
    idx = end;
  }

  return {
    cards,
    chapterCount: chapters.length,
    characterCount: characters.length,
    volumeCount,
    totalWords,
  };
}
