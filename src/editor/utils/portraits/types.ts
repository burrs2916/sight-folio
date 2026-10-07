/**
 * 画像类型定义
 *
 * 所有画像 kind/outcome/mode、影响面目标与 PortraitSpec 契约。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { type ProjectFile } from '../../../services/tauri';
import { type FileInsight } from '.././fileInsights';

/** 网格式画像：单一维度排序 → 网格排布，无连线 */
export type GridPortraitKind = 'complexity' | 'techDebt' | 'churn' | 'deadCode' | 'syntax' | 'risk' | 'duplication';
/** 图式画像：带连线，各有专属布局 */
export type GraphPortraitKind =
  | 'callGraph'
  | 'callGraph_redetect'
  | 'architecture'
  | 'dependency'
  | 'layering'
  | 'coupling'
  | 'changeCoupling'
  | 'quadrant'
  | 'directory';
/** 设计模式画像：无连线，按分类分区栅格排布（单独实现，见 runPatternsPortrait） */
export type PatternPortraitKind = 'patterns';
/** 代码结构画像：符号级实体（class/function/interface 等）按文件分组排布（单独实现） */
export type SymbolPortraitKind = 'symbols';
/** 函数热点画像：AST 逐函数度量 → 风险排序的函数级实体（R31，单独实现） */
export type FunctionPortraitKind = 'hotspotFunctions' | 'hotspotFunctions_redetect';
/** 数据流画像：函数摘要按污点角色分三区（R36，单独实现，见 runDataFlowPortrait） */
export type DataFlowPortraitKind = 'dataFlow' | 'dataFlow_redetect';
export type PortraitKind =
  | GridPortraitKind
  | GraphPortraitKind
  | PatternPortraitKind
  | SymbolPortraitKind
  | FunctionPortraitKind
  | DataFlowPortraitKind
  | 'moduleGraph'
  | 'testCoverage'
  | 'security'
  | 'apiSurface'
  | 'busFactor'
  | 'ripple'
  | 'executionFlow'
  | 'apiTrace'
  | 'taintFlow'
  | 'docsCoverage'
  | 'errorHandling'
  | 'logging'
  | 'commentRatio'
  | 'patterns_redetect';
/**
 * 需要「指定目标」才能生成的画像：不出现在画像菜单里（菜单项没有上下文），
 * 由影响面面板 / 画布右键菜单在选中实体后触发。
 */
export type TargetedPortraitKind = 'impact';
/** 写进实体 config.portraitMode 的取值域 */
export type PortraitMode = PortraitKind | TargetedPortraitKind;

export interface PortraitOutcome {
  ok: boolean;
  message: string;
  severity: 'success' | 'info' | 'warning';
  /** 实际落在画布上的实体数 */
  placed: number;
}

export interface PortraitSpec {
  labelKey: string;
  cols: number;
  colW: number;
  rowH: number;
  /** 参与画像的文件筛选（返回 false 则不上画布） */
  include?: (ins: FileInsight) => boolean;
  /** 排序：返回负数表示 a 靠前 */
  rank: (a: FileInsight, b: FileInsight) => number;
  /** 空结果时的提示 */
  emptyHintKey: string;
  /** 成功文案 */
  summarize: (rows: { file: ProjectFile; ins: FileInsight }[]) => string;
}

// ───────────────────────── 影响面画像 ─────────────────────────

/** 影响面画像的目标：符号级或文件级二选一 */
export interface ImpactTarget {
  rootSymbolId?: string;
  rootFileId?: string;
  maxDepth?: number;
}
