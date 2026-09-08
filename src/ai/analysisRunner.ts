/**
 * analysisRunner —— 「模块上下文 → 已配置 Agent 深度分析」的无头执行器。
 *
 * 为什么要抽出来：
 *   在此之前，「构建包 → 落库 → 建会话 → 组装取数指令」这段逻辑只活在 ScanAnalysisLauncher
 *   这个 React 组件里。一旦自动编排（扫描完成后自动发起分析）也要走同一条路，就会出现
 *   第二份 prompt 组装代码——两份很快会漂移，Agent 拿到的取数指令时好时坏，排查极痛苦。
 *   所以这里把它抽成不依赖 React 的纯函数：UI 按钮和自动编排共用同一份实现。
 *
 * 三条铁律（贯穿整个 AI 接入层）：
 *   1. **Agent 绝不写死**：agentId 必须由调用方传入，且必须能在 agentStore.agents 中找到；
 *      找不到就报错，绝不兜底成「第一个 Agent」——那会让用户看到自己没选过的模型在跑。
 *   2. **上下文不塞消息体**：数据已落库，消息里只写「怎么取」（outline → section），
 *      这样上万 token 的扫描结论不会在每一轮对话历史里反复重放。
 *   3. **模块无关**：本文件不含任何扫描知识，只认 AiContextProvider 协议。
 *      未来画布/报告模块接入时，实现 provider 即可复用这里的全部能力。
 */
import { aiContextRegistry } from "./contextRegistry";
import type { AiAnalysisPreset } from "./contextTypes";
import type { FocusPatrolPick } from "./focusPatrol";
import { persistModuleContext } from "./contextPersist";
import { INSIGHT_LEDGER_KEY, invalidateInsightFeedback } from "./insightFeedback";
import { useAgentStore } from "../store/agentStore";
import { aiContextApi } from "../services/tauri";
import type { AiAnalysisOutcome } from "../services/tauri";
import { t, getLang, pickLang } from "../i18n";
import { L } from "./aiLang";
import { logger } from "../utils/logger";

/** 深度分析的硬依赖工具：没有它 Agent 取不到上下文，整件事没有意义 */
export const CONTEXT_TOOL_ID = "project_context";
/** 软依赖：缺了只是结论不沉淀，不阻断分析 */
export const INSIGHT_TOOL_ID = "context_insight";
/** 软依赖：缺了只是无法下钻到原始记录（结论仍可基于 Top-N 得出，但不得声称全局） */
export const RECORDS_TOOL_ID = "scan_records";

export interface LaunchAnalysisParams {
  /** 供给模块 id，如 "project-scan" */
  moduleId: string;
  /** 作用域 id（扫描模块 = analysisId） */
  scopeId: string;
  /** 用户已配置的 Agent id —— 必填，不允许由本模块推断 */
  agentId: string;
  /** 预设 key；缺省用模块的第一个预设 */
  presetKey?: string;
  /** 会话标题前缀，自动编排会带上「自动」标识便于用户区分 */
  titlePrefix?: string;
  /** 是否把新会话切到前台。手动点按钮=true；自动编排=false（不抢用户当前视图） */
  focusConversation?: boolean;
  /** 自动编排传规则 id；手动发起留空（记为 manual） */
  ruleId?: string;
  /** 触发种类：full-scan / incremental / backfill / manual */
  triggerKind?: string;
  /**
   * 机器可读的触发原因（ok / rotate-gap / focus-gap / backfill…）。
   * 补跑调度要靠它判断一条规则「是不是还欠着一轮」，不能靠解析 detail 里的中文。
   */
  reason?: string;
  /**
   * 本轮点名要求 Agent 必须覆盖的焦点目标（多维共振且尚未巡查过的文件）。
   *
   * 不点名时 Agent 每轮都会挑「在各分节 Top-N 里最显眼」的那批大文件反复解读，
   * 而共振榜真正的第一名恰恰在别处不显眼——不指定对象，它可以永远不被看到。
   */
  focusTargets?: FocusPatrolPick[];
}

export interface LaunchAnalysisResult {
  packId: string;
  conversationId: string;
  presetKey: string;
  /**
   * **全集包**的指纹，编排器据此做「内容没变就不重复烧 AI」的去重。
   *
   * 曾经这里回的是预设裁剪后子集的指纹，而编排器拿它跟扫描侧的全集指纹比对——
   * 两个口径永远对不上，`内容未变化时跳过` 这个开关实际上从未生效过。
   * 口径统一后去重才真的省下 token。
   */
  digest: string;
  /** 本次建议 Agent 读取的分节（预设声明 ∩ 实际存在），不是库里分节的全集 */
  sectionKeys: string[];
  /** 上面这些分节的 token 量合计（全集体积见 pack.tokenEstimate） */
  tokenEstimate: number;
  /** 本次轨迹 id；回执会异步回填到这一行。轨迹写失败时为空串 */
  runId: string;
  /** 本轮点名巡查的文件路径（供编排日志与 UI 说明「这一轮去看了谁」） */
  focusPaths: string[];
}

/** 失败原因分类：编排器要据此写审计 detail，用户才知道「为什么没跑」 */
export class AnalysisLaunchError extends Error {
  constructor(
    message: string,
    /** 机器可读原因：no-provider / no-data / no-preset / agent-missing / agent-no-tool / busy / build-failed */
    public readonly reason: string,
  ) {
    super(message);
    this.name = "AnalysisLaunchError";
  }
}

