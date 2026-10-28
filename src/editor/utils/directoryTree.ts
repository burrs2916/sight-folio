/**
 * 目录结构聚合（「文件目录」这一分析维度的数据层）
 *
 * 需求 §7.3 要求分析「文件目录」并在画布上画像，但此前整条链路是缺的：
 * - 后端 modules 只按**顶层一级目录**聚合，看不到 src/editor/panels 这种真实层级
 * - 前端十二种画像里没有一种是目录结构
 * - folder 实体类型注册了、FolderRenderer 写了，却没有任何代码创建过 folder 实体，
 *   渲染器里那两个 childCount / depth 字段从来没有真实数据喂进去
 *
 * 这个模块补上数据层：把扁平的 ProjectFile[] 还原成目录树，并为每个目录
 * 后序聚合出「规模 / 复杂度 / 欠账 / 语言构成」四类指标。
 *
 * 为什么不用 parentId 建树：
 * parentId 由后端扫描时写入，根目录项可能缺失、被排除规则跳过的中间目录会断链，
 * 用它建树会掉节点。relPath 是每个文件都必然完整的字段，按 "/" 切分重建
 * 目录层级更稳，代价只是要自己补出中间目录节点。
 */

import type { ProjectFile, FileMetric, TechDebtItem, ReviewFinding, CodeClone } from "../../services/tauri";

/** 复杂度分档阈值（与画布热力、SVG 报告口径一致） */
export function complexityLevelOf(avg: number): "low" | "medium" | "high" | "extreme" {
  if (avg <= 5) return "low";
  if (avg <= 10) return "medium";
  if (avg <= 20) return "high";
  return "extreme";
}

export interface DirLanguageShare {
  language: string;
  files: number;
  lines: number;
}

export interface DirNode {
  /** 相对路径，根节点为 ""（显示为项目名） */
  path: string;
  name: string;
  depth: number;
  children: DirNode[];

  /** 直属文件数（不含子目录） */
  directFiles: number;
  /** 含所有子孙的文件总数 */
  fileCount: number;
  /** 子目录数（直属） */
  childDirCount: number;

  totalLines: number;
  /** 子孙文件圈复杂度均值（无度量数据时为 0） */
  avgComplexity: number;
  maxComplexity: number;
  complexityLevel: "low" | "medium" | "high" | "extreme";

  techDebtCount: number;
  findingCount: number;
  cloneCount: number;

  /** 语言构成，按文件数降序 */
  languages: DirLanguageShare[];
  dominantLanguage: string | null;
}

interface Accum {
  directFiles: number;
  fileCount: number;
  totalLines: number;
  complexitySum: number;
  complexityN: number;
  maxComplexity: number;
  techDebtCount: number;
  findingCount: number;
  cloneCount: number;
  langFiles: Map<string, { files: number; lines: number }>;
}

function emptyAccum(): Accum {
  return {
    directFiles: 0,
    fileCount: 0,
    totalLines: 0,
    complexitySum: 0,
    complexityN: 0,
    maxComplexity: 0,
    techDebtCount: 0,
    findingCount: 0,
    cloneCount: 0,
    langFiles: new Map(),
  };
}

/** 取文件所在目录路径（顶层文件返回 ""） */
function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i < 0 ? "" : relPath.slice(0, i);
}

/** 目录路径的所有祖先链（含自身），从根到叶：["", "src", "src/editor"] */
function ancestorChain(dirPath: string): string[] {
  if (dirPath === "") return [""];
  const segs = dirPath.split("/");
  const out: string[] = [""];
  let cur = "";
  for (const s of segs) {
    cur = cur === "" ? s : `${cur}/${s}`;
    out.push(cur);
  }
  return out;
}

export interface BuildDirTreeInput {
  files: ProjectFile[];
  metrics?: FileMetric[];
  techDebt?: TechDebtItem[];
  findings?: ReviewFinding[];
  clones?: CodeClone[];
}

