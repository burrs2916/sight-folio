/**
 * AI 上下文供给协议 —— 模块无关的通用契约。
 *
 * 设计意图：
 * project-sight 的分析产物（扫描、画布、报告、未来任意模块）都需要以「AI 能高效消费」的
 * 形态交给 Agent。如果每个模块各写一套拼 prompt 的代码，AI 层就会被写死在扫描上，
 * 后续接入任何新模块都要改 AI 层。所以这里只定义协议，不含任何模块知识：
 *
 *   模块侧实现 AiContextProvider  →  注册到 aiContextRegistry  →  AI 层按协议消费
 *
 * 省 token 的四个机制都落在协议里：
 *   1. 分节（section）：Agent 先看目录（title + summary + tokenEstimate），按需取正文；
 *   2. 预算（tokenBudget）：按 priority 升序装箱，超预算的分节降级为「仅摘要」；
 *   3. 事实（facts）：结构化 JSON 与 Markdown 正文并存，程序精确消费不必解析自然语言；
 *   4. 分节级增量（digest + updatedAt + changedSections）：重扫后只有真正变化的分节
 *      才会被重写与重读——写库省 IO，Agent 增量分析时只取变化节，省的是最贵的那部分 token。
 */

/**
 * 分节数据可信度。
 *
 * 为什么协议层必须有这一条
 * ------------------------
 * AI 分析里最贵的错误不是「数据不够」，而是**把「没有数据」读成「没有问题」**。
 * 一个分节如果只输出「未发现循环依赖」，Agent 无从分辨这句话来自
 *   (a) 依赖分析跑完了，确实没有环；还是
 *   (b) 该语言没有依赖分析器 / 阶段失败 / 项目不在 Git 仓库，压根没数据。
 * 两者的正确反应完全相反：(a) 可以下结论，(b) 必须声明盲区。
 * 所以每个分节都要显式携带「这节的数据到底成不成立」，让 Agent 先看可信度再决定读不读、敢不敢下结论。
 *
 * 同时这也是省 token 的手段：status 为 empty / unavailable 的分节，
 * Agent 在 outline 阶段就能跳过，不必花 token 取回一段「无数据」的正文。
 */
import type { LangText } from "../i18n";

export type AiDataQualityStatus =
  /** 数据完整可信，可直接据此下结论（observed 为 0 时意味着「确实没有」，是真结论） */
  | "ok"
  /** 只覆盖了部分对象（如仅部分语言支持该分析），结论仅在覆盖范围内成立 */
  | "partial"
  /** 该维度有能力分析，但本项目确实没有可分析的对象（如项目里没有测试文件） */
  | "empty"
  /** 该维度在本项目上不可用（语言不支持 / 前置条件缺失 / 阶段未跑），不得据此下任何结论 */
  | "unavailable";

/**
 * 原始记录下钻指路。
 *
 * 为什么这条信息必须由**模块自己声明**
 * ------------------------------------
 * 分节正文只放 Top-N 明细，这是省 token 的必要取舍，但代价是 Agent 看不到第 N+1 条。
 * 补救办法是让它去查原始记录 —— 前提是它知道「这一节背后的全量数据叫什么、在哪个工具里」。
 *
 * 这个对应关系是**模块知识**（扫描模块才知道 techDebt 分节背后是 project_tech_debt 表）。
 * 如果把它写进 AI 层或后端工具层，每接入一个新模块都要回头改公共代码，
 * 「模块实现 Provider 即接入」的架构承诺就破了。所以协议只留一个声明位，
 * 谁供数据谁填，AI 层与后端一律只做透传。
 */
export interface AiSectionDrilldown {
  /** 能取到全量记录的工具名，如 "scan_records" */
  tool: string;
  /** 该工具里的数据集标识，如 "techDebt" */
  dataset: string;
  /** 该维度的原始记录总数；正文明细只是其中的 Top-N 摘录 */
  total?: number;
}

