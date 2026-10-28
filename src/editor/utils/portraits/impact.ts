/**
 * 影响面画像
 *
 * runImpactPortrait/runImpactPortraitFor（以目标为中心上下游分环）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place, connect } from './canvas';
import { currentInsights, fileConfig } from './shared';
import { type ImpactTarget, type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { useProjectStore } from '../../../store/projectStore';
import { emptyFileInsight } from '.././fileInsights';
import { analyzeImpact, buildCallIndex, impactLevelOf, traverseImpact, impactLevelLabel, type ImpactNode } from '.././impactGraph';


/**
 * 影响面画像：以目标为中心，上游（调用者）向左分环、下游（被调用者）向右分环
 *
 * 其它画像回答「整个项目怎么样」，这张图只回答一个问题：
 * **「我改这里，谁会跟着崩」** —— 因此布局是以自我为中心的，
 * 左边每一列是一跳调用者（越往左越远），右边每一列是一跳依赖。
 *
 * 中心节点用 module 实体（视觉上更大更醒目），周围用 file 实体。
 */
export async function runImpactPortrait(analysisId: string, target: ImpactTarget): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  if (pst.callEdges.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.impactNoData'),
      severity: 'info',
      placed: 0,
    };
  }

  const index = buildCallIndex(pst.callEdges);
  const maxDepth = target.maxDepth ?? 3;

  // 归一到「一批根符号」：符号级就是它自己，文件级是文件内所有参与调用图的符号
  let rootIds: string[] = [];
  let centerLabel = '';
  let centerSub = '';
  if (target.rootSymbolId) {
    rootIds = [target.rootSymbolId];
    const rep = analyzeImpact(pst.callEdges, target.rootSymbolId, {
      maxDepth,
      symbols: pst.symbols,
      index,
    });
    centerLabel = rep.rootName;
    centerSub = rep.rootFilePath;
  } else if (target.rootFileId) {
    index.meta.forEach((m, id) => {
      if (m.fileId === target.rootFileId) rootIds.push(id);
    });
    const f = pst.files.find((x) => x.id === target.rootFileId);
    centerLabel = f?.name || t('portrait.msg.targetFile');
    centerSub = f?.relPath || '';
  }

  if (rootIds.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.impactIsolated'),
      severity: 'info',
      placed: 0,
    };
  }

  // 合并多根的传播结果，同一符号取最小跳数
  const collect = (dir: 'upstream' | 'downstream') => {
    const best = new Map<string, ImpactNode>();
    for (const rid of rootIds) {
      for (const n of traverseImpact(index, rid, dir, maxDepth).nodes) {
        if (rootIds.includes(n.symbolId)) continue;
        const cur = best.get(n.symbolId);
        if (!cur || n.depth < cur.depth) best.set(n.symbolId, n);
      }
    }
    return [...best.values()];
  };

  const upstream = collect('upstream');
  const downstream = collect('downstream');

  if (upstream.length === 0 && downstream.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.impactOrphan', { name: centerLabel }),
      severity: 'info',
      placed: 0,
    };
  }

  clearCanvas();

  const NODE_W = 176;
  const NODE_H = 62;
  const CX = 640;
  const CY = 420;
  const COL_GAP = 250;
  const ROW_GAP = 78;
  const MAX_PER_COL = 9; // 每跳最多铺 9 个，超出折叠为一个「其余 N 个」节点

  const fileById = new Map(pst.files.map((f) => [f.id, f]));
  const insights = currentInsights();
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();

  // 中心节点
  const centerX = CX - 110;
  const centerY = CY - 44;
  // 中心节点尺寸随 place 第 5 参落库（与连线用的 centerBox 220×88 对齐）
  place(
    'module',
    { x: centerX, y: centerY },
    centerLabel,
    {
      name: centerLabel,
      moduleName: centerLabel,
      filePath: centerSub,
      fileCount: rootIds.length,
      depCount: downstream.length,
      beDepCount: upstream.length,
      color: '#8b5cf6',
      portraitMode: 'impact',
      isImpactRoot: true,
    },
    { w: 220, h: 88 },
  );
  const centerBox = { x: centerX, y: centerY, w: 220, h: 88 };

  /** 把某一方向的节点按跳数铺成列 */
  const layoutSide = (nodes: ImpactNode[], side: -1 | 1) => {
    let count = 0;
    for (let d = 1; d <= maxDepth; d++) {
      const layer = nodes
        .filter((n) => n.depth === d)
        .sort((a, b) => Number(b.crossFile) - Number(a.crossFile) || a.name.localeCompare(b.name));
      if (layer.length === 0) continue;
      const shown = layer.slice(0, MAX_PER_COL);
      const x = CX + side * (COL_GAP * d) - NODE_W / 2 + (side < 0 ? -60 : 60);
      const totalH = shown.length * ROW_GAP;
      shown.forEach((n, i) => {
        const y = CY - totalH / 2 + i * ROW_GAP;
        const f = fileById.get(n.fileId);
        const ins = f ? (insights.get(f.id) ?? emptyFileInsight()) : emptyFileInsight();
        const id = place(
          'file',
          { x, y },
          n.name,
          f
            ? {
                ...fileConfig(f, ins, 'impact'),
                // 覆盖显示名：影响面关心的是「哪个函数」而不是「哪个文件」
                symbolName: n.name,
                impactDepth: d,
                impactSide: side < 0 ? 'upstream' : 'downstream',
                crossFile: n.crossFile,
                viaName: n.viaName,
                callLine: n.callLine,
              }
            : {
                fileName: n.name,
                filePath: n.filePath,
                symbolName: n.name,
                impactDepth: d,
                impactSide: side < 0 ? 'upstream' : 'downstream',
                portraitMode: 'impact',
              },
        );
        if (id) {
          positions.set(n.symbolId, { x, y, w: NODE_W, h: NODE_H });
          count += 1;
        }
      });
      if (layer.length > shown.length) {
        const y = CY - totalH / 2 + shown.length * ROW_GAP;
        place('annotation-text', { x, y }, t('portrait.msg.impactMore', { n: layer.length - shown.length, d }), {
          text: t('portrait.msg.impactMore', { n: layer.length - shown.length, d }),
          color: '#94a3b8',
        });
      }
    }
    return count;
  };

  const upCount = layoutSide(upstream, -1);
  const downCount = layoutSide(downstream, 1);

  // 连线：第 1 跳直接连中心，第 n 跳连它的 via 节点，还原真实调用链路径
  let edges = 0;
  const drawEdge = (n: ImpactNode, side: -1 | 1) => {
    const box = positions.get(n.symbolId);
    if (!box) return;
    const viaBox = n.depth === 1 ? centerBox : positions.get(n.viaSymbolId);
    if (!viaBox) return;
    // 上游是「别人调用我」，箭头方向应是 调用者 → 中心
    const a = side < 0 ? box : viaBox;
    const b = side < 0 ? viaBox : box;
    if (
      connect(a, b, `${n.viaName || centerLabel} ← ${n.name}`, {
        depType: 'call',
        isCircular: false,
        symbolNames: [n.name],
        impactDepth: n.depth,
        impactSide: side < 0 ? 'upstream' : 'downstream',
      })
    ) {
      edges += 1;
    }
  };
  for (const n of upstream) drawEdge(n, -1);
  for (const n of downstream) drawEdge(n, 1);

  await persist(analysisId, 'impact');

  const affectedFiles = new Set(upstream.map((n) => n.fileId).filter(Boolean));
  affectedFiles.delete(target.rootFileId || '');
  const level = impactLevelOf(upstream.length, affectedFiles.size);
  return {
    ok: true,
    message: t('portrait.msg.impactDone', {
      name: centerLabel,
      up: upCount,
      files: affectedFiles.size,
      level: impactLevelLabel(level),
      down: downCount,
      edges,
    }),
    severity: level === 'critical' || level === 'wide' ? 'warning' : 'success',
    placed: upCount + downCount + 1,
  };
}

/** 影响面画像（外部入口：面板与右键菜单调用） */
export async function runImpactPortraitFor(analysisId: string, target: ImpactTarget): Promise<PortraitOutcome> {
  if (!analysisId) {
    return { ok: false, message: t('portrait.msg.noAnalysis'), severity: 'warning', placed: 0 };
  }
  return runImpactPortrait(analysisId, target);
}