/** 选预设：显式指定优先，其次模块第一个 */
export function resolvePreset(
  presets: AiAnalysisPreset[],
  presetKey?: string,
): AiAnalysisPreset | undefined {
  if (presetKey) {
    const hit = presets.find((p) => p.key === presetKey);
    if (hit) return hit;
  }
  return presets[0];
}

/**
 * 消息收尾段：说明「分节明细是 Top-N 截断」这一事实，以及（若可用）如何下钻到全量原始记录。
 *
 * 为什么单独抽出来：上下文包的每个分节都只给 Top-15，这是省 token 的必要取舍，
 * 但如果不把「你看到的不是全部」明确写给 Agent，它会拿 Top-15 当全集下全局结论——
 * 表面上言之凿凿，实际是过度外推，这是整套设计里最贵的失真。
 * 启用 scan_records 后这个缺口才真正补上：先看数据集行数，再按条件下钻，
 * 每次返回都带 total/hasMore，「还有多少没看」始终可感知。
 */
function buildEvidenceTail(scopeId: string, withRecords: boolean): string {
  if (!withRecords) {
    return L(
      `所有结论必须基于工具返回的事实数据与 Top-N 明细，并引用具体「文件:行号」；需要更细的代码细节时再用其他工具精准取。\n` +
        `注意：分节里的明细是各维度的 Top-N 截断，不是全集。若某条结论需要「全项目共有多少处」这类全量口径，` +
        `请说明你的依据仅来自 Top-N，不要把排名靠前的样本当作全部。`,
      `All conclusions must be grounded in factual data returned by tools and the Top-N details, citing concrete "file:line" references; use other tools to fetch finer code details when needed.\n` +
        `Note: the details in each section are a per-dimension Top-N truncation, not the full set. If a conclusion needs a full-scope figure (e.g. "how many occurrences project-wide"), ` +
        `state explicitly that your basis is only the Top-N — do not treat the top-ranked samples as the whole picture.`,
    );
  }
  return L(
    `分节里的明细是各维度的 **Top-N 截断，不是全集**。需要核实全量口径（有多少处、是否还有第 16 名、某个目录下的全部记录）时，` +
      `用 \`${RECORDS_TOOL_ID}\` 下钻原始扫描记录：\n` +
      `  · ${RECORDS_TOOL_ID}(action="datasets", analysis_id="${scopeId}") 先看有哪些数据集及各自行数（成本极低）；\n` +
      `  · ${RECORDS_TOOL_ID}(action="query", analysis_id="${scopeId}", dataset=..., path=..., where={...}, min_value=..., offset=..., limit=...) ` +
      `带条件取回紧凑记录。返回里的 \`total\` / \`hasMore\` 告诉你还有多少没看，据此判断结论是否已有足够支撑。\n` +
      `  · ${RECORDS_TOOL_ID}(action="dossier", analysis_id="${scopeId}", path="某个文件") ` +
      `一次取回**单个文件**在所有维度上的完整画像（含已有 AI 结论、以及哪些维度没跑过）。` +
      `想吃透某个具体文件时用它，比逐个数据集 query 少几倍调用，也远比 file_read 读源码省。\n` +
      `  · 优先用 path/where/min_value 把范围缩小，不要盲目翻页；已经算好的数字不要再用 file_read 读源码重新推导。\n` +
      `  · 返回的 \`dataQuality.safeToConcludeAbsence\` 为 false 时，0 行代表「该维度没跑成（前置条件缺失）」而非「项目没这个问题」，此时不得下阴性结论。\n` +
      `所有结论必须基于工具返回的事实数据，并引用具体「文件:行号」；凡是带全局数量的判断，都应先用 ${RECORDS_TOOL_ID} 核实过再写。`,
    `The details in each section are a **Top-N truncation per dimension, not the full set**. When you need to verify a full-scope figure (how many occurrences, whether there is a 16th entry, or every record under a directory), ` +
      `drill into the raw scan records with \`${RECORDS_TOOL_ID}\`:\n` +
      `  · ${RECORDS_TOOL_ID}(action="datasets", analysis_id="${scopeId}") first list the datasets and their row counts (very cheap);\n` +
      `  · ${RECORDS_TOOL_ID}(action="query", analysis_id="${scopeId}", dataset=..., path=..., where={...}, min_value=..., offset=..., limit=...) ` +
      `fetch compact records with conditions. The returned \`total\` / \`hasMore\` tell you how much is still unseen — use that to judge whether the evidence supports the conclusion.\n` +
      `  · ${RECORDS_TOOL_ID}(action="dossier", analysis_id="${scopeId}", path="a specific file") ` +
      `fetches the **full portrait of a single file** across all dimensions (including existing AI conclusions and which dimensions were never run). ` +
      `Use it when you want to understand a specific file — several times fewer calls than querying datasets one by one, and far cheaper than reading the source with file_read.\n` +
      `  · Prefer narrowing the scope with path/where/min_value; do not blindly page through. Do not re-derive numbers that the scan already computed by reading source code.\n` +
      `  · When the returned \`dataQuality.safeToConcludeAbsence\` is false, 0 rows means "this dimension did not run (a precondition was missing)" rather than "the project does not have this problem" — do not draw negative conclusions in that case.\n` +
      `All conclusions must be grounded in factual data returned by tools, citing concrete "file:line" references; any judgment carrying a global count should first be verified with ${RECORDS_TOOL_ID}.`,
  );
}

