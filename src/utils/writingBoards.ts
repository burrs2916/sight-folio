// 写作预设画板 · 分镜板 / 人物关系板（H5）
//
// 与全书总览（bookOverview）的分工：
//   全书总览 = 「体量」读法 —— 人物列 + 4 列密集章节网格，一眼看有多少章、多少人物；
//   分镜板   = 「顺序」读法 —— 横向时间轴，一章一格镜头，从左往右过一遍叙事推进；
//   关系板   = 「结构」读法 —— 设定卡为节点、同章共现为边，看谁和谁真的一起出现。
// 三者共用 parseWritingChapters 的章节口径，保证同一本书在任何板上读到的数字一致。
//
// 数据全部来自 F2 扫描产物（project_files.metadata.appearances），零新后端命令。

import { parseWritingChapters } from './bookOverview';
import type { ProjectFile } from '../services/tauri';

export interface BoardCard {
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 结构性装饰（卷头）锁定防拖乱 */
  locked: boolean;
  config: Record<string, unknown>;
}

interface Card {
  id: string;
  name: string;
  kind: 'character' | 'worldbuilding';
  total: number;
  chapters: number;
  /** 主出场章节（提及最多的一章，并列取靠前）：设定卡不是文件，挂上它双击才有落点 */
  top: ReturnType<typeof parseWritingChapters>[number] | null;
  topCount: number;
}

/** 设定卡聚合：跨章求提及次数与出现章数，按总提及降序 */
function aggregateCards(chapters: ReturnType<typeof parseWritingChapters>): Card[] {
  const map = new Map<string, Card>();
  for (const ch of chapters) {
    for (const a of ch.appearances) {
      const kind: Card['kind'] = a.kind === 'worldbuilding' ? 'worldbuilding' : 'character';
      const acc = map.get(a.id) ?? { id: a.id, name: a.name, kind, total: 0, chapters: 0, top: null, topCount: 0 };
      acc.total += a.count;
      acc.chapters += 1;
      if (a.count > acc.topCount) {
        acc.topCount = a.count;
        acc.top = ch;
      }
      map.set(a.id, acc);
    }
  }
  return [...map.values()].sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));
}

// ─────────────────────────────────────────────────────────────
// 分镜板：横向时间轴（一章一格镜头，卷头横条领起本卷）
// ─────────────────────────────────────────────────────────────

export interface StoryboardResult {
  cards: BoardCard[];
  chapterCount: number;
  volumeCount: number;
}

const SHOT_W = 176;
const SHOT_H = 150;
const SHOT_GAP = 18;
const VOL_H = 34;
const VOL_GAP = 52; // 卷与卷之间在横向多留一段，视觉上分段

export function buildStoryboard(files: ProjectFile[]): StoryboardResult {
  const chapters = parseWritingChapters(files);
  const cards: BoardCard[] = [];
  let x = 0;
  let volumeCount = 0;
  let idx = 0;
  while (idx < chapters.length) {
    const vol = chapters[idx].volume;
    let end = idx;
    while (end < chapters.length && chapters[end].volume === vol) end++;
    const group = chapters.slice(idx, end);
    const groupW = group.length * SHOT_W + (group.length - 1) * SHOT_GAP;
    if (vol) {
      volumeCount += 1;
      cards.push({
        type: 'writing-outline',
        name: vol,
        x,
        y: 0,
        width: groupW,
        height: VOL_H,
        locked: true,
        config: {
          title: vol,
          summary: group.length,
          kind: 'volume',
          // 卷头双击跳本卷第一章（横向时间轴的卷分段也不能是死节点）
          topChapter: group[0].file.name,
          ...(group[0] ? { fileId: group[0].file.id, filePath: group[0].file.path } : {}),
        },
      });
    }
    const topY = vol ? VOL_H + 14 : 0;
    group.forEach((ch, i) => {
      // 卡内人物只带前 3 个（画布上塞满名字等于没信息），其余用 +N 由渲染器补
      const cast = [...ch.appearances]
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((a) => ({ name: a.name, count: a.count }));
      cards.push({
        type: 'writing-chapter',
        name: ch.file.name,
        x: x + i * (SHOT_W + SHOT_GAP),
        y: topY,
        width: SHOT_W,
        height: SHOT_H,
        locked: false,
        config: {
          fileId: ch.file.id,
          filePath: ch.file.path,
          title: ch.file.name,
          volume: ch.volume,
          wordCount: ch.file.size || 0,
          chapterStatus: ch.status,
          shotNo: idx + i + 1,
          cast,
          castTotal: ch.appearances.length,
        },
      });
    });
    x += groupW + VOL_GAP;
    idx = end;
  }
  return { cards, chapterCount: chapters.length, volumeCount };
}

