/**
 * 调用链画像
 *
 * runCallGraphPortrait（同心环布局，入度最高文件为核）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place, connect } from './canvas';
import { currentInsights, fileConfig } from './shared';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { type ProjectFile } from '../../../services/tauri';
import { useProjectStore } from '../../../store/projectStore';
import { receiverQualifiedName } from '.././callEdgeReceiver';
import { emptyFileInsight } from '.././fileInsights';


/**
 * 调用链画像：以「调用入度最高的文件」为核心节点，画出跨文件调用边
 *
 * 布局用同心环而非网格 —— 调用图关心的是中心性，环形能一眼看出
 * 哪些文件是被围绕的基础设施。上限 60 个节点，超出会糊成一团。
 */
export async function runCallGraphPortrait(analysisId: string, force = false): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  let edges = pst.callEdges.filter((e) => e.kind === 'cross-file');

  // 自愈：store 为空（扫描漏跑 callGraph 阶段 / 增量未带出）时主动重拉一次再渲染，
  // 避免用户永远看到「无数据」且无入口强刷（与设计模式/数据流同思路）。
  // force=true（菜单「调用链（重新分析）」）无论是否为空都强制重拉，确保刷新生效。
  if (force || edges.length === 0) {
    try {
      await pst.analyzeCallGraph(analysisId, undefined);
      await pst.loadCallEdges(analysisId);
      edges = useProjectStore.getState().callEdges.filter((e) => e.kind === 'cross-file');
    } catch (err) {
      console.error('[runCallGraphPortrait] 自愈重拉 callGraph 失败', err);
    }
  }

  if (edges.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.callGraphNoData'),
      severity: 'info',
      placed: 0,
    };
  }

  const insights = currentInsights();
  const fileById = new Map(pst.files.map((f) => [f.id, f]));

  // 参与节点：出现在跨文件调用边两端的文件，按（入度+出度）取前 60
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.callerFileId, (degree.get(e.callerFileId) || 0) + 1);
    degree.set(e.calleeFileId, (degree.get(e.calleeFileId) || 0) + 1);
  }
  const nodes = Array.from(degree.entries())
    .filter(([id]) => fileById.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([id]) => fileById.get(id)!);

  if (nodes.length === 0) {
    return { ok: false, message: t('portrait.msg.callGraphStale'), severity: 'warning', placed: 0 };
  }

  clearCanvas();

  // 同心环布局：入度前 8 名放内环（基础设施），其余放外环
  const NODE_W = 170;
  const NODE_H = 64;
  const CX = 620;
  const CY = 460;
  const placedPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const inner = nodes.slice(0, Math.min(8, nodes.length));
  const outer = nodes.slice(inner.length);

  const layout = (list: ProjectFile[], radius: number, phase: number) => {
    list.forEach((f, i) => {
      const angle = phase + (2 * Math.PI * i) / Math.max(list.length, 1);
      const x = CX + radius * Math.cos(angle) - NODE_W / 2;
      const y = CY + radius * 0.62 * Math.sin(angle) - NODE_H / 2;
      const ins = insights.get(f.id) ?? emptyFileInsight();
      place('file', { x, y }, f.name, fileConfig(f, ins, 'callGraph'));
      placedPos.set(f.id, { x, y, w: NODE_W, h: NODE_H });
    });
  };
  layout(inner, 210, -Math.PI / 2);
  layout(outer, 460, -Math.PI / 2 + 0.2);

  // 聚合文件级调用边（同一对文件只画一条，标注调用的函数名）
  const pairs = new Map<string, { from: string; to: string; names: Set<string>; count: number }>();
  for (const e of edges) {
    if (!placedPos.has(e.callerFileId) || !placedPos.has(e.calleeFileId)) continue;
    if (e.callerFileId === e.calleeFileId) continue;
    const key = `${e.callerFileId}->${e.calleeFileId}`;
    const cur = pairs.get(key) || {
      from: e.callerFileId,
      to: e.calleeFileId,
      names: new Set<string>(),
      count: 0,
    };
    // 接收者限定名：同名 sink（child_process.exec / re.exec）经 calleeReceiver 区分，
    // 避免文件级调用边标签合并成无意义的裸 `exec`（P1 · 对标 joern CALL.methodFullName）。
    cur.names.add(receiverQualifiedName(e.calleeName, e.calleeReceiver));
    cur.count += 1;
    pairs.set(key, cur);
  }

  let edgeCount = 0;
  for (const p of pairs.values()) {
    const a = placedPos.get(p.from)!;
    const b = placedPos.get(p.to)!;
    connect(a, b, `${fileById.get(p.from)?.name} → ${fileById.get(p.to)?.name}`, {
      depType: 'call',
      isCircular: false,
      fromFileId: p.from,
      toFileId: p.to,
      symbolNames: Array.from(p.names).slice(0, 5),
      callCount: p.count,
    });
    edgeCount += 1;
  }

  // ── 符号级调用链（下钻，呼应「链」字）──
  // 同心环是文件级宏观骨架；这里取高频被调枢纽符号（topCallees），从 cross-file 边溯源其
  // 调用者，画出 caller → callee 的「入链」；并取高频出度枢纽（topCallers）画出 hub → callee
  // 的「出链」，让"谁在支撑谁 / 谁扩散到哪"双向可探索。
  // 节点带 symbolId+fileId+lineStart → 双击直达函数定义行；边带 fromFileId/toFileId 复用高亮。
  const SYM_W = 210;
  const SYM_H = 52;
  const symbolById = new Map(pst.symbols.map((s) => [s.id, s]));
  const topCallees = pst.callGraphSummary?.topCallees ?? [];
  const topCallers = pst.callGraphSummary?.topCallers ?? [];
  let symChainNodes = 0;
  let symChainEdges = 0;

  // 入链区（谁在调用这些枢纽函数）：caller(左) → 枢纽(右)
  if (topCallees.length > 0) {
    const CHAIN_Y = CY + 460 + 40; // 同心环下方留白后起链
    place('layer-marker', { x: 40, y: CHAIN_Y - 34 }, t('portrait.msg.callChainZoneIn'), {
      layerName: t('portrait.msg.callChainZoneIn'),
      layerColor: '#7c3aed',
      layerOrder: 0,
      fileCount: topCallees.length,
      description: t('portrait.msg.callChainHintIn'),
      portraitMode: 'callGraph',
    });
    const perChainGap = SYM_H + 30;
    topCallees.slice(0, 6).forEach((hot, idx) => {
      const calleeSym = symbolById.get(hot.symbolId);
      const calleeFileId = calleeSym?.fileId ?? null;
      const calleeLine = calleeSym?.lineStart ?? null;
      const chainY = CHAIN_Y + idx * perChainGap;
      const calleeX = 40 + (SYM_W + 120) * 2; // 链尾（枢纽）最右
      const calleeId = place(
        'function',
        { x: calleeX, y: chainY },
        hot.name,
        {
          name: hot.name,
          symbolKind: calleeSym?.kind ?? 'function',
          fileId: calleeFileId,
          filePath: calleeSym?.filePath ?? hot.filePath,
          lineStart: calleeLine,
          callIn: hot.count,
          portraitMode: 'callGraph',
          isChainHub: true,
        },
        { w: SYM_W, h: SYM_H },
      );
      if (!calleeId) return;
      symChainNodes += 1;
      const callers = edges
        .filter((e) => e.calleeSymbolId === hot.symbolId && e.callerFileId !== e.calleeFileId)
        .slice(0, 3);
      callers.forEach((e, ci) => {
        const callerSym = symbolById.get(e.callerSymbolId);
        const callerX = 40 + ci * (SYM_W + 120);
        const callerId = place(
          'function',
          { x: callerX, y: chainY },
          e.callerName,
          {
            name: e.callerName,
            symbolKind: callerSym?.kind ?? 'function',
            fileId: e.callerFileId,
            filePath: e.callerFilePath,
            lineStart: callerSym?.lineStart ?? null,
            portraitMode: 'callGraph',
          },
          { w: SYM_W, h: SYM_H },
        );
        if (!callerId) return;
        symChainNodes += 1;
        const ca = { x: callerX, y: chainY, w: SYM_W, h: SYM_H };
        const cb = { x: calleeX, y: chainY, w: SYM_W, h: SYM_H };
        connect(ca, cb, `${e.callerName} → ${hot.name}`, {
          depType: 'call',
          isCircular: false,
          fromFileId: e.callerFileId,
          toFileId: e.calleeFileId,
          symbolNames: [hot.name],
          callCount: 1,
        });
        symChainEdges += 1;
      });
    });

    // 出链区（这些枢纽函数又扩散调用了谁）：枢纽(左) → callee(右)，位于入链区下方
    if (topCallers.length > 0) {
      const OUT_Y = CHAIN_Y + 6 * perChainGap + 40;
      place('layer-marker', { x: 40, y: OUT_Y - 34 }, t('portrait.msg.callChainZoneOut'), {
        layerName: t('portrait.msg.callChainZoneOut'),
        layerColor: '#0ea5e9',
        layerOrder: 1,
        fileCount: topCallers.length,
        description: t('portrait.msg.callChainHintOut'),
        portraitMode: 'callGraph',
      });
      topCallers.slice(0, 6).forEach((hot, idx) => {
        const callerSym = symbolById.get(hot.symbolId);
        const callerFileId = callerSym?.fileId ?? null;
        const callerLine = callerSym?.lineStart ?? null;
        const chainY = OUT_Y + idx * perChainGap;
        const callerX = 40; // 链头（枢纽）最左
        const callerId = place(
          'function',
          { x: callerX, y: chainY },
          hot.name,
          {
            name: hot.name,
            symbolKind: callerSym?.kind ?? 'function',
            fileId: callerFileId,
            filePath: callerSym?.filePath ?? hot.filePath,
            lineStart: callerLine,
            callOut: hot.count,
            portraitMode: 'callGraph',
            isChainHub: true,
          },
          { w: SYM_W, h: SYM_H },
        );
        if (!callerId) return;
        symChainNodes += 1;
        const callees = edges
          .filter((e) => e.callerSymbolId === hot.symbolId && e.callerFileId !== e.calleeFileId)
          .slice(0, 3);
        callees.forEach((e, ci) => {
          const calleeSym = symbolById.get(e.calleeSymbolId);
          const calleeX = 40 + (SYM_W + 120) * (ci + 1);
          const calleeId = place(
            'function',
            { x: calleeX, y: chainY },
            e.calleeName,
            {
              name: e.calleeName,
              symbolKind: calleeSym?.kind ?? 'function',
              fileId: e.calleeFileId,
              filePath: e.calleeFilePath,
              lineStart: calleeSym?.lineStart ?? null,
              portraitMode: 'callGraph',
            },
            { w: SYM_W, h: SYM_H },
          );
          if (!calleeId) return;
          symChainNodes += 1;
          const ca = { x: callerX, y: chainY, w: SYM_W, h: SYM_H };
          const cb = { x: calleeX, y: chainY, w: SYM_W, h: SYM_H };
          connect(ca, cb, `${hot.name} → ${e.calleeName}`, {
            depType: 'call',
            isCircular: false,
            fromFileId: e.callerFileId,
            toFileId: e.calleeFileId,
            symbolNames: [hot.name],
            callCount: 1,
          });
          symChainEdges += 1;
        });
      });
    }
  }

  await persist(analysisId, 'callGraph');

  const summary = pst.callGraphSummary;
  const hub = summary?.topCallees?.[0];
  const totalFiles = degree.size;
  const truncated = totalFiles - nodes.length;
  return {
    ok: true,
    message: t('portrait.msg.callGraphDone', {
      n: nodes.length,
      edges: edgeCount,
      hub: hub ? t('portrait.msg.callHub', { name: hub.name, n: hub.count }) : '',
      trunc: truncated > 0 ? t('portrait.msg.truncated', { total: totalFiles, keep: nodes.length, n: truncated }) : '',
      chain: symChainNodes > 0 ? t('portrait.msg.callChainDone', { nodes: symChainNodes, edges: symChainEdges }) : '',
    }),
    severity: 'success',
    placed: nodes.length + symChainNodes,
  };
}
