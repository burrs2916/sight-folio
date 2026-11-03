/**
 * insightOverlay —— 把 AI 的结论投射回项目视图的「翻译层」。
 *
 * ─── 为什么需要它 ───────────────────────────────────────────────────────
 * 扫描链路到上一轮为止已经闭环：扫描 → 上下文包 → Agent 按需取数 → 结论写回
 * `ai_insights`。但结论只出现在右侧的洞察列表里，而**人看项目的主视图是画布**。
 * 于是出现一个割裂：Agent 说「src/store/projectStore.ts 是改动放大器」，用户
 * 却要在几百张卡片里自己找那一张。分析做完了，视图上却看不见 —— 这一段不通，
 * 前面所有的省 token、去重沉淀都只服务了对话框，没有服务视图。
 *
 * 本文件负责其中最脏也最容易出错的一步：**把 Agent 写的位置引用对齐到画布实体**。
 *
 * ─── 为什么不能直接拿 refs 当 key 用 ────────────────────────────────────
 * refs 是模型写出来的自由文本，实际见过的形态至少有五种：
 *   `src/a.ts:120` / `src/a.ts` / `./src/a.ts` / `src\a.ts`（Windows 风格）/
 *   `/Users/x/proj/src/a.ts`（绝对路径）/ `src/ai/`（整个目录）
 * 而画布实体上带的是扫描产出的相对路径 `src/a.ts`。直接字符串相等匹配，
 * 上面六种里只有一种能命中。
 *
 * ─── 匹配策略：宁可不标，绝不标错 ───────────────────────────────────────
 * 标错比不标更糟 —— 用户会照着角标去改一个根本没问题的文件，并且从此不再
 * 信任这个角标。所以后缀匹配命中多个候选（例如 `index.ts` 在项目里有 40 个）
 * 时**一律丢弃**并计入 unresolved，由面板显式提示，而不是随便挑一个点亮。
 *
 * 本文件是纯函数：不碰 store、不碰 DOM、不查库，因此可以直接单测。
 */

/** 洞察严重度（与后端归一化后的取值一致） */
export type InsightSeverity = "critical" | "high" | "medium" | "low" | "info";

import { t } from "../i18n";
import { STATUS_TOKENS, type StatusTone } from "../theme/semanticColors";

/** 严重度标签（本地化，随当前 UI 语言；与 severity.* 命名空间同源） */
export function severityLabel(sev: InsightSeverity): string {
  return t(`severity.${sev}`);
}

/** 严重度权重：数字越小越危险（与 AiInsightsPanel 的排序语义一致） */
export const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEVERITY_BY_RANK: InsightSeverity[] = ["critical", "high", "medium", "low", "info"];

/**
 * 严重度归一化。后端已做过一轮别名归一，这里再兜一层是因为覆盖层的输入
 * 也可能来自旧数据行（表结构是幂等 ALTER 演进出来的，历史行什么都有）。
 */
export function normalizeSeverity(raw: string | null | undefined): InsightSeverity {
  const s = (raw ?? "").trim().toLowerCase();
  if (s in SEVERITY_RANK) return s as InsightSeverity;
  if (s === "blocker" || s === "fatal") return "critical";
  if (s === "major" || s === "warn" || s === "warning") return "high";
  if (s === "minor") return "low";
  return "info";
}

/** 覆盖层只需要洞察的这几个字段，不依赖完整 DTO（便于测试与未来复用） */
export interface InsightLike {
  id: string;
  title: string;
  severity: string;
  refs: string[];
  /**
   * 生命周期状态。已收口（`resolved`）的结论不再上画布——角标的含义是
   * 「这里现在有问题」，把已经改好的问题继续标红，比不标更容易误导人。
   * 缺省视为开放：历史数据没有这一列，不能因此让它们集体消失。
   */
  status?: string;
}

