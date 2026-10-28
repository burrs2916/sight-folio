/**
 * 依赖画像
 *
 * runDependencyPortrait（文件级力导向聚簇 + Tarjan 环检测）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place, connect } from './canvas';
import { MODULE_PALETTE } from './constants';
import { currentInsights, fileConfig, topDirOf } from './shared';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { useEditorStore } from '../../../store/editorStore';
import { useProjectStore } from '../../../store/projectStore';
import { findCycles } from '.././architectureMetrics';
import { emptyFileInsight } from '.././fileInsights';
import { forceDirectedLayout, layeredLayout } from '.././forceLayout';


// ───────────────────────── 依赖关系画像 ─────────────────────────

/**
 * 文件级依赖图：力导向布局 + Tarjan 环检测
 *
 * 与架构画像（模块粒度）互补，这里是文件粒度。
 *
 * 布局原本是「按依赖深度分列」，节点一多就退化成几根竖直的长条，
 * 30 个文件挤在一列、连线横穿整张画布，看不出任何聚类。改用力导向后
 * 互相 import 的文件被弹簧拉到一起，**模块簇会自己浮现出来**，
 * 而稀疏区域自动留白。拓扑深度依然保留，只是不再决定坐标，
 * 改为写进实体 config 供属性面板展示。
 *
 * 循环依赖也从「后端两两比对的 isCircular 布尔位」升级为 Tarjan 强连通分量，
 * 能挖出 a→b→c→a 这类三元以上的长环 —— 那才是真正难拆的那种。
 * 上限 90 个节点。
 */