export interface AiSectionDataQuality {
  status: AiDataQualityStatus;
  /** 该分节背后的原始记录数（Agent 判断样本量是否够支撑结论） */
  observed?: number;
  /** partial 时的覆盖面：已覆盖 / 应覆盖 */
  covered?: number;
  expected?: number;
  /** 一句话说明为什么是这个状态，直接给 Agent 读 */
  reason?: string;
  /** 正文只列了 Top-N 明细（聚合口径仍是全量），提示 Agent 别把 Top-N 当全集 */
  truncated?: boolean;
  /** 明确禁止 Agent 下的结论，避免「空即无问题」式误判 */
  caveat?: string;
  /**
   * 截断的补救路径：去哪儿拿这一维度的全量原始记录。
   * 只在 truncated 时才有意义 —— 没被截断的分节，正文就是全部。
   */
  drilldown?: AiSectionDrilldown;
}

/** 分节内容戳：内容指纹 + 该内容最后一次「真正发生变化」的时间 */
export interface AiSectionStamp {
  /** 分节内容指纹（同内容必同指纹） */
  digest: string;
  /**
   * 内容最后一次变化的时间戳（ms）。
   * 注意不是「最后一次重建时间」——未变化的分节会继承旧值，
   * 否则每次重扫全部刷新，Agent 就无法据此判断「哪节真的更新了」。
   */
  updatedAt: number;
}

/** 上下文分节：AI 检索与预算裁剪的最小单位 */
export interface AiContextSection extends AiSectionStamp {
  /** 分节唯一键（模块内唯一），Agent 按此键取正文 */
  key: string;
  /** 人类可读标题 */
  title: string;
  /** 一句话摘要：列目录时给 Agent 判断「值不值得取全文」 */
  summary: string;
  /** Markdown 正文 */
  content: string;
  /** 正文 token 估算 */
  tokenEstimate: number;
  /** 装箱优先级，越小越先进预算（0 = 必须保留） */
  priority: number;
  /** 结构化事实：供程序/Agent 精确消费，避免从自然语言里回读数字 */
  facts?: Record<string, unknown>;
  /**
   * 数据可信度。不填等价于 { status: "ok" }（老模块与历史数据的兼容口径），
   * 但新模块应当显式填写——这是 Agent 区分「没问题」与「没数据」的唯一依据。
   */
  dataQuality?: AiSectionDataQuality;
  /**
   * 派生分节：内容由 **AI 自己的产出**推导而来，而非模块观测到的客观数据。
   *
   * 为什么协议层非要区分这一类
   * --------------------------
   * 「内容指纹未变化就跳过分析」是整套自动化最重要的省钱闸门。它成立的前提是
   * 指纹只反映**客观世界**的变化：代码改了才重新分析。
   *
   * 一旦把「AI 结论账本」这类分节也算进包指纹，闸门的因果就被接反了：
   *   Agent 保存一条洞察 → 账本内容变 → 包指纹变 → 去重闸门判定「数据已更新」→
   *   放行下一轮分析 → Agent 再保存洞察 → ……
   * 一个自我供能的正反馈回路，按冷却窗口的节奏稳定烧钱，而且**每一项指标都是绿的**：
   * 轨迹全 completed、洞察持续增长、覆盖率满格。除非有人去对账，否则不会有任何告警。
   *
   * 所以派生分节**照常落库、照常给 Agent 读**（它确实有价值），但一律不参与包指纹：
   * 见 {@link packDigestFromSections}。判断标准很简单——
   * **这一节的内容会不会因为 Agent 做了分析而改变？会，就是 derived。**
   */
  derived?: boolean;
}