// ─────────────────────────────────────────────────────────────
// 人物关系板：设定卡为节点，同章共现为边（对称、无方向）
// ─────────────────────────────────────────────────────────────

export interface RelationBoardResult {
  cards: BoardCard[];
  nodeCount: number;
  edgeCount: number;
  /** 最强共现（章数），供 toast 与线宽归一化 */
  maxCo: number;
  /** 因上限被丢弃的边数（0 表示全画了） */
  dropped: number;
  /** 共现边明细（a/b 为设定卡 id，co 为共场章数），供关系面板列表展示（新增，零回归） */
  edges: { a: string; b: string; co: number; aName: string; bName: string }[];
}

const NODE_W = 150;
const NODE_H = 54;
/** 共现边上限：20 个节点两两 190 条，全画就是一团毛线球；按权重取前 N 条 */
const MAX_EDGES = 80;

export function buildRelationBoard(files: ProjectFile[]): RelationBoardResult {
  const chapters = parseWritingChapters(files);
  const all = aggregateCards(chapters);
  if (all.length < 2) {
    return { cards: [], nodeCount: all.length, edgeCount: 0, maxCo: 0, dropped: 0, edges: [] };
  }

  // 1) 共现统计：两卡在同一章都被提及 → 该章记 1 次（同章提及多次也只算 1 次「同场」）
  const pair = new Map<string, number>();
  for (const ch of chapters) {
    const ids = ch.appearances.map((a) => a.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        pair.set(key, (pair.get(key) ?? 0) + 1);
      }
    }
  }
  const edges = [...pair.entries()]
    .map(([key, co]) => {
      const [a, b] = key.split('|');
      return { a, b, co };
    })
    .sort((m, n) => n.co - m.co);
  const maxCo = edges.length ? edges[0].co : 0;
  const kept = edges.slice(0, MAX_EDGES);
  const dropped = edges.length - kept.length;

  // 2) 节点布局：环形（出场越多越靠前，环上均匀分布；半径随节点数增长防重叠）
  const cards: BoardCard[] = [];
  const radius = Math.max(240, (all.length * (NODE_H + 26)) / (2 * Math.PI));
  const cx = radius + NODE_W / 2;
  const cy = radius + NODE_H / 2;
  const pos = new Map<string, { x: number; y: number }>();
  all.forEach((c, i) => {
    const angle = (i / all.length) * Math.PI * 2 - Math.PI / 2;
    const px = cx + radius * Math.cos(angle);
    const py = cy + radius * Math.sin(angle);
    pos.set(c.id, { x: px, y: py });
    cards.push({
      type: c.kind === 'worldbuilding' ? 'writing-worldview' : 'writing-character',
      name: c.name,
      x: px - NODE_W / 2,
      y: py - NODE_H / 2,
      width: NODE_W,
      height: NODE_H,
      locked: false,
      config: {
        name: c.name,
        appearances: c.total,
        chapterCount: c.chapters,
        kind: c.kind,
        // 主出场章节：双击跳正文的落点（设定卡本身不是文件，没有它双击就是死节点）。
        // 无主出场章时不写 fileId/filePath —— 空串会被通用兜底当成有效 id 去跳。
        topChapter: c.top?.file.name ?? '',
        ...(c.top ? { fileId: c.top.file.id, filePath: c.top.file.path } : {}),
      },
    });
  });

  // 3) 边：bbox = 两端中心包围盒，坐标相对 bbox 左上角（与 structure 边同一约定）
  const nameOf = new Map(all.map((c) => [c.id, c.name]));
  for (const e of kept) {
    const p1 = pos.get(e.a);
    const p2 = pos.get(e.b);
    if (!p1 || !p2) continue;
    const minX = Math.min(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    cards.push({
      type: 'dependency-edge',
      name: `${nameOf.get(e.a)} ⇄ ${nameOf.get(e.b)}`,
      x: minX,
      y: minY,
      width: Math.max(4, Math.abs(p2.x - p1.x)),
      height: Math.max(4, Math.abs(p2.y - p1.y)),
      locked: true, // 边由布局算出来，拖动只会让它与节点脱节
      config: {
        depType: 'cooccur',
        fromX: p1.x - minX,
        fromY: p1.y - minY,
        toX: p2.x - minX,
        toY: p2.y - minY,
        // 线宽归一：degree 0..1（相对最强共现）；coChanges 是真实共现章数（标签/tooltip 用）
        degree: maxCo > 0 ? e.co / maxCo : 0,
        coChanges: e.co,
        fromName: nameOf.get(e.a) ?? '',
        toName: nameOf.get(e.b) ?? '',
      },
    });
  }

  const edgeList = kept.map((e) => ({
    a: e.a,
    b: e.b,
    co: e.co,
    aName: nameOf.get(e.a) ?? '',
    bName: nameOf.get(e.b) ?? '',
  }));

  return { cards, nodeCount: all.length, edgeCount: kept.length, maxCo, dropped, edges: edgeList };
}

