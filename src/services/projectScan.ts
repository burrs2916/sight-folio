import { invoke } from './core';

export interface ScanJob {
  id: string;
  analysisId: string;
  status: string;
  progress: number;
  filesScanned: number;
  totalFiles: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  config: string;
  createdAt: number;
}
export interface ProjectFile {
  id: string;
  analysisId: string;
  path: string;
  relPath: string;
  name: string;
  extension: string | null;
  language: string | null;
  size: number;
  lineCount: number;
  contentHash: string | null;
  parentId: string | null;
  isDirectory: boolean;
  layerId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata: string;
  scannedAt: number;
}
/** 扫描新鲜度体检结果（对应后端 check_scan_freshness） */
export interface ScanFreshness {
  stale: boolean;
  lastScannedAt: number | null;
  scannedFileCount: number;
  currentFileCount: number;
  added: string[];
  removed: string[];
  modified: string[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
}
export interface ProjectModule {
  id: string;
  analysisId: string;
  name: string;
  description: string | null;
  layerId: string | null;
  fileCount: number;
  depCount: number;
  beDepCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  metadata: string;
  createdAt: number;
  updatedAt: number;
}
export interface ProjectDependency {
  id: string;
  analysisId: string;
  fromId: string;
  fromType: string;
  toId: string;
  toType: string;
  kind: string;
  lineNo: number | null;
  isCircular: boolean;
  weight: number;
  metadata: string;
  detectedAt: number;
}
export interface ProjectLayer {
  id: string;
  analysisId: string;
  name: string;
  color: string;
  sortOrder: number;
  yPosition: number;
  description: string | null;
  rulePattern: string | null;
  metadata: string;
  createdAt: number;
  updatedAt: number;
}
export interface ReviewRule {
  id: string;
  name: string;
  description: string | null;
  ruleType: string;
  targetType: string;
  ruleBody: string;
  severity: string;
  enabled: boolean;
  scope: string;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 后端解析器真实能力矩阵（R45，来自 parser::ParserCapabilities）。
 * 前端激活/展示插件时以此为准，避免「前端声明了、后端没实现」的脱节
 * （历史：vue 声明 dependencyAnalysis:true 但后端无 vue 依赖解析）。
 */
export interface ParserCapability {
  language: string;
  symbols: boolean;
  deps: boolean;
  symbolRefs: boolean;
  ast: boolean;
}
export interface ReviewFinding {
  id: string;
  analysisId: string;
  ruleId: string | null;
  targetId: string;
  targetType: string;
  severity: string;
  message: string;
  suggestion: string | null;
  status: string;
  foundAt: number;
  fixedAt: number | null;
  metadata: string;
}

// ─── 代码结构索引（analyze_code_structure）───
export interface ProjectSymbol {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  name: string;
  kind: string;
  lineStart: number;
  lineEnd: number;
  signature: string;
  doc: string | null;
  modifiers: string;
  patterns: string;
  metadata: string;
  createdAt: number;
}
export interface PatternHit {
  pattern: string;
  name: string;
  symbolName: string;
  filePath: string;
  line: number;
  evidence: string;
  /**
   * 置信度 0..1（后端证据加权得分）
   *
   * 设计模式识别本质是启发式推断。旧引擎只给布尔命中，把猜测当事实输出，
   * 实测误报率极高（本项目前端 138 处「建造者模式」命中全部是把
   * `return this.state` 当成了链式返回）。新引擎按证据加权打分并把分数带到前端，
   * 命中阈值 0.6，而最强的命名信号只有 0.55 —— 仅靠类名永远无法单独命中。
   * 旧扫描数据无此字段，后端反序列化时补 0.5。
   */
  confidence: number;
  /** 判定依据清单（前端悬浮展示，让用户自己判断这条推断站不站得住） */
  signals: string[];
  /** 分类：creational / structural / behavioral / architectural */
  category: string;
}
export interface StructureSummary {
  totalSymbols: number;
  filesWithSymbols: number;
  byKind: Record<string, number>;
  patterns: PatternHit[];
}

// ─── 符号级引用索引（analyze_symbol_references）───
export interface ProjectSymbolRef {
  id: string;
  analysisId: string;
  fromFileId: string;
  fromFilePath: string;
  toSymbolId: string | null;
  toFileId: string;
  toFilePath: string;
  symbolName: string;
  refLine: number;
  refText: string;
  kind: string;
  createdAt: number;
}

// ─── 文件级度量（analyze_file_metrics，复杂度热力图数据源）───
export interface FileMetric {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  cyclomaticComplexity: number;
  /** 复杂度等级：low | medium | high | extreme */
  complexityLevel: string;
  metadata: string;
  createdAt: number;
  /**
   * 度量引擎：`ast`（tree-sitter 精确解析）| `heuristic`（行级关键字估算）。
   * 两种精度必须在 UI 上区分展示，否则用户会把估算值当成事实。
   */
  engine: string;
  /** 全文件最大控制流嵌套深度（AST 独有，heuristic 时为 0） */
  maxNesting: number;
  /** 函数/方法数量（AST 独有） */
  functionCount: number;
  /** 单函数最高圈复杂度（AST 独有）——比文件总 CC 更能指认难维护的代码 */
  maxFunctionCc: number;
  /** 最复杂函数名（AST 独有） */
  hotFunction: string;
  /** 阈值型魔法数字个数（AST 独有） */
  magicNumberCount: number;
}

/** AST 解析出的单个函数度量（存放于 FileMetric.metadata.functions） */
export interface AstFunctionMetric {
  name: string;
  line: number;
  endLine: number;
  lines: number;
  cc: number;
  params: number;
  maxNesting: number;
}

/** AST 解析出的阈值魔法数字（存放于 FileMetric.metadata.magicNumbers） */
export interface AstMagicNumber {
  line: number;
  value: string;
  snippet: string;
}

/** FileMetric.metadata 的解析结果 */
export interface FileMetricMeta {
  language?: string;
  engine?: string;
  hasError?: boolean;
  /** 语法错误所在行号（1 起；R46 起由 tree-sitter ERROR/MISSING 节点提取） */
  errorLines?: number[];
  functions?: AstFunctionMetric[];
  magicNumbers?: AstMagicNumber[];
}

/**
 * 安全解析 FileMetric.metadata。
 *
 * metadata 是 TEXT 列，历史数据里可能是 `{"language":"rust"}` 这种旧格式。
 * 解析失败一律返回空对象——绝不让一条脏数据把整张热力图打崩。
 */
export function parseFileMetricMeta(metric: Pick<FileMetric, 'metadata'>): FileMetricMeta {
  try {
    const raw = JSON.parse(metric.metadata || '{}');
    if (!raw || typeof raw !== 'object') return {};
    return raw as FileMetricMeta;
  } catch {
    return {};
  }
}

// ─── 技术债标记（scan_tech_debt，TODO/FIXME/HACK/XXX/OPTIMIZE/DEPRECATED）───
export interface TechDebtItem {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  lineNo: number;
  /** 标记类型：TODO | FIXME | HACK | XXX | OPTIMIZE | DEPRECATED */
  marker: string;
  /** 严重度：info | warning | critical */
  severity: string;
  /** 该行原文（截断） */
  snippet: string;
  createdAt: number;
}

// ─── 代码克隆 / 重复代码（detect_code_clones，winnowing 指纹）───
/**
 * 一条记录 = 一段重复代码的一个「出现位置」。
 * 同一 groupId 的多条记录构成一个「克隆组」（同一段代码出现了 groupSize 次）。
 */
export interface CodeClone {
  id: string;
  analysisId: string;
  /** 克隆组标识：同段代码的所有实例共享 */
  groupId: string;
  fileId: string;
  filePath: string;
  /** 片段起止行号（1 起始，含） */
  startLine: number;
  endLine: number;
  /** 参与比对的有效行数 */
  lineCount: number;
  /** 该克隆组的实例总数 */
  groupSize: number;
  /** 片段首行原文（截断） */
  snippet: string;
  language: string;
  /** 克隆类型：type1 = 逐字重复；type2 = 参数化克隆（标识符重命名后结构相同） */
  cloneType: string;
  createdAt: number;
}

// ─── 代码全文索引（index_code_content / search_code_content）───
export interface CodeIndexEntry {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  lineNo: number;
  content: string;
  createdAt: number;
}

// ─── 死代码检测（detect_dead_symbols）───
export interface DeadSymbol {
  symbolId: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  name: string;
  kind: string;
  lineStart: number;
  lineEnd: number;
  /** exported | internal */
  visibility: string;
  /** high | medium | low */
  confidence: string;
  /** 判定说明 */
  reason: string;
}

// ─── Git 变更热点（analyze_git_history）───
export interface GitChurn {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  commitCount: number;
  addedLines: number;
  deletedLines: number;
  authorCount: number;
  lastCommitAt: number;
  firstCommitAt: number;
  churnScore: number;
  /** low | medium | high | extreme */
  hotspotLevel: string;
  createdAt: number;
}

// ─── 变更耦合（analyze_change_coupling）───
/**
 * 一对「总是一起改」的文件。
 *
 * 依赖分析回答「谁 import 谁」（显性耦合），本结构回答「谁总和谁一起改」。
 * `couplingKind === "hidden"` 表示两者之间**没有任何静态依赖**却高度共变
 * —— 前后端契约、多处复制的常量、抽象泄漏都属此类，是静态工具永远发现不了
 * 的隐性架构风险。
 */
export interface ChangeCoupling {
  id: string;
  analysisId: string;
  fileAId: string;
  fileAPath: string;
  fileBId: string;
  fileBPath: string;
  /** 共同出现的提交数 */
  coChanges: number;
  commitsA: number;
  commitsB: number;
  /** 耦合度 co / min(a,b)，0..1 */
  degree: number;
  /** Jaccard co / (a+b-co)，0..1，用于识别单侧高频的伪耦合 */
  jaccard: number;
  /** 是否存在静态依赖（任一方向） */
  isStructural: boolean;
  /** 是否跨顶层模块 */
  crossModule: boolean;
  /** structural | hidden */
  couplingKind: string;
  /** low | medium | high | extreme */
  riskLevel: string;
  lastCoChangeAt: number;
  createdAt: number;
}

// ─── 过程间数据流摘要（analyze_data_flow）───
/**
 * 一个函数的 def-use 摘要（IFDS 意义上的 function summary）。
 *
 * 调用图回答「A 调了 B」，本结构回答「**B 会不会把收到的数据再传出去**」：
 * - `propagates === false` → 污染终止点（只打日志/只落库），影响链到此不再向上游扩散
 * - `sinks` 非空 → 该函数把入参写进了外部状态，改动会波及共享状态的所有读取方
 */
export interface DataFlowFact {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  functionName: string;
  lineNo: number;
  /** 形参列表，逗号分隔 */
  params: string;
  /** 流向返回值的形参，逗号分隔 */
  paramToReturn: string;
  /** 是否透传（输入变化会传导到输出） */
  propagates: boolean;
  returnsCallResult: boolean;
  /** 形参 → 下游实参，JSON 数组字符串 */
  callFlows: string;
  /** 写入的外部状态，JSON 数组字符串 */
  sinks: string;
  createdAt: number;
}

export interface DataFlowHotspot {
  functionName: string;
  filePath: string;
  lineNo: number;
  count: number;
  detail: string;
}

export interface DataFlowSummary {
  analyzedFiles: number;
  functions: number;
  /** 透传函数数（污染放行） */
  propagating: number;
  /** 阻断函数数（污染终止 —— 影响链剪枝依据） */
  blocking: number;
  sinkFunctions: number;
  paramFlows: number;
  topSinks: DataFlowHotspot[];
}

// ─── 源码内容（read_source_file）───
export interface SourceFileContent {
  fileId: string;
  path: string;
  relPath: string;
  name: string;
  language: string;
  /** 按行切好的源码（下标 0 = 第 1 行） */
  lines: string[];
  totalLines: number;
  /** 超过 6000 行被截断 */
  truncated: boolean;
  /** 二进制/过大/读取失败时的说明，非 null 时 lines 为空 */
  skippedReason: string | null;
}

// ─── 函数调用图（analyze_call_graph）───
export interface CallEdge {
  id: string;
  analysisId: string;
  callerSymbolId: string;
  callerName: string;
  callerFileId: string;
  callerFilePath: string;
  calleeSymbolId: string;
  calleeName: string;
  calleeFileId: string;
  calleeFilePath: string;
  lineNo: number;
  /** internal | cross-file */
  kind: string;
  /** 被调方接收者根标识符（如 `obj.method()` → "obj"；裸调用为空串）；用于区分同名 sink */
  calleeReceiver?: string;
  /** 被调方解析到的接收者声明类型名（如 `ClassA.foo()` → "ClassA"；裸函数/未锁定为空串）。
   *  对标 joern：joern 动态分派超近似丢失接收者类型，这里给出精确类型名，影响面画像按类型区分同名方法。 */
  receiverTarget?: string;
  createdAt: number;
}

export interface CallHotspot {
  symbolId: string;
  name: string;
  filePath: string;
  count: number;
}

export interface CallGraphSummary {
  totalEdges: number;
  crossFileEdges: number;
  functions: number;
  topCallers: CallHotspot[];
  topCallees: CallHotspot[];
}

export const projectScanApi = {
  async scan(
    analysisId: string,
    projectRoot: string,
    opts?: { excludeDirs?: string[]; excludeResources?: boolean },
  ): Promise<ScanJob> {
    return invoke('scan_project', {
      analysisId,
      projectRoot,
      excludeDirs: opts?.excludeDirs ?? undefined,
      excludeResources: opts?.excludeResources ?? undefined,
    });
  },
  /** 项目根是否存在 .gitignore（有 → 扫描按它过滤；无 → 提示可手动过滤） */
  async checkGitignore(projectRoot: string): Promise<boolean> {
    return invoke('check_gitignore', { projectRoot });
  },
  /** 扫描新鲜度体检：对比上次扫描快照与当前磁盘，判断数据是否过时 */
  async checkScanFreshness(
    analysisId: string,
    projectRoot: string,
    opts?: { excludeDirs?: string[]; excludeResources?: boolean },
  ): Promise<ScanFreshness> {
    return invoke('check_scan_freshness', {
      analysisId,
      projectRoot,
      excludeDirs: opts?.excludeDirs ?? undefined,
      excludeResources: opts?.excludeResources ?? undefined,
    });
  },
  /** 保存扫描排除配置（手动排除目录 + 是否排除非代码资源）到 analysis metadata */
  async saveScanExcludes(analysisId: string, excludeDirs: string[], excludeResources: boolean): Promise<void> {
    return invoke('save_scan_excludes', {
      analysisId,
      excludeDirs,
      excludeResources,
    });
  },
  async cancel(jobId: string): Promise<void> {
    return invoke('cancel_scan_job', { jobId });
  },
  /** 取消深度分析阶段（结构/符号/度量/技术债/克隆/审查），与 cancel 共同覆盖整条扫描流水线 */
  async cancelAnalysis(analysisId: string): Promise<void> {
    return invoke('cancel_analysis', { analysisId });
  },
  /** 复位深度分析取消标志（新扫描开始时调用，避免上次取消残留） */
  async resetAnalysisCancel(analysisId: string): Promise<void> {
    return invoke('reset_analysis_cancel', { analysisId });
  },
  async latestJob(analysisId: string): Promise<ScanJob | null> {
    return invoke('get_latest_scan_job', { analysisId });
  },
  /**
   * 增量差异：本轮扫描中内容哈希变化（或新增）的文件相对路径。
   *
   * 两态语义不可退化成空数组：
   * - `null`  —— 无基线（首扫 / 快照缺失）→ 调用方走全量重算
   * - `[]`    —— 有基线且**零文件变更**（重复扫描同一份代码），增量收益最大的场景
   */
  async getScanDelta(analysisId: string): Promise<string[] | null> {
    return invoke('get_scan_delta', { analysisId });
  },
  async listFiles(analysisId: string): Promise<ProjectFile[]> {
    return invoke('list_project_files', { analysisId });
  },
  async listModules(analysisId: string): Promise<ProjectModule[]> {
    return invoke('list_project_modules', { analysisId });
  },
  async listDependencies(analysisId: string): Promise<ProjectDependency[]> {
    return invoke('list_project_dependencies', { analysisId });
  },
  async listLayers(analysisId: string): Promise<ProjectLayer[]> {
    return invoke('list_project_layers', { analysisId });
  },
  async listRules(): Promise<ReviewRule[]> {
    return invoke('list_review_rules');
  },
  async listFindings(analysisId: string): Promise<ReviewFinding[]> {
    return invoke('list_review_findings', { analysisId });
  },
  async countBySeverity(analysisId: string): Promise<Record<string, number>> {
    return invoke('count_findings_by_severity', { analysisId });
  },
  async runReviewRules(analysisId: string): Promise<ReviewFinding[]> {
    return invoke('run_review_rules', { analysisId });
  },
  /** 同步前端分析器插件声明的规则到后端规则引擎（§4.2 RuleRegistry ↔ 引擎）。返回新增数量 */
  async syncAnalyzerRules(rules: ReviewRule[]): Promise<number> {
    return invoke('sync_analyzer_rules', { rules });
  },
  async detectDependencies(analysisId: string, projectRoot: string): Promise<ProjectDependency[]> {
    return invoke('detect_dependencies', { analysisId, projectRoot });
  },
  /** 后端解析器能力矩阵（R45 前后端能力联动：前端按真实能力对齐） */
  async listParserCapabilities(): Promise<ParserCapability[]> {
    return invoke('list_parser_capabilities');
  },
  /** 查询指定语言的后端能力（激活插件前校验） */
  async parserCapabilityFor(language: string): Promise<ParserCapability | null> {
    return invoke('parser_capability_for', { language });
  },
  async saveLayer(layer: ProjectLayer): Promise<void> {
    return invoke('save_project_layer', { layer });
  },
  async deleteLayer(id: string): Promise<void> {
    return invoke('delete_project_layer', { id });
  },
  async syncFilesToCanvas(analysisId: string, projectRoot: string): Promise<void> {
    return invoke('sync_files_to_canvas', { analysisId, projectRoot });
  },
  // ─── 代码结构索引 ───
  /** 分析代码结构（提取类/函数/接口等符号 + 检测设计模式），返回摘要 */
  async analyzeCodeStructure(analysisId: string, changedRelPaths?: string[]): Promise<StructureSummary> {
    return invoke('analyze_code_structure', {
      analysisId,
      changedRelPaths: changedRelPaths ?? null,
    });
  },
  async listSymbols(analysisId: string): Promise<ProjectSymbol[]> {
    return invoke('list_project_symbols', { analysisId });
  },
  async countSymbolsByKind(analysisId: string): Promise<Record<string, number>> {
    return invoke('count_symbols_by_kind', { analysisId });
  },
  async listDesignPatterns(analysisId: string): Promise<PatternHit[]> {
    return invoke('list_design_patterns', { analysisId });
  },
  /** 对既有分析重新检测设计模式（从源码重算，无需整库重扫），写回符号表并返回命中 */
  async redetectDesignPatterns(analysisId: string, projectRoot: string): Promise<PatternHit[]> {
    return invoke('redetect_design_patterns', { analysisId, projectRoot });
  },
  // ─── 符号级引用分析 + 符号索引搜索 ───
  /** 分析符号级引用（import 语句 → 目标符号匹配），返回引用边列表 */
  async analyzeSymbolReferences(analysisId: string, changedRelPaths?: string[]): Promise<ProjectSymbolRef[]> {
    return invoke('analyze_symbol_references', {
      analysisId,
      changedRelPaths: changedRelPaths ?? null,
    });
  },
  async listSymbolRefs(analysisId: string): Promise<ProjectSymbolRef[]> {
    return invoke('list_symbol_refs', { analysisId });
  },
  /** 符号索引搜索（name/file_path 模糊匹配，kind 权重排序） */
  async searchSymbols(analysisId: string, query: string, limit?: number): Promise<ProjectSymbol[]> {
    return invoke('search_project_symbols', { analysisId, query, limit: limit ?? 8 });
  },
  // ─── 文件度量分析（复杂度热力图）───
  /**
   * 分析全部文件的度量指标（行数/注释/圈复杂度），写入并返回。
   * 传入 changedRelPaths（增量差异）时只重算变更文件，其余按路径携带既有结果。
   */
  async analyzeFileMetrics(analysisId: string, changedRelPaths?: string[]): Promise<FileMetric[]> {
    return invoke('analyze_file_metrics', { analysisId, changedRelPaths: changedRelPaths ?? null });
  },
  async listFileMetrics(analysisId: string): Promise<FileMetric[]> {
    return invoke('list_file_metrics', { analysisId });
  },
  // ─── 技术债扫描（TODO/FIXME/HACK 等标记）───
  /**
   * 扫描全部源码文件的技术债标记（TODO/FIXME/HACK/XXX/OPTIMIZE/DEPRECATED），写入并返回。
   * 传入 changedRelPaths 时只重扫变更文件，其余按路径携带既有结果。
   */
  async scanTechDebt(analysisId: string, changedRelPaths?: string[]): Promise<TechDebtItem[]> {
    return invoke('scan_tech_debt', { analysisId, changedRelPaths: changedRelPaths ?? null });
  },
  async listTechDebt(analysisId: string): Promise<TechDebtItem[]> {
    return invoke('list_tech_debt', { analysisId });
  },
  // ─── 代码克隆检测（重复率，winnowing 指纹）───
  /** 检测项目中的重复代码块，写入并返回全部克隆实例 */
  async detectCodeClones(analysisId: string): Promise<CodeClone[]> {
    return invoke('detect_code_clones', { analysisId });
  },
  async listCodeClones(analysisId: string): Promise<CodeClone[]> {
    return invoke('list_code_clones', { analysisId });
  },
  // ─── 代码全文索引（search_code_content 检索跳转）───
  /**
   * 为分析的全部源码文件建立代码行索引，返回索引行数。
   * 传入 changedRelPaths 时只重建变更文件的索引，其余按路径携带既有条目。
   */
  async indexCodeContent(analysisId: string, changedRelPaths?: string[]): Promise<number> {
    return invoke('index_code_content', { analysisId, changedRelPaths: changedRelPaths ?? null });
  },
  /** 按内容片段全文检索当前分析的代码索引 */
  async searchCodeContent(analysisId: string, query: string, limit?: number): Promise<CodeIndexEntry[]> {
    return invoke('search_code_content', { analysisId, query, limit: limit ?? 12 });
  },
  /** 当前分析的代码索引行数（判断是否需要建索引） */
  async countCodeIndex(analysisId: string): Promise<number> {
    return invoke('count_code_index', { analysisId });
  },
  // ─── 死代码检测（零引用符号）───
  /** 检测死代码并写入 review_findings（需在符号引用与调用图之后执行） */
  async detectDeadSymbols(analysisId: string): Promise<DeadSymbol[]> {
    return invoke('detect_dead_symbols', { analysisId });
  },
  /** 只读列出死代码候选（不写审查结果） */
  async listDeadSymbols(analysisId: string): Promise<DeadSymbol[]> {
    return invoke('list_dead_symbols', { analysisId });
  },
  // ─── Git 变更热点 ───
  /** 目录是否在 git 工作区内 */
  async isGitRepo(projectRoot: string): Promise<boolean> {
    return invoke('is_git_repo', { projectRoot });
  },
  /** 采集 git 变更热点；sinceDays 传 undefined 表示全量历史 */
  async analyzeGitHistory(analysisId: string, projectRoot: string, sinceDays?: number): Promise<GitChurn[]> {
    return invoke('analyze_git_history', { analysisId, projectRoot, sinceDays: sinceDays ?? null });
  },
  async listGitChurn(analysisId: string): Promise<GitChurn[]> {
    return invoke('list_git_churn', { analysisId });
  },
  // ─── 变更耦合（时间维度耦合 / 隐性架构耦合）───
  /**
   * 分析「总是一起改」的文件对。
   *
   * 参数全部可选，默认值已按降噪需要调过：
   * - sinceDays 365（老仓库全量会把五年前的一次性协作算成当前耦合）
   * - minCoChanges 3（少于 3 次共变是巧合）
   * - minDegree 0.35
   * - maxCommitSize 30（超过则视为批量格式化/重命名，整体丢弃）
   * - topN 400
   */
  async analyzeChangeCoupling(
    analysisId: string,
    projectRoot: string,
    opts?: {
      sinceDays?: number | null;
      minCoChanges?: number;
      minDegree?: number;
      maxCommitSize?: number;
      topN?: number;
    },
  ): Promise<ChangeCoupling[]> {
    // v2.18 默认值 ?? 365 → ?? null：让「不传参 = 真全量」（Rust 跳过 --since）。
    // 历史 ?? 365 把 null 偷偷变 365 天窗口，导致 UI「全量」按钮与 store 默认行为都不真。
    // 配合 store.analyzeChangeCoupling 同步修复（projectStore.ts:756）。
    return invoke('analyze_change_coupling', {
      analysisId,
      projectRoot,
      sinceDays: opts?.sinceDays ?? null,
      minCoChanges: opts?.minCoChanges ?? null,
      minDegree: opts?.minDegree ?? null,
      maxCommitSize: opts?.maxCommitSize ?? null,
      topN: opts?.topN ?? null,
    });
  },
  async listChangeCoupling(analysisId: string): Promise<ChangeCoupling[]> {
    return invoke('list_change_coupling', { analysisId });
  },
  // ─── 函数调用图 ───
  /** 构建函数调用图，返回摘要（边数据用 listCallEdges 拉取） */
  async analyzeCallGraph(analysisId: string, changedRelPaths?: string[]): Promise<CallGraphSummary> {
    return invoke('analyze_call_graph', {
      analysisId,
      changedRelPaths: changedRelPaths ?? null,
    });
  },
  async listCallEdges(analysisId: string): Promise<CallEdge[]> {
    return invoke('list_call_edges', { analysisId });
  },
  // ─── 过程间数据流（函数级 def-use 摘要）───
  /**
   * 构建函数级数据流摘要，返回统计（明细用 listDataFlow 拉取）。
   * 只有 AST 支持的方言（TS/TSX/JS/Rust/Python）会产出摘要，其余语言静默跳过。
   */
  async analyzeDataFlow(analysisId: string, changedRelPaths?: string[]): Promise<DataFlowSummary> {
    return invoke('analyze_data_flow', { analysisId, changedRelPaths: changedRelPaths ?? null });
  },
  async listDataFlow(analysisId: string): Promise<DataFlowFact[]> {
    return invoke('list_data_flow', { analysisId });
  },
  // ─── 源码查看（画布实体 → 代码行）───
  /**
   * 读取已扫描文件的源码内容。
   * 只接受 fileId：后端从 project_files 反查路径，前端无法读取项目外的文件。
   */
  async readSourceFile(fileId: string): Promise<SourceFileContent> {
    return invoke('read_source_file', { fileId });
  },
  /**
   * 读取文件原始字节（v2.15 按需 CAD 解析用；v2.24 工作台图片/SVG 预览复用）。
   * 传入绝对路径（项目内文件）；Rust 端以 tauri::ipc::Response 返回原始二进制，
   * Tauri v2 的 invoke 已将其解码为 ArrayBuffer 直接交付（不走 asset 协议、不受 scope 约束）。
   * 个别 Tauri 构建可能返回 Uint8Array，此处归一化为 ArrayBuffer 以满足 Blob 契约。
   */
  async readFileBytes(path: string): Promise<ArrayBuffer> {
    const data = await invoke<ArrayBuffer | Uint8Array>('read_file_bytes', { path });
    if (data instanceof Uint8Array) {
      // 防御：个别 Tauri 构建可能直接返回 Uint8Array，归一化为独立 ArrayBuffer
      const ab = new ArrayBuffer(data.byteLength);
      new Uint8Array(ab).set(data);
      return ab;
    }
    return data;
  },
  /**
   * 受控写回源码文件（R46 P1）。
   * 安全模型在后端：只能写被扫描进项目内的文件；写前自动备份 .bak。
   * 写盘成功会经 file_watcher 触发增量重扫（metrics/结构/引用/技术债全链路刷新）。
   */
  async writeSourceFile(
    fileId: string,
    content: string,
    /**
     * 台账元信息（R47 P2-A）。**只在「AI 提议 → 用户点应用」时传**：
     * 带上它这次写入才会记入改动评审列表（可撤销）。编辑器自动保存不传，
     * 否则用户自己敲的每一次保存都会灌进评审列表，把 AI 的改动淹掉。
     */
    ledger?: {
      reason?: string;
      origin?: 'ai-apply' | 'user';
      /** 被替换的原文片段（有则支持片段级撤销，不必依赖整文快照） */
      oldText?: string;
      newText?: string;
      conversationId?: string;
    },
  ): Promise<WriteFileResult> {
    return invoke('write_file', {
      fileId,
      content,
      reason: ledger?.reason ?? null,
      origin: ledger?.origin ?? null,
      oldText: ledger?.oldText ?? null,
      newText: ledger?.newText ?? null,
      conversationId: ledger?.conversationId ?? null,
    });
  },
};

/** 写回结果（R46 P1，与后端 WriteFileResult 对齐） */
export interface WriteFileResult {
  path: string;
  relPath: string;
  backupPath: string | null;
  oldLines: number | null;
  newLines: number;
  deltaLines: number;
  /** 台账记录 id（null = 本次写入未登记，见 writeSourceFile 的 ledger 参数） */
  changeId: string | null;
}
