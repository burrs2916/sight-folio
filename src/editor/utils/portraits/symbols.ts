/**
 * 符号结构画像
 *
 * runSymbolsPortrait（符号级实体按文件分组）；hasLegacySymbolBands 兼容检测。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas } from './canvas';
import { buildTreeGuide } from './shared';
import { type PortraitMode, type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { type ProjectSymbol } from '../../../services/tauri';
import { useEditorStore, type BulkComponentInput } from '../../../store/editorStore';
import { useProjectStore } from '../../../store/projectStore';
import { buildDirectoryTree, flattenDirectoryTree } from '.././directoryTree';
import { entityTypeForFile } from '.././fileKind';
import { entityTypeForSymbolKind, MAX_SYMBOLS_PER_FILE } from '.././symbolLayout';


// ───────────────────────── 代码结构画像 ─────────────────────────

/**
 * 代码结构画像：把分析出的符号（class/function/interface/struct/enum/trait...）
 * 渲染成符号级画布实体，每个文件一组（分组头 + 一行符号卡片）。
 *
 * 需求「扫描项目要分析…代码结构」的画布落点 —— 此前符号数据只存在于左侧
 * 面板列表里，画布上没有任何符号实体。这也是本轮「实体补充」的核心：
 * ClassRenderer / FunctionRenderer / InterfaceRenderer 三个渲染器早已注册，
 * 但从没有代码用真实符号数据创建过对应实体（挂着不通电）。
 *
 * 业务联动（不只是静态画像）：
 * - 每个符号实体 config 带 fileId → 选中符号时，所属文件 + 该文件依赖邻居
 *   自动高亮（复用画布 fileId 联动机制）；
 * - 双击符号实体 → 打开源码并定位到符号定义行（lineStart）。
 */