// ─────────────────────────────────────────────────────────────
// 世界观板：worldbuilding 设定卡网格（提及次数降序，双击跳主出场章）
// 与人物关系板同源 aggregateCards，只取 kind="worldbuilding" 的设定卡，
// 网格铺开不画边——世界观看「有哪些设定、各自分量」，不是关系结构。
// ─────────────────────────────────────────────────────────────

export interface WorldviewBoardResult {
  cards: BoardCard[];
  cardCount: number;
}

const WV_W = 190;
const WV_H = 64;
const WV_GAP = 18;
const WV_COLS = 5;

export function buildWorldviewBoard(files: ProjectFile[]): WorldviewBoardResult {
  const chapters = parseWritingChapters(files);
  const all = aggregateCards(chapters).filter((c) => c.kind === 'worldbuilding');
  const cards: BoardCard[] = all.map((c, i) => {
    const col = i % WV_COLS;
    const row = Math.floor(i / WV_COLS);
    return {
      type: 'writing-worldview',
      name: c.name,
      x: col * (WV_W + WV_GAP),
      y: row * (WV_H + WV_GAP),
      width: WV_W,
      height: WV_H,
      locked: false,
      config: {
        name: c.name,
        appearances: c.total,
        chapterCount: c.chapters,
        kind: c.kind,
        // 主出场章节：双击跳正文的落点（与关系板节点同一约定，无则不写避免空串误跳）
        topChapter: c.top?.file.name ?? '',
        ...(c.top ? { fileId: c.top.file.id, filePath: c.top.file.path } : {}),
      },
    };
  });
  return { cards, cardCount: all.length };
}

// ─────────────────────────────────────────────────────────────
// 统计板：体量 KPI + 卷分布 + 章节体量（L2 统计视图）
//
// 读法与前三块板的分工：
//   分镜板 = 顺序（一章一格，从左往右读推进）
//   关系板 = 结构（谁和谁同场）
//   统计板 = 量（哪一卷/哪一章偏离均值 —— 体量异常是唯一值得上画板的信号）
//
// 全部由 parseWritingChapters 直接算，零新后端命令。字数口径 = file.size
// （后端落库的章节字节数），与全书总览的 totalWords 同源，保证两块板读到同一个数。
// ─────────────────────────────────────────────────────────────

export interface StatsVolumeRow {
  volume: string;
  chapters: number;
  words: number;
  finished: number;
}

export interface StatsBoardResult {
  cards: BoardCard[];
  totalWords: number;
  chapterCount: number;
  volumeCount: number;
  settingCount: number;
  avgWords: number;
  /** 最大章字数 / 最大卷字数：条形归一的基准，调用方做文案时也用得上 */
  maxChapterWords: number;
  maxVolumeWords: number;
}

const KPI_W = 172;
const KPI_H = 76;
const KPI_GAP = 14;

const VOLC_W = 252;
const VOLC_H = 88;
const VOLC_GAP = 16;
const VOLC_COLS = 4;

const CHC_W = 196;
const CHC_H = 58;
const CHC_GAP = 14;
const CHC_COLS = 5;

/** 行高（每段之间留的纵向间距），抽出来避免魔法数字散落 */
const BAND_GAP = 32;

