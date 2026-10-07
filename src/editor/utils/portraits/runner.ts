/**
 * 画像统一入口
 *
 * runPortrait 分发 + VIEW_TEMPLATE_PORTRAIT + portraitForTemplate。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { runApiTracePortrait } from './apiTrace';
import { runArchitecturePortrait } from './architecture';
import { runCallGraphPortrait } from './callGraph';
import { resetPending } from './canvas';
import { runChangeCouplingPortrait } from './changeCoupling';
import { runDataFlowPortrait } from './dataFlow';
import { runDependencyPortrait } from './dependency';
import { runDirectoryPortrait } from './directory';
import { runExecutionFlowPortrait } from './executionFlow';
import { runGridPortrait } from './grid';
import { runFunctionHotspotPortrait } from './hotspot';
import { runSecurityPortrait, runApiSurfacePortrait, runErrorHandlingPortrait, runLoggingPortrait, runCommentRatioPortrait } from './metrics-scan';
import { runTestCoveragePortrait, runBusFactorPortrait, runRipplePortrait, runDocsCoveragePortrait } from './metrics';
import { runModuleGraphPortrait } from './moduleGraph';
import { runPatternsPortrait } from './patterns';
import { runQuadrantPortrait } from './quadrant';
import { runLayeringPortrait, runCouplingPortrait } from './structure';
import { runSymbolsPortrait } from './symbols';
import { runTaintFlowPortrait } from './taintFlow';
import { type GridPortraitKind, type PortraitKind, type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { useEditorStore } from '../../../store/editorStore';
import { type TaintView } from '.././taintFlow';


/** 统一入口 */
export async function runPortrait(
  kind: PortraitKind,
  analysisId: string,
  filter?: { query?: string; kinds?: string[]; focusFileId?: string },
  projectRoot?: string | null,
  options?: {
    forceRedetect?: boolean;
    nameFilter?: string;
    apiTraceView?: 'all' | 'orphan' | 'dead';
    taintView?: TaintView;
  },
): Promise<PortraitOutcome> {
  if (!analysisId) {
    return { ok: false, message: t('portrait.msg.noAnalysis'), severity: 'warning', placed: 0 };
  }
  const editor = useEditorStore.getState();
  // v2.17 依赖画像焦点子图：把焦点文件落到会话态，工具条「总览」可一键复位；
  // 非依赖画像不触碰该状态，避免污染其它画像。
  if (kind === 'dependency') {
    editor.setDepFocusFileId(filter?.focusFileId ?? null);
  }
  editor.beginBatch();
  resetPending();
  try {
    switch (kind) {
      case 'callGraph':
        return runCallGraphPortrait(analysisId, false);
      case 'callGraph_redetect':
        // 菜单「调用链（重新分析）」：强制对源码重跑调用图分析并刷新画像。
        return runCallGraphPortrait(analysisId, true);
      case 'executionFlow':
        return runExecutionFlowPortrait(analysisId);
      case 'apiTrace':
        return runApiTracePortrait(analysisId, options?.apiTraceView ?? 'all');
      case 'taintFlow':
        return runTaintFlowPortrait(analysisId, options?.taintView ?? 'all');
      case 'architecture':
        return runArchitecturePortrait(analysisId);
      case 'dependency':
        return runDependencyPortrait(analysisId, filter?.focusFileId);
      case 'layering':
        return runLayeringPortrait(analysisId);
      case 'coupling':
        return runCouplingPortrait(analysisId);
      case 'changeCoupling': {
        // v2.18：与 dep 入口同形态——把焦点文件落会话态，避免下次切到 dep 时残留
        const focusId = filter?.focusFileId ?? null;
        useEditorStore.getState().setCouplingFocusFileId(focusId);
        return runChangeCouplingPortrait(analysisId, {
          filter: undefined, // filter 走 store.couplingFilter（前端切片，UI 切换即生效）
          windowDays: undefined, // windowDays 走 store.couplingWindowDays（UI 切时窗已先触发 invoke 重扫落库）
          focusFileId: focusId,
        });
      }
      case 'quadrant':
        return runQuadrantPortrait(analysisId, projectRoot, options?.forceRedetect, options?.nameFilter);
      case 'directory':
        return runDirectoryPortrait(analysisId);
      case 'moduleGraph':
        return runModuleGraphPortrait(analysisId);
      case 'patterns':
        return runPatternsPortrait(analysisId, projectRoot, options?.forceRedetect);
      case 'patterns_redetect':
        // 菜单「设计模式（重新检测）」：强制对源码重跑引擎并刷新画像。
        return runPatternsPortrait(analysisId, projectRoot, true);
      case 'symbols':
        return runSymbolsPortrait(analysisId, filter);
      case 'hotspotFunctions':
        return runFunctionHotspotPortrait(analysisId);
      case 'hotspotFunctions_redetect':
        return runFunctionHotspotPortrait(analysisId, true);
      case 'dataFlow':
        return runDataFlowPortrait(analysisId, false);
      case 'dataFlow_redetect':
        // 菜单「数据流（重新分析）」：强制对源码重跑 dataFlow 分析并刷新画像。
        return runDataFlowPortrait(analysisId, true);
      case 'testCoverage':
        return runTestCoveragePortrait(analysisId);
      case 'busFactor':
        return runBusFactorPortrait(analysisId);
      case 'ripple':
        return runRipplePortrait(analysisId);
      case 'docsCoverage':
        return runDocsCoveragePortrait(analysisId);
      case 'security':
        return runSecurityPortrait(analysisId);
      case 'apiSurface':
        return runApiSurfacePortrait(analysisId);
      case 'errorHandling':
        return runErrorHandlingPortrait(analysisId);
      case 'logging':
        return runLoggingPortrait(analysisId);
      case 'commentRatio':
        return runCommentRatioPortrait(analysisId);
      default:
        // 其余未识别 kind 兜底到网格画像（impact 是定向画像，不在此路径）
        return runGridPortrait(kind as GridPortraitKind, analysisId);
    }
  } finally {
    editor.endBatch();
  }
}

