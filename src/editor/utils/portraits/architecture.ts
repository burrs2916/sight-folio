/**
 * 架构画像
 *
 * runArchitecturePortrait（模块×分层×依赖边，循环标红）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place, connect } from './canvas';
import { topDirOf } from './shared';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { useProjectStore } from '../../../store/projectStore';


// ───────────────────────── 架构画像 ─────────────────────────

/**
 * 架构画像：模块按分层 y 轴排布 + 模块级依赖连线
 *
 * 这是「项目骨架图」——每行一个架构分层，行内是该层的模块，
 * 模块间连线由文件级 import 边按顶层目录聚合而来，循环依赖标红。
 */
export async function runArchitecturePortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const { layers, modules, dependencies, files, symbolRefs, metrics, techDebt } = pst;
  if (modules.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.archNoModules'),
      severity: 'info',
      placed: 0,
    };
  }

  clearCanvas();

  const sortedLayers = [...layers].sort((a, b) => a.sortOrder - b.sortOrder);
  const unlayered = modules.filter((m) => !layers.some((l) => l.id === m.layerId));
  const groups: { layer: (typeof layers)[number] | null; mods: typeof modules }[] = [];
  for (const l of sortedLayers) {
    groups.push({ layer: l, mods: modules.filter((m) => m.layerId === l.id) });
  }
  if (unlayered.length > 0) groups.push({ layer: null, mods: unlayered });

  const TOP = 80;
  const LEFT = 40;
  const ROW_GAP = 190;
  const COL_GAP = 250;
  const MOD_W = 220;
  const MOD_H = 88;
  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();
  let y = TOP;

  for (const g of groups) {
    if (g.mods.length === 0) {
      if (g.layer) y += ROW_GAP;
      continue;
    }
    if (g.layer) {
      place('layer-marker', { x: LEFT, y: y - 34 }, g.layer.name, {
        layerName: g.layer.name,
        layerColor: g.layer.color,
        layerOrder: g.layer.sortOrder,
      });
    }
    let x = LEFT;
    for (const m of g.mods) {
      // 模块级聚合口径（与 ModuleRenderer / SVG 报告保持一致）：顶层目录名匹配
      const modFiles = files.filter((f) => !f.isDirectory && topDirOf(f.relPath) === m.name);
      const lineCount = modFiles.reduce((acc, f) => acc + (f.lineCount || 0), 0);
      const ccs = metrics
        .filter((mt) => mt.cyclomaticComplexity > 0 && modFiles.some((f) => f.id === mt.fileId))
        .map((mt) => mt.cyclomaticComplexity);
      const avgComplexity = ccs.length > 0 ? ccs.reduce((a, b) => a + b, 0) / ccs.length : 0;
      const maxComplexity = ccs.length > 0 ? Math.max(...ccs) : 0;
      const complexityLevel =
        avgComplexity <= 5 ? 'low' : avgComplexity <= 10 ? 'medium' : avgComplexity <= 20 ? 'high' : 'extreme';
      const techDebtCount = techDebt.filter((t) => modFiles.some((f) => f.id === t.fileId)).length;
      const id = place('module', { x, y }, m.name, {
        name: m.name,
        moduleName: m.name,
        fileCount: m.fileCount,
        depCount: m.depCount,
        beDepCount: m.beDepCount,
        lineCount,
        avgComplexity,
        maxComplexity,
        complexityLevel,
        techDebtCount,
        projectLayerId: m.layerId,
        color: m.color,
        moduleId: m.id,
        portraitMode: 'architecture',
      });
      if (id) placed.set(m.id, { x, y, w: MOD_W, h: MOD_H });
      x += COL_GAP;
    }
    y += ROW_GAP;
  }

  // 文件级依赖 → 模块级聚合边
  const fileToModule = new Map<string, string>();
  for (const f of files) {
    if (!f.isDirectory) fileToModule.set(f.id, topDirOf(f.relPath));
  }
  const moduleNameToId = new Map(modules.map((m) => [m.name, m.id]));
  const seen = new Set<string>();
  let edgeCount = 0;
  let circularCount = 0;
  for (const d of dependencies) {
    const fromMod = fileToModule.get(d.fromId);
    const toMod = fileToModule.get(d.toId);
    if (!fromMod || !toMod || fromMod === toMod) continue;
    const fromId = moduleNameToId.get(fromMod);
    const toId = moduleNameToId.get(toMod);
    if (!fromId || !toId) continue;
    const key = `${fromId}->${toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = placed.get(fromId);
    const b = placed.get(toId);
    if (!a || !b) continue;
    const refsOnEdge = symbolRefs.filter((r) => r.fromFileId === d.fromId && r.toFileId === d.toId);
    const symbolNames = Array.from(new Set(refsOnEdge.map((r) => r.symbolName).filter(Boolean))).slice(0, 5);
    if (
      connect(a, b, `${fromMod} → ${toMod}`, {
        depType: d.kind || 'import',
        isCircular: !!d.isCircular,
        fromMod,
        toMod,
        symbolNames,
      })
    ) {
      edgeCount += 1;
      if (d.isCircular) circularCount += 1;
    }
  }

  await persist(analysisId, 'architecture');
  return {
    ok: true,
    message: t('portrait.msg.archDone', {
      n: modules.length,
      edges: edgeCount,
      cycles: circularCount > 0 ? t('portrait.msg.archCycles', { n: circularCount }) : '',
    }),
    severity: 'success',
    placed: placed.size,
  };
}