/**
 * 构建目录树并后序聚合指标。
 *
 * 聚合方式：每个文件的指标直接累加到它的**所有祖先目录**上。
 * 这样父目录天然是子目录的汇总，不需要再跑一遍后序遍历；
 * 代价是复杂度均值要用 sum/n 而不是子节点均值再平均
 * （后者会让只有 1 个文件的深目录和有 200 个文件的目录等权，失真）。
 */
export function buildDirectoryTree(input: BuildDirTreeInput): DirNode | null {
  const { files, metrics = [], techDebt = [], findings = [], clones = [] } = input;
  const realFiles = files.filter((f) => !f.isDirectory);
  if (realFiles.length === 0) return null;

  const metricByFile = new Map(metrics.map((m) => [m.fileId, m]));
  const debtCount = new Map<string, number>();
  techDebt.forEach((d) => debtCount.set(d.fileId, (debtCount.get(d.fileId) ?? 0) + 1));
  const findingCount = new Map<string, number>();
  findings.forEach((f) => findingCount.set(f.targetId, (findingCount.get(f.targetId) ?? 0) + 1));
  const cloneCount = new Map<string, number>();
  clones.forEach((c) => cloneCount.set(c.fileId, (cloneCount.get(c.fileId) ?? 0) + 1));

  const accums = new Map<string, Accum>();
  const getAccum = (p: string) => {
    let a = accums.get(p);
    if (!a) {
      a = emptyAccum();
      accums.set(p, a);
    }
    return a;
  };
  // 根节点必然存在，即使项目里全是顶层文件
  getAccum("");

  for (const f of realFiles) {
    const dir = dirOf(f.relPath);
    const chain = ancestorChain(dir);
    const metric = metricByFile.get(f.id);
    const cc = metric?.cyclomaticComplexity ?? 0;
    const lines = metric?.totalLines ?? f.lineCount ?? 0;
    const lang = (f.language || "unknown").toLowerCase();
    const debt = debtCount.get(f.id) ?? 0;
    const finds = findingCount.get(f.id) ?? 0;
    const cl = cloneCount.get(f.id) ?? 0;

    for (const p of chain) {
      const a = getAccum(p);
      a.fileCount += 1;
      a.totalLines += lines;
      if (cc > 0) {
        a.complexitySum += cc;
        a.complexityN += 1;
        if (cc > a.maxComplexity) a.maxComplexity = cc;
      }
      a.techDebtCount += debt;
      a.findingCount += finds;
      a.cloneCount += cl;
      const lf = a.langFiles.get(lang) ?? { files: 0, lines: 0 };
      lf.files += 1;
      lf.lines += lines;
      a.langFiles.set(lang, lf);
    }
    // 直属文件只算到它所在的那一层
    getAccum(dir).directFiles += 1;
  }

  // 由累加表还原成树：先建节点，再按父子路径挂接
  const nodes = new Map<string, DirNode>();
  for (const [path, a] of accums) {
    const avg = a.complexityN > 0 ? a.complexitySum / a.complexityN : 0;
    const languages = [...a.langFiles.entries()]
      .map(([language, v]) => ({ language, files: v.files, lines: v.lines }))
      .sort((x, y) => y.files - x.files || y.lines - x.lines);
    nodes.set(path, {
      path,
      name: path === "" ? "/" : path.slice(path.lastIndexOf("/") + 1),
      depth: path === "" ? 0 : path.split("/").length,
      children: [],
      directFiles: a.directFiles,
      fileCount: a.fileCount,
      childDirCount: 0,
      totalLines: a.totalLines,
      avgComplexity: Math.round(avg * 10) / 10,
      maxComplexity: a.maxComplexity,
      complexityLevel: complexityLevelOf(avg),
      techDebtCount: a.techDebtCount,
      findingCount: a.findingCount,
      cloneCount: a.cloneCount,
      languages,
      dominantLanguage: languages[0]?.language ?? null,
    });
  }

  for (const [path, node] of nodes) {
    if (path === "") continue;
    const i = path.lastIndexOf("/");
    const parentPath = i < 0 ? "" : path.slice(0, i);
    const parent = nodes.get(parentPath);
    if (parent) {
      parent.children.push(node);
      parent.childDirCount += 1;
    }
  }

  // 排序：文件多的目录在前，同量级按名称 —— 目录画像的阅读顺序应该是
  // 「先看大头」，按字母序排会把 utils/ 这种小目录顶到 src/ 前面
  const sortRec = (n: DirNode) => {
    n.children.sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));
    n.children.forEach(sortRec);
  };
  const root = nodes.get("")!;
  sortRec(root);
  return root;
}

