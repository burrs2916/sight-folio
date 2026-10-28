/**
 * 数据流画像
 *
 * runDataFlowPortrait（函数摘要按污点角色分三区）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place } from './canvas';
import { type PortraitOutcome } from './types';
import { t, resolveFragments } from '../../../i18n';
import { useProjectStore } from '../../../store/projectStore';
import { buildFlowPortrait, summarizeFlowPortrait, FLOW_ROLE_HINT, FLOW_ROLE_LABEL, FLOW_ROLE_LEVEL, FLOW_ROLE_ORDER } from '.././dataFlowPortrait';


// ───────────────────────── 数据流画像 ─────────────────────────

/**
 * 数据流画像（R36）：函数摘要按「污点传播角色」分三区铺开
 *
 * 与函数热点画像的区别，一句话：热点图告诉你**哪个函数难改**，
 * 这张图告诉你**改了之后数据会流到哪去** —— 前者是静态质量，后者是动态波及。
 *
 * 业务联动（不是"简单画像"）：
 * - config.fileId → 选中卡片时所属文件与依赖邻居在画布上高亮；
 * - config.symbolKind = "function" + lineStart → 双击直达函数定义行；
 * - config.flowRole / reasons → 检查器面板说明「它在数据流上扮演什么角色」；
 * - 阻断区（绿）就是 R36 影响链剪枝掉的那批节点 —— 把「为什么剪」摊开给用户看。
 */
export async function runDataFlowPortrait(analysisId: string, force = false): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  let facts = pst.dataFlow;

  // 自愈：store 为空（扫描漏跑 dataFlow 阶段 / 增量未带出）时，主动重拉一次再渲染，
  // 避免用户永远看到「无数据」且无入口强刷（与设计模式 patterns_redetect 同思路）。
  // force=true（菜单「数据流（重新分析）」）无论是否为空都强制重拉，确保刷新生效。
  if (force || facts.length === 0) {
    try {
      await pst.analyzeDataFlow(analysisId, undefined);
      await pst.loadDataFlow(analysisId);
      facts = useProjectStore.getState().dataFlow;
    } catch (err) {
      console.error('[runDataFlowPortrait] 自愈重拉 dataFlow 失败', err);
    }
  }

  if (facts.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.flowNoData'),
      severity: 'info',
      placed: 0,
    };
  }

  const layout = buildFlowPortrait(facts);
  if (layout.nodes.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.flowNoNode', { n: facts.length }),
      severity: 'warning',
      placed: 0,
    };
  }

  clearCanvas();

  // 分区头：角色名 + 数量 + 该角色的工程含义
  for (const z of layout.zones) {
    if (z.count === 0) continue;
    place('layer-marker', { x: z.x, y: z.y }, resolveFragments(FLOW_ROLE_LABEL[z.role]), {
      layerName: `${FLOW_ROLE_LABEL[z.role]} · ${z.renderedCount}/${z.count}`,
      layerColor: z.color,
      layerOrder: FLOW_ROLE_ORDER.indexOf(z.role),
      fileCount: z.count,
      description: FLOW_ROLE_HINT[z.role],
      portraitMode: 'dataFlow',
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
        symbolKind: 'function',
        fileId: n.fileId,
        filePath: n.filePath,
        lineStart: n.line,
        params: n.paramCount,
        // 复用 FunctionRenderer 的等级配色：汇点红 / 透传橙 / 阻断绿
        level: FLOW_ROLE_LEVEL[n.role],
        levelLabel: FLOW_ROLE_LABEL[n.role],
        flowRole: n.role,
        flowSinks: n.sinks,
        flowToReturn: n.toReturn,
        flowCallCount: n.callFlowCount,
        reasons: n.reasons,
        signature: n.signature,
        portraitMode: 'dataFlow',
      },
      { w: n.width, h: n.height },
    );
    if (!id) continue;
    placedCount += 1;
  }

  await persist(analysisId, 'dataFlow');

  const s = layout.summary;
  const ratio = Math.round(s.blockRatio * 100);
  return {
    ok: true,
    message: t('portrait.msg.flowDone', {
      summary: summarizeFlowPortrait(layout),
      ratio,
      note: ratio >= 30 ? t('portrait.msg.flowPrune') : '',
    }),
    severity: s.sinks > 0 ? 'success' : 'info',
    placed: placedCount,
  };
}
