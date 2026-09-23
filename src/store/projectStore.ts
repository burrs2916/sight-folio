import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { projectScanApi, fileWatcherApi, aiContextApi, analysisApi, type ProjectFile, type ProjectModule, type ProjectDependency, type ProjectLayer, type ScanJob, type ScanFreshness, type ReviewRule, type ReviewFinding, type FileChangeEvent, type ProjectSymbol, type PatternHit, type StructureSummary, type ProjectSymbolRef, type FileMetric, type TechDebtItem, type CodeClone, type CodeIndexEntry, type DeadSymbol, type GitChurn, type CallEdge, type CallGraphSummary, type ChangeCoupling, type DataFlowFact, type DataFlowSummary } from "../services/tauri";
import { aiContextRegistry } from "../ai/contextRegistry";
import { persistModuleContext, resetContextPersistCache } from "../ai/contextPersist";
import { useInsightOverlayStore } from "../store/insightOverlayStore";
import { useToastStore } from "./toastStore";
import { t } from "../i18n";

/**
 * projectRoot 是否是「真实文件系统路径」。
 *
 * 书场景的 projectRoot 是 `writing://{bookId}/` 这类**伪 URI** —— 书 = 场景，
 * 一本书的"文件"是 writing_chapters / writing_settings 里的行，磁盘上**没有**
 * 对应的目录。任何拿它去 stat / read_dir 的 Rust 命令都只会得到
 * 「路径不存在: writing://book_xxx/」，而且每切一次场景报一次。
 *
 * 判定用 scheme（`://`）而不是列白名单：以后再加别的虚拟场景（比如云端书稿）
 * 会自动豁免，不必回来补名单。Windows 盘符 `C:\...` 与 UNC 路径都不含 `://`，
 * 不受影响。
 */
export function isFilesystemProjectRoot(root: string | null | undefined): boolean {
  const r = (root ?? "").trim();
  if (!r) return false;
  return !r.includes("://");
}

// ─── 模块级单例：文件监视监听（防重复注册）───
let watcherUnlisten: UnlistenFn | null = null;
let watcherInitPromise: Promise<void> | null = null;
let changeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingChanges: FileChangeEvent[] = []; // 防抖窗口内累积的变更，flush 时合并去重
const CHANGE_DEBOUNCE_MS = 800; // 文件变更防抖窗口
const RECENT_CHANGES_LIMIT = 50; // recentChanges 上限
// AI 上下文包的落库缓存（分节戳 / 键集合 / 指纹）已统一收进 ai/contextPersist，
// 由扫描收尾与「发起分析」共用一份，避免两个写入方各持一份缓存互相欺骗。

interface ProjectStoreState {
  // 扫描任务
  currentJob: ScanJob | null;
  scanning: boolean;
  // 扫描新鲜度体检结果（check_scan_freshness）：数据是否过时、变更文件清单
  scanFreshness: ScanFreshness | null;
  scanFreshnessChecking: boolean;
  // 实时扫描进度（scan-progress 事件写入，供画布骨架屏订阅）
  scanStage: string | null;
  scanPercent: number;
  scanScanned: number;
  scanTotal: number;
  // 增量扫描模式标识（UI 反馈用）：incremental=true 表示本次携带既有结果只重算变更文件
  scanIncremental: boolean;
  scanChangedCount: number; // 增量模式下变更/新增文件数（全量为 0）

  // 扫描结果
  files: ProjectFile[];
  modules: ProjectModule[];
  dependencies: ProjectDependency[];
  layers: ProjectLayer[];
  rules: ReviewRule[];
  findings: ReviewFinding[];

  // ─── 代码结构索引（analyze_code_structure 产出）───
  symbols: ProjectSymbol[];
  structureSummary: StructureSummary | null;
  patternHits: PatternHit[];
  structureAnalyzed: boolean; // 当前 analysis 是否已做过结构分析
  depsAnalyzed: boolean;     // 当前 analysis 是否已做过依赖检测
  reviewAnalyzed: boolean;   // 当前 analysis 是否已做过审查规则

  // ─── 符号级引用索引（analyze_symbol_references 产出）───
  symbolRefs: ProjectSymbolRef[];    // 全部引用边
  refsAnalyzed: boolean;             // 当前 analysis 是否已做过引用分析

  // ─── 文件级度量（analyze_file_metrics 产出，复杂度热力图）───
  metrics: FileMetric[];
  metricsAnalyzed: boolean;

  // ─── 技术债标记（scan_tech_debt 产出，TODO/FIXME/HACK 等）───
  techDebt: TechDebtItem[];
  techDebtAnalyzed: boolean;

  // ─── 代码克隆 / 重复代码（detect_code_clones 产出，重复率画像）───
  clones: CodeClone[];
  clonesAnalyzed: boolean;

  // ─── 函数调用图（analyze_call_graph 产出，影响面分析）───
  callEdges: CallEdge[];
  callGraphSummary: CallGraphSummary | null;
  callGraphAnalyzed: boolean;

  // ─── 过程间数据流摘要（analyze_data_flow 产出，影响链剪枝：污染是否透传）───
  dataFlow: DataFlowFact[];
  dataFlowSummary: DataFlowSummary | null;
  dataFlowAnalyzed: boolean;

  // ─── Git 变更热点（analyze_git_history 产出，churn vs complexity）───
  gitChurn: GitChurn[];
  gitAnalyzed: boolean;
  isGitRepo: boolean;

  // ─── 变更耦合（analyze_change_coupling 产出，时间维度耦合 / 隐性架构耦合）───
  changeCoupling: ChangeCoupling[];
  couplingAnalyzed: boolean;

  // ─── 死代码候选（detect_dead_symbols 产出，零引用符号）───
  deadSymbols: DeadSymbol[];
  deadCodeAnalyzed: boolean;

  // ─── 语言焦点（插件联动：切换插件 → 左侧面板/画布按语言过滤）───
  focusLanguage: string | null;
  setFocusLanguage: (lang: string | null) => void;

  // 当前操作的 analysis id（用于切换数据）
  activeAnalysisId: string | null;

  // 最近一次落库的 AI 上下文包指纹：焦点巡查面板用它判断「派单后数据是否已变」，
  // 避免面板自己重跑一次 buildPack 去拿 digest。persistScanContext 里已有这个值，
  // 缓存到 store 只是顺手透传。
  aiContextDigest: string;

