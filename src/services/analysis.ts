import { invoke } from './core';
import { createDefaultScene } from '../types/scene';
import type { AnalysisDSL, AnalysisCategory } from '../types/scene';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════
// sight-folio 项目分析 API（分析器能力，叠加在参考实现之上）
// ═══════════════════════════════════════════════════════

interface PersistedAnalysis {
  id: string;
  name: string;
  description?: string;
  projectRoot: string;
  categoryId?: string;
  tags: string;
  status: string;
  metadata: string;
  scanStatus: string;
  scanProgress: number;
  lastScannedAt?: number;
  totalFiles: number;
  totalLines: number;
  primaryLanguage?: string;
  editorComponents?: string;
  editorLayers?: string;
  canvasConfig?: string;
  globalComponents?: string;
  views?: string;
  activeViewId?: string;
  viewportSyncRules?: string;
  createdAt: number;
  updatedAt: number;
}

function toPersistedAnalysis(analysis: AnalysisDSL): PersistedAnalysis {
  return {
    id: analysis.id,
    name: analysis.name,
    description: analysis.description,
    projectRoot: analysis.projectRoot,
    categoryId: analysis.categoryId,
    tags: JSON.stringify(analysis.tags || []),
    status: analysis.status,
    metadata: JSON.stringify(analysis.metadata || {}),
    scanStatus: analysis.scanStatus,
    scanProgress: analysis.scanProgress,
    lastScannedAt: analysis.lastScannedAt,
    totalFiles: analysis.totalFiles,
    totalLines: analysis.totalLines,
    primaryLanguage: analysis.primaryLanguage,
    editorComponents: analysis.editorComponents ? JSON.stringify(analysis.editorComponents) : undefined,
    editorLayers: analysis.editorLayers ? JSON.stringify(analysis.editorLayers) : undefined,
    canvasConfig: analysis.canvasConfig ? JSON.stringify(analysis.canvasConfig) : undefined,
    globalComponents: analysis.globalComponents ? JSON.stringify(analysis.globalComponents) : undefined,
    views: analysis.views ? JSON.stringify(analysis.views) : undefined,
    activeViewId: analysis.activeViewId,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
  };
}

function toAnalysisDSL(p: PersistedAnalysis): AnalysisDSL {
  const base = createDefaultScene();
  return {
    ...base,
    id: p.id,
    name: p.name,
    description: p.description,
    projectRoot: p.projectRoot || '',
    categoryId: p.categoryId,
    tags: JSON.parse(p.tags || '[]'),
    status: (p.status || 'draft') as AnalysisDSL['status'],
    metadata: JSON.parse(p.metadata || '{}'),
    scanStatus: (p.scanStatus || 'pending') as AnalysisDSL['scanStatus'],
    scanProgress: p.scanProgress || 0,
    lastScannedAt: p.lastScannedAt,
    totalFiles: p.totalFiles || 0,
    totalLines: p.totalLines || 0,
    primaryLanguage: p.primaryLanguage,
    editorComponents: p.editorComponents ? JSON.parse(p.editorComponents) : undefined,
    editorLayers: p.editorLayers ? JSON.parse(p.editorLayers) : undefined,
    canvasConfig: p.canvasConfig ? JSON.parse(p.canvasConfig) : undefined,
    globalComponents: p.globalComponents ? JSON.parse(p.globalComponents) : undefined,
    views: p.views ? JSON.parse(p.views) : undefined,
    activeViewId: p.activeViewId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export const analysisApi = {
  async list(): Promise<AnalysisDSL[]> {
    const result = await invoke<PersistedAnalysis[]>('get_all_analyses');
    return result.map(toAnalysisDSL);
  },
  async get(id: string): Promise<AnalysisDSL | null> {
    const result = await invoke<PersistedAnalysis | null>('get_analysis', { id });
    if (!result) return null;
    return toAnalysisDSL(result);
  },
  async listByCategory(categoryId: string): Promise<AnalysisDSL[]> {
    const result = await invoke<PersistedAnalysis[]>('get_analyses_by_category', { categoryId });
    return result.map(toAnalysisDSL);
  },
  async create(analysis: AnalysisDSL): Promise<void> {
    const persisted = toPersistedAnalysis(analysis);
    logger.info('AnalysisApi', 'Creating analysis', { id: persisted.id, name: persisted.name });
    return invoke('create_analysis', { analysis: persisted });
  },
  async update(analysis: AnalysisDSL): Promise<void> {
    const persisted = toPersistedAnalysis(analysis);
    logger.info('AnalysisApi', 'Updating analysis', { id: persisted.id, name: persisted.name });
    return invoke('update_analysis', { analysis: persisted });
  },
  async delete(id: string): Promise<void> {
    logger.info('AnalysisApi', 'Deleting analysis', { id });
    return invoke('delete_analysis', { id });
  },
  async listCategories(): Promise<AnalysisCategory[]> {
    return invoke('get_all_analysis_categories');
  },
  async getCategory(id: string): Promise<AnalysisCategory | null> {
    return invoke('get_analysis_category', { id });
  },
  async saveCategory(category: AnalysisCategory): Promise<void> {
    return invoke('save_analysis_category', { category });
  },
  async deleteCategory(id: string): Promise<void> {
    return invoke('delete_analysis_category', { id });
  },
};