/**
 * 「本轮必须覆盖的目标」段落。
 *
 * 为什么点名这件事必须写进消息，而不是指望预设提示词
 * --------------------------------------------------
 * 预设提示词里已经写了「以 riskMatrix 的共振榜为锚定序」，但那只是一句原则。
 * 实际观察到的行为很一致：Agent 会挑各分节 Top-N 里最显眼的大文件展开，
 * 因为那些文件在它读到的任何一节里都反复出现，写起来最有把握。
 * 而共振榜真正的第一名在别处一次都不露面（每维都排第 20 名），
 * 于是它在一轮又一轮的自动分析里始终是空白——原则没写错，只是不够硬。
 *
 * 两条要求缺一不可：
 *   · **逐个给结论**——不给结论就等于没巡查；
 *   · **判定没问题也要留一条 info 级记录**——否则这个文件在人的视角里
 *     与「从没人看过」完全无法区分，下一轮还得重派一次单，白烧 token。
 *
 * 还必须给它指一条取数的路（withRecords 分支）
 * --------------------------------------------
 * 点名这件事把任务形状变成了「去看 src/hot.ts」，可上下文包的形状是「按维度各给 Top-15」。
 * 共振文件恰恰是每一维都排在十几二十名的那种——在任何一个分节里都查不到。
 * 于是 Agent 只剩两条路：把八九个数据集挨个 query 一遍（调用次数爆炸），
 * 或者干脆 file_read 把源码读进来自己看（token 爆炸，且把整套扫描成果全扔了）。
 * `action="dossier"` 就是为这个形状补的：一次调用取回该文件的全维度画像，
 * 并且天然带「哪些维度没跑过」的盲区标注，Agent 不会把「没查」当成「没问题」。
 */
function buildFocusDirective(opts: {
  targets: FocusPatrolPick[];
  withInsight: boolean;
  withRecords: boolean;
  scopeId: string;
}): string {
  const { targets, withInsight, withRecords, scopeId } = opts;
  if (!targets.length) return "";
  const stateTail: Partial<Record<FocusPatrolPick["state"], string>> = {
    "stale-data": L(" —— 上次巡查后数据已变，需复核", " — data changed since the last patrol; needs re-verification"),
    // 复核档必须单独说清「先读旧结论、再判增量」，否则 Agent 会把它当成一次
    // 陌生文件的通读，白白丢掉「已知问题在第几行、上次判成什么严重度」这个
    // 最便宜的起点，还很可能把同一个问题重新写一遍（库里于是有了两条重复结论）。
    recheck: L(
      " —— **已有结论且其依据的代码已改动**：先取回该文件的既有结论，" +
        "逐条判定「已修复 / 仍存在 / 已恶化」，修好的当场收口，别重新描述一遍老问题",
      " — **existing conclusion whose evidence code has changed**: first fetch the file's existing conclusion, " +
        "then judge each item as \"fixed / still present / worsened\"; close out what is fixed on the spot — do not re-describe an old problem from scratch",
    ),
  };
  const lines = targets.map(
    (t, i) =>
      `  ${i + 1}. \`${t.filePath}\`` +
      (t.note ? L(`（${t.note}）`, ` (${t.note})`) : "") +
      (stateTail[t.state] ?? ""),
  );
  // 取数指路：有 scan_records 才给，否则是在指一个它调不到的工具。
  const howTo = withRecords
    ? L(
        `取数方式：对每个目标各调用一次 ` +
          `\`${RECORDS_TOOL_ID}(action="dossier", analysis_id="${scopeId}", path="上面的文件路径")\`，` +
          `一次即可拿回该文件在所有维度上的完整画像（复杂度/审查发现/技术债/重复块及其对端/变更历史/隐性耦合/` +
          `被引用与引用他人/调用边/依赖/符号清单/数据流，以及该文件已有的 AI 结论）。\n` +
          `  · **不要**为了拼出同一份信息去逐个数据集 query，更不要用 file_read 把源码读进来自己重算——` +
          `扫描已经算过的东西再算一遍，是这套流程里最浪费 token 的动作。\n` +
          `  · 返回里的 \`clean\` 是「查过、确实没问题」的维度，可以据此下阴性结论；` +
          `\`blind\` 是「这一维压根没跑」，对这些维度一个字都不要断言。\n` +
          `  · 返回里的 \`aiInsights\` 是这个文件已有的未关闭结论，先读它再决定要不要重复给。\n` +
          `  · 路径写不准时工具会返回候选列表（\`ambiguous\`），从中挑一条重试即可，不要凭印象编路径。\n`,
        `How to fetch: call this once per target — ` +
          `\`${RECORDS_TOOL_ID}(action="dossier", analysis_id="${scopeId}", path="the file path above")\` — ` +
          `it returns the file's full portrait across all dimensions (complexity/review findings/tech debt/duplicate blocks and their counterparts/change history/hidden coupling/` +
          `referenced-by and references/call edges/dependencies/symbol list/data flow, plus the file's existing AI conclusions).\n` +
          `  · **Do not** query datasets one by one to assemble the same information, and do not read the source with file_read to recompute it yourself — ` +
          `recomputing what the scan already computed is the most token-wasteful action in this whole workflow.\n` +
          `  · \`clean\` in the response means "checked and genuinely fine" — you may draw negative conclusions from it; ` +
          `\`blind\` means "this dimension never ran" — do not assert anything about those dimensions.\n` +
          `  · \`aiInsights\` holds the file's existing open conclusions — read them before deciding whether to repeat anything.\n` +
          `  · If a path is ambiguous, the tool returns candidate paths (\`ambiguous\`); pick one and retry — never invent a path from memory.\n`,
      )
    : "";
  const closing = withInsight
    ? L(
        `请对上述每个文件都给出明确结论：发现问题就用 ${INSIGHT_TOOL_ID}(action="save", ...) 写回（refs 指向该文件的具体行号）；` +
          `确实没有值得改的地方，也要写一条 severity="info" 的结论说明「已核查、未发现 X」——` +
          `没有记录的巡查等于没有发生过，下一轮还会把它重新排上队，白花一次 token。`,
        `Give an explicit conclusion for each of the above files: when you find a problem, write it back with ${INSIGHT_TOOL_ID}(action="save", ...) (refs pointing at concrete lines of that file); ` +
          `if there is genuinely nothing worth changing, still write a severity="info" conclusion stating "checked, no X found" — ` +
          `a patrol with no record is as if it never happened: the next round will queue the file again and waste another round of tokens.`,
      )
    : L(
        `请对上述每个文件都在回答里单列一段结论（含具体行号）；即使判定没有问题也要明确说出来，不要略过。`,
        `Give each of the above files its own conclusion paragraph in your answer (with concrete line numbers); even if you judge it problem-free, say so explicitly — do not skip any.`,
      );
  return (
    L(
      `\n【本轮必须覆盖的目标】（跨维度共振榜上尚未被巡查过的文件，按共振维度数排序）\n`,
      `\n[Targets that MUST be covered this round] (files on the cross-dimension resonance board that have not been patrolled, sorted by number of resonant dimensions)\n`,
    ) +
      `${lines.join("\n")}\n` +
      L(
        `这些文件在单个维度的 Top-N 明细里通常**不出现**（每一维都排在十几二十名），` +
          `只有跨维度交叉才看得到它们——所以不要因为「别处没提到」就跳过。\n`,
        `These files usually do **not appear** in any single dimension's Top-N list (they rank around 10th-20th on every dimension); ` +
          `only the cross-dimension intersection reveals them — so do not skip them just because "nothing else mentions them".\n`,
      ) +
      howTo +
      `${closing}\n`
  );
}