  // ─── 扫描动作 ───
  scan: (analysisId: string, projectRoot: string, opts?: { excludeDirs?: string[]; excludeResources?: boolean }) => Promise<void>;
  cancelScan: () => Promise<void>;
  /** 扫描新鲜度体检：对比上次扫描与当前磁盘，写入 scanFreshness（仅 id 即可，内部按 analysis 取 projectRoot） */
  checkFreshness: (analysisId: string) => Promise<void>;
  /** 实时扫描进度写入（scan-progress 事件回调调用，供画布骨架屏订阅） */
  setScanProgress: (p: { stage: string; percent: number; scanned: number; total: number; message: string }) => void;

  // ─── 数据加载 ───
  loadFiles: (analysisId: string) => Promise<void>;
  loadModules: (analysisId: string) => Promise<void>;
  loadDependencies: (analysisId: string) => Promise<void>;
  loadLayers: (analysisId: string) => Promise<void>;
  loadRules: () => Promise<void>;
  loadFindings: (analysisId: string) => Promise<void>;
  loadAll: (analysisId: string) => Promise<void>;
  // ─── 代码结构索引 ───
  /** changedRelPaths 非空时走增量：只重算变更文件符号，其余按 rel_path 携带既有符号并重置 file_id */
  analyzeStructure: (analysisId: string, changedRelPaths?: string[]) => Promise<StructureSummary | null>;
  loadSymbols: (analysisId: string) => Promise<void>;
  loadPatterns: (analysisId: string) => Promise<void>;
  // ─── 符号级引用索引 ───
  analyzeSymbolRefs: (analysisId: string, changedRelPaths?: string[]) => Promise<ProjectSymbolRef[]>;
  loadSymbolRefs: (analysisId: string) => Promise<void>;
  // ─── 文件度量（复杂度热力图）───
  /** changedRelPaths 非空时走增量：只重算变更文件，其余携带既有度量 */
  analyzeMetrics: (analysisId: string, changedRelPaths?: string[]) => Promise<FileMetric[]>;
  loadMetrics: (analysisId: string) => Promise<void>;
  // ─── 技术债扫描（TODO/FIXME/HACK 等标记）───
  /** changedRelPaths 非空时走增量：只重扫变更文件，其余携带既有标记 */
  analyzeTechDebt: (analysisId: string, changedRelPaths?: string[]) => Promise<TechDebtItem[]>;
  loadTechDebt: (analysisId: string) => Promise<void>;
  // ─── 代码克隆检测（重复率）───
  analyzeClones: (analysisId: string) => Promise<CodeClone[]>;
  loadClones: (analysisId: string) => Promise<void>;
  // ─── 函数调用图（影响面分析）───
  analyzeCallGraph: (analysisId: string, changedRelPaths?: string[]) => Promise<CallGraphSummary | null>;
  /** changedRelPaths 非空时走增量：只重算变更文件的函数摘要 */
  analyzeDataFlow: (analysisId: string, changedRelPaths?: string[]) => Promise<DataFlowSummary | null>;
  loadDataFlow: (analysisId: string) => Promise<void>;
  loadCallEdges: (analysisId: string) => Promise<void>;
  // ─── Git 变更热点 ───
  analyzeGitHistory: (analysisId: string, projectRoot: string, sinceDays?: number) => Promise<GitChurn[]>;
  loadGitChurn: (analysisId: string) => Promise<void>;
  // ─── 变更耦合（隐性架构耦合）───
  analyzeChangeCoupling: (analysisId: string, projectRoot: string, sinceDays?: number | null) => Promise<ChangeCoupling[]>;
  loadChangeCoupling: (analysisId: string) => Promise<void>;
  // ─── 死代码检测 ───
  detectDeadCode: (analysisId: string) => Promise<DeadSymbol[]>;
  loadDeadSymbols: (analysisId: string) => Promise<void>;
  // ─── 代码全文索引 ───
  /** changedRelPaths 非空时走增量：只重建变更文件的代码行索引 */
  indexCode: (analysisId: string, changedRelPaths?: string[]) => Promise<number>;
  searchCode: (analysisId: string, query: string, limit?: number) => Promise<CodeIndexEntry[]>;
  codeIndexed: boolean;

  // ─── 状态切换 ───
  setActiveAnalysis: (id: string | null) => void;
  clear: () => void;
  /**
   * 扫描完成后把分析结果压缩为 AI 上下文包并落库（供已配置的 Agent 按需取用、省 token），
   * 随后按用户配置的自动分析规则决定是否立即交给 Agent 解读。
   * @param trigger 区分全量扫描与 watch 增量重扫——规则可配置为「仅全量后触发」。
   */
  persistScanContext: (
    analysisId: string,
    trigger?: "full-scan" | "incremental",
  ) => Promise<void>;

  // ─── 分层管理 ───
  saveLayer: (layer: ProjectLayer) => Promise<void>;
  deleteLayer: (id: string) => Promise<void>;
  createLayer: (analysisId: string, name: string, color: string) => Promise<ProjectLayer | null>;

  // ─── 文件变更监视 ───
  watching: boolean;                         // 是否正在监视
  watchAnalysisId: string | null;            // 当前监视的分析 ID
  watchProjectRoot: string | null;           // 当前监视的项目根目录（联动重分析用）
  recentChanges: FileChangeEvent[];          // 最近的文件变更事件
  lastChangeEvent: FileChangeEvent | null;   // 最近一次变更（UI 通知用）
  startWatching: (analysisId: string, projectRoot: string) => Promise<void>;
  stopWatching: () => Promise<void>;
  clearChanges: () => void;
  /** 注册 file-changes / watching-stopped 事件监听（幂等，可重复调用） */
  initFileWatcher: () => Promise<void>;
  /** 文件变更后的自动联动（防抖合并批次） */
  handleFileChanges: (changes: FileChangeEvent[]) => void;
}