/** 一次上下文构建的完整产物 */
export interface AiContextPack {
  /** 来源模块 id，如 "project-scan" */
  moduleId: string;
  /** 作用域 id：扫描模块 = analysisId；其他模块自定义 */
  scopeId: string;
  /** 作用域展示名，如项目名 */
  scopeLabel: string;
  /** 协议版本：后端解析与前端生成必须同版本，升级时用于兼容判断 */
  schemaVersion: number;
  generatedAt: number;
  sections: AiContextSection[];
  /** 全包 token 估算（含被降级为摘要的分节） */
  tokenEstimate: number;
  /** 内容指纹：数据没变就不必重新生成 / 重新分析。由各分节指纹组合而成 */
  digest: string;
  /** 装箱时被裁成「仅摘要」的分节键（透明告知，避免 Agent 以为数据完整） */
  truncatedSections: string[];
  /**
   * 相对 buildOptions.previousSections，本次内容发生变化（含新增）的分节键。
   * 未传 previousSections 时视为全部变化（首次构建）。
   */
  changedSections: string[];
  /** 相对上次未发生变化的分节键：写库可跳过，Agent 也无需重读 */
  unchangedSections: string[];
}

/** 构建选项 */
export interface AiContextBuildOptions {
  /** token 预算上限；不传则不裁剪 */
  tokenBudget?: number;
  /** 只构建指定分节；不传则全量 */
  sectionKeys?: string[];
  /**
   * 上一次构建的分节戳（key → stamp）。传入后：
   *   - 内容未变的分节继承旧 updatedAt（保住「哪节真的更新了」这一信息）；
   *   - 包上回传 changedSections / unchangedSections，供持久化层做增量写库。
   * 不传则一切视为新增。
   */
  previousSections?: Record<string, AiSectionStamp>;
  /** 构建时间基准（ms），仅供测试注入；不传取 Date.now() */
  now?: number;
}

/**
 * 分析预设：模块可以声明「这类数据适合问什么」，UI 据此提供一键分析按钮。
 * 注意这里只提供**任务描述**，用哪个 Agent / 哪个模型永远由用户选择，不在此写死。
 */
export interface AiAnalysisPreset {
  key: string;
  /** 双语：按当前 UI 语言选取（见 i18n.pickLang） */
  title: LangText;
  description: LangText;
  /** 发给 Agent 的任务指令（不含上下文，上下文由 pack 提供） */
  prompt: LangText;
  /** 该预设需要的分节；不传表示全量 */
  sectionKeys?: string[];
  /** 预设分组：用于在 UI 上把同类预设归到同一区块（如「diagnose」问题诊断 / 「requirements」需求与演进）。可选，缺省归到默认组 */
  group?: string;
}

/**
 * 数据可信度体检报告 —— 给**人**看的那一份。
 *
 * dataQuality 挂在分节上是给 Agent 用的，但同一件事人也必须能看见：
 * 用户在点「开始深度分析」之前，有权知道这次扫描到底看清了多少、
 * 哪些维度是盲区。否则 Agent 输出「架构健康」时，人和 AI 会一起被同一个盲区骗。
 *
 * 报告以「维度」为单位而不是「分节」——分节是给 AI 的取数单位，
 * 维度才是人能理解的分析能力（依赖检测、Git 历史、数据流……）。
 */
export interface AiContextQualityDimension {
  key: string;
  /** 人类可读的维度名，如「依赖检测」 */
  label: string;
  /** 该维度观测到的记录数 */
  observed: number;
  quality: AiSectionDataQuality;
}

export interface AiContextQualityReport {
  moduleId: string;
  scopeId: string;
  /** 取所有维度里最差的那个 */
  overall: AiDataQualityStatus;
  dimensions: AiContextQualityDimension[];
}

/**
 * 焦点目标报告 —— 给**人**读的「从哪下手」那一份。
 *
 * 它与 riskMatrix 分节共用同一套全量交叉结果（computeRiskCorrelation），
 * 只是把「给 Agent 的 Markdown 分节」翻译成「给人读的表格」。
 * 这样人和 AI 看到的是同一份结论：同一个文件、同样的名次、同样的综合分，
 * 不会因为 Agent 侧做了 Top-N 截断而人和 AI 看到的不一致——
 * 否则会出现最糟的情况：Agent 把 quiet.ts 列为头号重构目标，人却在任何一处 UI 都找不到它。
 *
 * 模块无关：协议层只定义 AiFocusReport 形状，由模块侧实现 describeFocus 提供。
 * 与 describeQuality 同构——可选、低开销（只做计数与判定，不拼正文）、未实现时上层静默降级。
 */
