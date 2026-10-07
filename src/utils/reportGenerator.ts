/**
 * 分析报告生成器
 * 将项目扫描/审查结果生成为可下载的 HTML 报告
 */

import { t, getLang, resolveFragments } from '../i18n';
import type { AnalysisDSL } from '../types/scene';
import type {
  ProjectFile,
  ProjectModule,
  ProjectDependency,
  ProjectLayer,
  ReviewFinding,
  ProjectSymbol,
  PatternHit,
  ProjectSymbolRef,
  FileMetric,
  TechDebtItem,
  DeadSymbol,
  CallEdge,
  GitChurn,
  CodeClone,
} from '../services/tauri';
import { quadrantOf, QUADRANT_META } from '../editor/utils/fileInsights';
import { buildModuleDeps, detectModuleCycles, summarizeModuleDeps } from '../editor/utils/symbolLayout';
import {
  buildInsightReport,
  buildQualityDisclosure,
  stabilityLabel,
  freshnessNote,
  type ReportInsightInput,
  type ReportInsightSummary,
  type QualityDisclosure,
} from '../ai/insightReport';
import type { AiContextQualityReport } from '../ai/contextTypes';
import { generateBookReportHtml, generateBookReportSvg, generateBookReportJson } from './bookReport';

/** 模块依赖体检（v2.5）：报告里一段「架构健康摘要」 */
export interface ModuleHealth {
  moduleCount: number;
  edgeCount: number;
  crossMod: number;
  cycleDirs: string[];
  hubs: { name: string; n: number }[];
}

export function buildModuleHealth(
  callEdges: CallEdge[],
  files: ProjectFile[],
  symbols: ProjectSymbol[],
  symbolRefs: ProjectSymbolRef[],
): ModuleHealth {
  const moduleDeps = buildModuleDeps(callEdges, files);
  const counts = summarizeModuleDeps(moduleDeps);
  const cycleDirs = detectModuleCycles(moduleDeps);
  // 枢纽符号：import 引用聚合 top 5（与画布 hub 口径一致：只算 import）
  const refCount = new Map<string, number>();
  for (const r of symbolRefs) {
    if (r.kind !== 'import' || !r.toSymbolId) continue;
    refCount.set(r.toSymbolId, (refCount.get(r.toSymbolId) ?? 0) + 1);
  }
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const hubs = Array.from(refCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n]) => ({ name: byId.get(id)?.name ?? id, n }));
  return {
    moduleCount: Array.from(counts.keys()).length,
    edgeCount: moduleDeps.length,
    crossMod: moduleDeps.filter((d) => d.crossFile).length,
    cycleDirs: Array.from(cycleDirs),
    hubs,
  };
}

export interface ReportData {
  analysis: AnalysisDSL;
  files: ProjectFile[];
  modules: ProjectModule[];
  dependencies: ProjectDependency[];
  layers: ProjectLayer[];
  findings: ReviewFinding[];
  /** 符号索引（可选，JSON 报告使用） */
  symbols?: ProjectSymbol[];
  /** 设计模式命中（可选） */
  patternHits?: PatternHit[];
  /** 符号级引用（可选） */
  symbolRefs?: ProjectSymbolRef[];
  /** 文件度量/复杂度（可选） */
  metrics?: FileMetric[];
  /** 技术债标记（可选，JSON/SVG 报告使用） */
  techDebt?: TechDebtItem[];
  /** 死代码符号（零引用，可选，HTML/JSON/SVG 报告使用） */
  deadSymbols?: DeadSymbol[];
  /** 函数调用边（调用图，可选，HTML/JSON/SVG 报告使用） */
  callEdges?: CallEdge[];
  /** git 变更热点（可选，HTML/JSON/SVG 报告使用） */
  gitChurn?: GitChurn[];
  /** 代码克隆（重复代码，可选，HTML/JSON/SVG 报告使用） */
  clones?: CodeClone[];
  /**
   * AI Agent 沉淀的分析结论（ai_insights）。
   *
   * 报告到此为止呈现的都是**机器测量的事实**，而这一项是**AI 判断的结论**。
   * 两者必须同处一份文档：结论离开事实就无从验证，事实缺了结论就还停在数据阶段。
   * 缺省（未接 AI 或还没分析过）时报告完全不出现相关章节，不留空壳。
   */
  aiInsights?: ReportInsightInput[];
  /**
   * 本次扫描的数据可信度体检。
   *
   * 一份对外交付的报告，读者无从判断「未发现循环依赖」背后是跑完了还是没跑 ——
   * 缺了这段声明，报告的沉默会被读成担保。
   */
  contextQuality?: AiContextQualityReport | null;
}

/** 克隆聚合结果（三格式报告共用一份口径） */
export interface CloneAggregate {
  /** 克隆组数（一组 = 同一段代码的所有副本） */
  groups: number;
  /** 克隆实例总数 */
  instances: number;
  /** Type-2 参数化克隆实例数（标识符重命名后的近重复） */
  type2Instances: number;
  /** 受影响文件数 */
  affectedFiles: number;
  /** 可消除的冗余行数合计：Σ 块行数 ×（副本数-1） */
  wasteLines: number;
  /** 冗余最大的前若干组 */
  topGroups: {
    groupId: string;
    size: number;
    lines: number;
    waste: number;
    /** 组内 Type-2 实例数 */
    type2Count: number;
    /** 副本位置（最多 6 个） */
    places: { filePath: string; startLine: number; endLine: number }[];
    snippet: string;
  }[];
}

/**
 * 聚合代码克隆（纯函数，便于复用与测试）
 *
 * 排序口径统一用「可消除冗余行数 = 块行数 ×（副本数-1）」：
 * 它直接回答"删掉重复能省多少行"，比单看块行数或副本数都更接近真实收益。
 */
export function aggregateClones(clones?: CodeClone[], topN = 15): CloneAggregate {
  const empty: CloneAggregate = {
    groups: 0,
    instances: 0,
    type2Instances: 0,
    affectedFiles: 0,
    wasteLines: 0,
    topGroups: [],
  };
  if (!clones || clones.length === 0) return empty;
  const byGroup = new Map<string, CodeClone[]>();
  const fileSet = new Set<string>();
  let type2Total = 0;
  for (const c of clones) {
    fileSet.add(c.fileId);
    if (c.cloneType === 'type2') type2Total += 1;
    const arr = byGroup.get(c.groupId) || [];
    arr.push(c);
    byGroup.set(c.groupId, arr);
  }
  const groups = Array.from(byGroup.entries()).map(([groupId, list]) => {
    const sorted = [...list].sort((a, b) => b.lineCount - a.lineCount);
    const lines = sorted[0]?.lineCount ?? 0;
    const type2Count = list.filter((c) => c.cloneType === 'type2').length;
    return {
      groupId,
      size: sorted.length,
      lines,
      waste: lines * Math.max(0, sorted.length - 1),
      type2Count,
      places: sorted.slice(0, 6).map((c) => ({
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
      })),
      snippet: (sorted[0]?.snippet || '').split('\n').slice(0, 3).join('\n'),
    };
  });
  groups.sort((a, b) => b.waste - a.waste || b.size - a.size);
  return {
    groups: groups.length,
    instances: clones.length,
    type2Instances: type2Total,
    affectedFiles: fileSet.size,
    wasteLines: groups.reduce((acc, g) => acc + g.waste, 0),
    topGroups: groups.slice(0, topN),
  };
}

/** 调用图聚合结果（从 callEdges 派生，供三格式报告共用） */
export interface CallGraphAggregate {
  total: number;
  crossFile: number;
  /** 被调用最多的函数（高 fan-in，改动影响面大） */
  hotTargets: { name: string; filePath: string; count: number }[];
  /** 调出最多的函数（高 fan-out，依赖面宽） */
  hotSources: { name: string; filePath: string; count: number }[];
}

