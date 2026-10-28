/**
 * 执行流画像
 *
 * 语言族与入口识别辅助 + runExecutionFlowPortrait（左进右出走线图）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place, connect } from './canvas';
import { readLines, mapLimit } from './shared';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { type ProjectFile, type ProjectSymbol } from '../../../services/tauri';
import { useProjectStore } from '../../../store/projectStore';
import { receiverQualifiedName } from '.././callEdgeReceiver';
import { layeredLayout } from '.././forceLayout';


/**
 * 执行流画像（Execution-Flow Portrait · 纯静态，零 AI）
 *
 * ── 回答什么问题 ──────────────────────────────────────────────────────────
 * 「不知道代码入口、不知道流动方向」—— 本质上不是推理问题，而是静态分析 + 图算法问题。
 * 本画像把**整张符号级调用图**按「执行先后顺序」铺开成一张可读的走线图：
 *   - 左边一列 = 入口（main / bootstrap / 事件处理器 / 生命周期 / 路由 handler …）
 *   - 向右逐级 = 调用深入（入口 → 被调 → 再被调），整图读作「左进右出」的执行走线
 *   - 每一条跨文件调用边都画出来，双击任意节点直达该符号源码定义行
 *
 * ── 与 runCallGraphPortrait 的区别 ──────────────────────────────────────────
 * callGraph 只画「入度最高的文件同心环 + top 6 枢纽符号链」，是**中心性视角**；
 * 本画像是**顺序视角**：全量符号级调用边 + 以入口为根的拓扑排序，让「代码按什么顺序跑」可见。
 *
 * ── 入口点识别（框架感知分层，取代旧的「入度 0 即入口」）─────────────────────
 * 旧规则 ②「入度 0 且出度 > 0」危害极大：实测 web-craft 参与跨文件调用的 820 个符号里
 * 525 个（**64%**）被判为入口 —— 标记铺满全图，完全无法回答「我从哪个入口开始读」。
 * 故改为分层判定，每层都有明确语义：
 *   T0 应用入口：main.rs 的 main、main.tsx/main.ts 引导、App.tsx 根组件、router/routes 定义
 *   T1 边界入口：后端 #[tauri::command] 命令（前端跨语言调用真正的落点）
 *   T2 前端事件入口：on… / handle… 前缀命名且无调用方的事件处理器
 * 另按「可达度」（能触达多少下游节点/文件）排序，直接给出 Top N「从这里开始读」。
 *
 * ── 两项数据修正（纯前端，零 Rust）─────────────────────────────────────
 * ① 清洗跨语言假边：调用图解析器按名字全库匹配、不区分语言作用域，
 *    Rust 的 .lines()/.ok() 被错配到前端同名符号。web-craft 实测 945 条跨文件边里
 *    174 条（18.4%）是这类假边，既画出不存在的「前端↔后端」连线，又污染入/出度。
 *    按扩展名语种族剔除（Rust 不可能静态调用 TS，反之亦然）。
 * ② FE→BE invoke 桥接：前端 invoke('cmd') → 后端 #[tauri::command] 是字符串派发，
 *    call_graph 跳过字面量 → 调用图里根本不存在这条边。这是「前端事件 → 后端」
 *    唯一的实现路径，本画像扫描源码后合成 depType="invoke" 的琥珀虚线补上。
 */

/** 语言族：静态调用不可能跨源语言（跨语言只剩字符串派发，由 invoke 桥接边显式补出）。未知扩展返回 ""（保守保留）。 */
function langFamilyOf(path: string): string {
  const s = (path || '').toLowerCase();
  if (s.endsWith('.rs')) return 'rust';
  if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(s)) return 'tsjs';
  if (s.endsWith('.py')) return 'py';
  if (s.endsWith('.go')) return 'go';
  if (/\.(java|kt|kts)$/.test(s)) return 'jvm';
  if (/\.(c|h|cc|cpp|hpp)$/.test(s)) return 'cpp';
  if (s.endsWith('.cs')) return 'csharp';
  return '';
}

/** 前端 invoke 调用点：兼容泛型形态 invoke<OpsScript[]>('cmd') —— 旧正则漏掉全部泛型调用（web-craft 23/160 命中不到） */
const INVOKE_RE = /\binvoke\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/;
/** 后端 Tauri 命令属性：惯例独立成行，故不能单行匹配（web-craft 170 处全部换行，旧正则命中 0） */
const TAURI_ATTR_RE = /#\[tauri::command(?:\([^)]*\))?\]/;
/** 属性下方最近的 fn 名 */
const RUST_FN_RE = /\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/;
/** 动态导入：main.tsx 用 `await import('./App')` 拉起根组件，静态导入表里根本没有这条边 */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