export interface AiFocusDimensionHit {
  key: string;
  label: string;
  value: number;
  /** 分位：严格低于该值的文件占比（0..100），分母含取值为 0 的文件 */
  pct: number;
  /** 该维度内的名次（并列同名次） */
  rank: number;
  unit: string;
  /** 是否处于该维度高位（前 10% 且达绝对信号下限） */
  hot: boolean;
}

export interface AiFocusTarget {
  filePath: string;
  codeLines: number;
  /** 加权分位综合分 0..100 */
  score: number;
  /** 处于高位的维度数 */
  resonance: number;
  /** 处于高位的维度 key 列表 */
  resonantKeys: string[];
  /** 各维度命中细节（仅含高位维度，与 Agent 侧同一口径） */
  dims: Record<string, AiFocusDimensionHit>;
}

export interface AiFocusBlindSpot {
  key: string;
  label: string;
  reason?: string;
}

export interface AiFocusReport {
  moduleId: string;
  scopeId: string;
  scopeLabel?: string;
  /** 有风险信号的文件数 */
  scoredFiles: number;
  /** ≥2 维度同时高位的文件数（多维共振） */
  resonantFiles: number;
  /** 名次进入前多少名算「高位」，随项目规模浮动 */
  hotRankLimit: number;
  /** 参与打分的维度 */
  dimensions: Array<{ key: string; label: string; weight: number; nonZero: number; max: number; unit: string }>;
  /** 因阶段盲区被排除、未参与打分的维度 */
  blindSpots: AiFocusBlindSpot[];
  /** 多维共振 Top-N（先按共振数，再按综合分） */
  targets: AiFocusTarget[];
  /**
   * 维度共现：项目的系统性病灶（哪两类问题总落在同一文件）。
   *
   * 必须同时带 key 与 label：本报告的消费方（UI 面板）是模块无关的，
   * 手里没有任何维度字典，拿到裸 key 只能把 "complexity × churn" 原样印给用户。
   * 翻译责任属于知道维度定义的模块侧，不属于渲染侧。
   */
  cooccurrence: Array<{ a: string; b: string; aLabel: string; bLabel: string; count: number }>;
}

/**
 * 指标时间序列 —— 「这个项目在变好还是变坏」那一份。
 *
 * 为什么必须有这一层
 * ------------------
 * 在此之前，扫描的所有产出都只描述**此刻**：复杂度多少、技术债几条、重复率多高。
 * 每次重扫都覆盖同一批行，上一次的数值当场蒸发。于是有两个问题永远答不出来：
 *   · 人问「我这周重构完到底有没有变好」——没有昨天的数，无从比较；
 *   · Agent 拿到「技术债 87 条」，不知道这是从 120 降下来的还是从 40 涨上去的，
 *     只能把结论写成「存在技术债」这种任何项目都成立的废话。
 * 更糟的是它**不可追补**：历史一旦没记，事后再想要就只能等未来重新积累。
 *
 * 三条设计铁律
 * ------------
 * ① **指标由模块算，公共层只负责存与比。**
 *    「什么算一个指标」是模块知识（扫描才知道 techDebt 表是什么）。公共层若自己去算，
 *    就等于把扫描知识焊进 AI 层，且会与 UI 各算一遍产生口径漂移。
 * ② **盲区不参与对比。** 上次跑了 Git、这次不在 Git 仓库里，churn 从 300 变 0,
 *    那不是「变好了」而是「这次没看」。任一端点维度不可用 → incomparable，绝不判 improved。
 *    这是 clean/blind 三态之争在时间轴上的同一个坑。
 * ③ **总量要配密度。** 项目长大本身会让所有「总数类」指标上涨，
 *    只看总量会把「团队在正常交付」误报成「质量在恶化」。带 basis 的指标同时给密度口径。
 */