export const useProjectStore = create<ProjectStoreState>()(
  immer((set, get) => ({
    currentJob: null,
    scanning: false,
    scanFreshness: null,
    scanFreshnessChecking: false,
    scanStage: null,
    scanPercent: 0,
    scanScanned: 0,
    scanTotal: 0,
    scanIncremental: false,
    scanChangedCount: 0,
    files: [],
    modules: [],
    dependencies: [],
    layers: [],
    rules: [],
    findings: [],
    symbols: [],
    structureSummary: null,
    patternHits: [],
    structureAnalyzed: false,
    depsAnalyzed: false,
    reviewAnalyzed: false,
    symbolRefs: [],
    refsAnalyzed: false,
    metrics: [],
    metricsAnalyzed: false,
    techDebt: [],
    techDebtAnalyzed: false,
    clones: [],
    clonesAnalyzed: false,
    callEdges: [],
    callGraphSummary: null,
    callGraphAnalyzed: false,
    dataFlow: [],
    dataFlowSummary: null,
    dataFlowAnalyzed: false,
    gitChurn: [],
    gitAnalyzed: false,
    isGitRepo: false,
    changeCoupling: [],
    couplingAnalyzed: false,
    deadSymbols: [],
    deadCodeAnalyzed: false,
    codeIndexed: false,
    focusLanguage: null,
    activeAnalysisId: null,
    // 最近一次落库的 AI 上下文包指纹（供焦点巡查面板判断数据是否变更）
    aiContextDigest: "",

    // 文件变更监视
    watching: false,
    watchAnalysisId: null,
    watchProjectRoot: null,
    recentChanges: [],
    lastChangeEvent: null,

    scan: async (analysisId, projectRoot, opts) => {
      set((s) => {
        s.scanning = true;
        s.scanStage = null;
        s.scanPercent = 0;
        s.scanScanned = 0;
        s.scanTotal = 0;
        s.activeAnalysisId = analysisId;
        s.scanFreshness = null;
        s.files = [];
        s.modules = [];
        s.dependencies = [];
        s.findings = [];
        s.symbols = [];
        s.structureSummary = null;
        s.patternHits = [];
        s.structureAnalyzed = false;
        s.depsAnalyzed = false;
        s.reviewAnalyzed = false;
        s.symbolRefs = [];
        s.refsAnalyzed = false;
        s.metrics = [];
        s.metricsAnalyzed = false;
        s.techDebt = [];
        s.techDebtAnalyzed = false;
        s.clones = [];
        s.clonesAnalyzed = false;
        s.callEdges = [];
        s.callGraphSummary = null;
        s.callGraphAnalyzed = false;
        s.dataFlow = [];
        s.dataFlowSummary = null;
        s.dataFlowAnalyzed = false;
        s.gitChurn = [];
        s.gitAnalyzed = false;
        s.changeCoupling = [];
        s.couplingAnalyzed = false;
        s.deadSymbols = [];
        s.deadCodeAnalyzed = false;
        s.codeIndexed = false;
      });

      try {
        const job = await projectScanApi.scan(analysisId, projectRoot, opts);
        set((s) => {
          s.currentJob = job;
        });
      } catch (err) {
        console.error("[projectStore] scan failed", err);
        set((s) => {
          s.scanning = false;
        });
        throw err;
      }

      // 加载文件
      await get().loadFiles(analysisId);

      // ─── 增量差异：本轮内容哈希变化 / 新增的文件 ───
      // 只有「仅按 file_id 归属」的阶段能安全走增量（度量/技术债/数据流/全文索引）：
      // 它们的产出行不含跨文件符号引用，后端按 rel_path 重映射 file_id 后携带旧行不会留悬挂引用。
      // 结构 / 符号引用 / 调用图 / 死代码涉及跨文件符号 id，仍全量重算（已并行提速）。
      // null = 无基线（首扫）→ 保持 undefined 走全量；
      // [] = 有基线且零变更 → 必须传 []，四个阶段全部携带旧行（收益最大，别退化成全量）
      let changedRelPaths: string[] | undefined;
      try {
        const delta = await projectScanApi.getScanDelta(analysisId);
        if (delta !== null) {
          changedRelPaths = delta;
          const totalFiles = get().files.filter((f) => !f.isDirectory).length;
          console.info(
            `[projectStore] 增量扫描：${delta.length}/${totalFiles} 个文件变更，其余阶段结果按路径携带`,
          );
        }
      } catch (err) {
        console.error("[projectStore] get scan delta failed（回退全量）", err);
      }

      // 增量模式标识（UI 反馈）：有基线（delta !== null）即增量；
      // 空数组 = 零变更（收益最大），仍算增量；null = 无基线全量。
      set((s) => {
        s.scanIncremental = changedRelPaths !== undefined;
        s.scanChangedCount = changedRelPaths ? changedRelPaths.length : 0;
      });

      // ─── 并行编排：链内串行、链间并行 ───
      // 硬依赖链 structure→symbolRefs→callGraph→dataFlow 必须串行
      //   （callGraph 跨文件消歧依赖 import 表 symbolRefs；dataFlow 剪枝依赖 callGraph）。
      // 其余阶段仅依赖 files/projectRoot，与结构链无交集，并发跑以压榨 I/O 与 CPU。
      // deadCode 依赖符号引用与调用图，串在结构链之后。各阶段错误已隔离，单点失败不中断。
      const structureChain = (async () => {
        try { await get().analyzeStructure(analysisId, changedRelPaths); }
        catch (err) { console.error("[projectStore] analyze structure failed", err); }
        try { await get().analyzeSymbolRefs(analysisId, changedRelPaths); }
        catch (err) { console.error("[projectStore] analyze symbol refs failed", err); }
        try { await get().analyzeCallGraph(analysisId, changedRelPaths); }
        catch (err) { console.error("[projectStore] analyze call graph failed", err); }
        try { await get().analyzeDataFlow(analysisId, changedRelPaths); }
        catch (err) { console.error("[projectStore] analyze data flow failed", err); }
      })();

      const independentWave = Promise.all([
        (async () => {
          try { await projectScanApi.detectDependencies(analysisId, projectRoot); set((s) => { s.depsAnalyzed = true; }); }
          catch (err) { console.error("[projectStore] detect deps failed", err); }
        })(),
        (async () => {
          try { await projectScanApi.runReviewRules(analysisId); set((s) => { s.reviewAnalyzed = true; }); }
          catch (err) { console.error("[projectStore] run review failed", err); }
        })(),
        (async () => {
          try { await get().analyzeMetrics(analysisId, changedRelPaths); }
          catch (err) { console.error("[projectStore] analyze file metrics failed", err); }
        })(),
        (async () => {
          try { await get().analyzeTechDebt(analysisId, changedRelPaths); }
          catch (err) { console.error("[projectStore] analyze tech debt failed", err); }
        })(),
        (async () => {
          try { await get().analyzeClones(analysisId); }
          catch (err) { console.error("[projectStore] analyze code clones failed", err); }
        })(),
        (async () => {
          try { await get().analyzeGitHistory(analysisId, projectRoot); }
          catch (err) { console.error("[projectStore] analyze git history failed", err); }
        })(),
        (async () => {
          try { await get().analyzeChangeCoupling(analysisId, projectRoot); }
          catch (err) { console.error("[projectStore] analyze change coupling failed", err); }
        })(),
        (async () => {
          try { await get().indexCode(analysisId, changedRelPaths); }
          catch (err) { console.error("[projectStore] index code content failed", err); }
        })(),
      ]);

      // 结构链与独立波并发；各自错误已隔离，单个失败不影响其他阶段
      await Promise.all([structureChain, independentWave]);

      // 死代码检测依赖符号引用与调用图（结构链末端），串后执行
      try {
        await get().detectDeadCode(analysisId);
      } catch (err) {
        console.error("[projectStore] detect dead code failed", err);
      }

      // 加载全部数据
      await get().loadAll(analysisId);
      set((s) => {
        s.scanning = false;
      });
      // 扫描刚完成 → 刷新新鲜度（应显示「数据最新」）
      get().checkFreshness(analysisId);

      // 扫描完成后把分析结果压缩为 AI 上下文包并落库，供已配置的 Agent 按需取用（省 token）
      await get().persistScanContext(analysisId);
    },

    setScanProgress: (p) => {
      set((s) => {
        s.scanStage = p.stage;
        s.scanPercent = p.percent;
        s.scanScanned = p.scanned;
        s.scanTotal = p.total;
      });
    },

    cancelScan: async () => {
      const job = get().currentJob;
      if (!job) return;
      try {
        await projectScanApi.cancel(job.id);
      } catch (err) {
        console.error("[projectStore] cancel failed", err);
      }
    },

    // ─── 扫描新鲜度体检：对比上次扫描快照与当前磁盘，判断数据是否过时 ───
    // 仅用 analysisId：内部按 analysis 取 projectRoot，调用方零负担。
    // 失败静默（新鲜度只是辅助提示，绝不应阻断主流程）。
    checkFreshness: async (analysisId) => {
      set((s) => { s.scanFreshnessChecking = true; });
      try {
        const analysis = await analysisApi.get(analysisId);
        const projectRoot = analysis?.projectRoot;
        if (!projectRoot) {
          set((s) => { s.scanFreshnessChecking = false; });
          return;
        }
        // 书场景（`writing://{bookId}/` 伪 URI）磁盘上没有目录可体检 —— 直接跳过 invoke。
        // 不跳的话每次切场景都会往控制台灌一条
        // `checkScanFreshness failed – 路径不存在: writing://book_xxx/`。
        // 书的新鲜度由 openBookInStudio 的幂等重扫保证，这里顺手清掉上一次的新鲜度，
        // 免得把别的场景的「数据已过时」横幅带到书场景上。
        if (!isFilesystemProjectRoot(projectRoot)) {
          set((s) => { s.scanFreshness = null; s.scanFreshnessChecking = false; });
          return;
        }
        const fresh = await projectScanApi.checkScanFreshness(analysisId, projectRoot);
        set((s) => { s.scanFreshness = fresh; });
      } catch (err) {
        console.error("[projectStore] checkScanFreshness failed", err);
      } finally {
        set((s) => { s.scanFreshnessChecking = false; });
      }
    },

    loadFiles: async (analysisId) => {
      try {
        const files = await projectScanApi.listFiles(analysisId);
        set((s) => {
          s.files = files;
        });
      } catch (err) {
        console.error("[projectStore] loadFiles failed", err);
      }
    },

    loadModules: async (analysisId) => {
      try {
        const modules = await projectScanApi.listModules(analysisId);
        set((s) => {
          s.modules = modules;
        });
      } catch (err) {
        console.error("[projectStore] loadModules failed", err);
      }
    },

    loadDependencies: async (analysisId) => {
      try {
        const deps = await projectScanApi.listDependencies(analysisId);
        set((s) => {
          s.dependencies = deps;
        });
      } catch (err) {
        console.error("[projectStore] loadDependencies failed", err);
      }
    },

    loadLayers: async (analysisId) => {
      try {
        const layers = await projectScanApi.listLayers(analysisId);
        set((s) => {
          s.layers = layers;
        });
      } catch (err) {
        console.error("[projectStore] loadLayers failed", err);
      }
    },

    loadRules: async () => {
      try {
        const rules = await projectScanApi.listRules();
        set((s) => {
          s.rules = rules;
        });
      } catch (err) {
        console.error("[projectStore] loadRules failed", err);
      }
    },

    loadFindings: async (analysisId) => {
      try {
        const findings = await projectScanApi.listFindings(analysisId);
        set((s) => {
          s.findings = findings;
        });
      } catch (err) {
        console.error("[projectStore] loadFindings failed", err);
      }
    },

    loadAll: async (analysisId) => {
      await Promise.all([
        get().loadFiles(analysisId),
        get().loadModules(analysisId),
        get().loadDependencies(analysisId),
        get().loadLayers(analysisId),
        get().loadFindings(analysisId),
        get().loadRules(),
        get().loadSymbols(analysisId),
        get().loadPatterns(analysisId),
        get().loadSymbolRefs(analysisId),
        get().loadMetrics(analysisId),
        get().loadTechDebt(analysisId),
        get().loadClones(analysisId),
        get().loadCallEdges(analysisId),
        get().loadGitChurn(analysisId),
        get().loadChangeCoupling(analysisId),
        get().loadDeadSymbols(analysisId),
      ]);
    },

    // ─── 代码结构索引 ───
    analyzeStructure: async (analysisId, changedRelPaths) => {
      try {
        const summary = await projectScanApi.analyzeCodeStructure(analysisId, changedRelPaths);
        set((s) => {
          s.structureSummary = summary;
          s.structureAnalyzed = true;
        });
        await get().loadSymbols(analysisId);
        await get().loadPatterns(analysisId);
        return summary;
      } catch (err) {
        console.error("[projectStore] analyzeStructure failed", err);
        return null;
      }
    },

    loadSymbols: async (analysisId) => {
      try {
        const symbols = await projectScanApi.listSymbols(analysisId);
        set((s) => {
          s.symbols = symbols;
        });
      } catch (err) {
        console.error("[projectStore] loadSymbols failed", err);
      }
    },

    loadPatterns: async (analysisId) => {
      try {
        const hits = await projectScanApi.listDesignPatterns(analysisId);
        set((s) => {
          s.patternHits = hits;
        });
      } catch (err) {
        console.error("[projectStore] loadPatterns failed", err);
      }
    },

    // ─── 符号级引用索引 ───
    analyzeSymbolRefs: async (analysisId, changedRelPaths) => {
      try {
        const refs = await projectScanApi.analyzeSymbolReferences(analysisId, changedRelPaths);
        set((s) => {
          s.symbolRefs = refs;
          s.refsAnalyzed = true;
        });
        return refs;
      } catch (err) {
        console.error("[projectStore] analyzeSymbolRefs failed", err);
        return [];
      }
    },

    loadSymbolRefs: async (analysisId) => {
      try {
        const refs = await projectScanApi.listSymbolRefs(analysisId);
        set((s) => {
          s.symbolRefs = refs;
        });
      } catch (err) {
        console.error("[projectStore] loadSymbolRefs failed", err);
      }
    },

    // ─── 文件度量（复杂度热力图）───
    analyzeMetrics: async (analysisId, changedRelPaths) => {
      try {
        const metrics = await projectScanApi.analyzeFileMetrics(analysisId, changedRelPaths);
        set((s) => {
          s.metrics = metrics;
          s.metricsAnalyzed = true;
        });
        return metrics;
      } catch (err) {
        console.error("[projectStore] analyzeMetrics failed", err);
        return [];
      }
    },

    loadMetrics: async (analysisId) => {
      try {
        const metrics = await projectScanApi.listFileMetrics(analysisId);
        set((s) => {
          s.metrics = metrics;
        });
      } catch (err) {
        console.error("[projectStore] loadMetrics failed", err);
      }
    },

    // ─── 技术债扫描（TODO/FIXME/HACK 等标记）───
    analyzeTechDebt: async (analysisId, changedRelPaths) => {
      try {
        const debt = await projectScanApi.scanTechDebt(analysisId, changedRelPaths);
        set((s) => {
          s.techDebt = debt;
          s.techDebtAnalyzed = true;
        });
        return debt;
      } catch (err) {
        console.error("[projectStore] analyzeTechDebt failed", err);
        return [];
      }
    },

    loadTechDebt: async (analysisId) => {
      try {
        const debt = await projectScanApi.listTechDebt(analysisId);
        set((s) => {
          s.techDebt = debt;
        });
      } catch (err) {
        console.error("[projectStore] loadTechDebt failed", err);
      }
    },

    // ─── 代码克隆检测（重复率）───
    analyzeClones: async (analysisId) => {
      try {
        const clones = await projectScanApi.detectCodeClones(analysisId);
        set((s) => {
          s.clones = clones;
          s.clonesAnalyzed = true;
        });
        return clones;
      } catch (err) {
        console.error("[projectStore] analyzeClones failed", err);
        return [];
      }
    },

    loadClones: async (analysisId) => {
      try {
        const clones = await projectScanApi.listCodeClones(analysisId);
        set((s) => {
          s.clones = clones;
        });
      } catch (err) {
        console.error("[projectStore] loadClones failed", err);
      }
    },

    // ─── 函数调用图（影响面分析）───
    analyzeCallGraph: async (analysisId, changedRelPaths) => {
      try {
        const summary = await projectScanApi.analyzeCallGraph(analysisId, changedRelPaths);
        set((s) => {
          s.callGraphSummary = summary;
          s.callGraphAnalyzed = true;
        });
        await get().loadCallEdges(analysisId);
        return summary;
      } catch (err) {
        console.error("[projectStore] analyzeCallGraph failed", err);
        return null;
      }
    },

    loadCallEdges: async (analysisId) => {
      try {
        const edges = await projectScanApi.listCallEdges(analysisId);
        set((s) => {
          s.callEdges = edges;
        });
      } catch (err) {
        console.error("[projectStore] loadCallEdges failed", err);
      }
    },

    // ─── 过程间数据流摘要（影响链剪枝）───
    analyzeDataFlow: async (analysisId, changedRelPaths) => {
      try {
        const summary = await projectScanApi.analyzeDataFlow(analysisId, changedRelPaths);
        set((s) => {
          s.dataFlowSummary = summary;
          s.dataFlowAnalyzed = true;
        });
        await get().loadDataFlow(analysisId);
        return summary;
      } catch (err) {
        console.error("[projectStore] analyzeDataFlow failed", err);
        return null;
      }
    },

    loadDataFlow: async (analysisId) => {
      try {
        const facts = await projectScanApi.listDataFlow(analysisId);
        set((s) => {
          s.dataFlow = facts;
        });
      } catch (err) {
        console.error("[projectStore] loadDataFlow failed", err);
      }
    },

    // ─── Git 变更热点 ───
    analyzeGitHistory: async (analysisId, projectRoot, sinceDays) => {
      try {
        const isRepo = await projectScanApi.isGitRepo(projectRoot);
        set((s) => {
          s.isGitRepo = isRepo;
        });
        if (!isRepo) {
          set((s) => {
            s.gitChurn = [];
            s.gitAnalyzed = true;
          });
          return [];
        }
        const churn = await projectScanApi.analyzeGitHistory(analysisId, projectRoot, sinceDays);
        set((s) => {
          s.gitChurn = churn;
          s.gitAnalyzed = true;
        });
        return churn;
      } catch (err) {
        console.error("[projectStore] analyzeGitHistory failed", err);
        return [];
      }
    },

    loadGitChurn: async (analysisId) => {
      try {
        const churn = await projectScanApi.listGitChurn(analysisId);
        set((s) => {
          s.gitChurn = churn;
          if (churn.length > 0) s.isGitRepo = true;
        });
      } catch (err) {
        console.error("[projectStore] loadGitChurn failed", err);
      }
    },

    // ─── 变更耦合（时间维度耦合：总是一起改的文件对）───
    analyzeChangeCoupling: async (analysisId, projectRoot, sinceDays) => {
      try {
        const isRepo = await projectScanApi.isGitRepo(projectRoot);
        set((s) => {
          s.isGitRepo = isRepo;
        });
        if (!isRepo) {
          // 非 git 仓库时安静降级：这一维度本就依赖版本历史，不该打断整条扫描链
          set((s) => {
            s.changeCoupling = [];
            s.couplingAnalyzed = true;
          });
          return [];
        }
        // v2.18 默认 ?? 365 → ?? null：与 tauri.ts wrapper 同形修复，让 UI「全量」按钮 = 真全量。
    // 老仓库历史全量展开可能有更多耦合；top_n=400 + min_co=3 已在后端防御爆量。
    const pairs = await projectScanApi.analyzeChangeCoupling(analysisId, projectRoot, {
          sinceDays: sinceDays ?? null,
        });
        set((s) => {
          s.changeCoupling = pairs;
          s.couplingAnalyzed = true;
        });
        return pairs;
      } catch (err) {
        console.error("[projectStore] analyzeChangeCoupling failed", err);
        return [];
      }
    },

    loadChangeCoupling: async (analysisId) => {
      try {
        const pairs = await projectScanApi.listChangeCoupling(analysisId);
        set((s) => {
          s.changeCoupling = pairs;
          if (pairs.length > 0) {
            s.couplingAnalyzed = true;
            s.isGitRepo = true;
          }
        });
      } catch (err) {
        console.error("[projectStore] loadChangeCoupling failed", err);
      }
    },

    // ─── 死代码检测 ───
    detectDeadCode: async (analysisId) => {
      try {
        const dead = await projectScanApi.detectDeadSymbols(analysisId);
        set((s) => {
          s.deadSymbols = dead;
          s.deadCodeAnalyzed = true;
        });
        // 死代码会写入 review_findings，刷新审查面板
        await get().loadFindings(analysisId);
        return dead;
      } catch (err) {
        console.error("[projectStore] detectDeadCode failed", err);
        return [];
      }
    },

    loadDeadSymbols: async (analysisId) => {
      try {
        const dead = await projectScanApi.listDeadSymbols(analysisId);
        set((s) => {
          s.deadSymbols = dead;
        });
      } catch (err) {
        console.error("[projectStore] loadDeadSymbols failed", err);
      }
    },

    // ─── 代码全文索引 ───
    indexCode: async (analysisId, changedRelPaths) => {
      try {
        const count = await projectScanApi.indexCodeContent(analysisId, changedRelPaths);
        set((s) => {
          s.codeIndexed = count > 0;
        });
        return count;
      } catch (err) {
        console.error("[projectStore] indexCode failed", err);
        return 0;
      }
    },

    searchCode: async (analysisId, query, limit) => {
      try {
        return await projectScanApi.searchCodeContent(analysisId, query, limit);
      } catch (err) {
        console.error("[projectStore] searchCode failed", err);
        return [];
      }
    },

    setFocusLanguage: (lang) => {
      set((s) => {
        s.focusLanguage = lang;
      });
    },

    setActiveAnalysis: (id) => {
      set((s) => {
        s.activeAnalysisId = id;
        if (id) {
          get().loadAll(id);
          // 载入分析后顺带体检新鲜度（数据是否过时 → 横幅提示 + 重扫入口）
          get().checkFreshness(id);
        } else {
          s.files = [];
          s.modules = [];
          s.dependencies = [];
          s.findings = [];
          s.symbols = [];
          s.structureSummary = null;
          s.patternHits = [];
          s.structureAnalyzed = false;
        s.depsAnalyzed = false;
        s.reviewAnalyzed = false;
          s.symbolRefs = [];
          s.refsAnalyzed = false;
          s.metrics = [];
          s.metricsAnalyzed = false;
          s.techDebt = [];
          s.techDebtAnalyzed = false;
          s.callEdges = [];
          s.callGraphSummary = null;
          s.callGraphAnalyzed = false;
          s.dataFlow = [];
          s.dataFlowSummary = null;
          s.dataFlowAnalyzed = false;
          s.gitChurn = [];
          s.gitAnalyzed = false;
          s.changeCoupling = [];
          s.couplingAnalyzed = false;
          s.deadSymbols = [];
          s.deadCodeAnalyzed = false;
          s.codeIndexed = false;
        }
      });
    },

    clear: () => {
      // 换项目/清空时一并丢掉上下文落库缓存：留着上一个分析的分节戳，
      // 下一个分析会被误判为「大部分分节未变」而只写一部分，库里就成了两份数据的拼接。
      resetContextPersistCache();
      set((s) => {
        s.currentJob = null;
        s.scanning = false;
        s.scanIncremental = false;
        s.scanChangedCount = 0;
        s.files = [];
        s.modules = [];
        s.dependencies = [];
        s.layers = [];
        s.findings = [];
        s.symbols = [];
        s.structureSummary = null;
        s.patternHits = [];
        s.structureAnalyzed = false;
        s.depsAnalyzed = false;
        s.reviewAnalyzed = false;
        s.symbolRefs = [];
        s.refsAnalyzed = false;
        s.metrics = [];
        s.metricsAnalyzed = false;
        s.techDebt = [];
        s.techDebtAnalyzed = false;
        s.clones = [];
        s.clonesAnalyzed = false;
        s.callEdges = [];
        s.callGraphSummary = null;
        s.callGraphAnalyzed = false;
        s.dataFlow = [];
        s.dataFlowSummary = null;
        s.dataFlowAnalyzed = false;
        s.gitChurn = [];
        s.gitAnalyzed = false;
        s.isGitRepo = false;
        s.changeCoupling = [];
        s.couplingAnalyzed = false;
        s.deadSymbols = [];
        s.deadCodeAnalyzed = false;
        s.codeIndexed = false;
        s.focusLanguage = null;
        s.activeAnalysisId = null;
        s.watching = false;
        s.watchAnalysisId = null;
        s.watchProjectRoot = null;
        s.recentChanges = [];
        s.lastChangeEvent = null;
      });
    },

    persistScanContext: async (analysisId, trigger = "full-scan") => {
      // 仅当 store 当前装载的正是该 analysis 且确有文件时才构建（避免空包/错分析）
      const st = get();
      if (st.activeAnalysisId !== analysisId) return;
      if (!st.files.some((f) => !f.isDirectory)) return;
      const provider = aiContextRegistry.get("project-scan");
      if (!provider) return;

      // 指标切面必须在 buildPack **之前**记入时间轴。
      // 顺序反了 trend 分节读到的就永远是上一轮的报告——用户会看到「本次扫描」
      // 配着一份滞后一轮的走势，而这种错位在界面上完全看不出来。
      // 整段吞异常：趋势是增强能力，不能反过来打断扫描收尾。
      try {
        const { captureMetricSnapshot } = await import("../ai/metricTrend");
        await captureMetricSnapshot(provider, analysisId, { triggerKind: trigger });
      } catch (err) {
        console.error("[projectStore] captureMetricSnapshot failed", err);
      }

      // 实体切面同理，而且时序要求更硬：
      //
      // 指标切面答的是「整个项目的总量变了没有」，实体切面答的是「**哪个文件**变坏了」，
      // 后者是回归追责派单的唯一数据来源。它必须发生在 persistModuleContext 之前，
      // 因为 buildPack 会同步读缓存里的回归报告——顺序反了，Agent 拿到的追责线索
      // 永远慢一轮：这次点名带的是上一次劣化的数字，指着已经改过的地方问。
      //
      // 另外这一步**必须每次扫描都做**，不能因为「上下文指纹没变就跳过」而省掉：
      // 没打这个点，两次扫描之间的劣化就没有可比的两端，之后再也补不回来。
      try {
        const { captureEntitySnapshot } = await import("../ai/entityRegression");
        await captureEntitySnapshot(provider, analysisId, { triggerKind: trigger });
      } catch (err) {
        console.error("[projectStore] captureEntitySnapshot failed", err);
      }

      let digest: string | null = null;
      try {
        // 构建 + 落库统一交给 contextPersist：分节戳水合、增量判定、写库方式选择都在那里。
        // 这段逻辑曾经内联在这里，而 analysisRunner 另有一份「裁剪后整包写」的实现，
        // 两者写同一个 pack_id，后者会把这里写好的分节删掉一半。收成一个入口才根治。
        const res = await persistModuleContext(provider, analysisId);
        if (!res) return;
        digest = res.pack.digest;
        // 缓存指纹：焦点巡查面板据此判断「派单后数据是否已变」，不必自己重跑 buildPack。
        set((s) => {
          s.aiContextDigest = digest ?? "";
        });
        if (res.mode === "skip") {
          console.debug("[projectStore] AI 上下文包各分节内容均未变化，跳过写库");
        } else {
          console.info(
            `[projectStore] AI 上下文包已${res.mode === "partial" ? "增量更新" : "整包落库"} ${res.packId}` +
              `（${res.pack.sections.length} 分节 / ${res.pack.tokenEstimate} token，` +
              `本次变化 ${res.pack.changedSections.length} 节）`,
          );
        }
      } catch (err) {
        // 持久化失败不应阻断扫描主流程（这是增强能力，非核心链路）
        console.error("[projectStore] persistScanContext failed", err);
        return;
      }

      // 自动分析编排：数据已就绪，按用户配置的规则决定是否立刻交给 Agent 解读。
      // 注意即便上面因 digest 相同跳过了写库，这里仍要走一遍——规则自己带 lastDigest
      // 去重，新建的规则不该因为「内容恰好没变」而永远等不到第一次触发。
      // 整段吞异常：自动分析是增强能力，绝不能反过来打断扫描收尾。
      try {
        const { runAutoAnalysis } = await import("../ai/autoAnalysisOrchestrator");
        const outcome = await runAutoAnalysis({
          moduleId: "project-scan",
          scopeId: analysisId,
          trigger,
          digest: digest ?? "",
        });
        if (outcome.triggered > 0) {
          console.info(
            `[projectStore] 自动分析已发起 ${outcome.triggered} 次（跳过 ${outcome.skipped} / 失败 ${outcome.failed}）`,
          );
        }
      } catch (err) {
        console.error("[projectStore] runAutoAnalysis failed", err);
      }
    },

    // ─── 文件变更监视 ───
    initFileWatcher: async () => {
      // 幂等：已注册或正在初始化则跳过
      if (watcherUnlisten || watcherInitPromise) return;

      watcherInitPromise = (async () => {
        try {
          const unlisten1 = await listen<FileChangeEvent[]>("file-changes", (event) => {
            const changes = Array.isArray(event.payload) ? event.payload : [];
            if (!changes.length) return;
            const st = get();
            // 只处理当前监视分析的变更
            if (st.watchAnalysisId && changes.every((c) => c.analysisId !== st.watchAnalysisId)) return;

            set((s) => {
              s.recentChanges = [...changes.slice(-RECENT_CHANGES_LIMIT), ...s.recentChanges].slice(0, RECENT_CHANGES_LIMIT);
            });
            get().handleFileChanges(changes);
          });

          const unlisten2 = await listen("watching-stopped", () => {
            set((s) => {
              s.watching = false;
              s.watchAnalysisId = null;
              s.watchProjectRoot = null;
            });
          });

          watcherUnlisten = () => {
            try {
              unlisten1();
              unlisten2();
            } catch (e) {
              console.error("[projectStore] unlisten failed", e);
            }
          };
        } catch (err) {
          console.error("[projectStore] initFileWatcher failed", err);
        } finally {
          watcherInitPromise = null;
        }
      })();

      await watcherInitPromise;
    },

    handleFileChanges: (changes) => {
      // 防抖 + 合并批次：窗口内所有变更累积到 pendingChanges，最后一个变更后
      // CHANGE_DEBOUNCE_MS 无新变更才一次性联动，避免连存 10 文件触发 10 次重扫、
      // 且只处理最后一批导致前几批改动漏算。
      pendingChanges = pendingChanges.concat(changes);
      if (changeDebounceTimer) clearTimeout(changeDebounceTimer);
      changeDebounceTimer = setTimeout(async () => {
        changeDebounceTimer = null;
        // 取出并清空累积批次（按 path 去重：同一文件多次改动只算一次）
        const seen = new Set<string>();
        const batch = pendingChanges.filter((c) => {
          if (seen.has(c.path)) return false;
          seen.add(c.path);
          return true;
        });
        pendingChanges = [];
        const st = get();
        const id = st.watchAnalysisId;
        const root = st.watchProjectRoot;
        if (!id) return;

        try {
          // 1) 刷新文件列表（新增/删除/修改反映到左侧文件树与实体面板）
          await st.loadFiles(id);

          // 1b) 把本批变更的绝对路径映射成 rel_path，供 file_id 归属型阶段走增量。
          // 保存一个文件不该触发全项目重算；匹配不到（新建但未入库）的文件本就没有可分析的行。
          const changedAbs = new Set(batch.map((c) => c.path));
          const changedRelPaths = get()
            .files.filter((f) => !f.isDirectory && changedAbs.has(f.path))
            .map((f) => f.relPath);
          const deltaPaths = changedRelPaths.length > 0 ? changedRelPaths : undefined;
          // 增量模式标识（UI 反馈）：监听触发即变更驱动重扫，按本批变更文件数上报
          set((s) => {
            s.scanIncremental = true;
            s.scanChangedCount = changedAbs.size;
          });
          // 2) 重新检测依赖（需要项目根目录）
          if (root) {
            await projectScanApi.detectDependencies(id, root);
            await st.loadDependencies(id);
          }
          // 3) 重跑审查规则（代码变更后违规情况可能变化）
          await projectScanApi.runReviewRules(id);
          await st.loadFindings(id);
          // 3b) 重跑代码结构索引（新增/删除类、函数、设计模式变化）
          try {
            await get().analyzeStructure(id, deltaPaths);
          } catch (e) {
            console.error("[projectStore] re-analyze structure after change failed", e);
          }
          // 3c) 重跑符号级引用索引（import 变化 → 引用边更新）
          try {
            await get().analyzeSymbolRefs(id);
          } catch (e) {
            console.error("[projectStore] re-analyze symbol refs after change failed", e);
          }
          // 3d) 重跑文件度量（行数/复杂度变化 → 热力图更新，仅变更文件）
          try {
            await get().analyzeMetrics(id, deltaPaths);
          } catch (e) {
            console.error("[projectStore] re-analyze metrics after change failed", e);
          }
          // 3e) 重跑技术债扫描（新增 TODO/FIXME 标记 → 技术债画像更新，仅变更文件）
          try {
            await get().analyzeTechDebt(id, deltaPaths);
          } catch (e) {
            console.error("[projectStore] re-analyze tech debt after change failed", e);
          }
          // 3e2) 重跑代码克隆检测（复制粘贴新代码 → 重复率画像更新）
          try {
            await get().analyzeClones(id);
          } catch (e) {
            console.error("[projectStore] re-detect code clones after change failed", e);
          }
          // 3f) 重建符号结构 + 引用（函数/类增删改 → 实体画像与引用关系变化，仅变更文件）
          try {
            await get().analyzeStructure(id, deltaPaths);
          } catch (e) {
            console.error("[projectStore] re-analyze structure after change failed", e);
          }
          try {
            await get().analyzeSymbolRefs(id, deltaPaths);
          } catch (e) {
            console.error("[projectStore] re-analyze symbol refs after change failed", e);
          }
          // 3f2) 重建调用图（函数增删改 → 影响面变化）
          try {
            await get().analyzeCallGraph(id, deltaPaths);
          } catch (e) {
            console.error("[projectStore] re-analyze call graph after change failed", e);
          }
          // 3f2) 重建数据流摘要（函数体改动 → 透传/阻断判定变化 → 影响链剪枝更新，仅变更文件）
          try {
            await get().analyzeDataFlow(id, deltaPaths);
          } catch (e) {
            console.error("[projectStore] re-analyze data flow after change failed", e);
          }
          // 3g) 重跑死代码检测（引用关系变化 → 孤立符号变化）
          try {
            await get().detectDeadCode(id);
          } catch (e) {
            console.error("[projectStore] re-detect dead code after change failed", e);
          }
          // 3h) 重建代码全文索引（内容变化 → 检索结果更新，仅变更文件）
          try {
            await get().indexCode(id, deltaPaths);
          } catch (e) {
            console.error("[projectStore] re-index code after change failed", e);
          }
          // 4) 同步最新文件到画布（实体 config 的 fileSize/lineCount 等）
          try {
            await projectScanApi.syncFilesToCanvas(id, root ?? "");
          } catch (e) {
            console.error("[projectStore] sync files to canvas after change failed", e);
          }
          // 5) 刷新 AI 上下文包：增量重扫后数据已变，不刷新会让 Agent 读到陈旧结论。
          // persistScanContext 内部按 digest 去重，内容没实质变化时不会白写一次库。
          // 标记为 incremental：只想在全量扫描后分析的规则会自动跳过本次。
          await get().persistScanContext(id, "incremental");

          // 6) G4 回扫验证闭环：AI 写回代码后，后端自动复核本次诊断产出的洞察是否已解决。
          // 仅当存在诊断关联洞察且命中变更路径时才动库，幂等且不 emit file-changes（避免循环重扫）。
          if (changedRelPaths.length > 0) {
            try {
              const updated = await aiContextApi.verifyDiagnosisInsights(id, changedRelPaths);
              if (updated > 0) {
                useToastStore.getState().showToast(
                  t("aiPanel.verify.resolved", { n: updated }),
                  "info",
                );
                // 强制回库刷新画布 AI 角标（status 已变）
                const allPaths = get().files.map((f) => f.relPath);
                useInsightOverlayStore.getState().load(id, allPaths, true);
              }
            } catch (e) {
              console.error("[projectStore] verify diagnosis insights failed", e);
            }
          }
        } catch (err) {
          console.error("[projectStore] auto re-analyze after file change failed", err);
        }
      }, CHANGE_DEBOUNCE_MS);

      // 通知回调（供 UI 显示 toast），最近一次变更作为示例
      const last = changes[changes.length - 1];
      set((s) => {
        s.lastChangeEvent = last ?? null;
      });
    },

    startWatching: async (analysisId, projectRoot) => {
      // 确保监听已注册
      await get().initFileWatcher();
      try {
        await fileWatcherApi.startWatching(analysisId, projectRoot);
        set((s) => {
          s.watching = true;
          s.watchAnalysisId = analysisId;
          s.watchProjectRoot = projectRoot;
        });
      } catch (err) {
        console.error("[projectStore] startWatching failed", err);
        throw err;
      }
    },
    stopWatching: async () => {
      const id = get().watchAnalysisId;
      if (!id) return;
      // 取消挂起的防抖定时器并清空累积批次，避免残留变更在监听停止后仍被处理
      if (changeDebounceTimer) {
        clearTimeout(changeDebounceTimer);
        changeDebounceTimer = null;
      }
      pendingChanges = [];
      try {
        await fileWatcherApi.stopWatching(id);
        set((s) => {
          s.watching = false;
          s.watchAnalysisId = null;
          s.watchProjectRoot = null;
          s.recentChanges = [];
        });
      } catch (err) {
        console.error("[projectStore] stopWatching failed", err);
      }
    },
    clearChanges: () => {
      set((s) => {
        s.recentChanges = [];
        s.lastChangeEvent = null;
      });
    },

    saveLayer: async (layer) => {
      try {
        await projectScanApi.saveLayer(layer);
        set((s) => {
          const idx = s.layers.findIndex((l) => l.id === layer.id);
          if (idx >= 0) s.layers[idx] = layer;
          else s.layers.push(layer);
        });
      } catch (err) {
        console.error("[projectStore] saveLayer failed", err);
      }
    },

    deleteLayer: async (id) => {
      try {
        await projectScanApi.deleteLayer(id);
        set((s) => {
          s.layers = s.layers.filter((l) => l.id !== id);
        });
      } catch (err) {
        console.error("[projectStore] deleteLayer failed", err);
      }
    },

    createLayer: async (analysisId, name, color) => {
      const layer: ProjectLayer = {
        id: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        analysisId,
        name,
        color,
        sortOrder: 0,
        yPosition: 0,
        description: null,
        rulePattern: null,
        metadata: "{}",
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      };
      try {
        await projectScanApi.saveLayer(layer);
        set((s) => {
          s.layers.push(layer);
        });
        return layer;
      } catch (err) {
        console.error("[projectStore] createLayer failed", err);
        return null;
      }
    },
  }))
);