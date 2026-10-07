/**
 * 网格画像
 *
 * PORTRAIT_SPECS/gridStyle/runGridPortrait（声明式网格画像引擎，统一 renderMetricPortrait 落库）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { GRID_TIER_COLOR, PORTRAIT_THRESHOLDS } from './constants';
import { renderMetricPortrait } from './metrics';
import { currentInsights } from './shared';
import { type GridPortraitKind, type PortraitOutcome, type PortraitSpec } from './types';
import { t } from '../../../i18n';
import { useProjectStore } from '../../../store/projectStore';
import { duplicationLevelOf, emptyFileInsight, type FileInsight } from '.././fileInsights';
import { summarizeTechDebt, formatDebtHours } from '.././techDebtScore';


export const PORTRAIT_SPECS: Record<GridPortraitKind, PortraitSpec> = {
  complexity: {
    labelKey: 'portrait.spec.complexity.label',
    cols: 8,
    colW: 190,
    rowH: 76,
    rank: (a, b) => b.complexity - a.complexity,
    emptyHintKey: 'portrait.spec.complexity.empty',
    summarize: (rows) => {
      const risky = rows.filter((r) => r.ins.complexityLevel === 'extreme' || r.ins.complexityLevel === 'high').length;
      return t('portrait.spec.complexity.done', {
        n: rows.length,
        risky: risky > 0 ? t('portrait.spec.complexity.risky', { n: risky }) : '',
      });
    },
  },
  techDebt: {
    labelKey: 'portrait.spec.techDebt.label',
    cols: 6,
    colW: 200,
    rowH: 80,
    include: (ins) => ins.techDebtCount > 0,
    rank: (a, b) => b.techDebtCount - a.techDebtCount,
    emptyHintKey: 'portrait.spec.techDebt.empty',
    summarize: (rows) => {
      const total = rows.reduce((acc, r) => acc + r.ins.techDebtCount, 0);
      // 需求点 C：技术债量化为「预计清偿工时」（SQALE 口径，纯前端聚合）
      const debt = useProjectStore.getState().techDebt;
      const hours = summarizeTechDebt(debt).hours;
      return t('portrait.spec.techDebt.done', {
        n: rows.length,
        total,
        hours: hours > 0 ? t('portrait.spec.techDebt.hours', { h: formatDebtHours(hours) }) : '',
      });
    },
  },
  churn: {
    labelKey: 'portrait.spec.churn.label',
    cols: 7,
    colW: 195,
    rowH: 78,
    include: (ins) => ins.churnScore > 0,
    rank: (a, b) => b.churnScore - a.churnScore,
    emptyHintKey: 'portrait.spec.churn.empty',
    summarize: (rows) => {
      const first = rows.filter((r) => r.ins.quadrant === 'refactorFirst').length;
      const commits = rows.reduce((acc, r) => acc + r.ins.commitCount, 0);
      return t('portrait.spec.churn.done', {
        n: rows.length,
        commits,
        first: first > 0 ? t('portrait.spec.churn.refactorFirst', { n: first }) : '',
      });
    },
  },
  deadCode: {
    labelKey: 'portrait.spec.deadCode.label',
    cols: 6,
    colW: 200,
    rowH: 80,
    include: (ins) => ins.deadCount > 0,
    rank: (a, b) => b.deadCount - a.deadCount,
    emptyHintKey: 'portrait.spec.deadCode.empty',
    summarize: (rows) => {
      const total = rows.reduce((acc, r) => acc + r.ins.deadCount, 0);
      return t('portrait.spec.deadCode.done', { n: rows.length, total });
    },
  },
  syntax: {
    labelKey: 'portrait.spec.syntax.label',
    cols: 6,
    colW: 200,
    rowH: 80,
    include: (ins) => ins.syntaxErrorCount > 0,
    rank: (a, b) => b.syntaxErrorCount - a.syntaxErrorCount,
    emptyHintKey: 'portrait.spec.syntax.empty',
    summarize: (rows) => {
      const total = rows.reduce((acc, r) => acc + r.ins.syntaxErrorCount, 0);
      return t('portrait.spec.syntax.done', { n: rows.length, total });
    },
  },
  risk: {
    labelKey: 'portrait.spec.risk.label',
    cols: 6,
    colW: 200,
    rowH: 80,
    include: (ins) => ins.riskScore > 0,
    rank: (a, b) => b.riskScore - a.riskScore,
    emptyHintKey: 'portrait.spec.risk.empty',
    summarize: (rows) => {
      const err = rows.reduce((acc, r) => acc + r.ins.findingSeverities.error, 0);
      const warn = rows.reduce((acc, r) => acc + r.ins.findingSeverities.warning, 0);
      return t('portrait.spec.risk.done', { n: rows.length, err, warn });
    },
  },
  duplication: {
    labelKey: 'portrait.spec.duplication.label',
    cols: 6,
    colW: 200,
    rowH: 80,
    include: (ins) => ins.cloneCount > 0,
    // 先按重复率排，重复率相同再按绝对重复行数 —— 只按行数排会让
    // 一个 3000 行的巨型文件里 60 行重复排在 80 行文件里 50 行重复的前面，
    // 但后者的「烂」程度显然更高。
    rank: (a, b) => b.duplicationRatio - a.duplicationRatio || b.duplicatedLines - a.duplicatedLines,
    emptyHintKey: 'portrait.spec.duplication.empty',
    summarize: (rows) => {
      const blocks = rows.reduce((acc, r) => acc + r.ins.cloneCount, 0);
      const lines = rows.reduce((acc, r) => acc + r.ins.duplicatedLines, 0);
      const type2 = rows.reduce((acc, r) => acc + r.ins.cloneType2Count, 0);
      const worst = rows[0];
      return t('portrait.spec.duplication.done', {
        n: rows.length,
        blocks,
        lines,
        type2: type2 > 0 ? t('portrait.spec.duplication.type2', { n: type2 }) : '',
        worst: worst
          ? t('portrait.spec.duplication.worst', {
              name: worst.file.name,
              pct: (worst.ins.duplicationRatio * 100).toFixed(0),
            })
          : '',
      });
    },
  },
};

/** 网格画像的精准着色 + 徽标：把单维指标翻译成「色条 + 卡上主指标 + 悬浮详情」 */
function gridStyle(
  kind: GridPortraitKind,
  ins: FileInsight,
): {
  accentColor: string;
  metricBadge: string;
  metricTitle: string;
} {
  switch (kind) {
    case 'complexity':
      return {
        accentColor: GRID_TIER_COLOR[ins.complexityLevel] ?? '#22c55e',
        metricBadge: `CC${ins.complexity}`,
        metricTitle: t('portrait.metric.complexity', { n: ins.complexity, level: ins.complexityLevel }),
      };
    case 'techDebt':
      return {
        accentColor: ins.techDebtCount >= 10 ? '#ef4444' : ins.techDebtCount >= 4 ? '#f97316' : '#eab308',
        metricBadge: t('portrait.metric.debtBadge', { n: ins.techDebtCount }),
        metricTitle: t('portrait.metric.techDebt', { n: ins.techDebtCount }),
      };
    case 'churn':
      return {
        accentColor: GRID_TIER_COLOR[ins.churnLevel] ?? '#22c55e',
        metricBadge: t('portrait.metric.churnBadge', { n: ins.commitCount }),
        metricTitle: t('portrait.metric.churn', { n: ins.commitCount, level: ins.churnLevel }),
      };
    case 'deadCode': {
      const n = ins.deadCount;
      const color =
        n >= PORTRAIT_THRESHOLDS.deadCode.red
          ? '#ef4444'
          : n >= PORTRAIT_THRESHOLDS.deadCode.orange
            ? '#f59e0b'
            : '#22c55e';
      const level =
        n >= PORTRAIT_THRESHOLDS.deadCode.red
          ? t('portrait.metric.deadLevelHigh')
          : n >= PORTRAIT_THRESHOLDS.deadCode.orange
            ? t('portrait.metric.deadLevelMid')
            : t('portrait.metric.deadLevelLow');
      return {
        accentColor: color,
        metricBadge: t('portrait.metric.deadBadge', { n }),
        metricTitle: t('portrait.metric.deadCode', { n, level }),
      };
    }
    case 'syntax': {
      const n = ins.syntaxErrorCount;
      return {
        accentColor: n > 0 ? '#ef4444' : '#22c55e',
        metricBadge: `✕${n}`,
        metricTitle: t('portrait.metric.syntax', { n }),
      };
    }
    case 'risk':
      return {
        accentColor: ins.riskScore >= 40 ? '#ef4444' : ins.riskScore >= 15 ? '#f97316' : '#eab308',
        metricBadge: `⚠${ins.findingCount}`,
        metricTitle: t('portrait.metric.risk', {
          e: ins.findingSeverities.error,
          w: ins.findingSeverities.warning,
          s: ins.riskScore,
        }),
      };
    case 'duplication':
      return {
        accentColor: GRID_TIER_COLOR[duplicationLevelOf(ins.duplicationRatio)] ?? '#22c55e',
        metricBadge: t('portrait.metric.cloneBadge', { n: ins.cloneCount }),
        metricTitle: t('portrait.metric.duplication', {
          n: ins.cloneCount,
          lines: ins.duplicatedLines,
          pct: Math.round(ins.duplicationRatio * 100),
        }),
      };
  }
}

/** 网格式文件画像（complexity / techDebt / churn / deadCode / risk / duplication 共用）
 * 统一走 renderMetricPortrait → 一次性 addComponentsBulk 落库，不再逐条 addComponent（避开 O(N²)）。 */
export async function runGridPortrait(kind: GridPortraitKind, analysisId: string): Promise<PortraitOutcome> {
  const spec = PORTRAIT_SPECS[kind];
  const pst = useProjectStore.getState();
  const insights = currentInsights();

  const rows = pst.files
    .filter((f) => !f.isDirectory)
    .map((f) => ({ file: f, ins: insights.get(f.id) ?? emptyFileInsight() }))
    .filter((r) => (spec.include ? spec.include(r.ins) : true))
    .sort((a, b) => spec.rank(a.ins, b.ins))
    .map(({ file, ins }) => ({ file, ins, ...gridStyle(kind, ins) }));

  if (rows.length === 0) {
    return { ok: false, message: t(spec.emptyHintKey), severity: 'info', placed: 0 };
  }

  return renderMetricPortrait(kind, analysisId, rows, {
    cols: spec.cols,
    colW: spec.colW,
    rowH: spec.rowH,
    emptyHint: t(spec.emptyHintKey),
    summarize: spec.summarize,
  });
}