/** 指标变好的方向 */
export type AiMetricBetter =
  /** 越小越好（技术债、重复行、圈复杂度……） */
  | "lower"
  /** 越大越好（测试覆盖、文档密度……） */
  | "higher"
  /** 中性，只描述规模，不判好坏（文件数、代码行数） */
  | "neutral";

/** 一个可被时间序列追踪的指标取值 */
export interface AiMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  better: AiMetricBetter;
  /**
   * 该指标依赖的能力维度 key。任一端点该维度不可用 → 本指标判为 incomparable。
   * 不填表示「无前置依赖，永远可比」（如文件数）。
   */
  dimension?: string;
  /**
   * 规模基数（如代码总行数）。填了就会额外算一份密度口径，
   * 让「项目长大导致的自然增长」与「质量真的变差」分开。
   */
  basis?: number;
  /** 密度单位，如「每千行」 */
  basisUnit?: string;
}

/** 某一时刻的完整指标切面 */
export interface AiMetricSnapshot {
  moduleId: string;
  scopeId: string;
  /** 指标向量的指纹：与上一个点相同则不新增点，只延长它的存续时间 */
  digest: string;
  /** 触发来源，如 "full-scan" / "incremental" */
  triggerKind?: string;
  /** 该点首次出现的时间（ms） */
  takenAt: number;
  /** 该点最后一次被观测到的时间（ms）；未变化的重扫只推进这个值 */
  lastAt?: number;
  /** 该点被观测到的次数 */
  seenCount?: number;
  metrics: AiMetric[];
  /** 本次快照时各维度可用性；跨点比对的可比性判定完全依赖它 */
  coverage: Array<{ key: string; available: boolean; reason?: string }>;
}

export type AiTrendDirection =
  /** 朝好的方向变化 */
  | "improved"
  /** 朝坏的方向变化 */
  | "worsened"
  /** 没有实质变化 */
  | "flat"
  /** 中性指标发生了变化（只报事实，不判好坏） */
  | "moved"
  /** 端点存在盲区或指标缺席，不可比——绝不能当成「没变化」 */
  | "incomparable";

export interface AiMetricDelta {
  key: string;
  label: string;
  unit: string;
  from: number;
  to: number;
  delta: number;
  /** 相对变化百分比；from 为 0 时为 null（0 基数算不出百分比，硬算会得到 Infinity） */
  pct: number | null;
  direction: AiTrendDirection;
  better: AiMetricBetter;
  /** 密度口径（仅 basis 存在且两端都有时给出） */
  fromDensity?: number;
  toDensity?: number;
  densityDelta?: number;
  basisUnit?: string;
  /** incomparable 的具体原因，直接给人和 Agent 读 */
  reason?: string;
}

export interface AiTrendReport {
  moduleId: string;
  scopeId: string;
  /** 基线点（较早） */
  baseline: { takenAt: number; digest: string; triggerKind?: string } | null;
  /** 当前点（最新） */
  current: { takenAt: number; digest: string; triggerKind?: string } | null;
  /** 库内累计的快照点数 */
  points: number;
  /** 基线与当前之间跨越的天数（不足一天给小数） */
  spanDays: number;
  improved: number;
  worsened: number;
  flat: number;
  incomparable: number;
  deltas: AiMetricDelta[];
  /**
   * 整体判定。insufficient = 只有一个点，还没有可比的历史——
   * 这是**如实说明**而不是失败，第一次扫描本来就没有昨天。
   */
  verdict: "improving" | "regressing" | "mixed" | "flat" | "insufficient";
  /** 一句话结论，人与 Agent 共用 */
  note: string;
}