// ─── 导入解析修复（纯前端）─────────────────────────────────────────────────
// 扫描器把大量项目内相对导入误判成 external：metadata 里其实存着正确路径
// （{"raw":"./pages/TerminalPage","resolved":"src/pages/TerminalPage"}），
// 但查文件时没补扩展名（实际是 TerminalPage.tsx）→ 查不到 → 打成 external:。
// web-craft 实测：1717 条依赖里 1498 条被标 external，其中 182 条是 './' 相对导入（100% 误判），
// 导致 App.tsx 的 14 个页面组件导入全部丢失，前端主干在第一步就断了。
const IMPORT_EXT_CANDIDATES = [
  '',
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '/index.tsx',
  '/index.ts',
  '/index.js',
  '/index.jsx',
];

/** 把 import 说明符按导入方所在目录归一化为项目相对路径 */
function normalizeImportPath(baseDir: string, spec: string): string {
  let s = (spec || '').replace(/\\/g, '/').trim();
  if (!s) return '';
  if (s.startsWith('.')) {
    const parts = (baseDir ? baseDir.split('/') : []).concat(s.split('/'));
    const out: string[] = [];
    for (const seg of parts) {
      if (!seg || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    s = out.join('/');
  }
  return s.replace(/^\/+/, '');
}

/** 目录名：src/App.tsx → src；App.tsx → "" */
function dirOfRel(relPath: string): string {
  const s = (relPath || '').replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i > 0 ? s.slice(0, i) : '';
}
/** 文件基名去扩展名：src/pages/TerminalPage.tsx → TerminalPage */
function baseNameNoExt(relPath: string): string {
  const s = (relPath || '').replace(/\\/g, '/');
  const seg = s.slice(s.lastIndexOf('/') + 1);
  const i = seg.lastIndexOf('.');
  return i > 0 ? seg.slice(0, i) : seg;
}
export async function runExecutionFlowPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  // allCallEdges 保留全量（含同文件调用），仅用于「入口可达度」计算：
  // 同文件调用也是真实执行流的一部分，只用跨文件边会让可达度普遍偏低
  // （实测 web-craft 后端命令可达数普遍仅 3~4，Top N 排序被大量并列淹没、失去区分度）。
  let allCallEdges = pst.callEdges;
  // —— 构图与连通性一律用【全量边】（含 internal 同文件调用）——
  // 这是本轮「执行流画像画不出来」的最深根因：此前构图只用 cross-file 边，
  // 而 reach 用全量边，两套口径不一致。实测本仓 internal 边占全部调用边的 52.1%，
  // 丢掉它们后从真入口出发只能走到 89 个符号（92.7% 未接入），执行流整条断在
  // 第一跳——`main()` 调用同文件的 `setup()` 这条边根本不存在，链从起点就断了。
  // 改用全量边后可达 338 个、入图节点全部落在真实执行流上（未接入 0 个）。
  let edges = allCallEdges;

  // 自愈：与 runCallGraphPortrait 同思路——扫描漏跑 callGraph 阶段时主动重拉
  if (edges.length === 0) {
    try {
      await pst.analyzeCallGraph(analysisId, undefined);
      await pst.loadCallEdges(analysisId);
      allCallEdges = useProjectStore.getState().callEdges;
      edges = allCallEdges;
    } catch (err) {
      console.error('[runExecutionFlowPortrait] 自愈重拉 callGraph 失败', err);
    }
  }
  if (edges.length === 0) {
    return { ok: false, message: t('portrait.msg.flowNoData'), severity: 'info', placed: 0 };
  }

  const symbolById = new Map(pst.symbols.map((s) => [s.id, s]));

  // ── P0 清洗跨语言假边 ──
  // 调用图解析器按名字全库匹配、不区分语言作用域：Rust 的 .lines()/.ok() 被错配到前端同名符号。
  // web-craft 实测 945 条跨文件边里 174 条（18.4%）是 rust↔ts 假边，既画出不存在的
  // 「前端↔后端」连线，又污染入/出度。Rust 不可能静态调用 TS（反之亦然）→ 按语种族剔除。
  const rawEdgeCount = edges.length;
  const staticEdges = edges.filter((e) => {
    const a = langFamilyOf(e.callerFilePath);
    const b = langFamilyOf(e.calleeFilePath);
    return !a || !b || a === b;
  });
  const droppedCrossLang = rawEdgeCount - staticEdges.length;

  // ── 符号级入/出度 + 邻接表（执行流骨架，仅静态调用）──
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  const calleesOf = new Map<string, string[]>();
  const allSym = new Set<string>();
  for (const e of staticEdges) {
    if (e.callerSymbolId === e.calleeSymbolId) continue;
    allSym.add(e.callerSymbolId);
    allSym.add(e.calleeSymbolId);
    inDeg.set(e.calleeSymbolId, (inDeg.get(e.calleeSymbolId) || 0) + 1);
    outDeg.set(e.callerSymbolId, (outDeg.get(e.callerSymbolId) || 0) + 1);
    if (!calleesOf.has(e.callerSymbolId)) calleesOf.set(e.callerSymbolId, []);
    calleesOf.get(e.callerSymbolId)!.push(e.calleeSymbolId);
  }

  // ── FE→BE invoke 桥接：补出调用图看不见的「前端事件 → 后端命令」──
  // 前端 invoke('cmd') 是字符串派发，call_graph 跳过字面量 → 这条边在调用图里不存在。
  // 后端 #[tauri::command] 已作为符号入库（file+line），故扫描源码即可双向对齐。
  const symByFile = new Map<string, ProjectSymbol[]>();
  for (const s of pst.symbols) {
    if (!symByFile.has(s.fileId)) symByFile.set(s.fileId, []);
    symByFile.get(s.fileId)!.push(s);
  }
  const allFiles = pst.files.filter((f) => !f.isDirectory);
  // 项目相对路径 → 文件（导入修复与动态导入都靠它把说明符落到真实文件）
  const fileByRelPath = new Map<string, ProjectFile>();
  for (const f of allFiles) fileByRelPath.set(f.relPath.replace(/\\/g, '/'), f);
  const feFiles = allFiles.filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(f.relPath)).slice(0, 300);
  const beFiles = allFiles.filter((f) => /\.rs$/i.test(f.relPath)).slice(0, 300);

  // 后端命令名 → 符号（#[tauri::command] 惯例独立成行，故向下找最近的 fn NAME）
  const cmdByName = new Map<string, ProjectSymbol>();
  await mapLimit(beFiles, 16, async (f: ProjectFile) => {
    const lines = await readLines(f);
    if (!lines) return;
    for (let i = 0; i < lines.length; i++) {
      if (!TAURI_ATTR_RE.test(lines[i])) continue;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const m = lines[j].match(RUST_FN_RE);
        if (!m) continue;
        const list = symByFile.get(f.id) ?? [];
        const hit = list.find((x) => x.name === m[1]);
        if (hit) cmdByName.set(m[1], hit);
        break;
      }
    }
  });

  // 前端 invoke → 后端命令：合成跨语言派发边
  type InvokeEdge = { from: string; to: string; label: string };
  const invokeEdges: InvokeEdge[] = [];
  const seenInvoke = new Set<string>();
  // 全部 invoke 站点（含「所在文件无任何符号」的那些）。web-craft 实测 src/ 下 28/144 个
  // ts/tsx 文件零符号，其 invoke 无法挂到符号上 → 后面用主干上最后一个可表示组件兜底连到后端命令。
  const invokeSites: { fileId: string; targetId: string; cmd: string }[] = [];
  /** 动态导入边（文件级）：from 文件 id → to 文件 id */
  const dynamicImportEdges: { from: string; to: string }[] = [];
  await mapLimit(feFiles, 16, async (f: ProjectFile) => {
    const lines = await readLines(f);
    if (!lines) return;
    for (let i = 0; i < lines.length; i++) {
      // 动态 import('...')：与 invoke 同一次扫描，避免重复读盘
      if (/\bimport\s*\(/.test(lines[i])) {
        let dm: RegExpExecArray | null;
        DYNAMIC_IMPORT_RE.lastIndex = 0;
        while ((dm = DYNAMIC_IMPORT_RE.exec(lines[i])) !== null) {
          const spec = dm[1];
          const norm = normalizeImportPath(dirOfRel(f.relPath), spec);
          if (!norm) continue;
          const target =
            fileByRelPath.get(norm) ?? IMPORT_EXT_CANDIDATES.map((ext) => fileByRelPath.get(norm + ext)).find(Boolean);
          if (target && target.id !== f.id) dynamicImportEdges.push({ from: f.id, to: target.id });
        }
      }
      const m = lines[i].match(INVOKE_RE);
      if (!m) continue;
      const target = cmdByName.get(m[1]);
      if (!target) continue;
      invokeSites.push({ fileId: f.id, targetId: target.id, cmd: m[1] });
      const lineNo = i + 1;
      const list = symByFile.get(f.id) ?? [];
      // 取包含该 invoke 的最内层符号（行号落在 [lineStart, lineEnd] 内，取 lineStart 最大者）
      let owner: ProjectSymbol | undefined;
      for (const s of list) {
        if (s.lineStart <= lineNo && (s.lineEnd || s.lineStart) >= lineNo) {
          if (!owner || s.lineStart >= owner.lineStart) owner = s;
        }
      }
      if (!owner || owner.id === target.id) continue;
      const key = `${owner.id}->${target.id}`;
      if (seenInvoke.has(key)) continue;
      seenInvoke.add(key);
      invokeEdges.push({ from: owner.id, to: target.id, label: `invoke('${m[1]}')` });
    }
  });

  // 桥接边并入图：参与度数与深度计算，使后端命令不再是被孤立的死叶
  for (const ie of invokeEdges) {
    allSym.add(ie.from);
    allSym.add(ie.to);
    outDeg.set(ie.from, (outDeg.get(ie.from) || 0) + 1);
    inDeg.set(ie.to, (inDeg.get(ie.to) || 0) + 1);
    if (!calleesOf.has(ie.from)) calleesOf.set(ie.from, []);
    calleesOf.get(ie.from)!.push(ie.to);
  }

  // ── 前端渲染主干：补出「应用入口 → … → 发起 invoke 的前端函数」这条链路 ──
  // React 组件靠 JSX 渲染（<App/>），不是函数调用 → 调用图里根本没有这条主干，
  // 实测 web-craft 的 T0 入口（main.tsx 的 root）可达数只有个位数。
  // 这里改用「导入关系」补：静态导入（含被误判 external 的修复）+ 动态 import()，
  // 正向 BFS 求「入口 → 跨界文件」最短路径，只保留这条主干（避免把整棵组件树倒进来变毛线团）。
  const importAdj = new Map<string, string[]>();
  const addImportEdge = (from: string, to: string) => {
    if (!from || !to || from === to) return;
    if (!importAdj.has(from)) importAdj.set(from, []);
    const arr = importAdj.get(from)!;
    if (!arr.includes(to)) arr.push(to);
  };
  const fileById = new Map(allFiles.map((f) => [f.id, f]));
  // ① 静态导入：修复被误判为 external 的项目内相对导入（metadata.resolved 补扩展名反查）
  for (const d of pst.dependencies ?? []) {
    let toFileId: string | null = fileById.has(d.toId) ? d.toId : null;
    if (!toFileId) {
      let resolved = '';
      try {
        resolved = (JSON.parse(d.metadata || '{}') as { resolved?: string }).resolved ?? '';
      } catch {
        resolved = '';
      }
      const fromFile = fileById.get(d.fromId);
      if (!resolved || !fromFile) continue;
      const norm = normalizeImportPath(dirOfRel(fromFile.relPath), resolved);
      if (!norm) continue;
      const cand =
        fileByRelPath.get(norm) ?? IMPORT_EXT_CANDIDATES.map((ext) => fileByRelPath.get(norm + ext)).find(Boolean);
      if (!cand) continue;
      toFileId = cand.id;
    }
    addImportEdge(d.fromId, toFileId);
  }
  // ② 动态 import()（main.tsx 用 await import('./App') 拉起根组件）
  for (const e of dynamicImportEdges) addImportEdge(e.from, e.to);

  // 跨界文件 = 含 invoke 桥接起点的前端文件；入口文件 = main/App/router
  const crossFileIds = new Set<string>();
  for (const ie of invokeEdges) {
    const s = symbolById.get(ie.from);
    if (s?.fileId) crossFileIds.add(s.fileId);
  }
  // 无符号文件里的 invoke 站点也算跨界（靠主干兜底连到后端）
  for (const site of invokeSites) crossFileIds.add(site.fileId);
  const entryFileIds = allFiles
    .filter(
      (f) =>
        /\/(main|App)\.(tsx|ts)$/i.test('/' + f.relPath) ||
        /\bmain\.rs$/i.test(f.relPath) ||
        /\/(router|routes)\.(tsx|ts)$/i.test('/' + f.relPath),
    )
    .map((f) => f.id);

  // 正向 BFS：入口 → … → 跨界文件，parent 记录最短路径
  const parentOf = new Map<string, string | null>();
  const visitedFile = new Set<string>();
  const fileQueue: string[] = [];
  for (const eid of entryFileIds) {
    if (!visitedFile.has(eid)) {
      visitedFile.add(eid);
      parentOf.set(eid, null);
      fileQueue.push(eid);
    }
  }
  const reachedCross = new Set<string>();
  while (fileQueue.length) {
    const u = fileQueue.shift()!;
    if (crossFileIds.has(u)) reachedCross.add(u);
    for (const v of importAdj.get(u) ?? []) {
      if (visitedFile.has(v)) continue;
      visitedFile.add(v);
      parentOf.set(v, u);
      fileQueue.push(v);
    }
  }

  // 文件 → 代表符号：优先与文件同名的组件（TerminalPage.tsx → TerminalPage），否则取行跨度最大的函数
  const repOf = (fileId: string): ProjectSymbol | undefined => {
    const file = fileById.get(fileId);
    const list = (symByFile.get(fileId) ?? []).filter((s) => s.kind === 'function' || s.kind === 'component');
    if (list.length === 0) return undefined;
    const want = baseNameNoExt(file?.relPath ?? '').toLowerCase();
    const same = list.find((s) => (s.name || '').toLowerCase() === want);
    if (same) return same;
    return list.slice().sort((a, b) => b.lineEnd - b.lineStart - (a.lineEnd - a.lineStart))[0];
  };

  const renderEdges: { from: string; to: string }[] = [];
  const seenRender = new Set<string>();
  const pushRender = (from: string, to: string) => {
    if (!from || !to || from === to) return;
    const key = `${from}->${to}`;
    if (seenRender.has(key)) return;
    seenRender.add(key);
    renderEdges.push({ from, to });
  };
  // 兜底 invoke 边：跨界文件自身零符号时，用主干上最后一个可表示组件直接连后端命令
  const trunkInvoke: { from: string; to: string; label: string }[] = [];
  for (const crossId of reachedCross) {
    const path: string[] = [];
    let cur: string | null | undefined = crossId;
    while (cur) {
      path.push(cur);
      cur = parentOf.get(cur) ?? null;
    }
    path.reverse();
    for (let i = 0; i + 1 < path.length; i++) {
      const a = repOf(path[i]);
      const b = repOf(path[i + 1]);
      if (a && b) pushRender(a.id, b.id);
    }
    // 末段：跨界文件的代表符号 → 真正发起 invoke 的函数（接上 invoke 桥接边）
    if (path[path.length - 1] === crossId) {
      const rep = repOf(crossId);
      if (rep) {
        for (const ie of invokeEdges) {
          const owner = symbolById.get(ie.from);
          if (owner && owner.fileId === crossId) pushRender(rep.id, owner.id);
        }
      }
    }
    // 锚点 = 路径上最后一个能取到代表符号的文件（自深向浅找），零符号文件的 invoke 挂到它身上
    let anchor: ProjectSymbol | undefined;
    for (let i = path.length - 1; i >= 0; i--) {
      const r = repOf(path[i]);
      if (r) {
        anchor = r;
        break;
      }
    }
    if (anchor) {
      for (const site of invokeSites) {
        if (site.fileId !== crossId || anchor.id === site.targetId) continue;
        const key = `${anchor.id}->${site.targetId}`;
        if (seenInvoke.has(key)) continue;
        seenInvoke.add(key);
        trunkInvoke.push({ from: anchor.id, to: site.targetId, label: `invoke('${site.cmd}')` });
      }
    }
  }
  for (const ti of trunkInvoke) invokeEdges.push(ti);
  // 渲染主干并入图
  for (const re of renderEdges) {
    allSym.add(re.from);
    allSym.add(re.to);
    outDeg.set(re.from, (outDeg.get(re.from) || 0) + 1);
    inDeg.set(re.to, (inDeg.get(re.to) || 0) + 1);
    if (!calleesOf.has(re.from)) calleesOf.set(re.from, []);
    calleesOf.get(re.from)!.push(re.to);
  }
  // 兜底 invoke 边并入图（invokeEdges 的合并循环在前面已跑过，这里补合并）
  for (const ti of trunkInvoke) {
    allSym.add(ti.from);
    allSym.add(ti.to);
    outDeg.set(ti.from, (outDeg.get(ti.from) || 0) + 1);
    inDeg.set(ti.to, (inDeg.get(ti.to) || 0) + 1);
    if (!calleesOf.has(ti.from)) calleesOf.set(ti.from, []);
    calleesOf.get(ti.from)!.push(ti.to);
  }

  if (allSym.size === 0) {
    return { ok: false, message: t('portrait.msg.flowNoData'), severity: 'info', placed: 0 };
  }

  // ── 入口点识别（框架感知分层，取代「入度 0 即入口」）──
  const tierOf = new Map<string, 'T0' | 'T1' | 'T2'>();
  // T1 边界入口：后端 Tauri 命令（前端跨语言调用的真正落点）
  for (const s of cmdByName.values()) {
    tierOf.set(s.id, 'T1');
  }
  // T2 前端事件入口：**命名启发式已被实测证伪**（本仓 738 个「入度 0」种子里
  // 694 个是伪入口，样例 get_executed_migrations / generate_etag / json_to_sql_value
  // 全是普通工具函数）。故 T2 不再单看 `on*/handle*` 前缀，改为**图结构**判定：
  // 无调用者 + 有下游 + 且实际能驱动足够多的下游（reach 阈值）。
  // 这与污点画像入口选择的既有结论一致：入口必须由可达性证明，不能靠名字猜。
  const T2_MIN_REACH = 3;
  // 先按旧规则收集候选，稍后用 reach 过滤（reach 需在 fullCallees 就绪后才算得出）
  const t2Candidates: string[] = [];
  for (const sid of allSym) {
    const sym = symbolById.get(sid);
    if (!sym) continue;
    const p = sym.filePath ?? '';
    const name = sym.name ?? '';
    const outd = outDeg.get(sid) || 0;
    const ind = inDeg.get(sid) || 0;
    const base = '/' + p;
    const appEntryFile =
      /\bmain\.rs$/i.test(p) ||
      /\/(main|App)\.(tsx|ts|jsx|js)$/i.test(base) ||
      /\/(router|routes)\.(tsx|ts)$/i.test(base);
    const isFrontend = langFamilyOf(p) === 'tsjs';
    if (appEntryFile && (outd > 0 || /^(main|App|bootstrap|default)$/i.test(name))) {
      // T0 应用入口：文件级约定（main.rs / main.tsx / App.tsx / router），是硬证据
      tierOf.set(sid, 'T0');
    } else if (isFrontend && ind === 0 && outd > 0 && /^(on|handle)[A-Z]/.test(name)) {
      t2Candidates.push(sid);
    }
  }
  let entryIds = new Set(tierOf.keys());

  // ── 可达性判定：直接复用 `calleesOf` 作为单一真相源 ──
  // calleesOf 此刻已含「全量调用边（含同文件） + invoke 桥接 + render 主干」，
  // 与构图完全同一口径。此前这里另建 fullCallees 却只喂 allCallEdges，
  // 两套邻接表不一致正是「reach 算得出来、执行流却走不通」的根源。
  // 提前到入口识别之前：T2 必须由「实际能驱动多少下游」证明，而这依赖邻接表。
  const fullCallees = calleesOf;
  /** 从某节点出发能触达的下游节点数（不含自身） */
  const reachFrom = (root: string): number => {
    const seen = new Set<string>([root]);
    const q: string[] = [root];
    while (q.length) {
      const u = q.shift()!;
      for (const v of fullCallees.get(u) ?? []) {
        if (seen.has(v)) continue;
        seen.add(v);
        q.push(v);
      }
    }
    return seen.size - 1;
  };

  // T2 过滤：只有真能驱动下游的候选才算事件入口。
  // 本仓实测：508 个「入度 0」种子出度仅 1（只调一个跨文件函数），
  // 把它们当入口会把 60% 的节点塞进 depth=0 列、纵向撑爆画布。
  for (const sid of t2Candidates) {
    if (reachFrom(sid) >= T2_MIN_REACH) tierOf.set(sid, 'T2');
  }
  entryIds = new Set(tierOf.keys());

  // ── 执行顺序：以**真入口**为根的最短路径深度 ──
  // depth=0 即入口列，向右递增 = 调用逐级深入，整图读作「左进右出」的执行走线。
  //
  // 两处修正（本仓实测根因）：
  //  ① 种子不再包含「入度 0」的全体符号 —— 那会把 738 个伪入口（94% 不是入口）
  //     全部铺到第 0 列，纵向需 6766px 而画布仅 4096px，fit 视口后整图缩成一条线。
  //  ② 由「最长路径」改为「最短路径」—— 最长路径会被调用链随意拉长，
  //     语义上也不表示「从入口读下来第几步」。
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const id of entryIds)
    if (!depth.has(id)) {
      depth.set(id, 0);
      queue.push(id);
    }
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++]; // 数组 + 游标代替 shift()，避免 O(N²)
    const base = depth.get(u) ?? 0;
    for (const v of calleesOf.get(u) ?? []) {
      // 最短路径：首次到达即定层，不再用 nd > depth 反复松弛
      if (!depth.has(v)) {
        depth.set(v, base + 1);
        queue.push(v);
      }
    }
  }
  // 不可达任何入口的节点：归入末列，并在节点上标注「未接入」
  // （用户选定：保留可见但明确标注，而非直接丢弃——信息不丢，也不再污染入口列）
  let maxD = 0;
  for (const v of depth.values()) if (v > maxD) maxD = v;
  const UNREACHED_LAYER = maxD + 1;
  const unreachedIds = new Set<string>();
  for (const sid of allSym) {
    if (!depth.has(sid)) {
      depth.set(sid, UNREACHED_LAYER);
      unreachedIds.add(sid);
    }
  }

  // ── 入口可达度：每个入口能触达多少下游节点（正面回答「从哪个入口开始读」）──
  const reachOf = new Map<string, number>();
  for (const eid of entryIds) reachOf.set(eid, reachFrom(eid));

  // T1 命令若既不参与调用图、又完全不触达下游（可达 0），对「从哪里开始读」没有价值 → 不标为入口。
  // 反之，可达度高的命令即使不在跨文件图里也要纳入渲染（可达数证明它驱动着真实代码，
  // 例如 web-craft 的 build_llm_provider 可达 71 个下游节点，是最值得先读的入口之一）。
  for (const id of Array.from(tierOf.keys())) {
    if (tierOf.get(id) === 'T1' && !allSym.has(id) && (reachOf.get(id) ?? 0) === 0) tierOf.delete(id);
  }
  for (const id of tierOf.keys()) allSym.add(id);
  entryIds.clear();
  for (const id of tierOf.keys()) entryIds.add(id);

  // ── 节点选取：硬上限防马赛克 ──
  // 排序键：「是否接入执行流 → 入口分层 → 可达度 → 中心度」。
  //
  // **「是否接入执行流」必须是第一键**（本仓实测根因）：reachOf 只对 entryIds 填充，
  // 非入口符号的 reach 恒为 0，于是「按 reach 排序」对占绝大多数的非入口完全失效，
  // 实际退化成纯按度数排序 → 选入 176 个与任何入口都不连通的高热度节点，
  // 1544 条构图边只有 395 条（25.6%）两端都入图，图碎成一堆散点。
  const FLOW_LIMIT = 220;
  const TIER_RANK: Record<string, number> = { T0: 0, T1: 1, T2: 2 };
  const scored = Array.from(allSym).map((sid) => ({
    sid,
    entry: entryIds.has(sid),
    tier: tierOf.get(sid) ?? null,
    deg: (inDeg.get(sid) || 0) + (outDeg.get(sid) || 0),
    reach: reachOf.get(sid) ?? 0,
    unreached: unreachedIds.has(sid),
  }));
  scored.sort((a, b) => {
    const ua = a.unreached ? 1 : 0;
    const ub = b.unreached ? 1 : 0;
    const ta = a.tier ? (TIER_RANK[a.tier] ?? 3) : 3;
    const tb = b.tier ? (TIER_RANK[b.tier] ?? 3) : 3;
    return ua - ub || ta - tb || b.reach - a.reach || b.deg - a.deg;
  });
  const kept = scored.slice(0, FLOW_LIMIT);
  const keptSet = new Set(kept.map((k) => k.sid));

  // ── 拓扑分层布局（入口列在左，底座在右）──
  // maxRowsPerLayer=28：单层超过 28 个就横向分列。分层布局原本每层只是一根垂直单列，
  // 节点一多纵向就远超画布（本仓 depth=0 曾堆到 104 个 → 该列 6766px vs 画布 4096px），
  // fit 视口后整图缩成一条线，这就是「执行流画像画不出来」的直接观感。
  // 28 是本仓最大层的节点数（再往上加无收益，实测 28/32/36/40 结果完全相同）。
  // layerGap 由 200 降到 120：13 层 × (列宽224 + 间距) 是宽度主因，压到 120 后
  // 整图 4418×2065，fit 缩放从修复前的约 0.13 提升到约 0.36（节点从 26px 宽到 72px，可读）。
  const SYM_W = 200;
  const SYM_H = 50;
  const layoutNodes = kept.map((k) => ({ id: k.sid, weight: k.deg }));
  const posMap = layeredLayout(layoutNodes, depth, {
    width: 4096,
    height: 4096,
    originX: 90,
    originY: 110,
    nodeWidth: SYM_W,
    nodeHeight: SYM_H,
    layerGap: 120,
    nodeGap: 14,
    maxRowsPerLayer: 28,
  });

  clearCanvas();

  // ── 「从这里开始读」：入口按 分层 → 可达度 排序取前 6，直接回答「该从哪个入口分析」──
  const topEntries = Array.from(entryIds)
    .map((id) => ({
      id,
      name: symbolById.get(id)?.name ?? id,
      tier: tierOf.get(id) ?? 'T2',
      reach: reachOf.get(id) ?? 0,
    }))
    .sort((a, b) => (TIER_RANK[a.tier] ?? 3) - (TIER_RANK[b.tier] ?? 3) || b.reach - a.reach)
    .slice(0, 6);
  const startHere = topEntries.map((e) => `${e.name}·${e.reach}`).join(' → ');
  const invokePlaced = invokeEdges.filter((ie) => keptSet.has(ie.from) && keptSet.has(ie.to)).length;
  const renderPlaced = renderEdges.filter((re) => keptSet.has(re.from) && keptSet.has(re.to)).length;
  const flowUnreached = kept.filter((k) => k.unreached).length;

  // 左上角图例：读法 + 数据修正说明 + 「从这里开始读」
  const legendParts = [
    t('portrait.msg.flowLegendHint'),
    droppedCrossLang > 0 ? t('portrait.msg.flowClean', { n: droppedCrossLang }) : '',
    invokePlaced > 0 ? t('portrait.msg.flowBridge', { n: invokePlaced }) : '',
    renderPlaced > 0 ? t('portrait.msg.flowRender', { n: renderPlaced }) : '',
    flowUnreached > 0 ? t('portrait.msg.flowUnreached', { n: flowUnreached }) : '',
    startHere ? t('portrait.msg.flowStartHere', { list: startHere }) : '',
  ].filter(Boolean);
  place('layer-marker', { x: 40, y: 40 }, t('portrait.msg.flowLegend'), {
    layerName: t('portrait.msg.flowLegend'),
    layerColor: '#22c55e',
    layerOrder: 0,
    fileCount: entryIds.size,
    description: legendParts.join('\n'),
    portraitMode: 'executionFlow',
  });

  const placedPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const k of kept) {
    const p = posMap.get(k.sid);
    if (!p) continue;
    const sym = symbolById.get(k.sid);
    place(
      'function',
      { x: p.x, y: p.y },
      sym?.name ?? k.sid,
      {
        name: sym?.name ?? k.sid,
        symbolKind: sym?.kind ?? 'function',
        fileId: sym?.fileId ?? null,
        filePath: sym?.filePath ?? null,
        lineStart: sym?.lineStart ?? null,
        symbolId: k.sid,
        portraitMode: 'executionFlow',
        isEntry: k.entry,
        entryTier: k.tier ?? undefined,
        entryReach: k.entry ? (reachOf.get(k.sid) ?? 0) : undefined,
        // 未接入任何入口：末列单独成区，节点上可见，不与真入口混淆
        unreachable: k.unreached ? true : undefined,
        callIn: inDeg.get(k.sid) ?? 0,
        callOut: outDeg.get(k.sid) ?? 0,
      },
      { w: SYM_W, h: SYM_H },
    );
    placedPos.set(k.sid, { x: p.x, y: p.y, w: SYM_W, h: SYM_H });
  }

  // ── 画「每一条线」：所有落在已选节点之间的静态调用边（已剔除跨语言假边）──
  let edgeCount = 0;
  for (const e of staticEdges) {
    if (e.callerSymbolId === e.calleeSymbolId) continue;
    if (!keptSet.has(e.callerSymbolId) || !keptSet.has(e.calleeSymbolId)) continue;
    const a = placedPos.get(e.callerSymbolId)!;
    const b = placedPos.get(e.calleeSymbolId)!;
    connect(a, b, `${e.callerName} → ${receiverQualifiedName(e.calleeName, e.calleeReceiver)}`, {
      depType: 'call',
      isCircular: false,
      fromFileId: e.callerFileId,
      toFileId: e.calleeFileId,
      symbolNames: [receiverQualifiedName(e.calleeName, e.calleeReceiver)],
      callCount: 1,
      portraitMode: 'executionFlow',
    });
    edgeCount += 1;
  }

  // ── 跨语言派发边（invoke）：前端事件 → 后端 #[tauri::command]，琥珀虚线 ──
  let invokeCount = 0;
  for (const ie of invokeEdges) {
    if (!keptSet.has(ie.from) || !keptSet.has(ie.to)) continue;
    const a = placedPos.get(ie.from)!;
    const b = placedPos.get(ie.to)!;
    connect(a, b, ie.label, {
      depType: 'invoke',
      isCircular: false,
      symbolNames: [ie.label],
      callCount: 1,
      portraitMode: 'executionFlow',
    });
    invokeCount += 1;
  }

  // ── 组件渲染主干（render）：应用入口 → 页面 → 组件 → 发起 invoke 的函数，青虚线 ──
  let renderCount = 0;
  for (const re of renderEdges) {
    if (!keptSet.has(re.from) || !keptSet.has(re.to)) continue;
    const a = placedPos.get(re.from)!;
    const b = placedPos.get(re.to)!;
    connect(a, b, `${symbolById.get(re.from)?.name ?? ''} → ${symbolById.get(re.to)?.name ?? ''}`, {
      depType: 'render',
      isCircular: false,
      symbolNames: [],
      callCount: 1,
      portraitMode: 'executionFlow',
    });
    renderCount += 1;
  }

  await persist(analysisId, 'executionFlow');

  const truncated = kept.length < allSym.size;
  const extra = [
    droppedCrossLang > 0 ? t('portrait.msg.flowClean', { n: droppedCrossLang }) : '',
    invokeCount > 0 ? t('portrait.msg.flowBridge', { n: invokeCount }) : '',
    renderCount > 0 ? t('portrait.msg.flowRender', { n: renderCount }) : '',
    startHere ? t('portrait.msg.flowStartHere', { list: startHere }) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    ok: true,
    message: [
      t('portrait.msg.flowDone', {
        n: kept.length,
        edges: edgeCount,
        entries: entryIds.size,
        trunc: truncated ? t('portrait.msg.flowTrunc', { total: allSym.size, keep: kept.length }) : '',
      }),
      extra,
    ]
      .filter(Boolean)
      .join(' '),
    severity: 'success',
    placed: kept.length,
  };
}
