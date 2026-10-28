/**
 * 网格度量画像
 *
 * TEST_RE + MetricRow/metricInsight/renderMetricPortrait + 测试覆盖/巴士因子/涟漪/文档覆盖。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist } from './canvas';
import { PORTRAIT_THRESHOLDS } from './constants';
import { currentInsights, fileConfig } from './shared';
import { type PortraitKind, type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { type ProjectFile, type ProjectSymbol } from '../../../services/tauri';
import { useEditorStore, type BulkComponentInput } from '../../../store/editorStore';
import { useProjectStore } from '../../../store/projectStore';
import { emptyFileInsight, type FileInsight } from '.././fileInsights';


/* ============================================================================
 * 新增画像：测试覆盖 / 安全 / 接口暴露面 / 责任人(bus-factor) / 涟漪影响面 /
 * 文档覆盖 / 错误处理
 *
 * 设计约定（与既有画像一致，避免重蹈 O(N²) 覆辙）：
 * - 一律先算出 rows，再一次性 addComponentsBulk 落库（不在循环里 addComponent）。
 * - 每个实体通过 fileConfig 的 extra 注入 accentColor / metricBadge / metricTitle，
 *   由 FileRenderer 统一据此精准着色与标注，不新增渲染器分支。
 * - 源码扫描类画像（安全 / 接口 / 错误处理）用 readSourceFile 按需读行，
 *   受并发上限保护，避免一次性把几百个文件内容灌进主线程。
 * ========================================================================== */

const TEST_RE = /\b(__tests__|tests?|spec|__mocks__)\b|[-_.](test|spec)\.|(?:^|[/_])(?:test|spec)_/i;

export interface MetricRow {
  file: ProjectFile;
  ins: FileInsight;
  accentColor: string;
  metricBadge: string;
  metricTitle: string;
}

/** 取文件洞察，并把复杂度清零，避免复杂度色条盖掉新画像的 accent 色条 */
export function metricInsight(f: ProjectFile, insights: Map<string, FileInsight>): FileInsight {
  const base = insights.get(f.id) ?? emptyFileInsight();
  const ins = { ...base } as FileInsight;
  ins.complexity = 0;
  return ins;
}

/** 通用网格式画像渲染：rows → 一次性 bulk 落库 → 持久化 + 自适应视口 */
export async function renderMetricPortrait(
  kind: PortraitKind,
  analysisId: string,
  rows: MetricRow[],
  opts: {
    cols: number;
    colW: number;
    rowH: number;
    emptyHint: string;
    summarize: (rows: MetricRow[]) => string;
  },
): Promise<PortraitOutcome> {
  if (rows.length === 0) {
    return { ok: false, message: opts.emptyHint, severity: 'info', placed: 0 };
  }
  const items: BulkComponentInput[] = rows.map((r, i) => {
    const col = i % opts.cols;
    const row = Math.floor(i / opts.cols);
    return {
      type: 'file',
      name: r.file.name,
      x: 40 + col * opts.colW,
      y: 40 + row * opts.rowH,
      config: fileConfig(r.file, r.ins, kind, {
        accentColor: r.accentColor,
        metricBadge: r.metricBadge,
        metricTitle: r.metricTitle,
        rank: i + 1,
      }),
    };
  });
  useEditorStore.setState((s: any) => {
    s.components = [];
  });
  const ids = useEditorStore.getState().addComponentsBulk(items);
  await persist(analysisId, kind);
  return { ok: true, message: opts.summarize(rows), severity: 'success', placed: ids.length };
}

function isTestFile(f: ProjectFile): boolean {
  return TEST_RE.test(f.relPath) || TEST_RE.test(f.name);
}

/**
 * Candidate relative paths (lowercased) of a test file that would "pair" with
 * the given source file. File-level pairing instead of the old top-dir proxy so
 * one test file no longer greens an entire directory.
 */