export async function runSymbolsPortrait(
  analysisId: string,
  _filter?: { query?: string; kinds?: string[] },
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  if (pst.symbols.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.symNoData'),
      severity: 'info',
      placed: 0,
    };
  }

  // v2.14 范式：项目目录树 + 符号叶子（用户建议「代码结构在目录树基础上扩展」）。
  // 画布 = 目录树（folder/file 实体 + 树形引导线，与左侧目录树同一套心智）；
  // 文件行显示符号数徽标；双击文件展开/收起其符号卡（expandedSymFiles）。
  // 默认全部折叠 → 画布 = 干净的目录树；按需展开看符号 —— 不再一次画几百个实体。
  const root = buildDirectoryTree({
    files: pst.files,
    metrics: pst.metrics,
    techDebt: pst.techDebt,
    findings: pst.findings,
    clones: pst.clones,
  });
  if (!root) {
    return { ok: false, message: t('portrait.msg.dirNoScan'), severity: 'info', placed: 0 };
  }
  const flat = flattenDirectoryTree(root, { maxDepth: 4, maxNodes: 160, minFiles: 1, sort: 'size' });
  const nodes = flat.nodes;
  if (nodes.length <= 1) {
    return { ok: false, message: t('portrait.msg.dirNoDepth'), severity: 'info', placed: 0 };
  }

  // 符号按文件分组 + import 引用计数（文件徽标/符号卡引用数，口径与 buildSymbolLayout 一致）
  const symsByFile = new Map<string, ProjectSymbol[]>();
  const refCountBySymbol = new Map<string, number>();
  for (const r of pst.symbolRefs) {
    if (!r.toSymbolId || r.kind !== 'import') continue;
    refCountBySymbol.set(r.toSymbolId, (refCountBySymbol.get(r.toSymbolId) ?? 0) + 1);
  }
  for (const sym of pst.symbols) {
    const arr = symsByFile.get(sym.fileId);
    if (arr) arr.push(sym);
    else symsByFile.set(sym.fileId, [sym]);
  }

  const expanded = useEditorStore.getState().expandedSymFiles;
  clearCanvas();

  const LEFT = 40;
  const TOP = 40;
  const INDENT = 34;
  const DIR_H = 52;
  const FILE_H = 44;
  const SYM_H = 64;
  const ROW_GAP = 8;
  const SYM_W = 240;
  const MIN_W = 190;
  const MAX_W = 470;
  const MAX_FILE_LEAVES = 600;
  const MAX_FILES_PER_DIR = 20;
  const maxLines = Math.max(...nodes.map((n) => n.totalLines), 1);

  const dirOf = (relPath: string) => {
    const i = relPath.lastIndexOf('/');
    return i < 0 ? '' : relPath.slice(0, i);
  };
  const filesByDir = new Map<string, typeof pst.files>();
  for (const f of pst.files) {
    if (f.isDirectory) continue;
    const d = dirOf(f.relPath);
    const arr = filesByDir.get(d);
    if (arr) arr.push(f);
    else filesByDir.set(d, [f]);
  }

  interface LaidOutRow {
    x: number;
    y: number;
    w: number;
    h: number;
    parentPath: string | null;
    path: string;
  }
  const items: BulkComponentInput[] = [];
  const rows: LaidOutRow[] = [];
  const rowIndexByPath = new Map<string, number>();
  const parentPathOf = (p: string): string | null => {
    if (!p) return null;
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  };

  let fileLeaves = 0;
  let cursorY = TOP;
  let symPlaced = 0;
  let expandedCount = 0;

  for (const n of nodes) {
    const x = LEFT + n.depth * INDENT;
    const y = cursorY;
    cursorY += DIR_H + ROW_GAP;
    const ratio = Math.sqrt(n.totalLines / maxLines);
    const w = Math.round(MIN_W + (MAX_W - MIN_W) * ratio);
    rowIndexByPath.set(n.path, rows.length);
    rows.push({ x, y, w, h: DIR_H, parentPath: n === root ? null : parentPathOf(n.path), path: n.path });
    items.push({
      type: 'folder',
      name: n.name,
      x,
      y,
      width: w,
      height: DIR_H,
      locked: true,
      config: {
        name: n.name,
        dirPath: n.path,
        depth: n.depth,
        childCount: n.directFiles + n.childDirCount,
        directFiles: n.directFiles,
        childDirCount: n.childDirCount,
        fileCount: n.fileCount,
        totalLines: n.totalLines,
        avgComplexity: n.avgComplexity,
        maxComplexity: n.maxComplexity,
        complexityLevel: n.complexityLevel,
        techDebtCount: n.techDebtCount,
        findingCount: n.findingCount,
        cloneCount: n.cloneCount,
        dominantLanguage: n.dominantLanguage,
        languageShare: n.languages.slice(0, 4),
        portraitMode: 'symbols' as PortraitMode,
        dirSymbolTree: true,
      },
    });

    if (fileLeaves < MAX_FILE_LEAVES) {
      const dirFiles = filesByDir.get(n.path);
      if (dirFiles && dirFiles.length > 0) {
        for (const f of dirFiles.slice(0, MAX_FILES_PER_DIR)) {
          if (fileLeaves >= MAX_FILE_LEAVES) break;
          const entityType = entityTypeForFile(f);
          const isImg = entityType === 'image';
          const rowH = isImg ? 112 : FILE_H;
          const rowW = Math.max(160, w - INDENT);
          const fx = LEFT + (n.depth + 1) * INDENT;
          const fy = cursorY;
          cursorY += rowH + ROW_GAP;
          fileLeaves += 1;
          const filePathKey = `${n.path}\u0000${f.relPath}`;
          rowIndexByPath.set(filePathKey, rows.length);
          rows.push({ x: fx, y: fy, w: rowW, h: rowH, parentPath: n.path, path: filePathKey });
          const syms = symsByFile.get(f.id) ?? [];
          items.push({
            type: entityType,
            name: f.name,
            x: fx,
            y: fy,
            width: isImg ? Math.min(rowW, 168) : rowW,
            height: rowH,
            locked: true,
            config: {
              fileName: f.name,
              filePath: f.relPath,
              language: f.language,
              fileSize: f.size,
              lineCount: f.lineCount ?? 0,
              fileId: f.id,
              symbolCount: syms.length,
              // v2.14 展开标记：双击文件展开/收起符号
              expandableFile: true,
              symbolDrillFile: f.id,
              expanded: expanded.has(f.id),
              portraitMode: 'symbols' as PortraitMode,
            },
          });

          // 展开符号：该文件的符号卡（前 MAX_SYMBOLS_PER_FILE 个，按引用降序）
          if (expanded.has(f.id)) {
            expandedCount += 1;
            const shown = [...syms]
              .sort((a, b) => (refCountBySymbol.get(b.id) ?? 0) - (refCountBySymbol.get(a.id) ?? 0))
              .slice(0, MAX_SYMBOLS_PER_FILE);
            for (const sym of shown) {
              const sx = LEFT + (n.depth + 2) * INDENT;
              const sy = cursorY;
              cursorY += SYM_H + ROW_GAP;
              const symPath = `sym:${sym.id}`;
              rowIndexByPath.set(symPath, rows.length);
              rows.push({ x: sx, y: sy, w: SYM_W, h: SYM_H, parentPath: filePathKey, path: symPath });
              items.push({
                type: entityTypeForSymbolKind(sym.kind),
                name: sym.name,
                x: sx,
                y: sy,
                width: SYM_W,
                height: SYM_H,
                locked: true,
                config: {
                  name: sym.name,
                  symbolId: sym.id,
                  symbolKind: sym.kind,
                  fileId: sym.fileId,
                  fileName: f.name,
                  filePath: sym.filePath,
                  lineStart: sym.lineStart,
                  lineEnd: sym.lineEnd,
                  signature: sym.signature,
                  refCount: refCountBySymbol.get(sym.id) ?? 0,
                  portraitMode: 'symbols' as PortraitMode,
                },
              });
              symPlaced += 1;
            }
          }
        }
      }
    }
  }

  // 树形引导线：父竖干 + 子横枝（单 SVG 实体，压在实体底下）
  const guide = buildTreeGuide(rows, rowIndexByPath, INDENT);
  if (guide) {
    guide.locked = true;
    items.unshift(guide);
  }

  const ids = useEditorStore.getState().addComponentsBulk(items);
  await persist(analysisId, 'symbols');

  return {
    ok: true,
    message: t('portrait.msg.symTreeDone', {
      dirs: nodes.length,
      files: fileLeaves,
      syms: symPlaced,
      exp: expandedCount > 0 ? t('portrait.msg.symTreeExpanded', { n: expandedCount }) : '',
    }),
    severity: 'success',
    placed: ids.length,
  };
}

/**
 * v2.12 旧版符号画像横带检测：旧版（2026-08-19 前）layer-marker 的 layerName 是
 * `目录 src-tauri/src/app · 40/135 符号` / `licensing.ts · 3/3 符号`（`a/b 符号` 旧模板），
 * 且 place 未传 size → 实体以注册默认 300×40 落库，横带与下一行内容重叠。
 * 新代码输出 `symBandSub`（`{path} · {b} 符号 · 画布 {a}`）副行 + 精确尺寸，不含 `/` 分隔。
 * 命中旧格式 → 提示/触发一次自动重建（新布局）。
 */
export function hasLegacySymbolBands(components: { type?: string; config?: Record<string, unknown> }[]): boolean {
  return components.some(
    (c) =>
      c.type === 'layer-marker' &&
      typeof c.config?.layerName === 'string' &&
      /\d+\/\d+\s*符号/.test(c.config.layerName as string),
  );
}
