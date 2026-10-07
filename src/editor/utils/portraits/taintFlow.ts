/**
 * 污点分析画像
 *
 * runTaintFlowPortrait（污点传播路径三区）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place, connectVertical } from './canvas';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { useProjectStore } from '../../../store/projectStore';
import { buildTaintPaths, filterTaintPaths, layoutTaintPaths, SINK_KIND_COLOR, SINK_KIND_LABEL, TAINT_ROLE_COLOR, TAINT_ROLE_LABEL, type TaintLayoutNode, type TaintView } from '.././taintFlow';


// ───────────────────────── 污点传播路径画像（对标 joern reachableByFlows） ─────────────────────────
/**
 * 污点传播路径画像（taintFlow）：回答安全与审计最核心的问题 ——
 * **不可信数据从哪个函数进来 → 经过哪些函数 → 在第几个参数位置传递 → 落到哪个危险调用**。
 *
 * 此前所有画像都在回答「代码长什么样」与「代码怎么调」，没有一张回答「数据怎么流、
 * 流到哪会出事」。joern 的旗舰能力 `reachableByFlows` 做的正是这件事，但我们没有
 * 语句级 DDG，只有 `project_data_flow` 的函数级摘要 + `project_call_edges` 的调用边，
 * 因此本画像是**诚实的能力降级版**（函数级 / 参数位置感知 / 上下文不敏感），
 * 完整取舍与局限说明见 `taintFlow.ts` 头部。
 *
 * 可行动性（画像价值铁律）：每个节点都带 fileId + filePath + lineStart，
 * 双击经 SceneEditor 兜底分支直达源码；sink 节点锚定在**危险调用所在行**
 * （不是函数定义行），点开即是出事的那一行。
 *
 * 三视图（view）：all=全部链路 / critical=仅高危(score≥4) / sanitized=已被净化函数拦下。
 */
export async function runTaintFlowPortrait(analysisId: string, view: TaintView = 'all'): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  let facts = pst.dataFlow;

  // 自愈：dataFlow 为空（扫描漏跑 / 增量未带出）时主动重拉，避免永远「无数据」且无入口强刷
  if (facts.length === 0) {
    try {
      await pst.analyzeDataFlow(analysisId, undefined);
      await pst.loadDataFlow(analysisId);
      facts = useProjectStore.getState().dataFlow;
    } catch (err) {
      console.error('[runTaintFlowPortrait] 自愈重拉 dataFlow 失败', err);
    }
  }
  if (facts.length === 0) {
    return { ok: false, message: t('portrait.msg.taintNoData'), severity: 'info', placed: 0 };
  }

  let edges = pst.callEdges;
  if (edges.length === 0) {
    try {
      await pst.loadCallEdges(analysisId);
      edges = useProjectStore.getState().callEdges;
    } catch (err) {
      console.error('[runTaintFlowPortrait] 加载调用边失败', err);
    }
  }
  if (edges.length === 0) {
    return { ok: false, message: t('portrait.msg.taintNoEdges'), severity: 'info', placed: 0 };
  }

  const built = buildTaintPaths(facts, edges);
  const filtered = filterTaintPaths(built, view);
  if (filtered.paths.length === 0) {
    const msg =
      view === 'critical'
        ? t('portrait.msg.taintNoCritical')
        : view === 'sanitized'
          ? t('portrait.msg.taintNoSanitized')
          : t('portrait.msg.taintNoPath', { n: facts.length });
    return { ok: false, message: msg, severity: 'info', placed: 0 };
  }

  const layout = layoutTaintPaths(filtered, {
    left: 60,
    top: 80,
    nodeW: 250,
    nodeH: 46,
    rowGap: 18,
    colGap: 70,
    maxPaths: 40,
  });

  clearCanvas();

  place('layer-marker', { x: 60, y: 24 }, t('portrait.msg.taintLegend'), {
    layerName: t('portrait.msg.taintLegend'),
    layerColor: '#ef4444',
    layerOrder: 0,
    fileCount: filtered.paths.length,
    description: t('portrait.msg.taintLegendHint'),
    portraitMode: 'taintFlow',
  });

  let placed = 0;
  let edgeCount = 0;
  for (const p of layout.paths) {
    for (const n of p.nodes) {
      const node = n as TaintLayoutNode;
      const label = node.name.length > 34 ? `${node.name.slice(0, 33)}…` : node.name;
      const color = node.role === 'sink' && node.endKind ? SINK_KIND_COLOR[node.endKind] : TAINT_ROLE_COLOR[node.role];
      place(
        'function',
        { x: node.x, y: node.y },
        label,
        {
          name: node.name,
          symbolKind: 'function',
          fileId: node.fileId || null,
          filePath: node.filePath || null,
          lineStart: node.line,
          symbolId: node.symbolId ?? null,
          portraitMode: 'taintFlow',
          accentColor: color,
          taintRole: node.role,
          taintEndKind: node.endKind ?? null,
          taintSeverity: node.severity,
          taintRule: node.rule ?? null,
          taintParams: node.tainted,
          // 复用 FunctionRenderer 的等级配色：汇点最重、源次之、净化最轻
          level:
            node.role === 'sink'
              ? 'extreme'
              : node.role === 'source'
                ? 'high'
                : node.role === 'sanitized'
                  ? 'low'
                  : 'medium',
          levelLabel: TAINT_ROLE_LABEL[node.role],
          signature: node.rule && node.endKind ? `${SINK_KIND_LABEL[node.endKind]} · ${node.rule}` : null,
        },
        { w: node.width, h: node.height },
      );
      placed++;
    }
    for (const e of p.edges) {
      const a = p.nodes[e.from];
      const b = p.nodes[e.to];
      if (!a || !b) continue;
      connectVertical(
        { x: a.x, y: a.y, w: a.width, h: a.height },
        { x: b.x, y: b.y, w: b.width, h: b.height },
        e.label,
        {
          depType: 'taint',
          isCircular: false,
          fromFileId: a.fileId || null,
          toFileId: b.fileId || null,
          portraitMode: 'taintFlow',
          taintSink: p.endKind,
        },
      );
      edgeCount++;
    }
  }

  await persist(analysisId, 'taintFlow');

  const st = layout.stats;
  return {
    ok: true,
    message: t('portrait.msg.taintDone', {
      n: st.paths,
      sinks: st.sinks,
      sanitized: st.sanitized,
      edges: edgeCount,
      unresolved: st.unresolved,
      trunc: st.truncated ? t('portrait.msg.taintTrunc') : '',
    }),
    severity: st.sinks > 0 ? 'warning' : 'success',
    placed,
  };
}