/**
 * 组装发给 Agent 的任务消息。
 *
 * 刻意只写「怎么取数据」而不带数据本身，并明确劝阻 action="get"（拉全包）——
 * 全包动辄上万 token，而绝大多数问题只需要 2~3 个分节。省 token 的收益全在这段文字里。
 */
export function buildAnalysisMessage(opts: {
  preset: AiAnalysisPreset;
  packId: string;
  scopeId: string;
  sectionKeys: string[];
  /** Agent 是否启用了洞察沉淀工具（没启用就不要发无法执行的指令） */
  withInsight: boolean;
  /** Agent 是否启用了原始记录下钻工具（没启用就不要指路到一个它调不到的工具） */
  withRecords?: boolean;
  /** 自动触发时给 Agent 一句来源说明，避免它以为是用户手动提问 */
  autoNote?: string;
  /** 本轮点名必须覆盖的焦点目标；空数组等价于不点名 */
  focusTargets?: FocusPatrolPick[];
}): string {
  const { preset, packId, scopeId, sectionKeys, withInsight, autoNote } = opts;
  const withRecords = !!opts.withRecords;
  const sectionList = sectionKeys.length ? sectionKeys.join(", ") : L("全部分节", "all sections");
  const evidenceTail = buildEvidenceTail(scopeId, withRecords);
  const focusDirective = buildFocusDirective({
    targets: opts.focusTargets ?? [],
    withInsight,
    withRecords,
    scopeId,
  });
  // 让 Agent 的回复语言跟随当前 UI 语言（中文 / 英文），确保「生成的内容」随语言切换
  const lang = getLang();
  const langNote = lang === "en-US" ? t("ai.respondEn") : t("ai.respondZh");

  // 具备洞察沉淀能力时走完整闭环：先读历史 → 增量取上下文（since）→ 分析 → 写回结论。
  // 这样 Agent 第二次及以后的分析只需读取「内容真正变化」的分节，省 token 最彻底，
  // 且结论能在不同轮次间累积——正契合「扫描数据为 AI Agent 节省 token、充分发挥其能力」的目标。
  if (withInsight) {
    return (
      `${pickLang(preset.prompt)}\n\n` +
      (autoNote ? `> ${autoNote}\n\n` : "") +
      `---\n` +
      L(
        `【${pickLang(preset.title)} · ${t("ai.promptContextLabel")}】\n` +
          `本次分析所需数据已落库，通过 \`${CONTEXT_TOOL_ID}\` 工具按需取用（本消息不直接携带原始数据，以节省 token）。\n` +
          `请按以下顺序操作：\n` +
          `0) ${CONTEXT_TOOL_ID}(action="section", pack_id="${packId}", section_keys=["${INSIGHT_LEDGER_KEY}"]) ` +
          `先读「AI 结论账本」——它把你历轮的全部结论按**文件**聚合成一张表（几百 token），` +
          `一眼看清：哪些文件的结论因为代码改动已经待复核、哪些结论已确认且代码未动（**不要重复保存**）、` +
          `哪些结论的证据文件已经消失。先看它，再决定要不要把历史结论整包拉回来。\n` +
          `1) ${INSIGHT_TOOL_ID}(action="list", analysis_id="${scopeId}") 取回需要处理的那几条结论的 id 与正文` +
          `（返回里的 \`reviewQueue\` 就是待复核队列）。` +
          `记下其 \`lastSeen\`（你上次分析的毫秒时间戳）——它就是后续 \`since\` 的取值；已给过的结论不要再重复给。\n` +
          `2) ${CONTEXT_TOOL_ID}(action="outline", pack_id="${packId}") 看分节目录。` +
          `若第 1 步拿到了 lastSeen，务必带上 \`since=<lastSeen>\`：此时 outline 只返回「自该时刻以来内容真正变化」的分节（含 changedSince 标记），` +
          `未变化的节直接复用你之前的结论、跳过即可，避免重复烧 token。\n` +
          `3) ${CONTEXT_TOOL_ID}(action="section", pack_id="${packId}", section_keys=[变化的节...]) 只批量取回变化的分节正文与结构化 facts；` +
          `同样可带 \`since=<lastSeen>\` 让工具替你筛出变化节。\n` +
          `4) 第 1 步返回的 \`reviewQueue\`（freshness 为 stale/orphaned，即所依据的代码已经变了）要优先复核：` +
          `若核对现有代码后发现该问题已经修好或已随重构消失，用 ` +
          `${INSIGHT_TOOL_ID}(action="resolve", analysis_id="${scopeId}", insight_id=..., reason="你在当前代码里核实到的依据") 收口，` +
          `它会退出列表，之后每轮都不再消耗你的 token；仅在真正核实过时才收口，未核实的一律留着。\n` +
          `5) 分析完成后，用 ${INSIGHT_TOOL_ID}(action="save", analysis_id="${scopeId}", pack_id="${packId}", ` +
          `title=..., body=..., kind=..., severity=..., refs=["文件:行号", ...]) 把每条新结论写回本次分析，` +
          `用户能在界面上看到并直接跳转到代码。\n` +
          `   注意 refs 会在保存那一刻逐条与本次扫描到的真实文件核对：一条都对不上会被直接拒收并退回最接近的真实路径，` +
          `部分对不上的会被丢弃并点名。所以路径一律从上下文分节或检索结果里原样复制，不要凭印象重写；` +
          `实在没有具体位置就不带 refs（会被标为 unanchored，永远无法被判定解决）。\n` +
          `除非确实需要全部维度，否则不要用 action="get" 拉全包（动辄上万 token）。\n` +
          `本次建议重点读取分节：${sectionList}。\n`,
        `[${pickLang(preset.title)} · ${t("ai.promptContextLabel")}]\n` +
          `The data needed for this analysis is already persisted — fetch it on demand via the \`${CONTEXT_TOOL_ID}\` tool (this message does not carry raw data, to save tokens).\n` +
          `Proceed in the following order:\n` +
          `0) ${CONTEXT_TOOL_ID}(action="section", pack_id="${packId}", section_keys=["${INSIGHT_LEDGER_KEY}"]) ` +
          `first read the "AI conclusion ledger" — it aggregates all your past conclusions into one table per **file** (a few hundred tokens), ` +
          `so you can see at a glance which conclusions await re-review because their code changed, which are confirmed and untouched (**do not save duplicates**), ` +
          `and which have lost their evidence files. Read it first, then decide whether to pull back the whole history.\n` +
          `1) ${INSIGHT_TOOL_ID}(action="list", analysis_id="${scopeId}") fetch the ids and bodies of the conclusions that need handling ` +
          `(\`reviewQueue\` in the response is the re-review queue). ` +
          `Note its \`lastSeen\` (your previous analysis' ms timestamp) — it is the value for subsequent \`since\`; never re-give a conclusion you already gave.\n` +
          `2) ${CONTEXT_TOOL_ID}(action="outline", pack_id="${packId}") look at the section directory. ` +
          `If step 1 gave you a lastSeen, do pass \`since=<lastSeen>\`: outline then returns only sections whose content actually changed since that moment (with a changedSince flag), ` +
          `so you can reuse your previous conclusions for unchanged sections and skip them — avoiding repeated token burn.\n` +
          `3) ${CONTEXT_TOOL_ID}(action="section", pack_id="${packId}", section_keys=[changed sections...]) batch-fetch only the changed sections' bodies and structured facts; ` +
          `the same \`since=<lastSeen>\` lets the tool filter changed sections for you.\n` +
          `4) Prioritize re-reviewing the \`reviewQueue\` from step 1 (freshness stale/orphaned — the code they rely on has changed): ` +
          `if checking the current code shows the problem is fixed or gone with a refactor, close it with ` +
          `${INSIGHT_TOOL_ID}(action="resolve", analysis_id="${scopeId}", insight_id=..., reason="evidence you verified in the current code") — ` +
          `it leaves the list and stops consuming your tokens every round; close only what you truly verified, leave everything unverified in place.\n` +
          `5) After analyzing, write each new conclusion back with ${INSIGHT_TOOL_ID}(action="save", analysis_id="${scopeId}", pack_id="${packId}", ` +
          `title=..., body=..., kind=..., severity=..., refs=["file:line", ...]) ` +
          `so the user can see it in the UI and jump straight to the code.\n` +
          `   Note: refs are checked against the real scanned files at save time — if none match, the whole save is rejected and the closest real paths are returned; ` +
          `partially unmatched refs are dropped and called out. So always copy paths verbatim from context sections or search results — never rewrite from memory; ` +
          `if there is truly no location, omit refs (it will be marked unanchored and can never be judged resolved).\n` +
          `Unless you genuinely need all dimensions, do not use action="get" to pull the whole pack (tens of thousands of tokens).\n` +
          `Sections recommended for this run: ${sectionList}.\n`,
      ) +
      focusDirective +
      evidenceTail +
      `\n\n${langNote}`
    );
  }

  // 不具备洞察工具：无法做 since 增量判断，降级为「outline → section」，仍是省 token 的取数方式
  return (
    `${pickLang(preset.prompt)}\n\n` +
    (autoNote ? `> ${autoNote}\n\n` : "") +
    `---\n` +
    L(
      `【${pickLang(preset.title)} · ${t("ai.promptContextLabel")}】\n` +
        `本次分析所需数据已落库，通过 \`${CONTEXT_TOOL_ID}\` 工具按需取用（本消息不直接携带原始数据，以节省 token）。\n` +
        `请按以下顺序加载：\n` +
        `1) ${CONTEXT_TOOL_ID}(action="outline", pack_id="${packId}") 先看分节目录（只有标题/摘要/token 量，成本极低），判断该读哪些维度；\n` +
        `2) ${CONTEXT_TOOL_ID}(action="section", pack_id="${packId}", section_keys=[...]) 一次批量取回真正需要的分节正文与结构化 facts。\n` +
        `   其中 \`${INSIGHT_LEDGER_KEY}\`（AI 结论账本）值得优先读：它汇总了历轮已经得出的结论，` +
        `照着它可以避免把同一个问题重新描述一遍，并优先处理「结论依据的代码已改动」的那些文件。\n` +
        `除非确实需要全部维度，否则不要用 action="get" 拉全包（动辄上万 token）。\n` +
        `本次建议重点读取分节：${sectionList}。\n`,
      `[${pickLang(preset.title)} · ${t("ai.promptContextLabel")}]\n` +
        `The data needed for this analysis is already persisted — fetch it on demand via the \`${CONTEXT_TOOL_ID}\` tool (this message does not carry raw data, to save tokens).\n` +
        `Load it in the following order:\n` +
        `1) ${CONTEXT_TOOL_ID}(action="outline", pack_id="${packId}") first look at the section directory (only titles/summaries/token counts — very cheap) to decide which dimensions to read;\n` +
        `2) ${CONTEXT_TOOL_ID}(action="section", pack_id="${packId}", section_keys=[...]) batch-fetch the sections you actually need, with their bodies and structured facts.\n` +
        `   Among them \`${INSIGHT_LEDGER_KEY}\` (the AI conclusion ledger) is worth reading first: it summarizes all conclusions reached so far, ` +
        `so you can avoid re-describing the same problem and prioritize files whose evidence code has changed.\n` +
        `Unless you genuinely need all dimensions, do not use action="get" to pull the whole pack (tens of thousands of tokens).\n` +
        `Sections recommended for this run: ${sectionList}.\n`,
    ) +
    focusDirective +
    evidenceTail +
    `\n\n${langNote}`
  );
}

