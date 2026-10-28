/**
 * 结构/主序画像
 *
 * runLayeringPortrait + treemap squarify + runCouplingPortrait（主序图）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place, connect } from './canvas';
import { currentInsights, fileConfig } from './shared';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { useProjectStore } from '../../../store/projectStore';
import { buildModuleGraph, computeModuleCoupling, findCycles, ZONE_COLOR, zoneLabelOf } from '.././architectureMetrics';
import { emptyFileInsight } from '.././fileInsights';


// ───────────────────────── 分层画像 ─────────────────────────

/**
 * 分层视图：文件按架构分层归位，并检出「分层违规」
 *
 * 约定 sortOrder 小 = 上层（表现层），大 = 下层（基础设施层）。
 * 正常依赖方向是自上而下（上层用下层）；一旦出现下层反过来依赖上层
 * （fromOrder > toOrder），就是架构腐化信号，连线标红并计入违规数。
 */
export async function runLayeringPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const { layers, files, dependencies } = pst;
  if (layers.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.layerNoData'),
      severity: 'info',
      placed: 0,
    };
  }

  const sorted = [...layers].sort((a, b) => a.sortOrder - b.sortOrder);
  const orderOf = new Map(sorted.map((l, i) => [l.id, i]));
  const realFiles = files.filter((f) => !f.isDirectory);
  const insights = currentInsights();

  clearCanvas();

  const LEFT = 40;
  const COL_W = 190;
  const ROW_H = 74;
  const PER_ROW = 8;
  const NODE_W = 170;
  const NODE_H = 62;
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  let y = 80;
  let placedCount = 0;

  const groups: { layer: (typeof sorted)[number] | null; items: typeof realFiles }[] = sorted.map((l) => ({
    layer: l,
    items: realFiles.filter((f) => f.layerId === l.id),
  }));
  const orphan = realFiles.filter((f) => !f.layerId || !orderOf.has(f.layerId));
  if (orphan.length > 0) groups.push({ layer: null, items: orphan });

  for (const g of groups) {
    if (g.items.length === 0) continue;
    place('layer-marker', { x: LEFT, y: y - 34 }, g.layer ? g.layer.name : t('portrait.msg.unlayered'), {
      layerName: g.layer ? g.layer.name : t('portrait.msg.unlayered'),
      layerColor: g.layer ? g.layer.color : '#64748b',
      layerOrder: g.layer ? g.layer.sortOrder : 999,
      fileCount: g.items.length,
    });
    g.items.forEach((f, i) => {
      const col = i % PER_ROW;
      const row = Math.floor(i / PER_ROW);
      const x = LEFT + col * COL_W;
      const fy = y + row * ROW_H;
      const ins = insights.get(f.id) ?? emptyFileInsight();
      if (
        place('file', { x, y: fy }, f.name, {
          ...fileConfig(f, ins, 'layering'),
          layerName: g.layer?.name ?? t('portrait.msg.unlayered'),
          layerColor: g.layer?.color ?? '#64748b',
        })
      ) {
        pos.set(f.id, { x, y: fy, w: NODE_W, h: NODE_H });
        placedCount += 1;
      }
    });
    y += Math.ceil(g.items.length / PER_ROW) * ROW_H + 70;
  }

  // 只画跨层边，避免同层内部连线糊成一片
  let violations = 0;
  let crossEdges = 0;
  const drawn = new Set<string>();
  for (const d of dependencies) {
    const fromFile = realFiles.find((f) => f.id === d.fromId);
    const toFile = realFiles.find((f) => f.id === d.toId);
    if (!fromFile || !toFile) continue;
    const fo = fromFile.layerId ? orderOf.get(fromFile.layerId) : undefined;
    const to = toFile.layerId ? orderOf.get(toFile.layerId) : undefined;
    if (fo === undefined || to === undefined || fo === to) continue;
    const key = `${d.fromId}->${d.toId}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    const a = pos.get(d.fromId);
    const b = pos.get(d.toId);
    if (!a || !b) continue;
    const isViolation = fo > to; // 下层反向依赖上层
    if (
      connect(a, b, `${fromFile.name} → ${toFile.name}`, {
        depType: d.kind || 'import',
        isCircular: isViolation || !!d.isCircular,
        layerViolation: isViolation,
        symbolNames: [],
      })
    ) {
      crossEdges += 1;
      if (isViolation) violations += 1;
    }
  }

  await persist(analysisId, 'layering');
  return {
    ok: true,
    message: t('portrait.msg.layerDone', {
      n: placedCount,
      layers: groups.length,
      edges: crossEdges,
      viol: violations > 0 ? t('portrait.msg.layerViol', { n: violations }) : t('portrait.msg.layerClean'),
    }),
    severity: violations > 0 ? 'warning' : 'success',
    placed: placedCount,
  };
}

// ───────────────────────── 耦合矩形树图（treemap）画像 ─────────────────────────

/**
 * 耦合矩形树图（squarified treemap）—— 用面积编码模块体量、颜色编码耦合健康度
 *
 * 替代原先的「主序散点图」：散点图需要用户脑补 X/Y 轴含义、模块一多就糊成一片，
 * 体验差。treemap 是更直观的呈现：
 * - 矩形面积 = 模块文件数（体量一目了然，谁是大头立刻可见）
 * - 矩形颜色 = 耦合 zone（painful 红 / useless 紫 / mainSequence 绿 / 其它灰蓝）
 * - 矩形内文字 = 模块名 + 文件数 + Ce/Ca 徽标
 *
 * 布局用 Bruls et al. 的 squarified 算法：每行/列尽量贴近正方形，长宽比接近 1，
 * 视觉最干净、不会拉出细长条。算法纯函数，输入带权重的模块列表，输出 {x,y,w,h}。
 */
interface TreemapInput {
  name: string;
  weight: number;
  /** 渲染用附带字段 */
  zone: string;
  zoneLabel: string;
  fileCount: number;
  ca: number;
  ce: number;
  instability: number;
  abstractness: number;
  inCycle: boolean;
  /** 面积占比（%），渲染器在单元格内显示 */
  sharePct: number;
}
interface TreemapBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** squarified treemap：把带权重的条目铺进 (x,y,w,h) 矩形区域，返回 name→box 映射 */
function squarify(items: TreemapInput[], x: number, y: number, w: number, h: number): Map<string, TreemapBox> {
  const result = new Map<string, TreemapBox>();
  const total = items.reduce((s, it) => s + it.weight, 0);
  if (total <= 0 || items.length === 0) return result;

  // 归一化权重到面积
  const areas = items.map((it) => ({ ...it, area: (it.weight / total) * (w * h) }));
  // 按面积降序：大的先放，squarify 收敛更好
  areas.sort((a, b) => b.area - a.area);

  let rx = x;
  let ry = y;
  let rw = w;
  let rh = h;

  let row: typeof areas = [];

  const worst = (r: typeof areas, side: number): number => {
    if (r.length === 0) return Infinity;
    const s = r.reduce((s, it) => s + it.area, 0);
    const max = Math.max(...r.map((it) => it.area));
    const min = Math.min(...r.map((it) => it.area));
    const s2 = s * s;
    const side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };

  const layoutRow = (r: typeof areas, horizontal: boolean) => {
    const s = r.reduce((acc, it) => acc + it.area, 0);
    if (horizontal) {
      // 横向铺：row 占满 rw 高度的一行，按面积分配宽度
      const rowH = s / rw;
      let cx = rx;
      for (const it of r) {
        const cw = it.area / rowH;
        result.set(it.name, { x: Math.round(cx), y: Math.round(ry), w: Math.round(cw), h: Math.round(rowH) });
        cx += cw;
      }
      ry += rowH;
      rh -= rowH;
    } else {
      // 纵向铺：row 占满 rh 宽度的一列，按面积分配高度
      const colW = s / rh;
      let cy = ry;
      for (const it of r) {
        const ch = it.area / colW;
        result.set(it.name, { x: Math.round(rx), y: Math.round(cy), w: Math.round(colW), h: Math.round(ch) });
        cy += ch;
      }
      rx += colW;
      rw -= colW;
    }
  };

  for (const it of areas) {
    const horizontal = rw >= rh; // 当前剩余区域更宽 → 横向铺一行
    const side = horizontal ? rw : rh;
    const newRow = [...row, it];
    if (row.length === 0 || worst(newRow, side) <= worst(row, side)) {
      row = newRow;
    } else {
      layoutRow(row, horizontal);
      row = [it];
    }
  }
  if (row.length > 0) {
    layoutRow(row, rw >= rh);
  }
  return result;
}

export async function runCouplingPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const realFiles = pst.files.filter((f) => !f.isDirectory);
  const graph = buildModuleGraph(realFiles, pst.dependencies);

  if (graph.nodes.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.msNoModules'),
      severity: 'info',
      placed: 0,
    };
  }
  if (graph.edges.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.msNoDeps'),
      severity: 'info',
      placed: 0,
    };
  }

  const cycles = findCycles(
    graph.nodes.map((n) => n.name),
    graph.edges,
  );
  const coupling = computeModuleCoupling(graph, pst.symbols, cycles);

  clearCanvas();

  // treemap 画布区域（留出顶部标题 + 底部图例的空间）
  const PAD = 40;
  const TITLE_H = 70;
  const PLOT_X = PAD;
  const PLOT_Y = PAD + TITLE_H;
  const PLOT_W = 1120;
  const PLOT_H = 640;

  // 顶部标题
  place(
    'layer-marker',
    { x: PLOT_X, y: PAD - 10 },
    t('portrait.msg.treemapTitle'),
    {
      layerName: t('portrait.msg.treemapTitle'),
      layerColor: '#0f172a',
      layerOrder: 5,
    },
    { w: PLOT_W, h: 44 },
  );

  // 图例（右下角，4 个 zone 色块）
  const legend: Array<[string, string]> = [
    [t('portrait.msg.zonePainful'), ZONE_COLOR.painful],
    [t('portrait.msg.zoneUseless'), ZONE_COLOR.useless],
    [t('health.zone.mainSequence'), ZONE_COLOR.mainSequence],
    [t('portrait.msg.zoneNormal'), '#64748b'],
  ];
  let lx = PLOT_X + PLOT_W - 720;
  const ly = PLOT_Y + PLOT_H + 24;
  for (const [label, color] of legend) {
    place(
      'layer-marker',
      { x: lx, y: ly },
      '',
      {
        layerName: '',
        layerColor: color,
        layerOrder: 4,
      },
      { w: 18, h: 18 },
    );
    place(
      'layer-marker',
      { x: lx + 24, y: ly - 2 },
      label,
      {
        layerName: label,
        layerColor: '#475569',
        layerOrder: 4,
      },
      { w: 140, h: 22 },
    );
    lx += 170;
  }

  // 面积权重：用文件数（体量最直观）；单文件模块保底权重避免 0 面积
  const totalFiles = coupling.reduce((s, c) => s + Math.max(c.fileCount, 1), 0);
  const inputs: TreemapInput[] = coupling.map((c) => ({
    name: c.name,
    weight: Math.max(c.fileCount, 1),
    zone: c.zone,
    zoneLabel: zoneLabelOf(c.zone),
    fileCount: c.fileCount,
    ca: c.ca,
    ce: c.ce,
    instability: c.instability,
    abstractness: c.abstractness,
    inCycle: c.inCycle,
    sharePct: totalFiles === 0 ? 0 : (Math.max(c.fileCount, 1) / totalFiles) * 100,
  }));

  const boxes = squarify(inputs, PLOT_X, PLOT_Y, PLOT_W, PLOT_H);
  const moduleByName = new Map(pst.modules.map((m) => [m.name, m]));
  const shareMap = new Map(inputs.map((it) => [it.name, it.sharePct]));
  let placed = 0;

  for (const c of coupling) {
    const box = boxes.get(c.name);
    if (!box) continue;
    const mod = moduleByName.get(c.name);
    place(
      'treemap-cell',
      { x: box.x, y: box.y },
      c.name,
      {
        name: c.name,
        moduleName: c.name,
        fileCount: c.fileCount,
        depCount: c.ce,
        beDepCount: c.ca,
        moduleId: mod?.id,
        projectLayerId: mod?.layerId,
        ca: c.ca,
        ce: c.ce,
        instability: c.instability,
        abstractness: c.abstractness,
        distance: c.distance,
        zone: c.zone,
        zoneLabel: zoneLabelOf(c.zone),
        symbolCount: c.symbolCount,
        abstractSymbolCount: c.abstractSymbolCount,
        inCycle: c.inCycle,
        // treemap 单元格占比（渲染器显示 N文件 (XX%)）
        sharePct: shareMap.get(c.name) ?? 0,
        // treemap 单元格宽度（渲染器据此决定字体大小 / 是否换行）
        cellW: box.w,
        cellH: box.h,
      },
      { w: box.w, h: box.h },
    );
    placed += 1;
  }

  await persist(analysisId, 'coupling');

  const painful = coupling.filter((c) => c.zone === 'painful');
  const useless = coupling.filter((c) => c.zone === 'useless');
  const parts: string[] = [t('portrait.msg.msDone', { n: placed })];
  if (painful.length > 0) {
    parts.push(
      t('portrait.msg.msPainful', {
        n: painful.length,
        names: painful
          .slice(0, 3)
          .map((c) => c.name)
          .join('、'),
      }),
    );
  }
  if (useless.length > 0) parts.push(t('portrait.msg.msUseless', { n: useless.length }));
  if (cycles.length > 0) parts.push(t('portrait.msg.msCycles', { n: cycles.length, edges: 0 }));
  if (painful.length === 0 && useless.length === 0 && cycles.length === 0) {
    parts.push(t('portrait.msg.msHealthy'));
  }

  return {
    ok: true,
    message: parts.join('；'),
    severity: painful.length > 0 || cycles.length > 0 ? 'warning' : 'success',
    placed,
  };
}