/** 单个实体（文件或目录）上的洞察标记 */
export interface InsightMark {
  /** 该实体命中的最高严重度 */
  severity: InsightSeverity;
  /** 命中该实体的洞察条数（按洞察 id 去重） */
  count: number;
  /** 最严重的若干条标题，供 tooltip 展示（最多 3 条） */
  titles: string[];
  /** 目录：子树内被点名的文件数；文件实体恒为 1 */
  fileCount: number;
}

export interface InsightMarkIndex {
  /** key = 规范化后的文件相对路径 */
  files: Record<string, InsightMark>;
  /** key = 规范化后的目录相对路径（含所有祖先层级） */
  dirs: Record<string, InsightMark>;
  /** 无法对齐到任何实体的引用原文（面板据此提示，不静默吞掉） */
  unresolved: string[];
}

export const EMPTY_MARK_INDEX: InsightMarkIndex = { files: {}, dirs: {}, unresolved: [] };

export interface BuildMarksOptions {
  /**
   * 画布上只标注达到该严重度的洞察，默认 medium。
   * 低于阈值的结论仍然在洞察列表里可见 —— 画布是「一眼看出哪里危险」的视图，
   * 把 info 级也铺上去只会变成噪声墙，反而看不见真正的红点。
   */
  minSeverity?: InsightSeverity;
}

/**
 * 拆出 `路径:行号` 里的行号并规范化路径分隔符。
 *
 * 行号必须是纯数字才认，因此 Windows 盘符 `C:\x\a.ts` 不会被误切
 * （切出来的 `\x\a.ts` 不是数字）。
 */
export function normalizeRefPath(raw: string): { path: string; line: number | null } {
  let s = (raw ?? "").trim();
  let line: number | null = null;

  const idx = s.lastIndexOf(":");
  if (idx > 0) {
    const tail = s.slice(idx + 1).trim();
    if (/^\d+$/.test(tail)) {
      line = Number(tail);
      s = s.slice(0, idx);
    }
  }

  s = s.replace(/\\/g, "/").replace(/\/{2,}/g, "/").trim();
  // 反复剥 "./"：模型偶尔写成 "././src/a.ts"
  while (s.startsWith("./")) s = s.slice(2);
  // 去掉尾部斜杠，让 "src/ai/" 与 "src/ai" 命中同一个目录
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);

  return { path: s, line };
}

/** 取路径的目录部分；根级返回 null（与 FileRenderer.dirPathOf 语义一致） */
function dirOf(path: string): string | null {
  const i = path.lastIndexOf("/");
  if (i <= 0) return null;
  return path.slice(0, i);
}

/** 逐级列出祖先目录：a/b/c.ts → ["a/b", "a"] */
function ancestorsOf(path: string): string[] {
  const out: string[] = [];
  let d = dirOf(path);
  while (d) {
    out.push(d);
    d = dirOf(d);
  }
  return out;
}

interface PathIndex {
  files: Set<string>;
  dirs: Set<string>;
  byBasename: Map<string, string[]>;
}

function buildPathIndex(knownPaths: readonly string[]): PathIndex {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const byBasename = new Map<string, string[]>();

  for (const raw of knownPaths) {
    const { path } = normalizeRefPath(raw);
    if (!path) continue;
    files.add(path);
    const base = path.slice(path.lastIndexOf("/") + 1);
    const list = byBasename.get(base);
    if (list) list.push(path);
    else byBasename.set(base, [path]);
    for (const d of ancestorsOf(path)) dirs.add(d);
  }
  return { files, dirs, byBasename };
}

type Resolved =
  | { kind: "file"; path: string }
  | { kind: "dir"; path: string }
  | { kind: "none" };

/**
 * 把一条引用对齐到已知实体。
 *
 * 顺序：精确文件 → 文件后缀唯一命中 → 精确目录 → 目录后缀唯一命中 → 放弃。
 * 「唯一」是硬性要求：`index.ts` 这种在项目里有几十份的名字，宁可不标。
 */