export type DirSortMode = "size" | "name" | "path";

export interface FlattenOptions {
  /** 最大展开深度（根为 0），超出的目录折叠进父节点不单独出现 */
  maxDepth?: number;
  /** 最多输出多少个目录节点，超出后停止（防止大项目画布爆炸） */
  maxNodes?: number;
  /** 文件数低于该阈值的目录不单独成节点 */
  minFiles?: number;
  /** 目录内搜索：仅保留路径命中关键词或其子树命中的节点（命中项在渲染层高亮，其余命中路径上的祖先淡化） */
  search?: string;
  /** 子目录展开排序：size=文件多在前（默认）；name=名称 A→Z；path=路径序 */
  sort?: DirSortMode;
}

export interface FlattenResult {
  /** 实际输出的目录节点（先序，父节点紧跟其子树） */
  nodes: DirNode[];
  /** 是否因 maxNodes 上限被截断（树还有更深/更多目录没画出来） */
  truncated: boolean;
  /** 实际输出的目录节点数 */
  shownDirs: number;
  /** target 子树（含自身）的目录总数，不受 maxNodes 限制 */
  totalDirs: number;
  /** target 子树下的文件总数，不受 maxNodes 限制 */
  totalFiles: number;
}

/** 先序展开成可布局的线性序列（父节点紧跟其子树，天然形成缩进树顺序） */
export function flattenDirectoryTree(root: DirNode, opts: FlattenOptions = {}): FlattenResult {
  const { maxDepth = 4, maxNodes = 160, minFiles = 1 } = opts;
  const q = opts.search?.trim().toLowerCase() || "";
  const sortMode = opts.sort ?? "size";

  // 搜索模式：先算出每个节点自身/子树是否命中，用于保留命中路径的祖先链
  const selfMatch = (n: DirNode) => (q ? n.path.toLowerCase().includes(q) : false);
  let subHasMatch: Map<string, boolean> | null = null;
  if (q) {
    subHasMatch = new Map();
    const calc = (n: DirNode): boolean => {
      let has = selfMatch(n);
      for (const c of n.children) if (calc(c)) has = true;
      subHasMatch!.set(n.path, has);
      return has;
    };
    calc(root);
  }

  const cmp = (a: DirNode, b: DirNode): number => {
    if (sortMode === "name") return a.name.localeCompare(b.name);
    if (sortMode === "path") return a.path.localeCompare(b.path);
    return b.fileCount - a.fileCount || a.name.localeCompare(b.name);
  };

  // 搜索模式下放宽深度限制（用户主动筛选，结果已少，深层目录也要能命中）
  const effMaxDepth = q ? 99 : maxDepth;

  const out: DirNode[] = [];
  let hitLimit = false;
  const walk = (n: DirNode) => {
    if (out.length >= maxNodes) {
      hitLimit = true;
      return;
    }
    // 搜索模式：自身与子树均无命中的节点整棵跳过（保留命中路径 + 其祖先链）
    if (q && !(selfMatch(n) || subHasMatch!.get(n.path))) return;
    out.push(n);
    if (n.depth >= effMaxDepth) return;
    const kids = [...n.children].filter((c) => c.fileCount >= minFiles).sort(cmp);
    for (const c of kids) walk(c);
  };
  walk(root);

  // 统计 target 子树下的目录总数与文件总数（不受 maxNodes 限制，用于「已显示 N / 共 M」提示）
  let totalDirs = 0;
  let totalFiles = 0;
  const stat = (n: DirNode) => {
    totalDirs += 1;
    totalFiles += n.fileCount;
    n.children.forEach(stat);
  };
  stat(root);

  return {
    nodes: out,
    truncated: hitLimit,
    shownDirs: out.length,
    totalDirs,
    totalFiles,
  };
}
