/**
 * 调用链展开
 *
 * expandCallChain（增量展开调用链到画布）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { useEditorStore, type BulkComponentInput } from '../../../store/editorStore';
import { useProjectStore } from '../../../store/projectStore';
import { receiverQualifiedName } from '.././callEdgeReceiver';


/**
 * 调用链画像：从某个符号沿调用图做多跳展开（真正 A→B→C→D 完整链路）。
 *
 * - 双向 BFS：上游 caller（谁调用它）+ 下游 callee（它调用谁），各 `depth` 跳（默认 2）。
 * - 增量追加到当前画布（不重建全图），节点带 symbolId+fileId+lineStart（双击跳源码），
 *   边带 fromFileId/toFileId（复用 DependencyEdgeRenderer 高亮）。
 * - 返回创建的组件 id，供调用方在「再次单击」时收起（removeComponentsBulk）。
 * - 非侵入：零后端、不触碰 runCallGraphPortrait 的全量布局。
 */
export function expandCallChain(
  analysisId: string,
  symbolId: string,
  origin: { x: number; y: number },
  depth = 2,
): { nodeIds: string[]; edgeIds: string[]; count: number } {
  const pst = useProjectStore.getState();
  const edges = pst.callEdges.filter((e) => e.kind === 'cross-file');
  const symbolById = new Map(pst.symbols.map((s) => [s.id, s]));

  // BFS 收集多跳邻居符号（去重，排除起点自身与同文件内边）
  const visited = new Set<string>([symbolId]);
  const frontier = [symbolId];
  const found = new Set<string>(); // 多跳到达的符号（不含起点）
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const sid of frontier) {
      for (const e of edges) {
        if (e.callerFileId === e.calleeFileId) continue;
        // 上游：sid 是被调方 → 找调用者
        if (e.calleeSymbolId === sid && !visited.has(e.callerSymbolId)) {
          visited.add(e.callerSymbolId);
          found.add(e.callerSymbolId);
          next.push(e.callerSymbolId);
        }
        // 下游：sid 是调用方 → 找被调者
        if (e.callerSymbolId === sid && !visited.has(e.calleeSymbolId)) {
          visited.add(e.calleeSymbolId);
          found.add(e.calleeSymbolId);
          next.push(e.calleeSymbolId);
        }
      }
    }
    frontier.length = 0;
    frontier.push(...next);
  }

  if (found.size === 0) return { nodeIds: [], edgeIds: [], count: 0 };

  const SYM_W = 210;
  const SYM_H = 52;
  const GAP_X = SYM_W + 60;
  const GAP_Y = SYM_H + 36;
  const perCol = Math.ceil(Math.sqrt(found.size)) || 1;

  // 起点节点放在 origin，邻居沿右下网格铺开
  const idBySymbol = new Map<string, string>();
  const items: BulkComponentInput[] = [];

  const startSym = symbolById.get(symbolId);
  const startId = `cg-${globalThis.crypto?.randomUUID?.() ?? `${symbolId}-${Date.now()}`}`;
  idBySymbol.set(symbolId, startId);
  items.push({
    type: 'function',
    name: startSym?.name ?? symbolId,
    x: origin.x,
    y: origin.y,
    width: SYM_W,
    height: SYM_H,
    config: {
      name: startSym?.name ?? symbolId,
      symbolKind: startSym?.kind ?? 'function',
      fileId: startSym?.fileId ?? null,
      filePath: startSym?.filePath ?? null,
      lineStart: startSym?.lineStart ?? null,
      symbolId,
      portraitMode: 'callGraph',
      isChainHub: true,
      expandOwner: symbolId,
    },
  });

  const foundArr = Array.from(found);
  foundArr.forEach((sid, i) => {
    const sym = symbolById.get(sid);
    const col = i % perCol;
    const row = Math.floor(i / perCol);
    const id = `cg-${globalThis.crypto?.randomUUID?.() ?? `${sid}-${Date.now()}-${i}`}`;
    idBySymbol.set(sid, id);
    items.push({
      type: 'function',
      name: sym?.name ?? sid,
      x: origin.x + GAP_X * (col + 1),
      y: origin.y + GAP_Y * row,
      width: SYM_W,
      height: SYM_H,
      config: {
        name: sym?.name ?? sid,
        symbolKind: sym?.kind ?? 'function',
        fileId: sym?.fileId ?? null,
        filePath: sym?.filePath ?? null,
        lineStart: sym?.lineStart ?? null,
        symbolId: sid,
        portraitMode: 'callGraph',
        expandOwner: symbolId,
      },
    });
  });

  // 边：连接起点与所有多跳邻居（直接 1 跳）+ 邻居间若也存在调用则补边
  const edgeItems: BulkComponentInput[] = [];
  const linkEdge = (fromSid: string, toSid: string, label: string) => {
    const fa = idBySymbol.get(fromSid);
    const tb = idBySymbol.get(toSid);
    if (!fa || !tb) return;
    const fromComp = items.find((it) => it.config?.symbolId === fromSid) as any;
    const toComp = items.find((it) => it.config?.symbolId === toSid) as any;
    if (!fromComp || !toComp) return;
    const ax = fromComp.x + fromComp.width;
    const ay = fromComp.y + fromComp.height / 2;
    const bx = toComp.x;
    const by = toComp.y + toComp.height / 2;
    const minX = Math.min(ax, bx);
    const minY = Math.min(ay, by);
    const cf = pst.callEdges.find((e) => e.callerSymbolId === fromSid && e.calleeSymbolId === toSid);
    edgeItems.push({
      type: 'dependency-edge',
      name: label,
      x: minX,
      y: minY,
      width: Math.max(4, Math.abs(bx - ax) + 16),
      height: Math.max(4, Math.abs(by - ay) + 16),
      config: {
        depType: 'call',
        isCircular: false,
        fromFileId: cf?.callerFileId ?? null,
        toFileId: cf?.calleeFileId ?? null,
        symbolNames: [label],
        callCount: 1,
        portraitMode: 'callGraph',
        expandOwner: symbolId,
        fromX: ax - minX,
        fromY: ay - minY,
        toX: bx - minX,
        toY: by - minY,
      },
    });
  };

  // 1 跳直连：起点 ↔ 邻居
  for (const sid of foundArr) {
    const upEdge = edges.find((e) => e.calleeSymbolId === symbolId && e.callerSymbolId === sid);
    const downEdge = edges.find((e) => e.callerSymbolId === symbolId && e.calleeSymbolId === sid);
    if (upEdge)
      linkEdge(
        sid,
        symbolId,
        `${upEdge.callerName} → ${receiverQualifiedName(upEdge.calleeName, upEdge.calleeReceiver)}`,
      );
    else if (downEdge)
      linkEdge(
        symbolId,
        sid,
        `${downEdge.callerName} → ${receiverQualifiedName(downEdge.calleeName, downEdge.calleeReceiver)}`,
      );
  }
  // 2 跳及以上：邻居之间存在调用也画边（补全路径可视性）
  for (let i = 0; i < foundArr.length; i++) {
    for (let j = 0; j < foundArr.length; j++) {
      if (i === j) continue;
      const e = edges.find((ed) => ed.callerSymbolId === foundArr[i] && ed.calleeSymbolId === foundArr[j]);
      if (e)
        linkEdge(
          foundArr[i],
          foundArr[j],
          `${e.callerName} → ${receiverQualifiedName(e.calleeName, e.calleeReceiver)}`,
        );
    }
  }

  const allItems = [...items, ...edgeItems];
  let nodeIds: string[] = [];
  let edgeIds: string[] = [];
  if (allItems.length > 0) {
    const ids = useEditorStore.getState().addComponentsBulk(allItems);
    // addComponentsBulk 返回顺序与输入一致：前 items.length 个是节点，其余是边
    nodeIds = ids.slice(0, items.length);
    edgeIds = ids.slice(items.length);
  }
  return { nodeIds, edgeIds, count: found.size };
}