export function resolveRefPath(candidate: string, index: PathIndex): Resolved {
  if (!candidate) return { kind: "none" };
  if (index.files.has(candidate)) return { kind: "file", path: candidate };

  // 后缀匹配：绝对路径（known 是 candidate 的后缀）与截断路径（candidate 是 known 的后缀）都要兼容
  const base = candidate.slice(candidate.lastIndexOf("/") + 1);
  const sameName = index.byBasename.get(base);
  if (sameName && sameName.length > 0) {
    const hits = sameName.filter(
      (known) => known.endsWith("/" + candidate) || candidate.endsWith("/" + known),
    );
    if (hits.length === 1) return { kind: "file", path: hits[0] };
    if (hits.length > 1) return { kind: "none" }; // 歧义：宁可不标
  }

  if (index.dirs.has(candidate)) return { kind: "dir", path: candidate };

  const dirHits: string[] = [];
  for (const d of index.dirs) {
    if (d.endsWith("/" + candidate) || candidate.endsWith("/" + d)) dirHits.push(d);
  }
  if (dirHits.length === 1) return { kind: "dir", path: dirHits[0] };

  return { kind: "none" };
}

/** 聚合中间态：用 Set 去重洞察 id，避免一条洞察引用同文件 3 处被算成 3 条 */
interface Acc {
  rank: number;
  ids: Set<string>;
  entries: { rank: number; title: string }[];
  files: Set<string>;
}

function touch(map: Map<string, Acc>, key: string): Acc {
  let acc = map.get(key);
  if (!acc) {
    acc = { rank: 99, ids: new Set(), entries: [], files: new Set() };
    map.set(key, acc);
  }
  return acc;
}

function finalize(acc: Acc): InsightMark {
  const titles = [...acc.entries]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((e) => e.title);
  return {
    severity: SEVERITY_BY_RANK[Math.min(acc.rank, 4)] ?? "info",
    count: acc.ids.size,
    titles,
    fileCount: acc.files.size,
  };
}

/**
 * 洞察 → 实体标记索引。
 *
 * @param insights Agent 沉淀在 ai_insights 里的结论
 * @param knownPaths 当前分析下所有文件的相对路径（projectStore.files.relPath），
 *        用于把绝对路径 / 截断路径对齐到画布实体真正使用的 key
 */
export function buildInsightMarks(
  insights: readonly InsightLike[],
  knownPaths: readonly string[],
  options: BuildMarksOptions = {},
): InsightMarkIndex {
  const minRank = SEVERITY_RANK[options.minSeverity ?? "medium"];
  const index = buildPathIndex(knownPaths);

  const fileAcc = new Map<string, Acc>();
  const dirAcc = new Map<string, Acc>();
  const unresolved: string[] = [];
  const seenUnresolved = new Set<string>();

  for (const ins of insights) {
    // 已收口的结论退出画布：它代表的问题已被复核确认不存在，继续标红就是误报
    if (ins.status === "resolved") continue;
    const sev = normalizeSeverity(ins.severity);
    const rank = SEVERITY_RANK[sev];
    if (rank > minRank) continue; // 低于阈值不上画布（列表里依然看得到）
    if (!Array.isArray(ins.refs) || ins.refs.length === 0) continue;

    // 同一条洞察可能引用同一文件的多行，这里先按实体去重再聚合
    const filesHit = new Set<string>();
    const dirsHit = new Set<string>();

    for (const raw of ins.refs) {
      const { path } = normalizeRefPath(raw);
      const r = resolveRefPath(path, index);
      if (r.kind === "file") filesHit.add(r.path);
      else if (r.kind === "dir") dirsHit.add(r.path);
      else if (raw && !seenUnresolved.has(raw)) {
        seenUnresolved.add(raw);
        unresolved.push(raw);
      }
    }

    for (const f of filesHit) {
      const acc = touch(fileAcc, f);
      acc.rank = Math.min(acc.rank, rank);
      acc.ids.add(ins.id);
      acc.entries.push({ rank, title: ins.title });
      acc.files.add(f);
      // 向上冒泡：目录角标代表「子树里有问题」，用户在全览档就能顺着往下钻
      for (const d of ancestorsOf(f)) {
        const dacc = touch(dirAcc, d);
        dacc.rank = Math.min(dacc.rank, rank);
        dacc.ids.add(ins.id);
        dacc.entries.push({ rank, title: ins.title });
        dacc.files.add(f);
      }
    }

    // 直接点名目录的引用（`src/ai/`）：标在该目录及其祖先上，但不虚报文件数
    for (const d of dirsHit) {
      for (const key of [d, ...ancestorsOf(d)]) {
        const dacc = touch(dirAcc, key);
        dacc.rank = Math.min(dacc.rank, rank);
        dacc.ids.add(ins.id);
        dacc.entries.push({ rank, title: ins.title });
      }
    }
  }

  const files: Record<string, InsightMark> = {};
  for (const [k, v] of fileAcc) files[k] = finalize(v);
  const dirs: Record<string, InsightMark> = {};
  for (const [k, v] of dirAcc) dirs[k] = finalize(v);

  return { files, dirs, unresolved };
}