function pairedTestPaths(srcRel: string): string[] {
  const idx = srcRel.lastIndexOf('/');
  const dir = idx > 0 ? srcRel.slice(0, idx) : '';
  const base = idx > 0 ? srcRel.slice(idx + 1) : srcRel;
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot) : '';
  const name = dot >= 0 ? base.slice(0, dot) : base;
  const cands: string[] = [];
  const push = (p: string) => {
    if (p) cands.push(p.toLowerCase());
  };
  if (dir) {
    push(`${dir}/${name}.test${ext}`);
    push(`${dir}/${name}.spec${ext}`);
    push(`${dir}/${name}.e2e${ext}`);
    push(`${dir}/__tests__/${name}${ext}`);
    push(`${dir}/__tests__/${name}.test${ext}`);
  }
  push(`test/${name}.test${ext}`);
  push(`tests/${name}.test${ext}`);
  push(`__tests__/${name}${ext}`);
  const mirrorTest = dir.replace(/^src\//i, 'test/');
  const mirrorTests = dir.replace(/^src\//i, 'tests/');
  if (mirrorTest !== dir) {
    push(`${mirrorTest}/${name}.test${ext}`);
    push(`${mirrorTest}/${name}.spec${ext}`);
  }
  if (mirrorTests !== dir) {
    push(`${mirrorTests}/${name}.test${ext}`);
    push(`${mirrorTests}/${name}.spec${ext}`);
  }
  return cands;
}

/** 测试配对画像：按文件配对判断源文件是否有同名测试（*.test/*.spec），红=无配对测试保护（非行级覆盖率） */
export async function runTestCoveragePortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const files = pst.files.filter((f) => !f.isDirectory);
  if (files.length === 0) {
    return { ok: false, message: t('portrait.spec.testCoverage.empty'), severity: 'info', placed: 0 };
  }
  const testFiles = files.filter(isTestFile);
  const testSet = new Set(testFiles.map((tf) => tf.relPath.toLowerCase()));
  const rows: MetricRow[] = files
    .filter((f) => !isTestFile(f))
    .map((f) => {
      const hasTest = pairedTestPaths(f.relPath).some((c) => testSet.has(c));
      return {
        file: f,
        ins: (() => {
          const c = emptyFileInsight();
          c.complexity = 0;
          return c;
        })(),
        accentColor: hasTest ? '#22c55e' : '#ef4444',
        metricBadge: hasTest ? t('portrait.metric.testPaired') : t('portrait.metric.testUnpaired'),
        metricTitle: hasTest
          ? t('portrait.metric.testPairedTitle', { name: f.name })
          : t('portrait.metric.testUnpairedTitle', { name: f.name }),
      };
    })
    .sort((a, b) =>
      a.accentColor === b.accentColor ? b.file.lineCount - a.file.lineCount : a.accentColor === '#ef4444' ? -1 : 1,
    );
  return renderMetricPortrait('testCoverage', analysisId, rows, {
    cols: 8,
    colW: 190,
    rowH: 76,
    emptyHint: t('portrait.spec.testCoverage.empty'),
    summarize: (rs) => {
      const untested = rs.filter((r) => r.accentColor === '#ef4444').length;
      const tested = rs.length - untested;
      const pct = rs.length ? Math.round((tested / rs.length) * 100) : 0;
      return t('portrait.spec.testCoverage.done', { n: rs.length, tested, untested, pct });
    },
  });
}

/** 责任人 / bus-factor 画像：用 git 贡献者数做知识集中度代理（单人=孤岛风险） */
export async function runBusFactorPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const rows: MetricRow[] = pst.files
    .filter((f) => !f.isDirectory)
    .map((f) => {
      const ins = metricInsight(f, insights);
      const authors = ins.authorCount;
      const color = authors <= 1 ? '#ef4444' : authors === 2 ? '#f59e0b' : '#22c55e';
      return {
        file: f,
        ins,
        accentColor: color,
        metricBadge: `👥${authors}`,
        metricTitle: t('portrait.metric.busFactor', {
          n: authors,
          note: authors <= 1 ? t('portrait.metric.busSolo') : authors === 2 ? t('portrait.metric.busTwo') : '',
        }),
      };
    })
    .filter((r) => r.ins.authorCount > 0)
    .sort((a, b) => a.ins.authorCount - b.ins.authorCount);
  return renderMetricPortrait('busFactor', analysisId, rows, {
    cols: 8,
    colW: 190,
    rowH: 76,
    emptyHint: t('portrait.spec.busFactor.empty'),
    summarize: (rs) => {
      const solo = rs.filter((r) => r.ins.authorCount <= 1).length;
      return t('portrait.spec.busFactor.done', { n: rs.length, solo });
    },
  });
}