/**
 * 实体级回归 —— 「**哪个文件**在变坏」那一份。
 *
 * 为什么项目级趋势不够
 * --------------------
 * metricTrend 能回答「项目整体在变好还是变坏」，但它是一堆总量：
 * 技术债 87 → 91、复杂度均值 12.3 → 12.5。人看完只会耸肩，Agent 也只能写
 * 「整体略有恶化，建议关注技术债」——一句放在任何项目上都成立的话。
 *
 * 缺的那一步是**落到具体对象**：这 4 条技术债长在哪个文件上？它是不是上周刚重构过的那个？
 * 有没有哪个文件同时在复杂度、扇入、重复三条线上一起恶化？
 * 只有落到实体，结论才可执行；也只有落到实体，注意力分配才有依据——
 * 「上一轮之后变坏的文件」显然比「一直很大但没动过的文件」更该被优先巡查。
 *
 * 四条设计铁律（每一条都对应一种会**说谎**的实现）
 * ------------------------------------------------
 * ① **新出现的实体单列 appeared，绝不混进 worsened。**
 *    新文件天然「从无到有」，混进恶化榜会让每次新增功能都刷出一屏假警报，
 *    真正的恶化被淹没。它值得看，但不是同一件事。
 * ② **截断边界不判「已修复」。** 榜单只存 Top-N。某个实体这次不在榜上，
 *    可能是修好了，也可能只是被别人挤下去了。只有当它的旧分数**严格高于当前榜单门槛**
 *    （说明按旧分数它本该在榜上）时，缺席才是可解释的下降；否则一律 incomparable。
 * ③ **实体消失优先判 removed，不判 improved。** 文件被删掉不叫质量改善，
 *    叫代码没了。把删除算成修复，会让「删掉遗留模块」这种操作刷出漂亮的改善曲线，
 *    掩盖真正的恶化。区分靠 {@link AiEntitySnapshot.survivedIds}。
 * ④ **维度盲区逐维判不可比，且综合分口径变化时整体不可比。**
 *    上次跑了 Git 这次没跑，churn 从 300 掉到 0 不是改善。更隐蔽的是综合分：
 *    打分会在可用维度上做权重归一，可用维度集合一变，**每个文件的分数都会变**，
 *    却与代码本身毫无关系。所以两端可用维度集合不同时，scoreComparable = false，
 *    只在两端都可用的维度上逐维比较。
 *
 * 与 metricTrend 的分工：那边比「总量」，这边比「对象」；那边的基线是最早的点（看长期），
 * 这边的基线是**上一个点**（看这次改动干了什么）。回归要的是行动，不是史观。
 */

/** 某个实体在一次快照中的排名记录 */
export interface AiEntityRecord {
  /**
   * 稳定标识：跨快照比对的唯一依据。
   * 扫描模块用 files 表的 relPath —— 不能用 file_id，那个每次扫描都会变。
   */
  id: string;
  /** 展示名；不填则回落到 id */
  label?: string;
  /** 综合分 0..100（模块自定口径，公共层只负责比大小） */
  score: number;
  /** 榜内名次，1 起 */
  rank: number;
  /** 多维共振数：同时处于高位的维度个数 */
  resonance: number;
  /** 各维度原始取值（仅含参与打分的维度） */
  dims: Record<string, number>;
  /** 规模基数（如代码行数）：用来分辨「变坏」是不是仅仅因为文件变大了 */
  size?: number;
}