/**
 * 把一条洞察的引用列表对齐成画布实体的 key（面板「在画布中定位」用）。
 *
 * 与 buildInsightMarks 共用同一套解析规则，保证「面板点定位」点亮的
 * 正是「画布上带角标」的那些实体，不会出现两边对不上的情况。
 */
export function resolveMarkedPaths(
  refs: readonly string[],
  knownPaths: readonly string[],
): { files: string[]; dirs: string[] } {
  const index = buildPathIndex(knownPaths);
  const files = new Set<string>();
  const dirs = new Set<string>();
  for (const raw of refs ?? []) {
    const { path } = normalizeRefPath(raw);
    const r = resolveRefPath(path, index);
    if (r.kind === "file") files.add(r.path);
    else if (r.kind === "dir") dirs.add(r.path);
  }
  return { files: [...files], dirs: [...dirs] };
}

/**
 * 反查：某个实体路径对应哪些洞察（面板「只看这个文件」与画布点选联动都用它）。
 * 目录会连带子树内文件的洞察一起返回。
 */
export function insightsForPath(
  insights: readonly InsightLike[],
  targetPath: string,
  knownPaths: readonly string[],
): InsightLike[] {
  const { path: target } = normalizeRefPath(targetPath);
  if (!target) return [];
  const index = buildPathIndex(knownPaths);
  const isDir = !index.files.has(target) && index.dirs.has(target);

  return insights.filter((ins) =>
    (ins.refs ?? []).some((raw) => {
      const { path } = normalizeRefPath(raw);
      const r = resolveRefPath(path, index);
      if (r.kind === "none") return false;
      if (r.path === target) return true;
      return isDir && r.path.startsWith(target + "/");
    }),
  );
}

/** 严重度 → 语义族。画布角标与右侧面板共用同一张映射表，语义永远同源。 */
export const SEVERITY_TONE: Record<InsightSeverity, StatusTone> = {
  critical: "danger",
  high: "accent",
  medium: "warning",
  low: "cyan",
  info: "indigo",
};

/**
 * 画布角标配色（与 AiInsightsPanel 的严重度色同源，保证左右两侧语义一致）。
 *
 * 这里取的是 **fill（填充）角色**，不是文字角色：角标是「彩色底 + 白字」，
 * 而右侧面板里同一严重度是当**文字色**用的。两者取值必须不同 —— 深色下文字要偏亮、
 * 白字填充底要偏深，混用就会出现「浅底白字」（旧值 #ea580c / #d97706 作白字底只有
 * 3.0:1 左右，角标上的字基本糊掉）或「深底深字」。定义见 theme/semanticColors.ts。
 */
export const SEVERITY_COLOR: Record<InsightSeverity, string> = {
  critical: STATUS_TOKENS.danger.fill,
  high: STATUS_TOKENS.accent.fill,
  medium: STATUS_TOKENS.warning.fill,
  low: STATUS_TOKENS.cyan.fill,
  info: STATUS_TOKENS.indigo.fill,
};
