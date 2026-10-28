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

// 出场边治理：与关系板 MAX_EDGES 同一思路 —— 全集必是毛线球，按强度截断。
// 单人物只保留提及最多的前 6 章；全局再截前 80 条，丢弃数回传给调用方提示。
const APPEAR_PER_CHAR_CAP = 6;
const MAX_APPEARANCE_EDGES = 80;

export interface BookOverviewCard {
  /** dependency-edge = 出场边（人物 → 出场章节，F8-G2/H1） */
  type: "writing-chapter" | "writing-character" | "writing-outline" | "dependency-edge";
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
  /** 出场边数量（人物 → 出场章节，F8-G2/H1；0 表示无人物数据） */
  appearanceEdgeCount: number;
  /** 因上限被丢弃的出场边数（0 表示全画了） */
  appearanceEdgesDropped: number;
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

  // 书 id：从章节虚拟文件路径反解（writing://{bookId}/...），供设定卡/出场边配置携带，
  // 让画布双击跳设定卡不依赖工作室窗口里 writingStore 是否恰好装载过这本书。
  const bookId = chapters[0]?.file.path.match(/^writing:\/\/([^/]+)\//)?.[1] ?? "";

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

  // 出场边端点收集：人物卡中心 / 章节卡中心（bbox 相对坐标在边卡生成时换算）
  const charCenter = new Map<string, { x: number; y: number }>();
  const chapterCenter = new Map<string, { x: number; y: number; title: string }>();

  characters.forEach((c, i) => {
    const cy = i * (CHAR_H + CHAR_GAP);
    charCenter.set(c.id, { x: CHAR_W / 2, y: cy + CHAR_H / 2 });
    cards.push({
      type: "writing-character",
      name: c.name,
      x: 0,
      y: cy,
      width: CHAR_W,
      height: CHAR_H,
      locked: false,
      config: {
        name: c.name,
        appearances: c.total,
        chapterCount: c.chapters,
        // 设定卡 id（F2 扫描的 appearances[].id 即 WritingSetting.id）：双击直跳设定卡，
        // 不再依赖画布层「按名匹配 writingStore.settings」的兜底（工作室窗口里设定
        // 未必装载过，按名匹配会失败弹「未绑定」）。
        settingId: c.id,
        // 主出场章节：双击跳正文的落点（见上方聚合注释）。
        // 没有主出场章（理论上不会出现）就根本不写这两个键 —— 写空串会被通用兜底
        // 当成「有 fileId」去跳，弹一个莫名其妙的失败 toast。
        topChapter: c.top?.file.name ?? "",
        ...(c.top ? { fileId: c.top.file.id, filePath: c.top.file.path } : {}),
        ...(bookId ? { bookId } : {}),
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
      const chX = GRID_X + col * (CH_W + GAP_X);
      const chY = y + row * (CH_H + GAP_Y);
      chapterCenter.set(ch.file.id, {
        x: chX + CH_W / 2,
        y: chY + CH_H / 2,
        title: ch.file.name,
      });
      cards.push({
        type: "writing-chapter",
        name: ch.file.name,
        x: chX,
        y: chY,
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

  // 4) 出场边（F8-G2/H1）：人物 → 其出场章节。全集很容易是几百条毛线，
  //    沿用关系板的治理手法：单人物只取提及最多的前 6 章（并列按章序），
  //    全局再按提及次数降序截前 MAX_APPEARANCE_EDGES 条，丢弃数回传调用方提示。
  const nameOf = new Map(characters.map((c) => [c.id, c.name]));
  const perChar: { charId: string; fileId: string; count: number; order: number }[] = [];
  chapters.forEach((ch, order) => {
    for (const a of ch.appearances) {
      if (charCenter.has(a.id) && chapterCenter.has(ch.file.id)) {
        perChar.push({ charId: a.id, fileId: ch.file.id, count: a.count, order });
      }
    }
  });
  const byCharTop = new Map<string, typeof perChar>();
  for (const e of perChar) {
    const list = byCharTop.get(e.charId) ?? [];
    list.push(e);
    byCharTop.set(e.charId, list);
  }
  const candidates: typeof perChar = [];
  byCharTop.forEach((list) => {
    list.sort((m, n) => n.count - m.count || m.order - n.order);
    candidates.push(...list.slice(0, APPEAR_PER_CHAR_CAP));
  });
  candidates.sort((m, n) => n.count - m.count);
  const kept = candidates.slice(0, MAX_APPEARANCE_EDGES);
  const dropped = candidates.length - kept.length;
  const maxMention = kept.length ? kept[0].count : 0;
  for (const e of kept) {
    const p1 = charCenter.get(e.charId)!;
    const p2 = chapterCenter.get(e.fileId)!;
    const minX = Math.min(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    cards.push({
      type: "dependency-edge",
      name: `${nameOf.get(e.charId) ?? ""} → ${chapterCenter.get(e.fileId)!.title}`,
      x: minX,
      y: minY,
      width: Math.max(4, Math.abs(p2.x - p1.x)),
      height: Math.max(4, Math.abs(p2.y - p1.y)),
      locked: true, // 边由布局算出来，拖动只会让它与两端卡片脱节
      config: {
        depType: "appearance",
        fromX: p1.x - minX,
        fromY: p1.y - minY,
        toX: p2.x - minX,
        toY: p2.y - minY,
        // 线宽归一：degree 0..1（相对最强提及）；mentions 是该章真实提及次数（tooltip 用）
        degree: maxMention > 0 ? e.count / maxMention : 0,
        mentions: e.count,
        fromName: nameOf.get(e.charId) ?? "",
        toName: chapterCenter.get(e.fileId)!.title,
      },
    });
  }

  return {
    cards,
    chapterCount: chapters.length,
    characterCount: characters.length,
    volumeCount,
    totalWords,
    appearanceEdgeCount: kept.length,
    appearanceEdgesDropped: dropped,
  };
}