/** 某一时刻的实体榜单切面 */
export interface AiEntitySnapshot {
  moduleId: string;
  scopeId: string;
  /** 榜单指纹：与上一个点相同则不新增点，只延长它的存续时间 */
  digest: string;
  triggerKind?: string;
  takenAt: number;
  lastAt?: number;
  seenCount?: number;
  /** 实体的类别名，如「文件」；人读视图用 */
  entityLabel?: string;
  /** 榜单，按 rank 升序，只存 Top-N */
  entities: AiEntityRecord[];
  /** 参与打分的实体总数（截断之前） */
  total: number;
  /**
   * 榜单门槛：末位实体的分数。低于它的实体不在榜内。
   * 铁律②全靠这个值——没有它就无法区分「修好了」和「被挤下去了」。
   */
  cutoff: number;
  /**
   * 各维度可用性。**键就是维度 key**（不是阶段 key）——
   * 阶段与维度的对应关系是模块知识，映射必须在模块侧完成，公共层不做翻译。
   */
  coverage: Array<{ key: string; available: boolean; reason?: string }>;
  /**
   * 维度字典：让模块无关的渲染侧不必回头问模块要 label（与 AiFocusReport 同一条约定）。
   *
   * better / minDelta 也放这里，而不是硬编码进回归引擎：
   * 「哪个方向算变好」「变多少才算真的动了」都是模块知识——
   * 技术债 +1 条和圈复杂度 +1 完全不是一个量级的事件，
   * 引擎无从判断，硬塞一个统一阈值只会同时制造漏报和噪声。
   */
  dimensions?: Array<{
    key: string;
    label: string;
    unit: string;
    weight?: number;
    /** 不填按 "lower"（风险类维度都是越小越好） */
    better?: AiMetricBetter;
    /** 绝对变化下限：小于它一律当抖动。不填表示任何变化都算 */
    minDelta?: number;
  }>;
  /**
   * 上一批榜单实体中、此刻**仍然存在**的 id 子集。
   *
   * 这是铁律③唯一的信息来源。它必须在采集时算好并持久化，而不是留到读取时再问模块：
   * 读取发生在任意时刻（可能是几天后、可能在别的界面），那时的「现在还在不在」
   * 回答的是另一个时刻的问题，会让人读视图与 Agent 看到的结论不一致。
   */
  survivedIds?: string[];
}

/** 实体在两个快照之间的变化类别 */
export type AiEntityChange =
  /** 上次没有、这次上榜（新文件，或分数升过了门槛） */
  | "appeared"
  /** 实体已不存在（文件被删） */
  | "removed"
  /** 变坏 */
  | "worsened"
  /** 变好 */
  | "improved"
  /** 没有实质变化 */
  | "flat"
  /** 端点存在盲区、口径变化或截断歧义，不可比 */
  | "incomparable";

export interface AiEntityDimDelta {
  key: string;
  label: string;
  unit: string;
  from: number | null;
  to: number | null;
  delta: number | null;
  direction: AiTrendDirection;
  better: AiMetricBetter;
  reason?: string;
}

export interface AiEntityDelta {
  id: string;
  label: string;
  change: AiEntityChange;
  scoreFrom: number | null;
  scoreTo: number | null;
  scoreDelta: number | null;
  /**
   * scoreTo 是**推断上界**而非实测值（实体跌出榜单，只知道它不高于门槛）。
   * 必须显式标出来，否则人和 Agent 会把「至少降了 12 分」读成「正好降了 12 分」。
   */
  approx?: boolean;
  rankFrom: number | null;
  rankTo: number | null;
  resonanceFrom: number | null;
  resonanceTo: number | null;
  sizeFrom?: number | null;
  sizeTo?: number | null;
  /** 逐维明细，只含两端都可用的维度 */
  dims: AiEntityDimDelta[];
  /** 主因维度 key：变化幅度（按各维分位贡献）最大的那一维 */
  driver?: string;
  /** 一句话说明，人与 Agent 共用 */
  reason?: string;
}

export interface AiEntityRegressionReport {
  moduleId: string;
  scopeId: string;
  entityLabel: string;
  /** 基线点 = 上一个点（不是最早的点，见本节文档） */
  baseline: { takenAt: number; digest: string; triggerKind?: string } | null;
  current: { takenAt: number; digest: string; triggerKind?: string } | null;
  /** 库内累计的快照点数 */
  points: number;
  /** 两点之间跨越的天数 */
  spanDays: number;
  /**
   * 综合分是否可比。两端可用维度集合不同时为 false ——
   * 打分要在可用维度上做权重归一，集合一变每个分数都会变，与代码无关。
   */
  scoreComparable: boolean;
  /** 两端都可用的维度 key */
  comparableDims: string[];
  /** 只在单端可用、因此逐维不可比的维度 */
  blindDims: Array<{ key: string; label: string; reason?: string }>;
  worsened: number;
  improved: number;
  appeared: number;
  removed: number;
  flat: number;
  incomparable: number;
  /** 变化明细：按「先恶化、再新增、后改善」排序，同类按幅度降序 */
  entities: AiEntityDelta[];
  verdict: "regressing" | "improving" | "mixed" | "flat" | "insufficient";
  note: string;
}

