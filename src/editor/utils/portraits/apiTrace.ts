/**
 * API 调用链画像
 *
 * runApiTracePortrait（FE→BE invoke 桥接追踪）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place, connectVertical } from './canvas';
import { CODE_LANGS } from './constants';
import { readLines, mapLimit } from './shared';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { useProjectStore } from '../../../store/projectStore';


// ───────────────────────── API 调用链路画像（前后端关联） ─────────────────────────
/**
 * API 调用链路画像（apiTrace）：把「前端访问了哪个 API → 该 API 落到后端哪个方法」画成
 * 一条条**纵向单列**走线（从上到下读），每个节点双击直达源码。满足三硬要求：
 *  ① 前后端关联：前端调用点 → API 路由 → 后端 handler → 下游方法；
 *  ② 点击直接打开源码定位（fileId/filePath/lineStart → SceneEditor 双击兜底）；
 *  ③ 每条依赖连线占一行、从上到下（纵向单列，边为 top→bottom 垂直线）。
 *
 * 纯前端、零 Rust/零新表/零新依赖：后端路由识别复用 apiSurface 同款正则思路，
 * 前端调用点正则 + URL→路由链接器 + 路由→handler 符号解析均在本函数内补齐。
 *
 * 三视图（view）：all=全链路 / orphan=悬空调用(前端调了但无后端路由) / dead=死路由(后端路由无前端调用)。
 */
