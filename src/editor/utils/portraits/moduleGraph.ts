/**
 * 模块依赖图画像
 *
 * MOD_GRAPH_* 常量 + runModuleGraphPortrait（环形依赖图）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place } from './canvas';
import { topDirOf } from './shared';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { useProjectStore } from '../../../store/projectStore';
import { buildModuleDeps, detectModuleCycles, summarizeModuleDeps } from '.././symbolLayout';


// ───────────────────────── 设计模式画像 ─────────────────────────

/**
 * 设计模式画像：后端识别出的每条模式命中在画布上落一个 pattern-node
 *
 * 需求「扫描项目要分析…代码的设计模式」的画布落点。布局按 GoF 分类分区：
 * 创建型 / 结构型 / 行为型 / 架构角色四列，每列顶部一个分区头（layer-marker），
 * 列内是该分类的模式命中节点，置信度环 + 证据 tooltip 由 PatternNodeRenderer 呈现。
 *
 * 命中数上限 120：模式识别是启发式推断，命中可能很多，超过上限只保留
 * 置信度最高的前 120 条，避免画布糊成一团（tooltip 文案说明截断）。
 */
/// 模块依赖图（v2.3）：顶层目录为节点、模块间调用聚合为边的环形依赖图。
/// 回答「模块之间到底谁依赖谁、方向对不对、哪里成环」——符号画像横带上的
/// →N ←M 徽标升级为独立视图。节点大小按依赖总量，环上模块红描边。
const MOD_GRAPH_NODE_W = 200;
const MOD_GRAPH_NODE_H = 88;
const MOD_GRAPH_MAX = 24;

export async function runModuleGraphPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  if (pst.callEdges.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.impactNoData'),
      severity: 'info',
      placed: 0,
    };
  }
  const deps = buildModuleDeps(pst.callEdges, pst.files);
  const counts = summarizeModuleDeps(deps);
  // 参与调用的模块（有出/入依赖），按依赖总量降序取前 N
  const dirs = Array.from(counts.entries())
    .map(([dir, c]) => ({ dir, total: c.out + c.in, out: c.out, in: c.in }))
    .sort((a, b) => b.total - a.total)
    .slice(0, MOD_GRAPH_MAX);
  if (dirs.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.modNoData'),
      severity: 'info',
      placed: 0,
    };
  }

  // 环形布局：节点均布圆周，半径按节点数自适应（防重叠）
  const N = dirs.length;
  const R = Math.max(380, (N * (MOD_GRAPH_NODE_W + 90)) / (2 * Math.PI));
  const CX = 520;
  const CY = 400;
  const nodes = dirs.map((m, i) => {
    const angle = (2 * Math.PI * i) / N - Math.PI / 2;
    return {
      ...m,
      x: CX + R * Math.cos(angle) - MOD_GRAPH_NODE_W / 2,
      y: CY + R * Math.sin(angle) - MOD_GRAPH_NODE_H / 2,
    };
  });
  const dirSet = new Set(nodes.map((n) => n.dir));
  const edges = deps.filter((e) => dirSet.has(e.fromDir) && dirSet.has(e.toDir));
  const maxCount = Math.max(1, ...edges.map((e) => e.count));
  const cycleDirs = detectModuleCycles(edges);
  const fileCountOf = (dir: string) => pst.files.filter((f) => !f.isDirectory && topDirOf(f.relPath) === dir).length;
  // v2.4 节点大小按依赖总量缩放（160~260 宽）：承重模块视觉上更显眼
  const maxTotal = Math.max(1, ...nodes.map((n) => n.total));
  const nodeWOf = (n: { total: number }) => Math.round(160 + 100 * (n.total / maxTotal));

  clearCanvas();

  let placedCount = 0;
  for (const n of nodes) {
    const id = place(
      'module',
      { x: n.x, y: n.y },
      n.dir,
      {
        name: n.dir,
        moduleName: n.dir,
        fileCount: fileCountOf(n.dir),
        depCount: n.total,
        ca: n.in,
        ce: n.out,
        inCycle: cycleDirs.has(n.dir),
        portraitMode: 'moduleGraph',
      },
      { w: nodeWOf(n), h: MOD_GRAPH_NODE_H },
    );
    if (id) placedCount += 1;
  }

  // v2.5 双向边合并：A→B 与 B→A 成对时向垂直方向各偏移 14px ——
  // 两条边平行不重合，且各自箭头方向（谁依赖谁）仍可读。
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const byPair = new Map<string, typeof edges>();
  for (const e of edges) {
    const k = pairKey(e.fromDir, e.toDir);
    const arr = byPair.get(k);
    if (arr) arr.push(e);
    else byPair.set(k, [e]);
  }

  let edgeCount = 0;
  const placeEdge = (e: (typeof edges)[number], side: -1 | 0 | 1) => {
    const a = nodes.find((n) => n.dir === e.fromDir);
    const b = nodes.find((n) => n.dir === e.toDir);
    if (!a || !b) return;
    const aW = nodeWOf(a);
    const bW = nodeWOf(b);
    let absFromX = a.x + aW / 2;
    let absFromY = a.y + MOD_GRAPH_NODE_H / 2;
    let absToX = b.x + bW / 2;
    let absToY = b.y + MOD_GRAPH_NODE_H / 2;
    if (side !== 0) {
      // 垂直于 A→B 方向的单位向量 × 偏移量 × 方向
      const dx = absToX - absFromX;
      const dy = absToY - absFromY;
      const len = Math.hypot(dx, dy) || 1;
      const off = 14;
      absFromX += (-dy / len) * off * side;
      absFromY += (dx / len) * off * side;
      absToX += (-dy / len) * off * side;
      absToY += (dx / len) * off * side;
    }
    const minX = Math.min(absFromX, absToX);
    const minY = Math.min(absFromY, absToY);
    const id = place(
      'dependency-edge',
      { x: minX, y: minY },
      `${e.fromDir} → ${e.toDir}`,
      {
        depType: 'import',
        fromX: absFromX - minX,
        fromY: absFromY - minY,
        toX: absToX - minX,
        toY: absToY - minY,
        // 模块级联动：选中模块实体时这条依赖边点亮（复用 fromMod/toMod 字段）
        fromMod: e.fromDir,
        toMod: e.toDir,
        edgeCount: e.count,
        weight: e.count,
        // v2.4 权重分级：低权重边淡且细，高权重边粗且实（一眼看出主依赖链）
        weightRatio: e.count / maxCount,
        symbolNames: [],
        isCircular: cycleDirs.has(e.fromDir) && cycleDirs.has(e.toDir),
        portraitMode: 'moduleGraph',
      },
      { w: Math.max(4, Math.abs(absToX - absFromX) + 16), h: Math.max(4, Math.abs(absToY - absFromY) + 16) },
    );
    if (id) edgeCount += 1;
  };

  for (const arr of byPair.values()) {
    if (arr.length >= 2) {
      placeEdge(arr[0], 1);
      placeEdge(arr[1], -1);
    } else {
      placeEdge(arr[0], 0);
    }
  }

  await persist(analysisId, 'moduleGraph');

  const cycN = cycleDirs.size;
  return {
    ok: true,
    message: t('portrait.msg.modDone', {
      n: placedCount,
      edges: edgeCount,
      cyc: cycN > 0 ? t('portrait.msg.modCycles', { n: cycN }) : '',
      maxW: maxCount,
    }),
    severity: 'success',
    placed: placedCount + edgeCount,
  };
}