/** 涟漪 / 影响面画像：用调用入度（fan-in）衡量「改它会影响多少处」 */
export async function runRipplePortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const rows: MetricRow[] = pst.files
    .filter((f) => !f.isDirectory)
    .map((f) => {
      const ins = metricInsight(f, insights);
      const fanIn = ins.callIn;
      const color =
        fanIn >= PORTRAIT_THRESHOLDS.ripple.red
          ? '#ef4444'
          : fanIn >= PORTRAIT_THRESHOLDS.ripple.orange
            ? '#f59e0b'
            : '#22c55e';
      return {
        file: f,
        ins,
        accentColor: color,
        metricBadge: `↓${fanIn}`,
        metricTitle: t('portrait.metric.ripple', { n: fanIn }),
      };
    })
    .filter((r) => r.ins.callIn > 0)
    .sort((a, b) => b.ins.callIn - a.ins.callIn);
  return renderMetricPortrait('ripple', analysisId, rows, {
    cols: 8,
    colW: 190,
    rowH: 76,
    emptyHint: t('portrait.spec.ripple.empty'),
    summarize: (rs) => {
      const hubs = rs.filter((r) => r.ins.callIn >= PORTRAIT_THRESHOLDS.ripple.orange).length;
      return t('portrait.spec.ripple.done', { n: rs.length, hubs });
    },
  });
}

/** 文档覆盖画像：导出/公开符号中未写 doc 的比例 */
export async function runDocsCoveragePortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  // 诚实护栏：扫描器当前不提取符号 doc 注释（doc 字段恒为 None，见 code_structure.rs:719
  // 等三处），若整个项目没有任何符号带 doc，说明该能力未实现 —— 直接提示不可用，
  // 避免伪造"100% 未文档化"的红色卡片（审计：.workbuddy/audit-portraits-2026-08-22.md）。
  // 一旦后端实现 doc 提取（选项 A），此处自动恢复真实分析，无需再改前端。
  const docAvailable = (pst.symbols as ProjectSymbol[]).some((s) => !!s.doc);
  if (!docAvailable) {
    return { ok: false, message: t('portrait.msg.docUnavailable'), severity: 'info', placed: 0 };
  }
  const exportedByFile = new Map<string, { total: number; undoc: number }>();
  for (const s of pst.symbols as ProjectSymbol[]) {
    if (!/(?:export|public)/i.test(s.modifiers || '')) continue;
    const e = exportedByFile.get(s.fileId) || { total: 0, undoc: 0 };
    e.total += 1;
    if (!s.doc) e.undoc += 1;
    exportedByFile.set(s.fileId, e);
  }
  const rows: MetricRow[] = pst.files
    .filter((f) => !f.isDirectory && exportedByFile.has(f.id))
    .map((f) => {
      const e = exportedByFile.get(f.id)!;
      const ratio = e.total > 0 ? e.undoc / e.total : 0;
      const color = ratio >= 0.5 ? '#ef4444' : ratio > 0 ? '#f59e0b' : '#22c55e';
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: e.undoc > 0 ? t('portrait.metric.docBadge', { n: e.undoc }) : t('portrait.metric.docOk'),
        metricTitle: t('portrait.metric.docsCoverage', { n: e.total, m: e.undoc }),
      };
    })
    .sort((a, b) => {
      const ea = exportedByFile.get(a.file.id)!;
      const eb = exportedByFile.get(b.file.id)!;
      return eb.undoc - ea.undoc || eb.total - ea.total;
    });
  return renderMetricPortrait('docsCoverage', analysisId, rows, {
    cols: 8,
    colW: 190,
    rowH: 76,
    emptyHint: t('portrait.spec.docsCoverage.empty'),
    summarize: (rs) => {
      const bad = rs.filter((r) => r.accentColor === '#ef4444').length;
      return t('portrait.spec.docsCoverage.done', { n: rs.length, bad });
    },
  });
}