/** 从调用边聚合调用热点（纯函数，便于复用与测试） */
export function aggregateCallGraph(edges?: CallEdge[]): CallGraphAggregate {
  const empty: CallGraphAggregate = { total: 0, crossFile: 0, hotTargets: [], hotSources: [] };
  if (!edges || edges.length === 0) return empty;
  const targetCount = new Map<string, { name: string; filePath: string; count: number }>();
  const sourceCount = new Map<string, { name: string; filePath: string; count: number }>();
  let cross = 0;
  for (const e of edges) {
    if (e.kind === 'cross-file') cross++;
    const t = targetCount.get(e.calleeSymbolId) ?? { name: e.calleeName, filePath: e.calleeFilePath, count: 0 };
    t.count++;
    targetCount.set(e.calleeSymbolId, t);
    const s = sourceCount.get(e.callerSymbolId) ?? { name: e.callerName, filePath: e.callerFilePath, count: 0 };
    s.count++;
    sourceCount.set(e.callerSymbolId, s);
  }
  const hotTargets = Array.from(targetCount.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const hotSources = Array.from(sourceCount.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return { total: edges.length, crossFile: cross, hotTargets, hotSources };
}

/** 审查严重度对应的颜色 */
const SEVERITY_COLORS: Record<string, string> = {
  critical: '#d32f2f',
  error: '#f44336',
  warning: '#ff9800',
  info: '#2196f3',
  success: '#4caf50',
};

/** 审查严重度标签（本地化） */
const severityLabel = (sev: string): string => t(`report.sev.${sev}`);

/** 获取文件的语言图标色 */
function getLanguageColor(language: string | null): string {
  const colors: Record<string, string> = {
    typescript: '#3178c6',
    javascript: '#f7df1e',
    rust: '#dea584',
    python: '#3572a5',
    go: '#00add8',
    java: '#b07219',
    c: '#555555',
    cpp: '#f34b7d',
    csharp: '#178600',
    swift: '#ffac45',
    kotlin: '#f18e33',
    php: '#4f5d95',
    ruby: '#701516',
    html: '#e34c26',
    css: '#563d7c',
    shell: '#89e051',
    yaml: '#cb171e',
    markdown: '#083fa1',
    json: '#292929',
    xml: '#0060ac',
    sql: '#e38c00',
  };
  const lang = language?.toLowerCase() ?? '';
  for (const [key, color] of Object.entries(colors)) {
    if (lang.includes(key)) return color;
  }
  return '#6b7280';
}

/** 文件大小格式化 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 时间戳格式化（随当前 UI 语言） */
function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(getLang(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ═══════════════════════════════════════════════════════════════
// AI 分析结论与数据可信度（三格式共用同一份翻译结果）
// ═══════════════════════════════════════════════════════════════

/** 可信度状态配色，与 ContextQualityPanel 同源，保证软件内外看到的是同一套语义 */
const QUALITY_COLOR: Record<string, string> = {
  ok: '#22c55e',
  partial: '#f59e0b',
  empty: '#94a3b8',
  unavailable: '#ef4444',
};

/**
 * 三格式统一的准备步骤：把洞察与体检翻译成可渲染结构。
 *
 * 证据核验需要一份「项目里真实存在的路径」清单，这里直接用报告自己的
 * files —— 报告里印出来的引用，必须能在同一份报告的文件清单里查到，
 * 否则读者根本无从核对。
 */
function prepareAiBlocks(data: ReportData): {
  insights: ReportInsightSummary | null;
  quality: QualityDisclosure | null;
} {
  const knownPaths = data.files.map((f) => f.relPath || f.path).filter(Boolean);
  return {
    insights: buildInsightReport(data.aiInsights, { knownPaths }),
    quality: buildQualityDisclosure(data.contextQuality),
  };
}

/** HTML：数据可信度声明块 */
function renderQualityHtml(q: QualityDisclosure | null): string {
  if (!q) return '';
  const color = QUALITY_COLOR[q.overall] ?? '#8b949e';
  const rows = q.rows
    .map((r) => {
      const c = QUALITY_COLOR[r.status] ?? '#8b949e';
      const cov = r.ratio !== null ? `${r.ratio}%` : `${r.observed}`;
      const note = [r.reason, r.caveat ? t('report.quality.forbidden', { caveat: r.caveat }) : '']
        .filter(Boolean)
        .join('；');
      return `
      <tr>
        <td>${escapeHtml(r.label)}</td>
        <td style="color:${c};font-weight:600">${escapeHtml(r.statusLabel)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${cov}</td>
        <td style="color:#8b949e;font-size:12px">${escapeHtml(note || '—')}</td>
      </tr>`;
    })
    .join('');

  return `
  <div class="section">
    <div class="section-title">${t('report.quality.title')} <span class="badge" style="background:${color}22;color:${color}">${escapeHtml(q.overallLabel)}</span></div>
    <div style="font-size:13px;color:#c9d1d9;margin-bottom:12px;line-height:1.7">${escapeHtml(q.statement)}</div>
    ${
      q.blindSpots.length > 0
        ? `<div style="background:#2d1416;border:1px solid #f8514955;border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px;color:#ffa198">
             <strong>${t('report.quality.blind')}</strong>${q.blindSpots.map((b) => escapeHtml(b)).join('、')}
             <div style="color:#8b949e;font-size:12px;margin-top:6px">${t('report.quality.blindNote')}</div>
           </div>`
        : ''
    }
    <table>
      <thead><tr><th>${t('report.quality.thDim')}</th><th>${t('report.quality.thStatus')}</th><th style="text-align:right">${t('report.quality.thCoverage')}</th><th>${t('report.quality.thNote')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/** HTML：AI 深度分析结论块 */
function renderInsightsHtml(s: ReportInsightSummary | null): string {
  if (!s) return '';

  const sevOrder: Array<[string, string]> = [
    ['critical', t('report.sev.critical')],
    ['high', t('report.sev.high')],
    ['medium', t('report.sev.medium')],
    ['low', t('report.sev.low')],
    ['info', t('report.sev.info')],
  ];
  const counts = sevOrder
    .filter(([k]) => (s.bySeverity as Record<string, number>)[k] > 0)
    .map(([k, label]) => {
      const n = (s.bySeverity as Record<string, number>)[k];
      const color = INSIGHT_SEV_COLOR[k] ?? '#6b7280';
      return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${color}22;color:${color};font-size:12px;font-weight:600;margin-right:8px">${label} ${n}</span>`;
    })
    .join('');

  const items = s.items
    .map((it) => {
      const refs = it.refs
        .map(
          (r) =>
            `<code style="font-size:11px;padding:1px 6px;border-radius:4px;margin-right:6px;background:${
              r.verified ? '#1f2933' : '#3d1d1d'
            };color:${r.verified ? '#8b949e' : '#ffa198'}">${escapeHtml(
              r.path + (r.line ? `:${r.line}` : ''),
            )}${r.verified ? '' : ` ${t('report.ai.unverifiedMark')}`}</code>`,
        )
        .join('');
      // 时效只在「结论已经不站在当初那份代码上」时才出现：给每条都挂个「证据未变」
      // 徽标是噪声，而 stale / orphaned 是读者必须先看到的东西。
      const freshMark =
        it.freshness === 'stale' || it.freshness === 'orphaned'
          ? `<span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;margin-left:6px;background:${
              FRESHNESS_COLOR[it.freshness]
            }22;color:${FRESHNESS_COLOR[it.freshness]}">${escapeHtml(it.freshnessLabel)}</span>`
          : '';
      const freshNote =
        it.freshness === 'stale' || it.freshness === 'orphaned'
          ? `<div style="margin-top:8px;font-size:12px;color:${FRESHNESS_COLOR[it.freshness]};line-height:1.6">
               ${escapeHtml(freshnessNote(it.freshness))}${
                 it.changedRefs.length > 0
                   ? t('report.ai.changed', {
                       paths: it.changedRefs
                         .slice(0, 5)
                         .map((p) => escapeHtml(p))
                         .join('、'),
                     })
                   : ''
               }${
                 it.missingRefs.length > 0
                   ? t('report.ai.missing', {
                       paths: it.missingRefs
                         .slice(0, 5)
                         .map((p) => escapeHtml(p))
                         .join('、'),
                     })
                   : ''
               }
             </div>`
          : '';
      return `
    <div class="finding-item" style="border-left-color:${it.severityColor};padding:12px 14px;margin-bottom:10px">
      <div class="finding-header" style="align-items:baseline">
        <span class="finding-badge" style="background:${it.severityColor}">${escapeHtml(it.severityLabel)}</span>
        <span style="font-size:11px;color:#8b949e;margin-right:6px">${escapeHtml(it.kindLabel)}</span>
        <span class="finding-message" style="font-weight:600">${escapeHtml(it.title)}</span>
        ${freshMark}
      </div>
      ${it.body ? `<div class="finding-suggestion" style="white-space:pre-wrap">${escapeHtml(it.body)}</div>` : ''}
      ${refs ? `<div style="margin-top:8px">${refs}</div>` : ''}
      ${freshNote}
      <div style="margin-top:6px;font-size:11px;color:#484f58">
        ${escapeHtml(stabilityLabel(it.stability))}${it.seenCount > 1 ? t('report.ai.confirmed', { n: it.seenCount }) : ''}${
          it.agentId ? t('report.ai.sourceAgent', { agent: it.agentId }) : ''
        }
      </div>
    </div>`;
    })
    .join('');

  const hot =
    s.hotPaths.length > 0
      ? `
    <div style="margin-top:16px">
      <div style="font-size:13px;font-weight:600;color:#f0f6fc;margin-bottom:8px">${t('report.ai.hotTitle')}</div>
      <table>
        <thead><tr><th>${t('report.ai.thFile')}</th><th style="text-align:right">${t('report.ai.thCount')}</th><th>${t('report.ai.thTopSev')}</th></tr></thead>
        <tbody>${s.hotPaths
          .map(
            (h) => `
          <tr>
            <td style="font-family:monospace;font-size:12px">${escapeHtml(h.path)}</td>
            <td style="text-align:right">${h.count}</td>
            <td style="color:${INSIGHT_SEV_COLOR[h.severity]}">${escapeHtml(h.severity)}</td>
          </tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>`
      : '';

  const unverified =
    s.unverifiedRefs.length > 0
      ? `
    <div style="margin-top:14px;background:#2d1416;border:1px solid #f8514955;border-radius:8px;padding:12px;font-size:12px;color:#ffa198">
      <strong>${t('report.ai.unverifiedTitle', { n: s.unverifiedRefs.length })}</strong>
      <div style="color:#8b949e;margin-top:6px">${t('report.ai.unverifiedNote')}${s.unverifiedRefs
        .slice(0, 12)
        .map((r) => `<code>${escapeHtml(r)}</code>`)
        .join('、')}</div>
    </div>`
      : '';

  // 已收口结论：不再作为待办，但作为审计闭环单独成节（与面板「已解决」档一致）。
  // 不重复渲染严重度徽标等噪声，只保留「结论 + 收口理由」，让读者知道问题已被处理过。
  const resolved =
    s.resolvedCount > 0
      ? `
    <div style="margin-top:16px;border-top:1px dashed #30363d;padding-top:14px">
      <div style="font-size:13px;font-weight:600;color:#8b949e;margin-bottom:10px">${t('report.ai.resolvedTitle', { n: s.resolvedCount })}</div>
      ${s.resolvedItems
        .map(
          (it) => `
        <div style="padding:8px 12px;margin-bottom:8px;border-radius:8px;background:#161b22;border-left:3px solid ${it.severityColor};opacity:0.72">
          <div style="font-size:13px;font-weight:600;color:#c9d1d9">${escapeHtml(it.title)}</div>
          ${
            it.resolvedReason
              ? `<div style="font-size:12px;color:#8b949e;margin-top:4px">${t('report.ai.resolvedReason', { reason: escapeHtml(it.resolvedReason) })}${
                  it.resolvedBy ? t('report.ai.resolvedBy', { by: escapeHtml(it.resolvedBy) }) : ''
                }</div>`
              : ''
          }
        </div>`,
        )
        .join('')}
    </div>`
      : '';

  // 时效提示排在结论清单之前：读者在读任何一条结论之前，先得知道这批结论里
  // 有几条所依据的代码已经变了——否则他会按整改计划去改一个可能已经修好的问题。
  const review =
    s.needsReview > 0
      ? `
    <div style="margin-bottom:14px;background:#2b2413;border:1px solid #d2992255;border-radius:8px;padding:12px;font-size:12.5px;color:#e3b341;line-height:1.7">
      <strong>${t('report.ai.reviewTitle', { n: s.needsReview })}</strong>
      <div style="color:#8b949e;margin-top:6px">
        ${t('report.ai.reviewNote', { stale: s.byFreshness.stale, orphaned: s.byFreshness.orphaned })}
      </div>
    </div>`
      : '';

  return `
  <div class="section">
    <div class="section-title">${t('report.ai.title')} <span class="badge">${t('report.ai.badge', { n: s.total, actionable: s.actionable })}${
      s.resolvedCount > 0 ? t('report.ai.resolved', { n: s.resolvedCount }) : ''
    }</span></div>
    <div style="margin-bottom:12px">${counts}</div>
    <div style="font-size:12px;color:#8b949e;margin-bottom:14px;line-height:1.7">
      ${t('report.ai.intro', { agents: s.agents.length > 0 ? t('report.ai.agents', { agents: s.agents.map((a) => escapeHtml(a)).join('、') }) : t('report.ai.agentsDefault') })}
      ${t('report.ai.introConfirmed', { n: s.stableCount, m: s.newCount })}
      ${t('report.ai.introEvidence')}
    </div>
    ${review}
    ${items}
    ${hot}
    ${unverified}
    ${resolved}
  </div>`;
}

/** 洞察严重度配色（与画布角标 / 面板同源） */
const INSIGHT_SEV_COLOR: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#d97706',
  low: '#0891b2',
  info: '#6366f1',
};

/** 时效配色：只有需要读者动作的两档才会真正被用到 */
const FRESHNESS_COLOR: Record<string, string> = {
  current: '#22c55e',
  stale: '#f59e0b',
  orphaned: '#94a3b8',
  unanchored: '#8b949e',
  unknown: '#8b949e',
};

/**
 * 生成 HTML 分析报告
 */
export function generateReportHtml(data: ReportData): string {
  // 书场景（novel-zh）→ 生成「作品分析报告」，不掺代码分析章节（P0-1）
  if (data.analysis.primaryLanguage === 'novel-zh') return generateBookReportHtml(data.analysis, data.files);
  const {
    analysis,
    files,
    modules,
    dependencies,
    layers,
    findings,
    metrics,
    deadSymbols,
    callEdges,
    gitChurn,
    clones,
  } = data;
  const cloneAgg = aggregateClones(clones);
  // AI 结论与可信度声明：两者都可能缺席（没接 AI / 没分析过），缺席时渲染成空串
  const ai = prepareAiBlocks(data);

  // 统计
  const totalFiles = files.length;
  const totalLines = files.reduce((sum, f) => sum + (f.lineCount || 0), 0);
  const totalDeps = dependencies.length;
  const circularDeps = dependencies.filter((d) => d.isCircular).length;
  const uniqueLangs = new Set(files.map((f) => f.language).filter(Boolean));
  const langList = Array.from(uniqueLangs).join(', ') || t('report.meta.unknownLang');

  // 调用图聚合（被调用最多 / 调出最多）
  const callAgg = aggregateCallGraph(callEdges);

  const findingsBySeverity = {
    critical: findings.filter((f) => f.severity === 'critical'),
    error: findings.filter((f) => f.severity === 'error'),
    warning: findings.filter((f) => f.severity === 'warning'),
    info: findings.filter((f) => f.severity === 'info'),
  };

  const layerColors = layers.reduce(
    (acc, l) => {
      acc[l.id] = l.color || '#6b7280';
      return acc;
    },
    {} as Record<string, string>,
  );

  const filesByLayer = new Map<string, ProjectFile[]>();
  for (const f of files) {
    const key = f.layerId || 'unassigned';
    if (!filesByLayer.has(key)) filesByLayer.set(key, []);
    filesByLayer.get(key)!.push(f);
  }

  const modulesHtml = modules
    .map(
      (m) => `
    <tr>
      <td>${m.name}</td>
      <td><span class="layer-badge" style="background:${layerColors[m.layerId ?? ''] || '#6b7280'}">${layers.find((l) => l.id === m.layerId)?.name || t('report.meta.unassigned')}</span></td>
      <td>${m.fileCount}</td>
      <td>${m.depCount}</td>
      <td>${m.beDepCount}</td>
    </tr>`,
    )
    .join('');

  // v2.5 模块依赖体检：环/枢纽/跨模块调用（复用画布纯函数，与画像口径一致）
  const modHealth = buildModuleHealth(data.callEdges ?? [], files, data.symbols ?? [], data.symbolRefs ?? []);
  const modHealthHtml =
    modHealth.edgeCount > 0
      ? `
  <div class="section">
    <div class="section-title">${t('report.section.moduleHealth')} <span class="badge">${modHealth.moduleCount}</span></div>
    <div style="font-size:13px;line-height:1.8">
      ${t('report.moduleHealth.summary', { n: modHealth.moduleCount, e: modHealth.edgeCount, cross: modHealth.crossMod })}
      ${
        modHealth.cycleDirs.length > 0
          ? `<div style="color:#ef4444;font-weight:600">${t('report.moduleHealth.cycles', { n: modHealth.cycleDirs.length, dirs: escapeHtml(modHealth.cycleDirs.join('、')) })}</div>`
          : `<div style="color:#22c55e">${t('report.moduleHealth.clean')}</div>`
      }
      ${
        modHealth.hubs.length > 0
          ? `<div style="color:#f59e0b;font-weight:600">${t('report.moduleHealth.hubs', { n: modHealth.hubs.length, names: escapeHtml(modHealth.hubs.map((h) => `${h.name}×${h.n}`).join('、')) })}</div>`
          : ''
      }
    </div>
  </div>`
      : '';

  const layersHtml = layers
    .map(
      (l) => `
    <div class="layer-item">
      <span class="layer-dot" style="background:${l.color || '#6b7280'}"></span>
      <span class="layer-name">${l.name}</span>
      <span class="layer-count">${filesByLayer.get(l.id)?.length || 0} ${t('report.meta.files')}</span>
    </div>`,
    )
    .join('');

  const findingsHtml = findings
    .map(
      (f) => `
    <div class="finding-item severity-${f.severity}">
      <div class="finding-header">
        <span class="finding-badge" style="background:${SEVERITY_COLORS[f.severity] || '#6b7280'}">${severityLabel(f.severity)}</span>
        <span class="finding-message">${escapeHtml(f.message)}</span>
      </div>
      ${f.suggestion ? `<div class="finding-suggestion">${escapeHtml(f.suggestion)}</div>` : ''}
      <div class="finding-target">${t('report.meta.target')}: ${f.targetId}</div>
    </div>`,
    )
    .join('');

  const filesByLang = new Map<string, number>();
  for (const f of files) {
    const lang = f.language || t('report.meta.unknown');
    filesByLang.set(lang, (filesByLang.get(lang) || 0) + 1);
  }
  const langChartData = Array.from(filesByLang.entries())
    .sort((a, b) => b[1] - a[1])
    .map(
      ([lang, count]) => `
    <div class="lang-bar-row">
      <span class="lang-label">${lang}</span>
      <div class="lang-bar-track">
        <div class="lang-bar-fill" style="width:${(count / totalFiles) * 100}%;background:${getLanguageColor(lang)}"></div>
      </div>
      <span class="lang-count">${count}</span>
    </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="${getLang()}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(analysis.name)} — ${t('report.title')}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #0f1117;
    color: #e1e4e8;
    line-height: 1.6;
  }
  .container { max-width: 1000px; margin: 0 auto; padding: 40px 24px; }
  .header {
    text-align: center; padding: 48px 0 32px;
    border-bottom: 1px solid #21262d;
    margin-bottom: 32px;
  }
  .header h1 { font-size: 28px; font-weight: 700; color: #f0f6fc; margin-bottom: 8px; }
  .header .subtitle { color: #8b949e; font-size: 14px; }
  .header .project-path { color: #58a6ff; font-size: 13px; margin-top: 4px; }
  .meta-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 16px; margin-bottom: 32px;
  }
  .meta-card {
    background: #161b22; border: 1px solid #21262d; border-radius: 8px;
    padding: 16px; text-align: center;
  }
  .meta-card .value { font-size: 28px; font-weight: 700; color: #f0f6fc; }
  .meta-card .label { font-size: 12px; color: #8b949e; margin-top: 4px; }
  .meta-card.highlight .value { color: #58a6ff; }
  .meta-card.warn .value { color: #d29922; }
  .meta-card.danger .value { color: #f85149; }
  .section { margin-bottom: 32px; }
  .section-title {
    font-size: 18px; font-weight: 600; color: #f0f6fc;
    padding-bottom: 8px; border-bottom: 1px solid #21262d;
    margin-bottom: 16px; display: flex; align-items: center; gap: 8px;
  }
  .section-title .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 10px;
    background: #21262d; color: #8b949e;
  }
  .lang-bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .lang-label { width: 80px; font-size: 12px; color: #8b949e; text-align: right; }
  .lang-bar-track { flex: 1; height: 20px; background: #21262d; border-radius: 4px; overflow: hidden; }
  .lang-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .lang-count { width: 40px; font-size: 12px; color: #8b949e; text-align: right; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #21262d; font-size: 13px; }
  th { color: #8b949e; font-weight: 600; font-size: 12px; text-transform: uppercase; }
  td { color: #e1e4e8; }
  .layer-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; color: #fff; font-size: 11px; }
  .layer-item {
    display: flex; align-items: center; gap: 12px; padding: 10px 0;
    border-bottom: 1px solid #21262d;
  }
  .layer-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .layer-name { flex: 1; font-size: 14px; color: #e1e4e8; }
  .layer-count { font-size: 12px; color: #8b949e; }
  .finding-item {
    padding: 12px; border-radius: 6px; margin-bottom: 8px;
    border-left: 3px solid;
  }
  .finding-item.severity-critical { border-left-color: #d32f2f; background: rgba(211,47,47,0.08); }
  .finding-item.severity-error { border-left-color: #f44336; background: rgba(244,67,54,0.08); }
  .finding-item.severity-warning { border-left-color: #ff9800; background: rgba(255,152,0,0.08); }
  .finding-item.severity-info { border-left-color: #2196f3; background: rgba(33,150,243,0.08); }
  .finding-item.severity-success { border-left-color: #4caf50; background: rgba(76,175,80,0.08); }
  .finding-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .finding-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; color: #fff; font-size: 10px; font-weight: 600; }
  .finding-message { font-size: 13px; color: #e1e4e8; }
  .finding-suggestion { font-size: 12px; color: #8b949e; margin: 4px 0; padding-left: 2px; }
  .finding-target { font-size: 11px; color: #484f58; margin-top: 4px; }
  .empty-state { text-align: center; padding: 32px; color: #484f58; font-size: 14px; }
  .footer {
    text-align: center; padding: 32px 0; border-top: 1px solid #21262d;
    color: #484f58; font-size: 12px; margin-top: 48px;
  }
  .files-list { max-height: 400px; overflow-y: auto; }
  .files-list table { font-size: 12px; }
  .files-list td { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 12px; }
</style>
</head>
<body>
<div class="container">

  <!-- 报告头 -->
  <div class="header">
    <h1>📊 ${escapeHtml(analysis.name)}</h1>
    <div class="subtitle">${t('report.title')}</div>
    ${analysis.projectRoot ? `<div class="project-path">📁 ${escapeHtml(analysis.projectRoot)}</div>` : ''}
    <div class="subtitle" style="margin-top:8px">${t('report.generatedAt', { time: formatDate(Math.floor(Date.now() / 1000)) })}</div>
  </div>

  <!-- 统计概览 -->
  <div class="meta-grid">
    <div class="meta-card highlight">
      <div class="value">${totalFiles}</div>
      <div class="label">${t('report.meta.scannedFiles')}</div>
    </div>
    <div class="meta-card highlight">
      <div class="value">${totalLines.toLocaleString()}</div>
      <div class="label">${t('report.meta.codeLines')}</div>
    </div>
    <div class="meta-card">
      <div class="value">${langList}</div>
      <div class="label">${t('report.meta.languages')}</div>
    </div>
    <div class="meta-card highlight">
      <div class="value">${totalDeps}</div>
      <div class="label">${t('report.meta.deps')}</div>
    </div>
    ${
      circularDeps > 0
        ? `
    <div class="meta-card danger">
      <div class="value">${circularDeps}</div>
      <div class="label">${t('report.meta.circular')}</div>
    </div>`
        : `
    <div class="meta-card">
      <div class="value">0</div>
      <div class="label">${t('report.meta.circular')}</div>
    </div>`
    }
    <div class="meta-card">
      <div class="value">${findings.length}</div>
      <div class="label">${t('report.meta.findings')}</div>
    </div>
    ${
      callEdges && callEdges.length > 0
        ? `
    <div class="meta-card">
      <div class="value">${callEdges.length}</div>
      <div class="label">${t('report.meta.callEdges')}</div>
    </div>`
        : ''
    }
    ${
      deadSymbols && deadSymbols.length > 0
        ? `
    <div class="meta-card ${deadSymbols.some((d) => d.visibility === 'exported') ? 'danger' : 'warn'}">
      <div class="value">${deadSymbols.length}</div>
      <div class="label">${t('report.meta.deadSymbols')}</div>
    </div>`
        : ''
    }
    ${
      cloneAgg.groups > 0
        ? `
    <div class="meta-card ${cloneAgg.wasteLines >= 500 ? 'danger' : 'warn'}">
      <div class="value">${cloneAgg.wasteLines}</div>
      <div class="label">${t('report.meta.dupLines')}</div>
    </div>`
        : ''
    }
  </div>

  <!-- 可信度与 AI 结论两块刻意排在所有明细章节之前：读者应当先知道这些数字有多可信、
       模型的高层判断是什么，再往下看支撑它们的原始数据。顺序反过来，
       结论就会变成读完两百行表格之后的脚注。两块都可能整体缺席。 -->
  ${renderQualityHtml(ai.quality)}
  ${renderInsightsHtml(ai.insights)}

  <!-- 语言分布 -->
  ${
    langChartData
      ? `
  <div class="section">
    <div class="section-title">${t('report.section.lang')} <span class="badge">${t('report.section.langBadge', { n: uniqueLangs.size })}</span></div>
    ${langChartData}
  </div>`
      : ''
  }

  <!-- 架构分层 -->
  ${
    layers.length > 0
      ? `
  <div class="section">
    <div class="section-title">${t('report.section.layers')} <span class="badge">${t('report.section.layersBadge', { n: layers.length })}</span></div>
    ${layersHtml}
  </div>`
      : ''
  }

  <!-- 语义模块 -->
  ${
    modules.length > 0
      ? `
  <div class="section">
    <div class="section-title">${t('report.section.modules')} <span class="badge">${modules.length}</span></div>
    <table>
      <thead><tr><th>${t('report.th.module')}</th><th>${t('report.th.layer')}</th><th>${t('report.th.fileCount')}</th><th>${t('report.th.outDeps')}</th><th>${t('report.th.inDeps')}</th></tr></thead>
      <tbody>${modulesHtml}</tbody>
    </table>
  </div>`
      : ''
  }

  <!-- 模块依赖体检（v2.5） -->
  ${modHealthHtml}

  <!-- 审查发现 -->
  ${
    findings.length > 0
      ? `
  <div class="section">
    <div class="section-title">${t('report.section.findings')} <span class="badge">${t('report.section.findingsBadge', { n: findings.length })}</span></div>
    ${findingsBySeverity.critical.length > 0 ? `<div style="margin-bottom:8px;font-size:13px;color:#d32f2f">${t('report.section.findingsCritical', { n: findingsBySeverity.critical.length })}</div>` : ''}
    ${findingsBySeverity.warning.length > 0 ? `<div style="margin-bottom:8px;font-size:13px;color:#ff9800">${t('report.section.findingsWarning', { n: findingsBySeverity.warning.length })}</div>` : ''}
    ${findingsBySeverity.info.length > 0 ? `<div style="margin-bottom:8px;font-size:13px;color:#2196f3">${t('report.section.findingsInfo', { n: findingsBySeverity.info.length })}</div>` : ''}
    ${findingsHtml}
  </div>`
      : `
  <div class="section">
    <div class="section-title">${t('report.section.findings')}</div>
    <div class="empty-state">${t('report.section.findingsClean')}</div>
  </div>`
  }

  <!-- 函数调用热点 -->
  ${
    callAgg.total > 0
      ? `
  <div class="section">
    <div class="section-title">${t('report.section.callHot')} <span class="badge">${t('report.section.callHotBadge', { n: callAgg.total, cross: callAgg.crossFile })}</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
      <div>
        <div style="font-size:13px;color:#ef4444;font-weight:600;margin-bottom:8px">${t('report.callHot.target')}</div>
        ${callAgg.hotTargets
          .map(
            (h) => `
          <div class="finding-item" style="border-left-color:#ef4444;padding:8px 12px;margin-bottom:6px">
            <div style="font-size:12px;font-family:monospace;color:#e1e4e8">${escapeHtml(h.name)} <span style="color:#8b949e">×${h.count}</span></div>
            <div style="font-size:11px;color:#8b949e">${escapeHtml(h.filePath)}</div>
          </div>`,
          )
          .join('')}
      </div>
      <div>
        <div style="font-size:13px;color:#3b82f6;font-weight:600;margin-bottom:8px">${t('report.callHot.source')}</div>
        ${callAgg.hotSources
          .map(
            (h) => `
          <div class="finding-item" style="border-left-color:#3b82f6;padding:8px 12px;margin-bottom:6px">
            <div style="font-size:12px;font-family:monospace;color:#e1e4e8">${escapeHtml(h.name)} <span style="color:#8b949e">×${h.count}</span></div>
            <div style="font-size:11px;color:#8b949e">${escapeHtml(h.filePath)}</div>
          </div>`,
          )
          .join('')}
      </div>
    </div>
  </div>`
      : `
  <div class="section">
    <div class="section-title">${t('report.section.callHot')}</div>
    <div class="empty-state">${t('report.section.callHotEmpty')}</div>
  </div>`
  }

  <!-- 死代码 -->
  ${
    deadSymbols && deadSymbols.length > 0
      ? `
  <div class="section">
    <div class="section-title">${t('report.section.dead')} <span class="badge">${t('report.section.deadBadge', { n: deadSymbols.length })}</span></div>
    ${deadSymbols
      .slice(0, 100)
      .map(
        (d) => `
      <div class="finding-item" style="border-left-color:#6b7280;padding:8px 12px;margin-bottom:6px">
        <div style="font-size:12px;font-family:monospace;color:#e1e4e8">${escapeHtml(d.name)} <span style="color:#8b949e">(${d.kind} · ${d.visibility} · ${t('report.dead.conf')} ${d.confidence})</span></div>
        <div style="font-size:11px;color:#8b949e">${escapeHtml(d.filePath)}:${d.lineStart} · ${escapeHtml(d.reason)}</div>
      </div>`,
      )
      .join('')}
    ${deadSymbols.length > 100 ? `<div style="text-align:center;color:#484f58;font-size:12px;padding:8px">${t('report.section.deadLimit', { n: deadSymbols.length })}</div>` : ''}
  </div>`
      : `
  <div class="section">
    <div class="section-title">${t('report.section.dead')}</div>
    <div class="empty-state">${t('report.section.deadClean')}</div>
  </div>`
  }

  <!-- 重复代码（克隆检测） -->
  ${
    cloneAgg.groups > 0
      ? `
  <div class="section">
    <div class="section-title">${t('report.section.clones')} <span class="badge">${t('report.section.clonesBadge', { n: cloneAgg.groups, m: cloneAgg.instances, w: cloneAgg.wasteLines })}</span>${
      cloneAgg.type2Instances > 0
        ? ` <span class="badge" style="background:#8b5cf6">${t('report.section.clonesType2', { n: cloneAgg.type2Instances })}</span>`
        : ''
    }</div>
    <table>
      <thead><tr><th>${t('report.th.copyCount')}</th><th>${t('report.th.blockLines')}</th><th>${t('report.th.waste')}</th><th>${t('report.th.type')}</th><th>${t('report.th.location')}</th></tr></thead>
      <tbody>
        ${cloneAgg.topGroups
          .map(
            (g) => `
        <tr>
          <td>${g.size}</td>
          <td>${g.lines}</td>
          <td style="color:${g.waste >= 120 ? '#f44336' : g.waste >= 40 ? '#ff9800' : '#8b949e'}">${t('report.clone.wasteLines', { n: g.waste })}</td>
          <td>${
            g.type2Count > 0
              ? `<span style="color:#a78bfa;font-size:11px">${t('report.clone.type2')} ${g.type2Count}</span>`
              : `<span style="color:#8b949e;font-size:11px">${t('report.clone.verbatim')}</span>`
          }</td>
          <td style="font-family:monospace;font-size:11px">${g.places
            .map((p) => `${escapeHtml(p.filePath)}:${p.startLine}-${p.endLine}`)
            .join('<br/>')}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <div style="font-size:11px;color:#8b949e;margin-top:8px">${t('report.clone.note', { n: cloneAgg.affectedFiles })}${
      cloneAgg.type2Instances > 0 ? t('report.clone.type2Note') : ''
    }</div>
  </div>`
      : `
  <div class="section">
    <div class="section-title">${t('report.section.clones')}</div>
    <div class="empty-state">${t('report.section.clonesClean')}</div>
  </div>`
  }

  <!-- git 变更热点 + 重构象限 -->
  ${
    gitChurn && gitChurn.length > 0
      ? (() => {
          const metricLevelByFile = new Map<string, string>();
          for (const m of metrics ?? []) metricLevelByFile.set(m.fileId, m.complexityLevel);
          const rows = gitChurn
            .slice()
            .sort((a, b) => b.churnScore - a.churnScore)
            .slice(0, 20);
          return `
  <div class="section">
    <div class="section-title">${t('report.section.git')} <span class="badge">${t('report.section.gitBadge', { n: gitChurn.length })}</span></div>
    <table>
      <thead><tr><th>${t('report.th.file')}</th><th>${t('report.th.churn')}</th><th>${t('report.th.commits')}</th><th>${t('report.th.authors')}</th><th>${t('report.th.quadrant')}</th></tr></thead>
      <tbody>
        ${rows
          .map((c) => {
            const cLevel = c.hotspotLevel as any;
            const xLevel = (metricLevelByFile.get(c.fileId) || 'low') as any;
            const quad = quadrantOf(xLevel, cLevel);
            const qm = QUADRANT_META[quad];
            return `
          <tr>
            <td>${escapeHtml(c.filePath)}</td>
            <td>${c.churnScore}（${c.hotspotLevel}）</td>
            <td>${c.commitCount}</td>
            <td>${c.authorCount}</td>
            <td><span class="layer-badge" style="background:${qm.color}">${resolveFragments(qm.label)}</span></td>
          </tr>`;
          })
          .join('')}
      </tbody>
    </table>
    <div style="font-size:11px;color:#8b949e;margin-top:8px">${t('report.git.note')}</div>
  </div>`;
        })()
      : `
  <div class="section">
    <div class="section-title">${t('report.section.git')}</div>
    <div class="empty-state">${t('report.section.gitSkip')}</div>
  </div>`
  }

  <!-- 文件列表 -->
  ${
    files.length > 0
      ? `
  <div class="section">
    <div class="section-title">${t('report.section.files')} <span class="badge">${t('report.section.filesBadge', { n: files.length })}</span></div>
    <div class="files-list">
      <table>
        <thead><tr><th>${t('report.th.path')}</th><th>${t('report.th.lang')}</th><th>${t('report.th.size')}</th><th>${t('report.th.lines')}</th><th>${t('report.th.layer')}</th></tr></thead>
        <tbody>
          ${files
            .slice(0, 200)
            .map(
              (f) => `
          <tr>
            <td>${escapeHtml(f.relPath || f.path)}</td>
            <td>${f.language || '—'}</td>
            <td>${formatSize(f.size)}</td>
            <td>${f.lineCount}</td>
            <td>${layers.find((l) => l.id === f.layerId)?.name || '—'}</td>
          </tr>`,
            )
            .join('')}
          ${files.length > 200 ? `<tr><td colspan="5" style="color:#484f58;text-align:center">${t('report.section.filesLimit', { n: files.length })}</td></tr>` : ''}
        </tbody>
      </table>
    </div>
  </div>`
      : ''
  }

  <div class="footer">
    <p>${t('report.generatedBy')}</p>
    <p style="margin-top:4px">${formatDate(Math.floor(Date.now() / 1000))}</p>
  </div>

</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ═══════════════════════════════════════════════════════════════
// JSON 报告（需求 §7.3「报告导出器 HTML/JSON/SVG」的 JSON 部分）
// ═══════════════════════════════════════════════════════════════

/**
 * 生成 JSON 分析报告：包含全部结构化的分析数据（文件/模块/依赖/分层/
 * 符号索引/设计模式/符号引用/文件度量/审查发现），供程序化消费与二次分析。
 */
export function generateReportJson(data: ReportData): string {
  // 书场景（novel-zh）→ 作品分析报告 JSON（P0-1）
  if (data.analysis.primaryLanguage === 'novel-zh') return generateBookReportJson(data.analysis, data.files);
  const {
    analysis,
    files,
    modules,
    dependencies,
    layers,
    findings,
    symbols,
    patternHits,
    symbolRefs,
    metrics,
    techDebt,
    deadSymbols,
    callEdges,
    gitChurn,
    clones,
  } = data;
  const ai = prepareAiBlocks(data);

  // 统计概览
  const totalLines = files.reduce((sum, f) => sum + (f.lineCount || 0), 0);
  const circularDeps = dependencies.filter((d) => d.isCircular).length;
  const langCount = files.reduce(
    (acc, f) => {
      const lang = f.language || 'unknown';
      acc[lang] = (acc[lang] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const severityCount = findings.reduce(
    (acc, f) => {
      acc[f.severity] = (acc[f.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  // 复杂度分布（来自文件度量）
  const complexityCount = (metrics ?? []).reduce(
    (acc, m) => {
      acc[m.complexityLevel] = (acc[m.complexityLevel] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  // 技术债分布（按标记类型 + 按严重度）
  const techDebtByMarker = (techDebt ?? []).reduce(
    (acc, t) => {
      acc[t.marker] = (acc[t.marker] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const techDebtBySeverity = (techDebt ?? []).reduce(
    (acc, t) => {
      acc[t.severity] = (acc[t.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  // 调用图聚合
  const callAgg = aggregateCallGraph(callEdges);
  // 代码克隆聚合
  const cloneAgg = aggregateClones(clones, 30);
  // 重构象限分布（churn × complexity，按文件归并）
  const metricLevelByFile = new Map<string, string>();
  for (const m of metrics ?? []) metricLevelByFile.set(m.fileId, m.complexityLevel);
  const quadrantDistribution: Record<string, number> = {};
  for (const c of gitChurn ?? []) {
    const quad = quadrantOf((metricLevelByFile.get(c.fileId) || 'low') as any, c.hotspotLevel as any);
    quadrantDistribution[quad] = (quadrantDistribution[quad] || 0) + 1;
  }

  const report = {
    format: 'sight-folio-analysis-report',
    // v2：新增 aiAnalysis（AI 结论 + 证据核验）与 dataQuality（可信度声明）两个顶层节点。
    // 消费方按 version 判定即可，v1 结构完全保留，旧的解析脚本不会因此失效。
    version: 2,
    generatedAt: new Date().toISOString(),
    analysis: {
      id: analysis.id,
      name: analysis.name,
      projectRoot: analysis.projectRoot ?? '',
      primaryLanguage: (analysis as any).primaryLanguage ?? null,
    },
    summary: {
      totalFiles: files.length,
      totalLines,
      totalDependencies: dependencies.length,
      circularDependencies: circularDeps,
      totalFindings: findings.length,
      languages: langCount,
      findingsBySeverity: severityCount,
      complexityDistribution: complexityCount,
      techDebtCount: (techDebt ?? []).length,
      techDebtByMarker: techDebtByMarker,
      techDebtBySeverity: techDebtBySeverity,
      // 调用图
      callEdges: callAgg.total,
      crossFileCallEdges: callAgg.crossFile,
      topCallers: callAgg.hotTargets,
      topCallees: callAgg.hotSources,
      // 死代码
      deadSymbolCount: (deadSymbols ?? []).length,
      // 重复代码（克隆检测）
      cloneGroups: cloneAgg.groups,
      cloneInstances: cloneAgg.instances,
      cloneType2Instances: cloneAgg.type2Instances,
      cloneAffectedFiles: cloneAgg.affectedFiles,
      /** 抽成公共实现后可删除的行数 */
      duplicationWasteLines: cloneAgg.wasteLines,
      // git 变更热点
      gitChurnFiles: (gitChurn ?? []).length,
      highChurnFiles: (gitChurn ?? []).filter((c) => c.hotspotLevel === 'high' || c.hotspotLevel === 'extreme').length,
      quadrantDistribution,
    },
    files: files.map((f) => ({
      id: f.id,
      path: f.relPath || f.path,
      name: f.name,
      language: f.language,
      size: f.size,
      lineCount: f.lineCount,
      layerId: f.layerId,
      isDirectory: f.isDirectory,
    })),
    modules: modules.map((m) => ({
      id: m.id,
      name: m.name,
      layerId: m.layerId,
      fileCount: m.fileCount,
      depCount: m.depCount,
      beDepCount: m.beDepCount,
      color: m.color,
    })),
    layers: layers.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      sortOrder: l.sortOrder,
    })),
    dependencies: dependencies.map((d) => ({
      id: d.id,
      fromId: d.fromId,
      fromType: d.fromType,
      toId: d.toId,
      toType: d.toType,
      kind: d.kind,
      lineNo: d.lineNo,
      isCircular: d.isCircular,
    })),
    symbols: (symbols ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      filePath: s.filePath,
      lineStart: s.lineStart,
      lineEnd: s.lineEnd,
      signature: s.signature,
      patterns: (() => {
        try {
          return JSON.parse(s.patterns || '[]');
        } catch {
          return [];
        }
      })(),
    })),
    designPatterns: (patternHits ?? []).map((p) => ({
      pattern: p.pattern,
      name: p.name,
      symbolName: p.symbolName,
      filePath: p.filePath,
      line: p.line,
      evidence: p.evidence,
    })),
    symbolRefs: (symbolRefs ?? []).map((r) => ({
      fromFilePath: r.fromFilePath,
      toFilePath: r.toFilePath,
      symbolName: r.symbolName,
      refLine: r.refLine,
      refText: r.refText,
    })),
    fileMetrics: (metrics ?? []).map((m) => ({
      filePath: m.filePath,
      totalLines: m.totalLines,
      codeLines: m.codeLines,
      commentLines: m.commentLines,
      blankLines: m.blankLines,
      cyclomaticComplexity: m.cyclomaticComplexity,
      complexityLevel: m.complexityLevel,
    })),
    techDebt: (techDebt ?? []).map((t) => ({
      filePath: t.filePath,
      lineNo: t.lineNo,
      marker: t.marker,
      severity: t.severity,
      snippet: t.snippet,
    })),
    findings: findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      message: f.message,
      suggestion: f.suggestion,
      targetId: f.targetId,
      targetType: f.targetType,
      status: f.status,
    })),
    deadSymbols: (deadSymbols ?? []).map((d) => ({
      filePath: d.filePath,
      name: d.name,
      kind: d.kind,
      lineStart: d.lineStart,
      visibility: d.visibility,
      confidence: d.confidence,
      reason: d.reason,
    })),
    callEdges: (callEdges ?? []).map((e) => ({
      caller: e.callerName,
      callerFile: e.callerFilePath,
      callee: e.calleeName,
      calleeFile: e.calleeFilePath,
      lineNo: e.lineNo,
      kind: e.kind,
    })),
    gitChurn: (gitChurn ?? []).map((c) => ({
      filePath: c.filePath,
      churnScore: c.churnScore,
      hotspotLevel: c.hotspotLevel,
      commitCount: c.commitCount,
      authorCount: c.authorCount,
    })),
    codeClones: cloneAgg.topGroups.map((g) => ({
      groupId: g.groupId,
      instances: g.size,
      lineCount: g.lines,
      wasteLines: g.waste,
      type2Count: g.type2Count,
      places: g.places,
    })),
    /**
     * AI Agent 的分析结论。
     *
     * 放进 JSON 而不只是 HTML，是因为这份报告本身就是给机器再消费的：
     * 下一轮分析、外部工具、CI 门禁都可以直接读 aiAnalysis.items，
     * 拿到「上一轮已经得出过什么结论」，不必把整包上下文重新喂一遍模型。
     * 这是省 token 链条上的最后一环 —— 结论可携带，才不必重算。
     */
    aiAnalysis: ai.insights
      ? {
          total: ai.insights.total,
          actionable: ai.insights.actionable,
          bySeverity: ai.insights.bySeverity,
          stableCount: ai.insights.stableCount,
          newCount: ai.insights.newCount,
          /** 产出这些结论的 Agent（用户自己配置的，不是写死的模型） */
          agents: ai.insights.agents,
          hotPaths: ai.insights.hotPaths,
          /** 无法在本次扫描结果中核实的引用原文，供人工甄别笔误还是幻觉 */
          unverifiedRefs: ai.insights.unverifiedRefs,
          /**
           * 时效分布。消费方（CI 门禁 / 下一轮分析）据此就能只挑 stale + orphaned 复核，
           * 不必把所有结论重新过一遍模型——这是「结论可携带」之后的第二层省法。
           */
          byFreshness: ai.insights.byFreshness,
          needsReview: ai.insights.needsReview,
          /**
           * 已收口结论数。resolved 不再计入 total / actionable / bySeverity，
           * 只走 resolvedItems 做审计闭环（与面板单独成档一致），避免污染待办统计。
           */
          resolvedCount: ai.insights.resolvedCount,
          items: ai.insights.items.map((i) => ({
            id: i.id,
            title: i.title,
            body: i.body,
            kind: i.kind,
            severity: i.severity,
            stability: i.stability,
            seenCount: i.seenCount,
            firstSeen: i.firstSeen,
            lastSeen: i.lastSeen,
            agentId: i.agentId,
            freshness: i.freshness,
            changedRefs: i.changedRefs,
            missingRefs: i.missingRefs,
            status: i.status ?? 'open',
            refs: i.refs.map((r) => ({
              path: r.path,
              line: r.line,
              verified: r.verified,
            })),
          })),
          resolvedItems: ai.insights.resolvedItems.map((i) => ({
            id: i.id,
            title: i.title,
            severity: i.severity,
            kind: i.kind,
            resolvedReason: i.resolvedReason ?? null,
            resolvedBy: i.resolvedBy ?? null,
          })),
        }
      : null,
    /** 数据可信度声明：哪些维度真的查过，哪些是盲区 */
    dataQuality: ai.quality
      ? {
          overall: ai.quality.overall,
          statement: ai.quality.statement,
          blindSpots: ai.quality.blindSpots,
          partial: ai.quality.partial,
          dimensions: ai.quality.rows,
        }
      : null,
  };

  return JSON.stringify(report, null, 2);
}

// ═══════════════════════════════════════════════════════════════
// SVG 报告（需求 §7.3「报告导出器 HTML/JSON/SVG」的 SVG 部分）
// 架构分层图 + 模块依赖连线（循环红色虚线）+ 复杂度热力条 + 技术债 + 设计模式 + 审查汇总
// ═══════════════════════════════════════════════════════════════

/** 复杂度等级 → 热力色（与画布 FileRenderer 保持一致） */
const COMPLEXITY_HEAT: Record<string, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#f97316',
  extreme: '#ef4444',
};

/** 技术债严重度 → 颜色 */
const TECH_DEBT_SEV: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
};

const PATTERN_LABEL_MAP: Record<string, string> = {
  singleton: 'report.pattern.singleton',
  factory: 'report.pattern.factory',
  observer: 'report.pattern.observer',
  strategy: 'report.pattern.strategy',
  builder: 'report.pattern.builder',
  repository: 'report.pattern.repository',
  service: 'report.pattern.service',
};

/** SVG 复杂度等级判定（与 utils/fileInsights.ts 阈值一致） */
function svgComplexityLevel(cc: number): string {
  if (cc <= 5) return 'low';
  if (cc <= 10) return 'medium';
  if (cc <= 20) return 'high';
  return 'extreme';
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * 生成 SVG 分析报告：一屏可读的「架构画像」
 * - 头部统计（文件/行数/依赖/循环依赖/审查/技术债）
 * - 语言分布条
 * - 架构分层模块图（按层分行排布 + 模块间依赖贝塞尔连线 + 循环依赖红色虚线）
 * - 模块复杂度热力点 + 技术债徽标
 * - 复杂度热力条（文件按圈复杂度降序，按等级着色）
 * - 技术债明细、设计模式命中、审查发现汇总
 */
export function generateReportSvg(data: ReportData): string {
  // 书场景（novel-zh）→ 作品分析报告 SVG（P0-1）
  if (data.analysis.primaryLanguage === 'novel-zh') return generateBookReportSvg(data.analysis, data.files);
  const {
    analysis,
    files,
    modules,
    dependencies,
    layers,
    findings,
    metrics,
    techDebt,
    patternHits,
    deadSymbols,
    callEdges,
    gitChurn,
    clones,
  } = data;
  const callAgg = aggregateCallGraph(callEdges);
  const cloneAgg = aggregateClones(clones, 14);
  const ai = prepareAiBlocks(data);

  const W = 1080;
  const parts: string[] = [];
  let y = 0;

  const totalFiles = files.length;
  const totalLines = files.reduce((s, f) => s + (f.lineCount || 0), 0);
  const circularDeps = dependencies.filter((d) => d.isCircular).length;
  const uniqueLangs = new Set(files.map((f) => f.language).filter(Boolean));

  // 文件 → 顶层目录（模块）映射（与画布「架构画像」口径一致）
  const topOf = (f: ProjectFile) => (f.isDirectory ? null : f.relPath.includes('/') ? f.relPath.split('/')[0] : 'root');
  const fileToTop = new Map<string, string | null>();
  for (const f of files) fileToTop.set(f.id, topOf(f));

  // 文件度量按 fileId 索引（模块复杂度聚合用）
  const metricByFile = new Map<string, FileMetric>();
  for (const m of metrics ?? []) metricByFile.set(m.fileId, m);

  // 技术债按 fileId 聚合
  const debtByFile = new Map<string, number>();
  for (const t of techDebt ?? []) debtByFile.set(t.fileId, (debtByFile.get(t.fileId) ?? 0) + 1);

  // ── 头部 ──
  parts.push(
    `<text x="40" y="${y + 34}" font-size="26" font-weight="700" fill="#f0f6fc">${escapeHtml(analysis.name)}</text>`,
  );
  parts.push(
    `<text x="40" y="${y + 58}" font-size="13" fill="#8b949e">${t('report.svg.subtitle', { time: formatDate(Math.floor(Date.now() / 1000)) })}</text>`,
  );
  if (analysis.projectRoot) {
    parts.push(
      `<text x="40" y="${y + 80}" font-size="12" fill="#58a6ff">📁 ${escapeHtml(analysis.projectRoot)}</text>`,
    );
  }
  y += 100;

  // ── 统计条 ──
  const stats = [
    { label: t('report.meta.scannedFiles'), value: `${totalFiles}` },
    { label: t('report.meta.codeLines'), value: totalLines.toLocaleString() },
    { label: t('report.meta.languages'), value: `${uniqueLangs.size}` },
    { label: t('report.meta.deps'), value: `${dependencies.length}` },
    { label: t('report.meta.circular'), value: `${circularDeps}`, danger: circularDeps > 0 },
    {
      label: t('report.meta.findings'),
      value: `${findings.length}`,
      danger: findings.filter((f) => f.severity === 'critical').length > 0,
    },
    { label: t('report.meta.techDebt'), value: `${techDebt?.length ?? 0}`, danger: (techDebt?.length ?? 0) > 0 },
    { label: t('report.meta.dupLines'), value: `${cloneAgg.wasteLines}`, danger: cloneAgg.wasteLines >= 500 },
  ];
  // AI 结论只在真有结论时占一格：架构画像是一屏视图，空格子等于浪费视觉预算
  if (ai.insights) {
    stats.push({
      label: t('report.meta.aiTodo'),
      value: `${ai.insights.actionable}`,
      danger: ai.insights.actionable > 0,
    });
  }
  const statW = (W - 80 - (stats.length - 1) * 12) / stats.length;
  stats.forEach((s, i) => {
    const x = 40 + i * (statW + 12);
    parts.push(`<rect x="${x}" y="${y}" width="${statW}" height="58" rx="8" fill="#161b22" stroke="#21262d"/>`);
    parts.push(
      `<text x="${x + 14}" y="${y + 26}" font-size="19" font-weight="700" fill="${s.danger ? '#f85149' : '#58a6ff'}">${s.value}</text>`,
    );
    parts.push(`<text x="${x + 14}" y="${y + 46}" font-size="11" fill="#8b949e">${s.label}</text>`);
  });
  y += 80;

  const sectionTitle = (title: string, badge: string) => {
    parts.push(`<text x="40" y="${y + 16}" font-size="16" font-weight="600" fill="#f0f6fc">${title}</text>`);
    parts.push(`<text x="40" y="${y + 34}" font-size="11" fill="#484f58">${badge}</text>`);
    y += 48;
  };

  // ── 数据可信度盲区（只在真有盲区时出现）──
  // 一屏画像最容易被当成「体检结论」直接引用，因此盲区必须在这一屏里说清楚，
  // 而不是躲在 HTML 版本的某个折叠区里。
  if (ai.quality && (ai.quality.blindSpots.length > 0 || ai.quality.partial.length > 0)) {
    const blind = ai.quality.blindSpots;
    const boxH = 52;
    parts.push(
      `<rect x="40" y="${y}" width="${W - 80}" height="${boxH}" rx="8" fill="${
        blind.length > 0 ? '#2d1416' : '#2b2413'
      }" stroke="${blind.length > 0 ? '#f8514955' : '#d2992255'}"/>`,
    );
    parts.push(
      `<text x="56" y="${y + 22}" font-size="12" font-weight="600" fill="${
        blind.length > 0 ? '#ffa198' : '#e3b341'
      }">${blind.length > 0 ? t('report.svg.blind', { list: escapeHtml(trunc(blind.join('、'), 70)) }) : t('report.svg.partial', { list: escapeHtml(trunc(ai.quality.partial.join('、'), 70)) })}</text>`,
    );
    parts.push(
      `<text x="56" y="${y + 40}" font-size="11" fill="#8b949e">${
        blind.length > 0 ? t('report.svg.blindNote') : t('report.svg.partialNote')
      }</text>`,
    );
    y += boxH + 20;
  }

  // ── AI 深度分析结论 ──
  if (ai.insights) {
    const s = ai.insights;
    sectionTitle(
      t('report.ai.title'),
      `${t('report.svg.aiBadge', { n: s.total, a: s.actionable, s: s.stableCount })}${
        s.resolvedCount > 0 ? t('report.svg.aiResolved', { n: s.resolvedCount }) : ''
      }${s.needsReview > 0 ? t('report.svg.aiReview', { n: s.needsReview }) : ''}${
        s.agents.length > 0 ? t('report.svg.aiAgents', { agents: trunc(s.agents.join('、'), 40) }) : ''
      }`,
    );
    const top = s.items.slice(0, 6);
    for (const it of top) {
      parts.push(`<rect x="40" y="${y}" width="4" height="30" rx="2" fill="${it.severityColor}"/>`);
      parts.push(
        `<text x="54" y="${y + 13}" font-size="12" font-weight="600" fill="#e1e4e8">${escapeHtml(
          trunc(it.title, 78),
        )}</text>`,
      );
      const refText = it.refs
        .slice(0, 3)
        .map((r) => r.path + (r.line ? `:${r.line}` : ''))
        .join('  ');
      // 一屏画像里，「这条结论所依据的代码已经变了」比任何统计都更该被看见
      const staleMark = it.freshness === 'stale' || it.freshness === 'orphaned' ? ` · ${it.freshnessLabel}` : '';
      parts.push(
        `<text x="54" y="${y + 28}" font-size="10.5" fill="${
          staleMark ? '#e3b341' : '#8b949e'
        }">${escapeHtml(it.severityLabel)} · ${escapeHtml(it.kindLabel)}${
          it.seenCount > 1 ? t('report.svg.rounds', { n: it.seenCount }) : ''
        }${escapeHtml(staleMark)}${refText ? ` · ${escapeHtml(trunc(refText, 74))}` : ''}</text>`,
      );
      y += 38;
    }
    if (s.total > top.length) {
      parts.push(
        `<text x="54" y="${y + 10}" font-size="11" fill="#484f58">${t('report.svg.moreInsights', { n: s.total - top.length })}</text>`,
      );
      y += 22;
    }
    if (s.needsReview > 0) {
      parts.push(
        `<text x="54" y="${y + 10}" font-size="11" fill="#e3b341">${t('report.svg.reviewWarn', { n: s.needsReview })}</text>`,
      );
      y += 22;
    }
    if (s.unverifiedRefs.length > 0) {
      parts.push(
        `<text x="54" y="${y + 10}" font-size="11" fill="#ffa198">${t('report.svg.unverifiedWarn', { n: s.unverifiedRefs.length })}</text>`,
      );
      y += 22;
    }
    y += 18;
  }

  // ── 语言分布 ──
  sectionTitle(t('report.section.lang'), t('report.svg.langBadge', { n: uniqueLangs.size }));
  const langCount = files.reduce(
    (acc, f) => {
      const l = f.language || t('report.meta.unknown');
      acc[l] = (acc[l] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const langRows = Object.entries(langCount).sort((a, b) => b[1] - a[1]);
  const langBarW = W - 80 - 150;
  const maxLang = langRows[0]?.[1] ?? 1;
  for (const [lang, count] of langRows) {
    const bw = Math.max(2, (count / maxLang) * langBarW);
    parts.push(`<text x="40" y="${y + 13}" font-size="12" fill="#8b949e">${escapeHtml(trunc(lang, 14))}</text>`);
    parts.push(`<rect x="150" y="${y + 2}" width="${bw}" height="14" rx="3" fill="${getLanguageColor(lang)}"/>`);
    parts.push(`<text x="${150 + langBarW + 12}" y="${y + 13}" font-size="12" fill="#e1e4e8">${count}</text>`);
    y += 22;
  }
  y += 18;

  // ── 架构分层与模块 ──
  sectionTitle(t('report.section.layers'), t('report.svg.layersBadge', { n: modules.length, m: dependencies.length }));
  const nodeW = 214;
  const nodeH = 68;
  const colGap = 26;
  const rowGap = 34;
  const layered = layers.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const layerRows: { label: string; color: string; mods: ProjectModule[] }[] = layered.map((l) => ({
    label: l.name,
    color: l.color || '#6b7280',
    mods: modules.filter((m) => m.layerId === l.id),
  }));
  const unlayered = modules.filter((m) => !m.layerId || !layers.some((l) => l.id === m.layerId));
  if (unlayered.length > 0) layerRows.push({ label: t('report.svg.unlayered'), color: '#6b7280', mods: unlayered });

  const placed = new Map<string, { x: number; y: number }>();
  const left = 40;
  for (const row of layerRows) {
    if (row.mods.length === 0) continue;
    // 分层色块 + 名称（位于 section 副标题下方、模块节点上方，留 16px 间距避免压字）
    parts.push(
      `<rect x="${left}" y="${y + 8}" width="8" height="8" rx="2" fill="${row.color}"/>` +
        `<text x="${left + 16}" y="${y + 15}" font-size="12" font-weight="600" fill="#8b949e">${escapeHtml(row.label)}</text>`,
    );
    y += 28;
    let x = left;
    for (const m of row.mods) {
      placed.set(m.id, { x, y });
      // 模块级复杂度聚合：该模块下文件的度量
      const modFiles = files.filter((f) => !f.isDirectory && fileToTop.get(f.id) === m.name);
      const ccs = modFiles.map((f) => metricByFile.get(f.id)?.cyclomaticComplexity ?? 0).filter((c) => c > 0);
      const avgCc = ccs.length > 0 ? ccs.reduce((a, b) => a + b, 0) / ccs.length : 0;
      const maxCc = ccs.length > 0 ? Math.max(...ccs) : 0;
      const level = avgCc > 0 ? svgComplexityLevel(avgCc) : 'low';
      const heat = COMPLEXITY_HEAT[level] ?? '#22c55e';
      const debtCount = modFiles.reduce((acc, f) => acc + (debtByFile.get(f.id) ?? 0), 0);
      const lineCount = modFiles.reduce((acc, f) => acc + (f.lineCount || 0), 0);
      const fill = row.color + '2e';
      parts.push(
        `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="8" fill="${fill}" stroke="${row.color}"/>` +
          `<rect x="${x}" y="${y}" width="4" height="${nodeH}" rx="2" fill="${row.color}"/>` +
          `<circle cx="${x + nodeW - 14}" cy="${y + 14}" r="5" fill="${heat}"/>` +
          `<text x="${x + 14}" y="${y + 24}" font-size="13" font-weight="600" fill="#f0f6fc">${escapeHtml(trunc(m.name, 20))}</text>` +
          `<text x="${x + 14}" y="${y + 44}" font-size="11" fill="#8b949e">${t('report.svg.moduleMeta', { n: m.fileCount, m: m.depCount, l: lineCount >= 1000 ? (lineCount / 1000).toFixed(1) + 'k' : String(lineCount) })}</text>` +
          `<text x="${x + 14}" y="${y + 60}" font-size="11" fill="${heat}">${avgCc > 0 ? t('report.svg.ccAvg', { n: avgCc.toFixed(1) }) + (maxCc > 20 ? t('report.svg.ccPeak', { n: maxCc }) : '') : '—'}</text>` +
          (debtCount > 0
            ? `<text x="${x + nodeW - 40}" y="${y + 60}" font-size="11" fill="#f59e0b">⚠ ${debtCount}</text>`
            : ''),
      );
      x += nodeW + colGap;
    }
    y += nodeH + rowGap;
  }

  // 模块级依赖连线（文件级 deps 按顶层目录聚合，与画布架构画像一致）
  const moduleNameToId = new Map(modules.map((m) => [m.name, m.id]));
  const drawnEdges = new Set<string>();
  for (const d of dependencies) {
    const fromTop = fileToTop.get(d.fromId);
    const toTop = fileToTop.get(d.toId);
    if (!fromTop || !toTop || fromTop === toTop) continue;
    const fromId = moduleNameToId.get(fromTop);
    const toId = moduleNameToId.get(toTop);
    if (!fromId || !toId) continue;
    const key = `${fromId}->${toId}`;
    if (drawnEdges.has(key)) continue;
    drawnEdges.add(key);
    const a = placed.get(fromId);
    const b = placed.get(toId);
    if (!a || !b) continue;
    const x1 = a.x + nodeW;
    const y1 = a.y + nodeH / 2;
    const x2 = b.x;
    const y2 = b.y + nodeH / 2;
    const cx = (x1 + x2) / 2;
    const stroke = d.isCircular ? '#ef4444' : '#58a6ff';
    const dash = d.isCircular ? ' stroke-dasharray="6 4"' : '';
    parts.push(
      `<path d="M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="1.6" opacity="0.75"${dash} marker-end="url(#dep-arrow)"/>` +
        (d.isCircular
          ? `<text x="${(x1 + x2) / 2 - 14}" y="${(y1 + y2) / 2 - 6}" font-size="10" fill="#ef4444">${t('report.svg.cycle')}</text>`
          : ''),
    );
  }

  // ── 复杂度热力条 ──
  y += 22;
  const metricRows = (metrics ?? [])
    .filter((m) => m.cyclomaticComplexity > 0)
    .sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity)
    .slice(0, 60);
  if (metricRows.length > 0) {
    sectionTitle(t('report.section.complexity'), t('report.svg.complexityBadge', { n: metricRows.length }));
    const heatBarW = W - 80 - 220;
    const maxCc = metricRows[0].cyclomaticComplexity || 1;
    const fileById = new Map(files.map((f) => [f.id, f]));
    for (const m of metricRows) {
      const f = fileById.get(m.fileId);
      const label = f ? f.relPath || f.name : m.filePath;
      const lvl = m.complexityLevel || svgComplexityLevel(m.cyclomaticComplexity);
      const color = COMPLEXITY_HEAT[lvl] ?? '#22c55e';
      const bw = Math.max(2, (m.cyclomaticComplexity / maxCc) * heatBarW);
      parts.push(
        `<text x="40" y="${y + 11}" font-size="11" fill="#8b949e" text-anchor="end">${m.cyclomaticComplexity}</text>` +
          `<rect x="150" y="${y}" width="${bw}" height="12" rx="2" fill="${color}"/>` +
          `<text x="${150 + heatBarW + 12}" y="${y + 11}" font-size="11" fill="#e1e4e8">${escapeHtml(trunc(label, 58))}</text>`,
      );
      y += 18;
    }
    y += 16;
  }

  // ── 技术债明细 ──
  const debtRows = (techDebt ?? []).slice(0, 40);
  if (debtRows.length > 0) {
    sectionTitle(t('report.section.techDebt'), t('report.svg.techDebtBadge', { n: techDebt?.length ?? 0 }));
    for (const t of debtRows) {
      const color = TECH_DEBT_SEV[t.severity] ?? '#3b82f6';
      const chipW = 12 + t.marker.length * 8 + 8;
      parts.push(
        `<rect x="40" y="${y - 12}" width="${chipW}" height="18" rx="9" fill="${color}22" stroke="${color}"/>` +
          `<text x="${40 + chipW / 2}" y="${y + 1}" font-size="10" font-weight="600" fill="${color}" text-anchor="middle">${escapeHtml(t.marker)}</text>` +
          `<text x="${50 + chipW}" y="${y + 1}" font-size="11" fill="#e1e4e8">${escapeHtml(trunc(t.filePath + ':' + t.lineNo, 52))}</text>` +
          `<text x="${620}" y="${y + 1}" font-size="10" fill="#484f58">${escapeHtml(trunc(t.snippet, 44))}</text>`,
      );
      y += 26;
    }
    y += 14;
  }

  // ── 设计模式命中 ──
  const patternAgg = new Map<string, number>();
  for (const p of patternHits ?? []) patternAgg.set(p.pattern, (patternAgg.get(p.pattern) ?? 0) + 1);
  if (patternAgg.size > 0) {
    sectionTitle(t('report.section.patterns'), t('report.svg.patternsBadge', { n: patternAgg.size }));
    let px = left;
    const py = y - 6;
    for (const [pat, count] of patternAgg) {
      const label = t(PATTERN_LABEL_MAP[pat] ?? pat);
      const w = 26 + label.length * 14 + 14;
      if (px + w > W - 40) {
        y += 30;
        px = left;
      }
      parts.push(
        `<rect x="${px}" y="${py}" width="${w}" height="24" rx="12" fill="#1f2937" stroke="#374151"/>` +
          `<text x="${px + 14}" y="${py + 16}" font-size="12" fill="#f0f6fc">${escapeHtml(label)}</text>` +
          `<text x="${px + w - 8}" y="${py + 16}" font-size="11" fill="#8b949e" text-anchor="end">×${count}</text>`,
      );
      px += w + 10;
    }
    y += 30;
  }

  // ── 审查发现汇总 ──
  sectionTitle(t('report.section.findingsSum'), t('report.svg.findingsSumBadge', { n: findings.length }));
  const sevCounts = [
    { sev: 'critical', label: t('report.sev.critical'), color: '#d32f2f' },
    { sev: 'error', label: t('report.sev.error'), color: '#f44336' },
    { sev: 'warning', label: t('report.sev.warning'), color: '#ff9800' },
    { sev: 'info', label: t('report.sev.info'), color: '#2196f3' },
  ];
  let sx = left;
  for (const s of sevCounts) {
    const count = findings.filter((f) => f.severity === s.sev).length;
    const w = 108;
    parts.push(
      `<rect x="${sx}" y="${y - 10}" width="${w}" height="34" rx="6" fill="#161b22" stroke="${s.color}" stroke-opacity="0.4"/>` +
        `<circle cx="${sx + 16}" cy="${y + 7}" r="4" fill="${s.color}"/>` +
        `<text x="${sx + 28}" y="${y + 11}" font-size="12" fill="#e1e4e8">${s.label}</text>` +
        `<text x="${sx + w - 12}" y="${y + 11}" font-size="13" font-weight="700" fill="${s.color}" text-anchor="end">${count}</text>`,
    );
    sx += w + 10;
  }
  y += 44;

  // ── 函数调用热点 ──
  if (callAgg.total > 0) {
    sectionTitle(
      t('report.section.callHot'),
      t('report.callHot.badge', { n: callAgg.total, cross: callAgg.crossFile }),
    );
    const colW = (W - 80 - 40) / 2;
    parts.push(
      `<text x="40" y="${y + 12}" font-size="12" font-weight="600" fill="#ef4444">${t('report.callHot.targetShort')}</text>`,
    );
    parts.push(
      `<text x="${40 + colW + 40}" y="${y + 12}" font-size="12" font-weight="600" fill="#3b82f6">${t('report.callHot.sourceShort')}</text>`,
    );
    y += 26;
    const rows = Math.max(callAgg.hotTargets.length, callAgg.hotSources.length);
    for (let i = 0; i < rows; i++) {
      const t = callAgg.hotTargets[i];
      const s = callAgg.hotSources[i];
      if (t) {
        parts.push(
          `<text x="40" y="${y + 11}" font-size="11" fill="#e1e4e8" font-family="monospace">${escapeHtml(trunc(t.name + ' ×' + t.count, 26))}</text>`,
        );
        parts.push(
          `<text x="40" y="${y + 23}" font-size="9" fill="#484f58">${escapeHtml(trunc(t.filePath, 38))}</text>`,
        );
      }
      if (s) {
        parts.push(
          `<text x="${40 + colW + 40}" y="${y + 11}" font-size="11" fill="#e1e4e8" font-family="monospace">${escapeHtml(trunc(s.name + ' ×' + s.count, 26))}</text>`,
        );
        parts.push(
          `<text x="${40 + colW + 40}" y="${y + 23}" font-size="9" fill="#484f58">${escapeHtml(trunc(s.filePath, 38))}</text>`,
        );
      }
      y += 30;
    }
    y += 10;
  }

  // ── 死代码 ──
  if (deadSymbols && deadSymbols.length > 0) {
    sectionTitle(t('report.section.dead'), t('report.dead.badge', { n: deadSymbols.length }));
    const rowsD = deadSymbols.slice(0, 24);
    for (const d of rowsD) {
      const color = d.confidence === 'high' ? '#f85149' : d.confidence === 'medium' ? '#f59e0b' : '#8b949e';
      parts.push(`<circle cx="46" cy="${y + 5}" r="4" fill="${color}"/>`);
      parts.push(
        `<text x="62" y="${y + 9}" font-size="11" fill="#e1e4e8" font-family="monospace">${escapeHtml(trunc(d.name + ' (' + d.visibility + ')', 34))}</text>`,
      );
      parts.push(
        `<text x="62" y="${y + 23}" font-size="9" fill="#484f58">${escapeHtml(trunc(d.filePath + ':' + d.lineStart + ' · ' + d.reason, 84))}</text>`,
      );
      y += 30;
    }
    y += 8;
  }

  // ── 重复代码（克隆检测）──
  if (cloneAgg.groups > 0) {
    sectionTitle(
      t('report.clone.svgTitle'),
      `${t('report.clone.svgBadge', { n: cloneAgg.groups, m: cloneAgg.instances, f: cloneAgg.affectedFiles, w: cloneAgg.wasteLines })}${
        cloneAgg.type2Instances > 0 ? t('report.clone.svgType2', { n: cloneAgg.type2Instances }) : ''
      }`,
    );
    const barW = 300;
    const maxWaste = cloneAgg.topGroups[0]?.waste || 1;
    for (const g of cloneAgg.topGroups) {
      const bw = Math.max(2, (g.waste / maxWaste) * barW);
      const color = g.waste >= 120 ? '#ef4444' : g.waste >= 40 ? '#f59e0b' : '#14b8a6';
      // 位置列表用「首个副本 + 其余数量」，全列会把行高撑爆
      const head = g.places[0];
      const restCount = g.size - 1;
      const where = head
        ? `${trunc(head.filePath, 42)}:${head.startLine}-${head.endLine}${
            restCount > 0 ? t('report.clone.more', { n: g.size }) : ''
          }`
        : '';
      parts.push(
        `<text x="80" y="${y + 11}" font-size="11" fill="#8b949e" text-anchor="end">${t('report.clone.wasteLines', { n: g.waste })}</text>` +
          `<rect x="90" y="${y}" width="${bw}" height="12" rx="2" fill="${color}"/>` +
          `<text x="${90 + barW + 14}" y="${y + 11}" font-size="10" fill="#e1e4e8">${escapeHtml(where)}</text>` +
          (g.type2Count > 0
            ? `<text x="${W - 130}" y="${y + 11}" font-size="10" fill="#a78bfa" text-anchor="end">${t('report.clone.type2')}</text>`
            : '') +
          `<text x="${W - 40}" y="${y + 11}" font-size="10" fill="#484f58" text-anchor="end">${g.size} × ${g.lines} ${t('report.th.lines')}</text>`,
      );
      y += 20;
    }
    y += 14;
  }

  // ── git 变更热点 + 重构象限 ──
  if (gitChurn && gitChurn.length > 0) {
    const metricLevelByFile = new Map<string, string>();
    for (const m of metrics ?? []) metricLevelByFile.set(m.fileId, m.complexityLevel);
    const rowsC = gitChurn
      .slice()
      .sort((a, b) => b.churnScore - a.churnScore)
      .slice(0, 18);
    sectionTitle(t('report.section.git'), t('report.git.badge', { n: gitChurn.length }));
    const barW = 360;
    const maxChurn = rowsC[0]?.churnScore || 1;
    for (const c of rowsC) {
      const lvl = c.hotspotLevel as any;
      const xlvl = (metricLevelByFile.get(c.fileId) || 'low') as any;
      const quad = quadrantOf(xlvl, lvl);
      const qm = QUADRANT_META[quad];
      const bw = Math.max(2, (c.churnScore / maxChurn) * barW);
      parts.push(
        `<text x="40" y="${y + 11}" font-size="11" fill="#8b949e" text-anchor="end">${c.churnScore}</text>` +
          `<rect x="90" y="${y}" width="${bw}" height="12" rx="2" fill="#f97316"/>` +
          `<text x="${90 + barW + 14}" y="${y + 11}" font-size="10" fill="#e1e4e8">${escapeHtml(trunc(c.filePath, 40))}</text>` +
          `<circle cx="${90 + barW + 14 + 320}" cy="${y + 6}" r="4" fill="${qm.color}"/>` +
          `<text x="${90 + barW + 14 + 330}" y="${y + 11}" font-size="9" fill="${qm.color}">${resolveFragments(qm.label)}</text>`,
      );
      y += 18;
    }
    y += 12;
  }

  // ── 页脚 ──
  parts.push(`<line x1="40" y1="${y}" x2="${W - 40}" y2="${y}" stroke="#21262d"/>`);
  parts.push(
    `<text x="40" y="${y + 26}" font-size="11" fill="#484f58">${t('report.generatedBy')} · ${formatDate(Math.floor(Date.now() / 1000))}</text>`,
  );
  const H = y + 44;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">
<defs>
  <marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 1 L 9 5 L 0 9 z" fill="#58a6ff"/>
  </marker>
</defs>
<rect width="${W}" height="${H}" fill="#0f1117"/>
${parts.join('\n')}
</svg>`;
}

/** 报告导出格式枚举（导出对话框用） */
export type ReportFormat = 'html' | 'json' | 'svg';