/** 轨迹 id：与编排器同构，便于两条路径的记录混在同一张表里也能看出来源 */
function runTraceId(): string {
  return `arun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 分析结束后写回执：这一轮到底有没有产出。
 *
 * 在此之前轨迹只写「已发起」。可 sendMessage 是流式的、不被等待，于是模型报错、
 * 网络中断、Agent 兜一圈一条结论都没保存的轮次，全都永远停在 triggered ——
 * 而覆盖台账把 triggered 读作「这个维度已经分析过」，直接点绿灯。
 * 「绿灯必须意味着真的分析过」这条铁律，在发起层补齐后又从结束层漏了出去。
 *
 * 产出量的口径取「本轮之后被写过的洞察条数」而不是「新增行数」：
 * 洞察保存是幂等去重的，Agent 重新确认一条老结论只会累加 seenCount 不新建行，
 * 按行数差算会把一次扎实的复核判成「零产出」。
 */
export interface ReceiptVerdict {
  outcome: AiAnalysisOutcome;
  count: number;
  detail: string;
}

/**
 * 回执判定（纯函数，抽出来是为了能被回归测试钉住）。
 *
 * @param insights 本作用域的洞察全量；传 undefined 表示「数不出来」，
 *                 这与「数出来是 0」是两件完全不同的事，绝不可混为一谈。
 */
export function classifyReceipt(input: {
  failure?: unknown;
  insights?: Array<{ lastSeen?: number }>;
  startedAtSec: number;
}): ReceiptVerdict {
  if (input.failure) {
    const msg = (input.failure as Error)?.message ?? String(input.failure);
    return { outcome: "error", count: 0, detail: L(`对话失败：${msg}`, `Conversation failed: ${msg}`) };
  }
  if (!input.insights) {
    // 数不出来不代表没产出。如实记为已完成但产出未知，绝不能想当然写成 no-output ——
    // 那会把一次成功的分析冤枉成空转，进而让补跑调度反复重跑同一个维度。
    return { outcome: "completed", count: 0, detail: L("对话已结束（产出数不可用）", "Conversation ended (output count unavailable)") };
  }
  // lastSeen 是秒级；容忍 1 秒抖动，避免同秒发起的那条被边界判掉
  const touched = input.insights.filter((i) => (i.lastSeen ?? 0) >= input.startedAtSec - 1).length;
  return {
    outcome: touched > 0 ? "completed" : "no-output",
    count: touched,
    detail: touched > 0 ? L(`产出/确认 ${touched} 条结论`, `${touched} conclusion(s) produced/confirmed`) : L("对话已结束，但未沉淀任何结论", "Conversation ended without any conclusions saved"),
  };
}

async function writeReceipt(
  runId: string,
  scopeId: string,
  startedAtSec: number,
  failure?: unknown,
): Promise<void> {
  // 这一轮结束意味着结论可能已经变了（新增、重新确认或收口），
  // 回流缓存必须作废——否则紧随其后的补跑心跳会拿着旧账本重新点名同一批文件。
  // 放在 runId 判空**之前**：轨迹没写成不代表 Agent 没产出。
  invalidateInsightFeedback();
  if (!runId) return; // 轨迹当初就没写成功，无处回填
  try {
    let insights: Array<{ lastSeen?: number }> | undefined;
    if (!failure) {
      try {
        insights = await aiContextApi.listAiInsights(scopeId);
      } catch {
        insights = undefined; // 交给 classifyReceipt 走「产出未知」分支
      }
    }
    const verdict = classifyReceipt({ failure, insights, startedAtSec });
    await aiContextApi.finishAutoAnalysisRun(runId, verdict.outcome, verdict.count, verdict.detail);
    // 同一张回执也要落到派单台账上。
    //
    // 「派单即销账」堵住了「判定没问题不写洞察 → 永远重复点名」的不收敛循环，
    // 却顺手开了反向的洞：**发起了、对话却失败**的那一轮同样销了账。
    // 补跑调度确实会把规则重新排队，但焦点台账读库时这些文件已是「已巡查」，
    // 于是不会再被点名 —— 一次网络抖动就足以让共振榜第一名永久沉默，
    // 而账面上一切正常（有派单、有轨迹，error 挂在另一张表上没人对得起来）。
    //
    // 没有派单的轮次这里是一次空 UPDATE，代价可以忽略；写失败也不影响本次分析，
    // 只是那批目标会按「已巡查」处理，下次数据变化时仍会重新排队。
    try {
      await aiContextApi.settleFocusAssignments(runId, verdict.outcome);
    } catch (err) {
      logger.warn("analysisRunner", "焦点派单核销失败（不影响本次分析）", { runId, error: err });
    }
  } catch (err) {
    logger.warn("analysisRunner", "回执写入失败（不影响本次分析）", { runId, error: err });
  }
}

/**
 * 发起一次分析：构建上下文包 → 落库 → 用指定 Agent 开会话 → 发送取数指令。
 *
 * 注意本函数**不等待 Agent 回答完毕**：sendMessage 是流式的，等它结束会把调用方
 * （扫描收尾链路）阻塞几十秒。编排器只需要知道「已经发起」即可。
 */
export async function launchModuleAnalysis(
  params: LaunchAnalysisParams,
): Promise<LaunchAnalysisResult> {
  const {
    moduleId,
    scopeId,
    agentId,
    presetKey,
    titlePrefix,
    focusConversation = true,
    ruleId,
    triggerKind,
  } = params;

  const provider = aiContextRegistry.get(moduleId);
  if (!provider) {
    throw new AnalysisLaunchError(`模块 ${moduleId} 未注册 AI 上下文供给者`, "no-provider");
  }
  if (!provider.isAvailable(scopeId)) {
    throw new AnalysisLaunchError("该作用域暂无可供分析的数据", "no-data");
  }

  const preset = resolvePreset(provider.presets ?? [], presetKey);
  if (!preset) {
    throw new AnalysisLaunchError(`模块 ${moduleId} 未定义任何分析预设`, "no-preset");
  }

  // Agent 必须来自用户已配置列表；这里不做任何默认值兜底
  const agentState = useAgentStore.getState();
  const agent = agentState.agents.find((a) => a.id === agentId);
  if (!agent) {
    throw new AnalysisLaunchError(
      "指定的 Agent 不存在（可能已被删除），请重新选择",
      "agent-missing",
    );
  }
  if (!agent.toolIds?.includes(CONTEXT_TOOL_ID)) {
    throw new AnalysisLaunchError(
      `Agent「${agent.name}」未启用 ${CONTEXT_TOOL_ID} 工具，无法加载分析上下文`,
      "agent-no-tool",
    );
  }
  // 正在流式回复时 sendMessage 会被 agentStore 静默丢弃，提前拦下并给出明确原因
  if (agentState.isStreaming) {
    throw new AnalysisLaunchError("上一次对话仍在进行中，本次分析已跳过", "busy");
  }

  // 落库的永远是**全集**，裁剪只发生在「告诉 Agent 读哪几节」这一步。
  //
  // 早先这里按预设裁剪后整包写库，看似省事，实则每发起一次分析就把该 pack 下
  // 其余分节从库里删掉（后端 save_pack 语义是先清空再写入）：上下文越用越残缺，
  // 而扫描侧的分节戳缓存还以为它们健在，增量重扫再也不会把它们补回来。
  // 省 token 的收益本来就来自「Agent 只取需要的分节」，不来自「库里只存一部分」。
  const persisted = await persistModuleContext(provider, scopeId);
  if (!persisted) {
    throw new AnalysisLaunchError("上下文包构建失败（数据缺失）", "build-failed");
  }
  const { packId, pack } = persisted;

  // 本次建议 Agent 读取的分节 = 预设声明 ∩ 实际存在。
  // 取交集是为了容错：预设可能引用了某个版本才有的分节，直接下发不存在的 key
  // 会让 Agent 白跑一轮工具调用，还以为是数据缺失。
  const availableKeys = new Set(pack.sections.map((s) => s.key));
  const focusKeys = (preset.sectionKeys ?? []).filter((k) => availableKeys.has(k));
  const messageKeys = focusKeys.length ? focusKeys : pack.sections.map((s) => s.key);
  const focusTokens = pack.sections
    .filter((s) => messageKeys.includes(s.key))
    .reduce((sum, s) => sum + s.tokenEstimate, 0);

  const title = `${titlePrefix ? `${titlePrefix} ` : ""}${pickLang(preset.title)} · ${pack.scopeLabel}`;
  const conv = await agentState.createConversation(agentId, title);
  if (focusConversation) {
    agentState.selectConversation(conv.id);
  }

  const focusTargets = params.focusTargets ?? [];
  const message = buildAnalysisMessage({
    preset,
    packId,
    scopeId,
    sectionKeys: messageKeys,
    withInsight: !!agent.toolIds?.includes(INSIGHT_TOOL_ID),
    withRecords: !!agent.toolIds?.includes(RECORDS_TOOL_ID),
    autoNote: titlePrefix
      ? "本次分析由系统在数据更新后自动发起，请直接开始，无需向用户确认。"
      : undefined,
    focusTargets,
  });

  // 轨迹在这里统一记，而不是各调用方各记一份。
  // 手动点按钮发起的分析此前完全不留痕，导致覆盖台账只看得见自动跑过的维度——
  // 用户明明手动分析过架构健康度，台账却报「从未分析」，绿灯与红灯都不可信。
  // 记录失败不能反过来打断分析：轨迹是观测手段，不是业务前提。
  let runId = runTraceId();
  try {
    await aiContextApi.recordAutoAnalysisRun({
      id: runId,
      ruleId: ruleId ?? "manual",
      moduleId,
      scopeId,
      agentId,
      presetKey: preset.key,
      packId,
      conversationId: conv.id,
      triggerKind: triggerKind ?? (ruleId ? "auto" : "manual"),
      status: "triggered",
      detail:
        `已发起分析：建议读 ${messageKeys.length}/${pack.sections.length} 个分节 / 约 ${focusTokens} token` +
        `（全集 ${pack.tokenEstimate} token，${persisted.mode === "skip" ? "上下文未变化" : "上下文已更新"}）` +
        (focusTargets.length ? ` · 点名巡查 ${focusTargets.length} 个焦点目标` : ""),
      // 记的是**全集包**的指纹，不是本次预设子集的指纹。
      // 覆盖台账要拿不同预设的记录跟同一个当前指纹比对，口径必须一致，
      // 否则每个维度都会因为「指纹长得不一样」被永久判成结论过期。
      contextDigest: pack.digest,
      reason: params.reason ?? (ruleId ? "auto" : "manual"),
      // 发起时还不知道结局，先挂 pending。补跑调度看到长期 pending 的轨迹
      // 就知道那一轮多半随应用退出中断了，不会把它当成已完成。
      outcome: "pending",
    });
  } catch (err) {
    logger.warn("analysisRunner", "运行轨迹写入失败（不影响本次分析）", { error: err });
    runId = ""; // 没写成也别去回填一个不存在的行
  }

  // 派单登记必须在**发起时**写，而不是等 Agent 答完再写。
  //
  // 等回执写，就会出现这样一段窗口：消息已经发出去、Agent 正在读，而台账上
  // 这个文件仍是「从未巡查」。补跑心跳恰好在这段窗口敲一拍，就会认为还欠着，
  // 于是同一个文件被连着点名两轮——自动化最不该犯的错就是重复烧钱。
  //
  // 代价是「发起了但对话失败」的那一轮也先销了账 —— 这一点**不能**指望
  // 「补跑调度会把整条规则重新排队」来兜底：规则是重排了，可焦点台账读库时
  // 这些文件已经是「已巡查」，此后再也不会被点名。所以回执必须同时核销派单
  // （见 writeReceipt → settleFocusAssignments），outcome=error 的那批目标退回队列。
  //
  // runId 为空（轨迹当初就没写成功）时无从核销，这批目标只能按已巡查处理；
  // 属于罕见的降级路径，下次数据变化仍会把它们重新排上队。
  if (focusTargets.length) {
    try {
      await aiContextApi.recordFocusAssignments({
        moduleId,
        scopeId,
        runId,
        presetKey: preset.key,
        contextDigest: pack.digest,
        targets: focusTargets.map((t) => ({
          filePath: t.filePath,
          resonance: t.resonance,
          note: t.note,
          // 复核收敛的记账凭据：记下「派单这一刻，该文件已知问题所在之处长什么样」。
          // 下一轮只有证据**再次**变化才重新排队——不看 Agent 有没有写字，
          // 否则「复核后判定结论仍成立、于是什么都没写」会变成永久重复点名。
          evidenceDigest: t.evidenceDigest,
          // 回归追责的记账凭据，与上面那本账各记各的：**两本都写，不管本行是哪一档**。
          // 一个文件完全可能既有待复核的旧结论、又刚刚变坏；只写当前档位那一本，
          // 另一本就永远是空串，对应档位下一轮会认定「还欠着」而重复点名同一个文件。
          regressionDigest: t.regressionDigest,
        })),
      });
    } catch (err) {
      logger.warn("analysisRunner", "焦点派单登记失败（不影响本次分析）", { error: err });
    }
  }

  // 不 await：流式回答可能持续数十秒，扫描收尾链路不该被它挂住。
  // 但必须在它结束时补一张回执，否则「已发起」会被台账当成「已分析」。
  const startedAtSec = Math.floor(Date.now() / 1000);
  void agentState
    .sendMessage(conv.id, message)
    .then(() => writeReceipt(runId, scopeId, startedAtSec))
    .catch((err) => {
      logger.error("analysisRunner", "sendMessage failed", { error: err });
      return writeReceipt(runId, scopeId, startedAtSec, err);
    });

  return {
    packId,
    conversationId: conv.id,
    presetKey: preset.key,
    digest: pack.digest,
    sectionKeys: messageKeys,
    tokenEstimate: focusTokens,
    runId,
    focusPaths: focusTargets.map((t) => t.filePath),
  };
}
