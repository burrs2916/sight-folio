/**
 * 函数热点画像
 *
 * runFunctionHotspotPortrait + renderHotspotLayout（AST 逐函数风险排序）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place } from './canvas';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { useProjectStore } from '../../../store/projectStore';
import { buildFunctionHotspots, HOTSPOT_COLORS, HOTSPOT_LABELS } from '.././functionHotspots';


/**
 * 函数热点画像（R31）：AST 逐函数度量 → 风险排序的函数级实体
 *
 * 与「复杂度画像」的区别，一句话：复杂度画像告诉你**哪个文件**红了，
 * 这张图告诉你**哪个函数**红了、红在哪（嵌套/CC/行数/形参），双击直接跳到那一行。
 *
 * 业务联动（不是"简单画像"）：
 * - config.fileId → 选中函数卡片时所属文件与其依赖邻居在画布上自动高亮；
 * - config.symbolKind = "function" + lineStart → 双击走 SceneEditor 的符号定位分支，
 *   直接打开源码停在函数定义行；
 * - config.level/reasons → 检查器面板直接说明「为什么它上榜」。
 */
export async function runFunctionHotspotPortrait(analysisId: string, force = false): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  // 自愈：metrics/callEdges/gitChurn 为空（扫描漏跑相关阶段 / 增量未带出）时主动从库重拉
  // 一次再渲染，避免用户永远看到「无数据」且无入口强刷（与设计模式/数据流/调用链同思路）。
  // force=true（菜单「函数热点（重新分析）」）无论是否为空都强制重拉，确保刷新生效。
  if (force || pst.metrics.length === 0 || pst.callEdges.length === 0 || pst.gitChurn.length === 0) {
    try {
      await pst.loadMetrics(analysisId);
      await pst.loadCallEdges(analysisId);
      await pst.loadGitChurn(analysisId);
      const fresh = useProjectStore.getState();
      const layout = buildFunctionHotspots(fresh.metrics, fresh.files, fresh.symbols, fresh.callEdges, fresh.gitChurn);
      return renderHotspotLayout(analysisId, layout);
    } catch (err) {
      console.error('[runFunctionHotspotPortrait] 自愈重拉失败', err);
    }
  }
  // v2.5：heuristic 语言无 AST 明细时，用结构方法符号兜底生成方法级热点
  const layout = buildFunctionHotspots(pst.metrics, pst.files, pst.symbols, pst.callEdges, pst.gitChurn);
  return renderHotspotLayout(analysisId, layout);
}

/** 把已算好的函数热点布局渲染到画布（runFunctionHotspotPortrait 与自愈路径共用） */
function renderHotspotLayout(analysisId: string, layout: ReturnType<typeof buildFunctionHotspots>): PortraitOutcome {
  // AST 明细为空且符号兜底也为空 → 才提示无数据（兜底已产出节点则继续渲染）
  if (layout.summary.astFiles === 0 && layout.nodes.length === 0) {
    return {
      ok: false,
      message:
        layout.summary.totalFunctions > 0
          ? t('portrait.msg.hotNoNode', { files: 0, fns: layout.summary.totalFunctions })
          : t('portrait.msg.hotNoAst'),
      severity: 'info',
      placed: 0,
    };
  }
  if (layout.nodes.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.hotNoNode', { files: layout.summary.astFiles, fns: layout.summary.totalFunctions }),
      severity: 'warning',
      placed: 0,
    };
  }

  clearCanvas();

  // 模块分组头：模块名 + 组内热点数，颜色取组内最高风险等级
  for (const g of layout.groups) {
    const top = layout.nodes.filter((n) => n.moduleName === g.name)[0];
    place('layer-marker', { x: g.x, y: g.y }, g.name, {
      layerName: t('portrait.msg.hotGroup', { name: g.name, a: g.renderedCount, b: g.functionCount }),
      layerColor: top ? HOTSPOT_COLORS[top.level] : '#64748b',
      layerOrder: 0,
      moduleName: g.name,
      portraitMode: 'hotspotFunctions',
    });
  }

  let placedCount = 0;
  for (const n of layout.nodes) {
    // 尺寸随 place 第 5 参落库（原 place 后 setState 设尺寸已失效）
    const id = place(
      'function',
      { x: n.x, y: n.y },
      n.name,
      {
        name: n.name,
        // symbolKind 存在 → 双击走 SceneEditor 的「符号定位」分支（打开源码到 lineStart）
        symbolKind: 'function',
        fileId: n.fileId,
        fileName: n.fileName,
        filePath: n.filePath,
        moduleName: n.moduleName,
        lineStart: n.line,
        lineEnd: n.endLine,
        // FunctionRenderer 读这几个字段渲染卡片
        params: n.params,
        complexity: n.cc,
        maxNesting: n.maxNesting,
        lines: n.lines,
        risk: n.risk,
        level: n.level,
        levelLabel: HOTSPOT_LABELS[n.level],
        reasons: n.reasons,
        callIn: n.callIn,
        churnScore: n.churnScore,
        signature: t('portrait.msg.hotSignature', {
          name: n.name,
          params: n.params,
          lines: n.lines,
          cc: n.cc,
          nesting: n.maxNesting,
        }),
        portraitMode: 'hotspotFunctions',
      },
      { w: n.width, h: n.height },
    );
    if (!id) continue;
    placedCount += 1;
  }

  persist(analysisId, 'hotspotFunctions');

  const { byLevel, worst, truncated, degraded, totalFunctions, astFiles } = layout.summary;
  if (degraded) {
    return {
      ok: true,
      message: t('portrait.msg.hotHealthy', { files: astFiles, fns: totalFunctions, n: placedCount }),
      severity: 'success',
      placed: placedCount,
    };
  }
  const levelTxt = (['extreme', 'high', 'medium', 'low'] as const)
    .filter((l) => byLevel[l] > 0)
    .map((l) => `${t(`canvasTip.hotspot.${l}`)} ${byLevel[l]}`)
    .join('、');
  return {
    ok: true,
    message: t('portrait.msg.hotDone', {
      files: astFiles,
      fns: totalFunctions,
      n: placedCount,
      levels: levelTxt,
      worst: worst
        ? t('portrait.msg.hotWorst', { path: worst.filePath, name: worst.name, reasons: worst.reasons.join('、') })
        : '',
      trunc: truncated > 0 ? t('portrait.msg.hotTrunc', { n: truncated }) : '',
    }),
    severity: 'success',
    placed: placedCount,
  };
}