export async function runApiTracePortrait(
  analysisId: string,
  view: 'all' | 'orphan' | 'dead' = 'all',
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const files = pst.files.filter(
    (f: any) =>
      !f.isDirectory &&
      CODE_LANGS.has((f.language || '').toLowerCase()) &&
      (f.lineCount || 0) > 0 &&
      (f.lineCount || 0) <= 6000,
  );
  const symbols: any[] = pst.symbols || [];
  const symbolById = new Map<string, any>(symbols.map((s) => [s.id, s]));
  const symbolByName = new Map<string, any[]>();
  for (const s of symbols) {
    const arr = symbolByName.get(s.name) ?? [];
    arr.push(s);
    symbolByName.set(s.name, arr);
  }
  const callEdges = (pst.callEdges || []).filter((e: any) => e.kind === 'cross-file');

  // ── 归一化（链接器核心）──
  const normPath = (p: string): string => {
    if (!p) return '';
    let s = p.trim();
    if (/^https?:\/\//i.test(s)) {
      try {
        s = new URL(s).pathname;
      } catch {
        /* keep raw */
      }
    }
    s = s.split('?')[0].split('#')[0];
    s = s.toLowerCase();
    s = s.replace(/[:<*]\w+/g, '{param}'); // :id / {id} / <id> / *id → {param}
    if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
    return s;
  };
  const normInvoke = (name: string): string => name.toLowerCase().replace(/[_-]/g, '');

  interface ApiNode {
    verb: string;
    path: string;
    norm: string;
    fileId: string | null;
    filePath: string;
    line: number;
    handler: string | null;
    raw: string;
    kind: 'call' | 'route';
  }

  const CALL_RES: RegExp[] = [
    /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{[^}]*?method\s*:\s*['"`](\w+)['"`]/i,
    /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/i,
    /\baxios\s*\.\s*(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/i,
    /\baxios\s*\(\s*\{[^}]*?url\s*:\s*['"`]([^'"`]+)['"`]/i,
    /\$\s*\.\s*ajax\s*\(\s*\{[^}]*?url\s*:\s*['"`]([^'"`]+)['"`]/i,
    /\b(got|httpx|requests)\b(?:\s*\.\s*(get|post|put|delete|patch))?\s*\(\s*['"`]([^'"`]+)['"`]/i,
    /\binvoke\s*\(\s*['"`]([^'"`]+)['"`]/i,
  ];
  const ROUTE_RE =
    /(?:app|router|server|api|res|req|fastify|koa|hapi|engine|http|client|db|conn|pool|srv|web|bp|blueprint|r|e)\.(get|post|put|delete|patch|head|options|all)\s*\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?))?/i;
  const ROUTE_DECORATOR =
    /@(?:Get|Post|Put|Delete|Patch|Head|Options|RequestMapping|app\.route|router\.(?:get|post|put|delete|patch)|\w+\.(?:get|post|put|delete|patch))\b[^)]*\((['"`][^'"`]+['"`])?\)/;
  const NEXT_RE =
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/;
  const TAURI_RE = /#\[tauri::command(?:\([^)]*\))?\]\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/;

  const scanned = await mapLimit(files, 16, async (f: any) => {
    const lines = await readLines(f);
    if (!lines) return null;
    const out: ApiNode[] = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      let m: RegExpMatchArray | null = null;
      for (const re of CALL_RES) {
        const mm = ln.match(re);
        if (mm) {
          m = mm;
          break;
        }
      }
      if (m) {
        let verb = 'GET';
        let path = m[1] ?? '';
        if (/fetch/i.test(m[0])) {
          verb = m[2] ? m[2].toUpperCase() : 'GET';
          path = m[1];
        } else if (/axios/i.test(m[0])) {
          if (/\.(get|post|put|delete|patch|head|options)/i.test(m[0])) {
            verb = (m[1] || 'GET').toUpperCase();
            path = m[2];
          } else {
            verb = 'GET';
            path = m[1];
          }
        } else if (/ajax/i.test(m[0])) {
          verb = 'GET';
          path = m[1];
        } else if (/got|httpx|requests/i.test(m[0])) {
          verb = m[2] ? m[2].toUpperCase() : 'GET';
          path = m[3];
        } else if (/invoke/i.test(m[0])) {
          verb = 'invoke';
          path = m[1];
        }
        const norm = verb === 'invoke' ? normInvoke(path) : normPath(path);
        out.push({
          verb,
          path,
          norm,
          fileId: f.id,
          filePath: f.relPath,
          line: i + 1,
          handler: null,
          raw: ln.trim().slice(0, 56),
          kind: 'call',
        });
      }

      const rm = ln.match(ROUTE_RE);
      if (rm) {
        out.push({
          verb: rm[1].toUpperCase(),
          path: rm[2],
          norm: normPath(rm[2]),
          fileId: f.id,
          filePath: f.relPath,
          line: i + 1,
          handler: rm[3] ?? null,
          raw: `${rm[1].toUpperCase()} ${rm[2]}`,
          kind: 'route',
        });
        continue;
      }
      const dm = ln.match(ROUTE_DECORATOR);
      if (dm) {
        let handler: string | null = null;
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const hm = lines[j].match(/\b(?:function|fn|def|const|let|var)\s+([A-Za-z_][\w]*)/);
          if (hm) {
            handler = hm[1];
            break;
          }
          const hm2 = lines[j].match(/([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?\(/);
          if (hm2) {
            handler = hm2[1];
            break;
          }
        }
        out.push({
          verb: 'DECORATOR',
          path: dm[1] || '',
          norm: normPath(dm[1] || ''),
          fileId: f.id,
          filePath: f.relPath,
          line: i + 1,
          handler,
          raw: (dm[1] || 'decorator').slice(0, 56),
          kind: 'route',
        });
        continue;
      }
      const nm = ln.match(NEXT_RE);
      if (nm) {
        out.push({
          verb: nm[1].toUpperCase(),
          path: '',
          norm: `next:${nm[1].toUpperCase()}`,
          fileId: f.id,
          filePath: f.relPath,
          line: i + 1,
          handler: nm[1],
          raw: `${nm[1]} handler`,
          kind: 'route',
        });
        continue;
      }
      const tm = ln.match(TAURI_RE);
      if (tm) {
        out.push({
          verb: 'invoke',
          path: `/${tm[1]}`,
          norm: normInvoke(tm[1]),
          fileId: f.id,
          filePath: f.relPath,
          line: i + 1,
          handler: tm[1],
          raw: `invoke ${tm[1]}`,
          kind: 'route',
        });
      }
    }
    return out;
  });

  const calls: ApiNode[] = [];
  const routes: ApiNode[] = [];
  for (const arr of scanned) {
    if (!arr) continue;
    for (const n of arr) (n.kind === 'call' ? calls : routes).push(n);
  }

  if (calls.length === 0 && routes.length === 0) {
    return { ok: false, message: t('portrait.msg.apiTraceNoData'), severity: 'info', placed: 0 };
  }

  // ── 链接器：call → route ──
  const pushRoute = (map: Map<string, ApiNode[]>, key: string, node: ApiNode) => {
    const arr = map.get(key);
    if (arr) arr.push(node);
    else map.set(key, [node]);
  };
  const routeByVerbNorm = new Map<string, ApiNode[]>();
  const routeByNorm = new Map<string, ApiNode[]>();
  for (const r of routes) {
    pushRoute(routeByVerbNorm, `${r.verb}|${r.norm}`, r);
    pushRoute(routeByNorm, r.norm, r);
  }
  const matchRoute = (call: ApiNode): ApiNode | null => {
    if (call.verb === 'invoke') {
      const arr = routeByVerbNorm.get(`invoke|${call.norm}`) ?? routeByNorm.get(call.norm) ?? [];
      return arr.find((r) => r.verb === 'invoke') ?? arr[0] ?? null;
    }
    const exact = routeByVerbNorm.get(`${call.verb}|${call.norm}`);
    if (exact && exact.length) return exact[0];
    const byNorm = routeByNorm.get(call.norm);
    if (byNorm && byNorm.length) return byNorm[0];
    for (const r of routes) {
      if (r.verb !== call.verb) continue;
      if (r.norm.startsWith(call.norm + '/') || call.norm.startsWith(r.norm + '/')) return r;
    }
    return null;
  };

  // 分类
  const matched: { call: ApiNode; route: ApiNode }[] = [];
  const matchedRouteKeys = new Set<string>();
  const seenEndpoint = new Set<string>();
  const orphan: ApiNode[] = [];
  for (const c of calls) {
    const r = matchRoute(c);
    if (r) {
      const key = `${c.verb}|${c.norm}`;
      if (!seenEndpoint.has(key)) {
        seenEndpoint.add(key);
        matched.push({ call: c, route: r });
      }
      matchedRouteKeys.add(`${r.verb}|${r.norm}`);
      matchedRouteKeys.add(r.norm);
    } else {
      orphan.push(c);
    }
  }
  const dead = routes.filter((r) => !matchedRouteKeys.has(`${r.verb}|${r.norm}`) && !matchedRouteKeys.has(r.norm));

  // 解析 handler 符号 + 下游
  const resolveHandler = (handler: string | null, routeFile: string): any | null => {
    if (!handler) return null;
    const name = handler.includes('.') ? handler.split('.').pop()! : handler;
    const cands = symbolByName.get(name);
    if (!cands || cands.length === 0) return null;
    return cands.find((s) => s.filePath === routeFile) ?? cands[0];
  };
  const downstream = (handlerSymId: string): any[] => {
    const visited = new Set<string>([handlerSymId]);
    const found: string[] = [];
    let frontier = [handlerSymId];
    for (let hop = 0; hop < 2; hop++) {
      const next: string[] = [];
      for (const sid of frontier) {
        for (const e of callEdges) {
          if (e.callerSymbolId === sid && e.callerFileId !== e.calleeFileId) {
            if (!visited.has(e.calleeSymbolId)) {
              visited.add(e.calleeSymbolId);
              found.push(e.calleeSymbolId);
              next.push(e.calleeSymbolId);
            }
          }
        }
      }
      frontier = next;
    }
    return found
      .slice(0, 6)
      .map((id) => symbolById.get(id))
      .filter(Boolean);
  };

  // ── 渲染 ──
  clearCanvas();
  const NODE_W = 250;
  const NODE_H = 46;
  const COL_GAP = 70;
  const ROW_GAP = 18;
  const LEFT = 60;
  const TOP = 80;

  // 竖向连线（top→bottom）：a 底中点 → b 顶中点
  // 纵向连线用共享原语 connectVertical（与 taintFlow 同一套几何，改一处即两处生效）

  const ROLE_COLOR: Record<string, string> = {
    call: '#3b82f6',
    route: '#f59e0b',
    handler: '#22c55e',
    downstream: '#94a3b8',
  };
  const placeNode = (
    role: 'call' | 'route' | 'handler' | 'downstream',
    x: number,
    y: number,
    label: string,
    fileId: string | null,
    filePath: string,
    line: number,
    symbolId?: string | null,
    extra?: Record<string, unknown>,
  ) => {
    place(
      'function',
      { x, y },
      label,
      {
        name: label,
        symbolKind: 'function',
        fileId: fileId ?? null,
        filePath: filePath ?? null,
        lineStart: line,
        symbolId: symbolId ?? null,
        portraitMode: 'apiTrace',
        accentColor: ROLE_COLOR[role],
        apiRole: role,
        isEntry: role === 'handler',
        ...(extra || {}),
      },
      { w: NODE_W, h: NODE_H },
    );
  };

  // 图例
  place('layer-marker', { x: LEFT, y: 24 }, t('portrait.msg.apiTraceLegend'), {
    layerName: t('portrait.msg.apiTraceLegend'),
    layerColor: '#3b82f6',
    layerOrder: 0,
    fileCount: view === 'all' ? matched.length : view === 'orphan' ? orphan.length : dead.length,
    description: t('portrait.msg.apiTraceLegendHint'),
    portraitMode: 'apiTrace',
  });

  let edgeCount = 0;
  let placed = 0;

  if (view === 'all') {
    if (matched.length === 0) {
      return { ok: false, message: t('portrait.msg.apiTraceNoLink'), severity: 'info', placed: 0 };
    }
    const CAP = 60;
    const traces = matched.slice(0, CAP);
    const colW = NODE_W + COL_GAP;
    traces.forEach((tr, col) => {
      const x = LEFT + col * colW;
      const callNode = { x, y: TOP, w: NODE_W, h: NODE_H };
      placeNode(
        'call',
        x,
        TOP,
        `${tr.call.verb === 'invoke' ? 'invoke' : tr.call.verb} ${tr.call.path || ''}`.trim().slice(0, 40),
        tr.call.fileId,
        tr.call.filePath,
        tr.call.line,
      );
      placed++;
      const routeY = TOP + (NODE_H + ROW_GAP);
      const routeNode = { x, y: routeY, w: NODE_W, h: NODE_H };
      placeNode(
        'route',
        x,
        routeY,
        `${tr.route.verb === 'DECORATOR' ? 'API' : tr.route.verb} ${tr.route.path || ''}`.trim().slice(0, 40),
        tr.route.fileId,
        tr.route.filePath,
        tr.route.line,
      );
      placed++;
      connectVertical(callNode, routeNode, `${tr.call.verb} ${tr.call.path} → ${tr.route.verb} ${tr.route.path}`, {
        depType: 'api-link',
        isCircular: false,
        fromFileId: tr.call.fileId,
        toFileId: tr.route.fileId,
        portraitMode: 'apiTrace',
        apiCrossBoundary: true,
      });
      edgeCount++;

      const handlerSym = resolveHandler(tr.route.handler, tr.route.filePath);
      let prev = routeNode;
      if (handlerSym) {
        const hY = routeY + (NODE_H + ROW_GAP);
        const hNode = { x, y: hY, w: NODE_W, h: NODE_H };
        placeNode(
          'handler',
          x,
          hY,
          (handlerSym.name || 'handler').slice(0, 40),
          handlerSym.fileId ?? null,
          handlerSym.filePath ?? tr.route.filePath,
          handlerSym.lineStart ?? tr.route.line,
          handlerSym.id,
          { callIn: handlerSym.callIn ?? 0, callOut: handlerSym.callOut ?? 0 },
        );
        placed++;
        connectVertical(prev, hNode, `${tr.route.path} → ${handlerSym.name}`, {
          depType: 'api-handler',
          isCircular: false,
          fromFileId: tr.route.fileId,
          toFileId: handlerSym.fileId ?? null,
          portraitMode: 'apiTrace',
        });
        edgeCount++;
        prev = hNode;
        const ds = downstream(handlerSym.id);
        for (const d of ds) {
          const dY = prev.y + (NODE_H + ROW_GAP);
          const dNode = { x, y: dY, w: NODE_W, h: NODE_H };
          placeNode(
            'downstream',
            x,
            dY,
            (d.name || 'method').slice(0, 40),
            d.fileId ?? null,
            d.filePath ?? '',
            d.lineStart ?? 0,
            d.id,
          );
          placed++;
          connectVertical(prev, dNode, `${handlerSym.name} → ${d.name}`, {
            depType: 'call',
            isCircular: false,
            fromFileId: handlerSym.fileId ?? null,
            toFileId: d.fileId ?? null,
            portraitMode: 'apiTrace',
          });
          edgeCount++;
          prev = dNode;
        }
      }
    });
  } else if (view === 'orphan') {
    if (orphan.length === 0) {
      return { ok: false, message: t('portrait.msg.apiTraceNoOrphan'), severity: 'info', placed: 0 };
    }
    const CAP = 80;
    const items = orphan.slice(0, CAP);
    const perRow = Math.max(1, Math.floor((4096 - LEFT) / (NODE_W + COL_GAP)));
    items.forEach((c, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = LEFT + col * (NODE_W + COL_GAP);
      const y = TOP + row * (NODE_H + ROW_GAP);
      placeNode(
        'call',
        x,
        y,
        `${c.verb === 'invoke' ? 'invoke' : c.verb} ${c.path || ''}`.trim().slice(0, 40),
        c.fileId,
        c.filePath,
        c.line,
        null,
        { apiOrphan: true },
      );
      placed++;
    });
  } else {
    // dead
    if (dead.length === 0) {
      return { ok: false, message: t('portrait.msg.apiTraceNoDead'), severity: 'info', placed: 0 };
    }
    const CAP = 80;
    const items = dead.slice(0, CAP);
    const perRow = Math.max(1, Math.floor((4096 - LEFT) / (NODE_W + COL_GAP)));
    items.forEach((r, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = LEFT + col * (NODE_W + COL_GAP);
      const y = TOP + row * (NODE_H + ROW_GAP);
      placeNode(
        'route',
        x,
        y,
        `${r.verb === 'DECORATOR' ? 'API' : r.verb} ${r.path || ''}`.trim().slice(0, 40),
        r.fileId,
        r.filePath,
        r.line,
        null,
        { apiDead: true },
      );
      placed++;
    });
  }

  await persist(analysisId, 'apiTrace');

  const overCap =
    (view === 'all' && matched.length > 60) ||
    (view === 'orphan' && orphan.length > 80) ||
    (view === 'dead' && dead.length > 80);
  return {
    ok: true,
    message: t('portrait.msg.apiTraceDone', {
      n: view === 'all' ? Math.min(matched.length, 60) : placed,
      edges: edgeCount,
      orphan: orphan.length,
      dead: dead.length,
      trunc: overCap ? t('portrait.msg.apiTraceTrunc') : '',
    }),
    severity: 'success',
    placed,
  };
}