/**
 * 视角模板 → 画像动作映射
 *
 * 需求「视角模板」原本只创建一个空视图，用户还得自己再点一次画像按钮 ——
 * 模板名字都叫「复杂度热力」了，创建完却是空白画布，这是断链。
 * 这里把模板 type 直接绑定到画像，创建即出图。
 */
export const VIEW_TEMPLATE_PORTRAIT: Record<string, PortraitKind> = {
  // ── 各 analyzer 插件实际注册的模板 type（必须全覆盖，否则新建视角=空白画布）──
  architecture: 'architecture', // TS / Rust / Python：架构总览
  dependency: 'dependency', // TS / Rust / Python：依赖关系图
  layering: 'layering', // TS / Rust / Python：分层视图
  complexity: 'complexity', // TS / Rust / Python：复杂度热力
  'unsafe-risk': 'risk', // Rust：unsafe / 风险聚焦
  'call-graph': 'callGraph', // Python：函数调用图
  // ── 常见别名（模板 type 命名风格不统一时的兜底）──
  directory: 'directory', // 目录结构（缩进冰柱图）
  'directory-tree': 'directory',
  'file-tree': 'directory',
  structure: 'directory',
  coupling: 'coupling', // 主序图（抽象度 × 不稳定性）
  'change-coupling': 'changeCoupling', // 变更耦合（总是一起改的文件对 / 隐性耦合）
  'temporal-coupling': 'changeCoupling',
  'hidden-coupling': 'changeCoupling',
  'co-change': 'changeCoupling',
  'complexity-heatmap': 'complexity',
  'dependency-graph': 'dependency',
  layers: 'layering',
  risk: 'risk',
  'tech-debt': 'techDebt',
  churn: 'churn',
  'dead-code': 'deadCode',
  'main-sequence': 'coupling',
  duplication: 'duplication',
  'code-clone': 'duplication',
  clone: 'duplication',
  'duplicate-code': 'duplication',
  patterns: 'patterns', // 设计模式画像（代码用了哪些模式）
  'design-patterns': 'patterns',
  pattern: 'patterns',
  gof: 'patterns',
  symbols: 'symbols', // 代码结构画像（class/function/interface 符号级实体）
  'code-structure': 'symbols',
  'symbol-structure': 'symbols',
  'hotspot-functions': 'hotspotFunctions', // 函数热点（AST 逐函数风险排序）
  'function-hotspot': 'hotspotFunctions',
  'function-complexity': 'hotspotFunctions',
  'hot-functions': 'hotspotFunctions',
  'data-flow': 'dataFlow', // 数据流（污点角色三区：汇点/透传/阻断）
  dataflow: 'dataFlow',
  'def-use': 'dataFlow',
  // v2.25 修正：此前 taint 别名被映射到 dataFlow（那时根本没有污点分析，属命名误导）。
  // 真实污点传播路径画像落地后，这些别名改指 taintFlow —— 语义对齐，不再骗用户。
  taint: 'taintFlow',
  'taint-flow': 'taintFlow',
  'taint-analysis': 'taintFlow',
  'source-sink': 'taintFlow',
};

/** 按视角模板 type 找到对应画像（找不到返回 null） */
export function portraitForTemplate(type: string | undefined | null): PortraitKind | null {
  if (!type) return null;
  return VIEW_TEMPLATE_PORTRAIT[type.toLowerCase()] ?? null;
}