export async function runDependencyPortrait(analysisId: string, focusFileId?: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const fileById = new Map(pst.files.filter((f) => !f.isDirectory).map((f) => [f.id, f]));
  const edges = pst.dependencies.filter((d) => fileById.has(d.fromId) && fileById.has(d.toId) && d.fromId !== d.toId);
  if (edges.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.depNoData'),
      severity: 'info',
      placed: 0,
    };
  }

  // v2.17 模块簇着色：按顶层目录取模块色（画布上同模块同色 → 模块边界一眼可见）
  const moduleOf = new Map<string, string>();
  for (const id of fileById.keys()) {
    const f = fileById.get(id);
    if (f) moduleOf.set(id, topDirOf(f.relPath));
  }
  const moduleColorOf = (id: string): string => {
    const m = moduleOf.get(id) ?? '';
    let h = 0;
    for (let i = 0; i < m.length; i++) h = (h * 31 + m.charCodeAt(i)) >>> 0;
    return MODULE_PALETTE[h % MODULE_PALETTE.length];
  };

  // 参与依赖的文件，按度数取前 90
  const degree = new Map<string, number>();
  const outAdj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const d of edges) {
    degree.set(d.fromId, (degree.get(d.fromId) || 0) + 1);
    degree.set(d.toId, (degree.get(d.toId) || 0) + 1);
  }

  // v2.17 依赖焦点（方案 A 修正 · 修回归）：点左侧项目树里一个【不在 top-90 采样上】
  // 的文件时，绝不能把整张全局依赖图重绘成「只有该文件+邻居」的子图 —— 那会让用户
  // 看到「其它节点全消失」（即本次回归）。正确做法：保留 top-90 全局图，把焦点文件
  // 及其 1 跳邻居「并入」并高亮（焦点文件描环），其余节点原样留在画布上。
  // keep = top-90 ∪ {焦点 + 它的全部 1 跳邻居}；
  // kept = keep 内任意两节点之间的「全部」依赖边（含 top-90 之间的全局边 + 焦点邻域边）。
  // 这样全局依赖关系永远不丢，焦点邻域也可见、可被点击/双击。
  const top90 = Array.from(degree.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 90)
    .map(([id]) => id);
  const top90Set = new Set(top90);
  const focusFile = focusFileId ? fileById.get(focusFileId) : undefined;
  let keep: Set<string>;
  if (focusFile && focusFileId) {
    // 保留全局图 + 并入焦点邻域（并集，非替换）—— 全局依赖关系永不消失
    keep = new Set(top90);
    keep.add(focusFileId);
    for (const d of edges) {
      if (d.fromId === focusFileId) keep.add(d.toId);
      if (d.toId === focusFileId) keep.add(d.fromId);
    }
  } else {
    keep = new Set(top90);
  }
  // 诱导子图：保留 keep 内任意两节点之间的所有边（不只与焦点相连的边）
  const kept = edges.filter((d) => keep.has(d.fromId) && keep.has(d.toId));
  for (const id of keep) {
    outAdj.set(id, []);
    inDeg.set(id, 0);
  }
  for (const d of kept) {
    outAdj.get(d.fromId)!.push(d.toId);
    outDeg.set(d.fromId, (outDeg.get(d.fromId) || 0) + 1);
    inDeg.set(d.toId, (inDeg.get(d.toId) || 0) + 1);
  }

  // ── Tarjan 找出真实的循环依赖环（含 3 元以上长环，不只是两两互引）──
  const fileCycles = findCycles(
    Array.from(keep),
    kept.map((d) => ({ from: d.fromId, to: d.toId })),
  );
  const cycleOf = new Map<string, number>();
  fileCycles.forEach((c, ci) => c.nodes.forEach((n) => cycleOf.set(n, ci)));

  // 拓扑深度仍然要算：它是「谁是入口、谁是底座」的语义信息。
  // 力导向只负责摆位置，深度写进 config 供属性面板与 Tooltip 使用。
  const depth = new Map<string, number>();
  let frontier = Array.from(keep).filter((id) => (inDeg.get(id) || 0) === 0);
  const remainingIn = new Map(inDeg);
  let level = 0;
  const visited = new Set<string>();
  while (frontier.length > 0 && level < 40) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      depth.set(id, level);
      for (const to of outAdj.get(id) || []) {
        remainingIn.set(to, (remainingIn.get(to) || 0) - 1);
        if ((remainingIn.get(to) || 0) <= 0 && !visited.has(to)) next.push(to);
      }
    }
    frontier = next;
    level += 1;
  }
  for (const id of keep) if (!depth.has(id)) depth.set(id, level);

  clearCanvas();

  const insights = currentInsights();
  const NODE_W = 180;
  const NODE_H = 66;

  // ── 力导向布局：互相 import 的文件被弹簧拉到一起，模块簇自己浮现 ──
  // 画布尺寸随节点数开方增长：节点少时紧凑、节点多时留白，不会糊成一坨。
  // ── 布局双模式（v2.17）：力导向聚簇（默认）/ 拓扑分层（工具条切换）──
  // 聚簇：互相 import 的文件被弹簧拉到一起，模块簇自己浮现，画布尺寸随节点
  // 数开方增长（节点少紧凑、节点多留白，不会糊成一坨）。
  // 分层：按拓扑深度分列 —— 入口在左、底座在右，依赖方向从左向右流过画布，
  // 直接回答「架构分层是否干净」。环内节点同层聚在最后一列（红虚线回流）。
  const layoutMode = useEditorStore.getState().depLayoutMode;
  const nodeList = Array.from(keep).map((id) => ({ id, weight: degree.get(id) ?? 1 }));
  const edgeList = kept.map((d) => ({ from: d.fromId, to: d.toId }));
  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  let positions: Map<string, { x: number; y: number }>;
  if (layoutMode === 'layered') {
    positions = layeredLayout(nodeList, depth, {
      width: Math.max(1200, (maxDepth + 1) * (NODE_W + 144)),
      height: Math.max(760, Math.round(Math.sqrt(keep.size) * 215)),
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
      originX: 60,
      originY: 40,
    });
  } else {
    positions = forceDirectedLayout(nodeList, edgeList, {
      width: Math.max(1200, Math.round(Math.sqrt(keep.size) * 320)),
      height: Math.max(760, Math.round(Math.sqrt(keep.size) * 215)),
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
      originX: 60,
      originY: 60,
    }).positions;
  }

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const ordered = Array.from(keep).sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0));
  for (const id of ordered) {
    const f = fileById.get(id);
    const p = positions.get(id);
    if (!f || !p) continue;
    const ins = insights.get(id) ?? emptyFileInsight();
    const ci = cycleOf.get(id);
    const out = outDeg.get(id) ?? 0;
    const inn = inDeg.get(id) ?? 0;
    const mod = moduleOf.get(id) ?? '';
    // v2.17 节点徽标：→出 ←入 度数（环内节点前缀 ⭕）；模块色作 accentColor（卡片底色/色条跟随）
    const inCycleFlag = ci !== undefined;
    const metricBadge = `${inCycleFlag ? '\u2b55' : ''}\u2192${out} \u2190${inn}`;
    const metricTitle = [
      t('portrait.msg.depNodeModule', { module: mod || '-' }),
      t('portrait.msg.depNodeDepth', { n: depth.get(id) ?? 0 }),
      inCycleFlag ? t('portrait.msg.depNodeCycle', { n: fileCycles[ci].size }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (
      place('file', { x: p.x, y: p.y }, f.name, {
        ...fileConfig(f, ins, 'dependency'),
        depDepth: depth.get(id) ?? 0,
        depDegree: degree.get(id) ?? 0,
        inCycle: inCycleFlag,
        cycleSize: ci !== undefined ? fileCycles[ci].size : 0,
        // v2.17 模块簇着色 + 节点徽标
        moduleName: mod,
        accentColor: moduleColorOf(id),
        metricBadge,
        metricTitle,
        depInCycle: inCycleFlag,
        // v2.17 焦点子图：以该文件为焦点的节点描一圈高亮环（FileRenderer 读取）
        isFocus: id === focusFileId,
      })
    ) {
      pos.set(id, { x: p.x, y: p.y, w: NODE_W, h: NODE_H });
    }
  }

  let edgeCount = 0;
  let circular = 0;
  const drawn = new Set<string>();
  for (const d of kept) {
    const key = `${d.fromId}->${d.toId}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    const a = pos.get(d.fromId);
    const b = pos.get(d.toId);
    if (!a || !b) continue;
    const symbolNames = Array.from(
      new Set(
        pst.symbolRefs
          .filter((r) => r.fromFileId === d.fromId && r.toFileId === d.toId)
          .map((r) => r.symbolName)
          .filter(Boolean),
      ),
    ).slice(0, 4);
    // 环内边：两端落在同一个强连通分量里 —— 比后端的两两 isCircular 更准
    const sameCycle = cycleOf.has(d.fromId) && cycleOf.get(d.fromId) === cycleOf.get(d.toId);
    // v2.17 跨模块边：两端顶层目录不同 → 深色加粗（架构边界被绕过，需要人看）
    const crossModule = (moduleOf.get(d.fromId) ?? '') !== (moduleOf.get(d.toId) ?? '');
    if (
      connect(a, b, `${fileById.get(d.fromId)?.name} → ${fileById.get(d.toId)?.name}`, {
        depType: d.kind || 'import',
        isCircular: sameCycle || !!d.isCircular,
        inCycle: sameCycle,
        symbolNames,
        crossModule,
        // v2.17 依赖画像点击高亮：把端点文件 id 写进边，画布选中节点时
        // 关联边才能被「点亮」（此前缺这两个字段，所有依赖边在选中时被误淡化）。
        fromFileId: d.fromId,
        toFileId: d.toId,
      })
    ) {
      edgeCount += 1;
      if (sameCycle || d.isCircular) circular += 1;
    }
  }

  await persist(analysisId, 'dependency');
  const biggest = fileCycles[0];
  const truncated = degree.size - keep.size;
  // v2.17 焦点高亮（修回归）：焦点文件已并入全局图并描环，提示语点明
  // 「它在全局图中的哪个位置、并入了多少个原本没画出来的 1 跳邻居」，
  // 让用户清楚全局图没丢、只是多高亮了一处。
  const addedToGlobal = focusFile ? Array.from(keep).filter((id) => !top90Set.has(id)).length : 0;
  if (focusFile) {
    return {
      ok: true,
      message: t('portrait.msg.depFocus', {
        name: focusFile.name,
        added: addedToGlobal,
        files: pos.size,
        edges: edgeCount,
      }),
      severity: 'info',
      placed: pos.size,
    };
  }
  return {
    ok: true,
    message: t('portrait.msg.depDone', {
      n: pos.size,
      edges: edgeCount,
      cycles:
        fileCycles.length > 0
          ? t('portrait.msg.depCycles', { n: fileCycles.length, size: biggest.size, edges: circular })
          : t('portrait.msg.depClean'),
      trunc: truncated > 0 ? t('portrait.msg.depTrunc', { keep: keep.size, n: truncated }) : '',
    }),
    severity: fileCycles.length > 0 ? 'warning' : 'success',
    placed: pos.size,
  };
}