export function buildStatsBoard(files: ProjectFile[]): StatsBoardResult {
  const chapters = parseWritingChapters(files);

  // 空书不出卡：KPI 卡即使是 0 也「有内容」，会让 seedTypedView 的
  // 「files 为空则跳过、视图保留空画布」失效，凭空多出一板 0/0/0 的噪声。
  if (chapters.length === 0) {
    return {
      cards: [],
      totalWords: 0,
      chapterCount: 0,
      volumeCount: 0,
      settingCount: 0,
      avgWords: 0,
      maxChapterWords: 0,
      maxVolumeWords: 0,
    };
  }

  const totalWords = chapters.reduce((sum, c) => sum + (c.file.size || 0), 0);
  const chapterCount = chapters.length;
  const avgWords = chapterCount > 0 ? Math.round(totalWords / chapterCount) : 0;

  // 设定卡总数：跨章按 id 去重（人物 + 世界观都算「设定」）
  const settingIds = new Set<string>();
  for (const ch of chapters) {
    for (const a of ch.appearances) settingIds.add(a.id);
  }
  const settingCount = settingIds.size;

  // 卷分布：按首次出现顺序（= parseWritingChapters 的章序），空卷名归到一组
  const volMap = new Map<string, StatsVolumeRow>();
  for (const ch of chapters) {
    const key = ch.volume || '';
    const row = volMap.get(key) ?? { volume: key, chapters: 0, words: 0, finished: 0 };
    row.chapters += 1;
    row.words += ch.file.size || 0;
    if (ch.status === 'finished') row.finished += 1;
    volMap.set(key, row);
  }
  const volumes = [...volMap.values()];
  // volumeCount 只数「真有卷名」的卷 —— 未分卷不是一个卷，否则空书上会显示 1 卷
  const volumeCount = volumes.filter((v) => v.volume !== '').length;

  const maxChapterWords = chapters.reduce((max, c) => Math.max(max, c.file.size || 0), 0);
  const maxVolumeWords = volumes.reduce((max, v) => Math.max(max, v.words), 0);

  const cards: BoardCard[] = [];
  const pctOf = (v: number, max: number) => (max > 0 ? Math.min(1, v / max) : 0);

  // ── Band A：体量 KPI（一行读完这本书「有多少」）
  // label/sub 存 i18n key 而非成品文案：渲染侧 readStr → resolveFragments 会解引用，
  // 切语言不必重跑布局器。字数/章节数复用既有 writing.* 键（文案与统计口径一致），
  // 不另造同义键 —— 同一个中文值挂两个 key 会污染 zh 反查索引。
  const kpis: { metric: string; label: string; value: string; sub: string }[] = [
    {
      metric: 'words',
      label: 'writing.totalWords',
      value: String(totalWords),
      sub: 'editor.writing.stats.kpiWordsSub',
    },
    {
      metric: 'chapters',
      label: 'writing.chapterCount',
      value: String(chapterCount),
      sub: 'editor.writing.stats.kpiChaptersSub',
    },
    {
      metric: 'volumes',
      label: 'editor.writing.stats.kpiVolumes',
      value: String(volumeCount),
      sub: 'editor.writing.stats.kpiVolumesSub',
    },
    {
      metric: 'settings',
      label: 'editor.writing.stats.kpiSettings',
      value: String(settingCount),
      sub: 'editor.writing.stats.kpiSettingsSub',
    },
    {
      metric: 'avg',
      label: 'editor.writing.stats.kpiAvg',
      value: String(avgWords),
      sub: 'editor.writing.stats.kpiAvgSub',
    },
  ];
  kpis.forEach((k, i) => {
    cards.push({
      type: 'writing-outline',
      name: `${k.value}`,
      x: i * (KPI_W + KPI_GAP),
      y: 0,
      width: KPI_W,
      height: KPI_H,
      locked: false,
      config: {
        kind: 'stat',
        shape: 'kpi',
        metric: k.metric,
        label: k.label,
        value: k.value,
        sub: k.sub,
      },
    });
  });

  // ── Band B：卷分布（每卷一张，条形 = 字数占最大卷的比例）
  const bandB = KPI_H + BAND_GAP;
  volumes.forEach((v, i) => {
    const col = i % VOLC_COLS;
    const row = Math.floor(i / VOLC_COLS);
    cards.push({
      type: 'writing-outline',
      name: v.volume || '—',
      x: col * (VOLC_W + VOLC_GAP),
      y: bandB + row * (VOLC_H + VOLC_GAP),
      width: VOLC_W,
      height: VOLC_H,
      locked: false,
      config: {
        kind: 'stat',
        shape: 'volume',
        volumeName: v.volume,
        entries: v.chapters,
        value: String(v.words),
        finished: v.finished,
        pct: pctOf(v.words, maxVolumeWords),
      },
    });
  });

  // ── Band C：章节体量（按章序铺，条形 = 字数占最大章的比例；状态徽标直接看完成度）
  // 没有卷卡时不预留卷带的高度，否则空卷的书会在 KPI 与章节带之间留一条空档
  const volRows = volumes.length === 0 ? 0 : Math.ceil(volumes.length / VOLC_COLS);
  const bandC = bandB + volRows * (VOLC_H + VOLC_GAP) + BAND_GAP;
  chapters.forEach((ch, i) => {
    const col = i % CHC_COLS;
    const row = Math.floor(i / CHC_COLS);
    const words = ch.file.size || 0;
    cards.push({
      type: 'writing-outline',
      name: ch.file.name,
      x: col * (CHC_W + CHC_GAP),
      y: bandC + row * (CHC_H + CHC_GAP),
      width: CHC_W,
      height: CHC_H,
      locked: false,
      config: {
        kind: 'stat',
        shape: 'chapter',
        title: ch.file.name,
        volume: ch.volume,
        value: String(words),
        pct: pctOf(words, maxChapterWords),
        chapterStatus: ch.status,
        // 双击跳正文：统计卡也要是可行动节点（复用画布带 fileId 实体双击跳转的通用兜底）
        fileId: ch.file.id,
        filePath: ch.file.path,
      },
    });
  });

  return {
    cards,
    totalWords,
    chapterCount,
    volumeCount,
    settingCount,
    avgWords,
    maxChapterWords,
    maxVolumeWords,
  };
}