/** 模块侧需要实现的供给者 */
export interface AiContextProvider {
  /** 模块唯一 id */
  moduleId: string;
  /** 展示名 */
  label: string;
  /** 模块能力描述，会写进上下文包头部，让 Agent 知道数据是怎么来的 */
  description: string;
  /** 当前作用域是否有可供给的数据（没数据时 UI 应禁用入口） */
  isAvailable: (scopeId: string) => boolean;
  /** 构建上下文包；数据不可用时返回 null */
  buildPack: (scopeId: string, options?: AiContextBuildOptions) => AiContextPack | null;
  /**
   * 可选：只算可信度、不构建正文。
   *
   * 独立于 buildPack 的原因是成本差了两个量级——UI 每次渲染都想知道「有没有盲区」，
   * 而 buildPack 要拼几万字 Markdown。实现方应当只做计数与判定，保持 O(1) 级开销。
   * 未实现时 UI 静默降级为不展示，不影响任何既有链路。
   */
  describeQuality?: (scopeId: string) => AiContextQualityReport | null;
  /**
   * 可选：只算「焦点目标」（多维共振榜），不构建正文。
   *
   * 与 describeQuality 同构——独立于 buildPack，低成本，未实现时 UI 静默降级。
   * 让人也能看到扫描给出的「该从哪下手」，与 AI 看到的 riskMatrix 同源同口径，
   * 否则人和 AI 会看到两份不一致的结论。
   */
  describeFocus?: (scopeId: string) => AiFocusReport | null;
  /**
   * 可选：给出**此刻**的指标切面，供公共层记入时间序列。
   *
   * 只返回当前值，不做任何比较——历史加载、去重、对比、可比性判定全在
   * 模块无关的 metricTrend 层完成。模块只回答「该测什么、现在是多少、
   * 哪些维度这次没看到」，这三件事才是模块知识。
   *
   * 与 describeQuality / describeFocus 同构：同步、低开销、未实现时整条趋势链路静默关闭。
   */
  collectMetrics?: (scopeId: string) => AiMetricSnapshot | null;
  /**
   * 可选：给出**此刻**的实体榜单切面，供公共层记入回归序列。
   *
   * previousIds 是上一个点的榜单实体 id，由公共层在采集前从库里取出并传入。
   * 模块唯一要多做的一件事，是回答「这些 id 现在还在不在」（填 survivedIds）——
   * 只有模块知道自己的实体宇宙（扫描模块 = 当前 files 表）。
   * 把这个判断留到读取时再做会破坏一致性，见 {@link AiEntitySnapshot.survivedIds}。
   *
   * 与 collectMetrics 同构：同步、低开销、未实现时整条回归链路静默关闭。
   */
  collectEntitySnapshot?: (scopeId: string, previousIds?: string[]) => AiEntitySnapshot | null;
  /** 可选的分析预设 */
  presets?: AiAnalysisPreset[];
}

/**
 * 协议版本：任何破坏性字段变更都要 +1。
 * v2：分节增加 digest / updatedAt，包增加 changedSections / unchangedSections（分节级增量重建）。
 * v3：分节增加 dataQuality（数据可信度），让 Agent 能区分「没问题」与「没数据」。
 * 版本变化会让持久化层放弃增量、强制整包重写一次，避免新旧字段混存。
 */
export const AI_CONTEXT_SCHEMA_VERSION = 3;
