/**
 * 共享工具
 *
 * currentInsights/fileConfig/topDirOf/findNode/buildTreeGuide/readLines/mapLimit 等跨域共享函数。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { type PortraitMode } from './types';
import { t } from '../../../i18n';
import { projectScanApi, type ProjectFile, type SourceFileContent } from '../../../services/tauri';
import { type BulkComponentInput } from '../../../store/editorStore';
import { useProjectStore } from '../../../store/projectStore';
import { type DirNode } from '.././directoryTree';
import { buildFileInsights, duplicationLevelOf, type FileInsight } from '.././fileInsights';


/** 用当前 store 里的全量分析数据构建画像映射 */
export function currentInsights(): Map<string, FileInsight> {
  const pst = useProjectStore.getState();
  return buildFileInsights(
    pst.files,
    pst.symbols,
    pst.patternHits,
    pst.symbolRefs,
    pst.metrics,
    pst.techDebt,
    pst.gitChurn,
    pst.callEdges,
    pst.deadSymbols,
    pst.findings,
    pst.clones,
  );
}

/** 把画像数据写进实体 config（渲染器读取的统一契约；模块下钻等外部路径复用同一口径） */
export function fileConfig(
  f: ProjectFile,
  ins: FileInsight,
  portraitMode: PortraitMode,
  extra?: Record<string, unknown>,
) {
  return {
    fileName: f.name,
    language: f.language,
    fileSize: f.size,
    filePath: f.relPath,
    fileId: f.id,
    lineCount: f.lineCount,
    projectLayerId: f.layerId,
    symbolCount: ins.symbolCount,
    patternNames: ins.patternNames,
    refCount: ins.refCount,
    complexity: ins.complexity,
    complexityLevel: ins.complexityLevel,
    complexityEngine: ins.complexityEngine,
    syntaxErrorCount: ins.syntaxErrorCount,
    syntaxErrorLines: ins.syntaxErrorLines,
    techDebtCount: ins.techDebtCount,
    churnScore: ins.churnScore,
    churnLevel: ins.churnLevel,
    commitCount: ins.commitCount,
    authorCount: ins.authorCount,
    callIn: ins.callIn,
    callOut: ins.callOut,
    deadCount: ins.deadCount,
    cloneCount: ins.cloneCount,
    duplicatedLines: ins.duplicatedLines,
    duplicationRatio: ins.duplicationRatio,
    duplicationLevel: duplicationLevelOf(ins.duplicationRatio),
    quadrant: ins.quadrant,
    findingCount: ins.findingCount,
    riskScore: ins.riskScore,
    errorCount: ins.findingSeverities.error,
    warningCount: ins.findingSeverities.warning,
    portraitMode,
    ...(extra ?? {}),
  };
}

/** 文件 relPath → 顶层目录名（模块口径，全项目统一） */
export function topDirOf(relPath: string): string {
  return relPath.includes('/') ? relPath.split('/')[0] : 'root';
}

// ───────────────────────── 重构四象限画像 ─────────────────────────

/**
 * 四象限画像：churn（变更频率）× complexity（圈复杂度）散点分区
 *
 * 这是 Michael Feathers / CodeScene 那套「重构优先级」判据的可视化。
 * 别的画像都是一维排序（谁最复杂、谁改得最多），一维的问题是**会骗人**：
 * 一个圈复杂度 80 但三年没人动的解析器，和一个复杂度 25 但每周改五次的
 * 订单服务，前者排在前面，可真正该先重构的是后者。
 *
 * 两个维度交叉之后，四个角落各有明确的行动建议：
 * - 右上（高复杂 × 高变更）→ **优先重构**，每次改都痛且还在一直改
 * - 左上（高复杂 × 低变更）→ 稳定遗留，别主动碰，但要补文档
 * - 右下（低复杂 × 高变更）→ 活跃开发区，正常状态
 * - 左下 → 健康
 *
 * X 轴 = churn 分值，Y 轴 = 圈复杂度（向上为高），坐标用分位数归一化，
 * 避免个别极端值把所有点压到角落里。
 */
// ───────────────────────── 目录结构画像 ─────────────────────────

/**
 * 目录结构画像：把项目的目录树画成缩进冰柱图（indented icicle）
 *
 * 回答的问题是「这个项目是怎么组织的、代码堆在哪几个目录里」——
 * 这是需求 §7.3「文件目录」维度唯一对应的画像，此前整个画像体系里没有。
 * 顺带激活 folder 实体：该类型注册过、渲染器也写了，但在此之前
 * 没有任何代码创建过 folder 实体，属于挂着不通电的一条链路。
 *
 * 布局取舍：
 * - x = 深度 × 缩进：一眼看出层级，比 treemap 的嵌套矩形更容易读出路径
 * - 宽度 ∝ 该目录代码行数占比：大目录一眼可见，小目录也不至于缩到看不见
 * - y = 先序行号：父目录紧跟其子树，与左侧文件树的阅读顺序一致
 * - 颜色 = 平均圈复杂度档位：结构图顺带回答「哪一块最难啃」
 *
 * 默认只展开 4 层、最多 160 个节点：再深的层级在画布上退化成一堆细条，
 * 而且画布是 DOM + CSS Transform，实体数量上去直接掉帧（需求 §9 要 60fps）。
 */
/** 在目录树里按路径定位节点（深度优先） */
export function findNode(root: DirNode, dirPath: string): DirNode | null {
  if (root.path === dirPath) return root;
  for (const c of root.children) {
    const r = findNode(c, dirPath);
    if (r) return r;
  }
  return null;
}

/**
 * 目录树引导线：把缩进层级画成直角连线（父竖干 + 子横枝）。
 *
 * 产出**单个** dependency-edge 实体，config.segments 是相对包围盒左上角的
 * 扁平坐标数组 [x1,y1,x2,y2, …]。用扁平数组而不是对象数组：这份 config 要
 * 随场景一起序列化落库，760 个节点下对象数组的 JSON 体积是它的三倍多。
 */
export function buildTreeGuide(
  rows: { x: number; y: number; w: number; h: number; parentPath: string | null; path: string }[],
  rowIndexByPath: Map<string, number>,
  indent: number,
): BulkComponentInput | null {
  if (rows.length < 2) return null;

  // 按父节点归拢子节点，才能画出「一条竖干贯穿所有孩子」而不是每个孩子一条
  const childrenOf = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (r.parentPath === null) return;
    if (!rowIndexByPath.has(r.parentPath)) return; // 父节点被搜索/截断过滤掉了
    const arr = childrenOf.get(r.parentPath);
    if (arr) arr.push(i);
    else childrenOf.set(r.parentPath, [i]);
  });
  if (childrenOf.size === 0) return null;

  const abs: number[] = [];
  for (const [parentPath, kids] of childrenOf) {
    const p = rows[rowIndexByPath.get(parentPath)!];
    // 竖干贴在父节点左内侧、子节点缩进的一半处
    const trunkX = p.x + indent / 2;
    const trunkTop = p.y + p.h;
    let trunkBottom = trunkTop;
    for (const ci of kids) {
      const c = rows[ci];
      const cy = c.y + c.h / 2;
      if (cy > trunkBottom) trunkBottom = cy;
      // 横枝：竖干 → 子节点左边缘
      abs.push(trunkX, cy, c.x, cy);
    }
    // 竖干：父节点底 → 最后一个子节点中线
    if (trunkBottom > trunkTop) abs.push(trunkX, trunkTop, trunkX, trunkBottom);
  }
  if (abs.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < abs.length; i += 2) {
    const x = abs[i];
    const y = abs[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const segments = abs.map((v, i) => (i % 2 === 0 ? v - minX : v - minY));

  return {
    type: 'dependency-edge',
    name: t('portrait.msg.treeGuide'),
    x: minX,
    y: minY,
    // +1 防零宽/零高包围盒（单列树时 maxX===minX）导致 SVG 不可见
    width: Math.max(1, maxX - minX) + 1,
    height: Math.max(1, maxY - minY) + 1,
    config: {
      depType: 'tree-guide',
      segments,
      /** 引导线是装饰，不参与选中/影响链/统计 */
      decorative: true,
    },
  };
}

/* ─── 源码扫描类画像（安全 / 接口 / 错误处理）共用 ─── */

export async function readLines(f: ProjectFile): Promise<string[] | null> {
  try {
    const c: SourceFileContent = await projectScanApi.readSourceFile(f.id);
    if (c.skippedReason || c.lines.length === 0) return null;
    return c.lines;
  } catch {
    return null;
  }
}
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
