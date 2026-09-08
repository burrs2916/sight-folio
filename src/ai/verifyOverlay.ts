/**
 * verifyOverlay —— 把「AI 改动 → 自动验证」的结论投射回项目视图（画布热力图）。
 *
 * ─── 为什么需要它 ───────────────────────────────────────────────────────
 * R9 起我们建立了独一无二的闭环：AI 改完代码，面板自动量化「复杂度/死代码/克隆/
 * 审查发现」的前后变化。但这段结论只躺在右侧面板的「改动总账」里——而人看项目的
 * 主视图是画布。于是又出现和洞察投射一模一样的割裂：面板说「projectStore.ts 被 AI
 * 改坏了（复杂度 +24）」，用户却要在几百张卡片里自己找那一张。
 *
 * 本文件是那条「翻译层」的验证版：把面板的 VerifyEntry 聚合成每个文件的 verdict，
 * 交给画布上的文件卡去点亮一枚 AI✓ / AI! 角标。「验证结论回画布」正是 VS Code /
 * Copilot 根本没有、我们独有的护城河的可视化收口。
 *
 * ─── 与 insightOverlay 同源但独立 ─────────────────────────────────────
 * 复用同一套「store + O(1) 选择器 + 渲染期只查表」的模式（见 insightOverlay.ts /
 * insightOverlayStore.ts），但数据来源不同：insight 来自后端 ai_insights（持久化，
 * 画布 load 取库）；verify 来自本次会话的实时验证（跨窗口用 Tauri 全局事件广播，
 * 不落库——它是「最近 AI 改动的即时效应」，不是长期结论）。所以是同源模式、异源传输。
 *
 * 本文件是纯函数：不碰 store、不碰 DOM、不查库、不发事件，因此可直接单测。
 */
import { L } from "./aiLang";

/** 验证结论：本次 AI 改动让该文件变好 / 变坏 / 无明显变化 */
export type VerifyVerdict = "improved" | "worsened" | "neutral";

/** 验证卡关心的单文件事实（与 WorkbenchAiPanel.FileFacts 字段一致，避免循环依赖在此重声明） */
export interface VerifyFacts {
  cc: number;
  lines: number;
  fns: number;
  dead: number;
  clones: number;
  findings: number;
}

/** 面板喂进来的精简条目（relPath 作为画布实体的 key） */
export interface VerifyEntryLite {
  relPath: string;
  before: VerifyFacts;
  after: VerifyFacts;
}

/** 单个文件的验证标记（渲染器 O(1) 查表消费） */
export interface VerifyFileMark {
  verdict: VerifyVerdict;
  /** 各维度 delta（after - before）。复杂度/死代码/克隆/审查发现：正值=更糟，负值=更好 */
  ccDelta: number;
  deadDelta: number;
  cloneDelta: number;
  findingsDelta: number;
  /** 最近一次结算时间戳（多轮改同一文件时取最新） */
  ts: number;
}

/** 角标配色：变好=绿（与生病热力同源的好转色），变坏=红（与 critical 同源） */
export const VERIFY_COLOR: Record<VerifyVerdict, string> = {
  improved: "#22c55e",
  worsened: "#dc2626",
  neutral: "#9ca3af",
};

/**
 * 把面板结算出的 VerifyEntry 聚合成「文件 → verdict」。
 *
 * 判定优先级：只要任一维度变差（cc↑ / 死代码↑ / 克隆↑ / 审查发现↑）→ worsened（红）；
 * 否则只要任一维度变好 → improved（绿）；否则 neutral（不显示角标）。
 * 这样「AI 引入新 bug」会被立刻用红色点名——这是闭环最具警示价值的一刻。
 */
export function computeVerifyMarks(entries: readonly VerifyEntryLite[]): Record<string, VerifyFileMark> {
  const out: Record<string, VerifyFileMark> = {};
  for (const e of entries) {
    if (!e.relPath) continue;
    const ccDelta = e.after.cc - e.before.cc;
    const deadDelta = e.after.dead - e.before.dead;
    const cloneDelta = e.after.clones - e.before.clones;
    const findingsDelta = e.after.findings - e.before.findings;
    const worsened = ccDelta > 0 || deadDelta > 0 || cloneDelta > 0 || findingsDelta > 0;
    const improved = ccDelta < 0 || deadDelta < 0 || cloneDelta < 0 || findingsDelta < 0;
    const verdict: VerifyVerdict = worsened ? "worsened" : improved ? "improved" : "neutral";
    out[e.relPath] = { verdict, ccDelta, deadDelta, cloneDelta, findingsDelta, ts: Date.now() };
  }
  return out;
}

/** tooltip 文本（双语，随 UI 语言） */
export function verifyTooltip(mark: VerifyFileMark): string {
  const fmt = (label: string, d: number): string | null =>
    d !== 0 ? `${label} ${d > 0 ? "+" : ""}${d}` : null;
  const lines = [
    fmt(L("复杂度", "Complexity"), mark.ccDelta),
    fmt(L("死代码", "Dead code"), mark.deadDelta),
    fmt(L("克隆组", "Clones"), mark.cloneDelta),
    fmt(L("审查发现", "Review findings"), mark.findingsDelta),
  ].filter(Boolean) as string[];
  const head =
    mark.verdict === "worsened"
      ? L("AI 改动后变差", "Worse after AI edit")
      : mark.verdict === "improved"
        ? L("AI 改动后变好", "Better after AI edit")
        : L("AI 改动后无显著变化", "No significant change after AI edit");
  return [head, ...(lines.length ? lines : [L("（无度量变化）", "(no metric change)")])].join("\n");
}

/** 角标短标签：变好=✓，变坏=! */
export function verifyBadgeGlyph(verdict: VerifyVerdict): string {
  return verdict === "worsened" ? "AI!" : "AI✓";
}

/** verdict 严重度排序：worsened(2) > improved(1) > neutral(0)——目录冒泡取「最坏」 */
export function verifyVerdictRank(v: VerifyVerdict): number {
  return v === "worsened" ? 2 : v === "improved" ? 1 : 0;
}

/**
 * 把文件级验证标记「冒泡」成目录级：每个文件的 verdict 沿路径向上聚合到所有祖先目录。
 * - verdict 取子树内最坏（红色 AI! 一旦存在，整条祖先链都标红）。
 * - 各维度 delta 在目录内累加（目录总复杂度增量 = 其下文件增量之和），便于 tooltip 给总量。
 * 纯函数，不碰 store/DOM——与 computeVerifyMarks 同源，目录卡照常 O(1) 查表。
 */
export function bubbleDirVerifyMarks(
  fileMarks: Record<string, VerifyFileMark>,
): Record<string, VerifyFileMark> {
  const out: Record<string, VerifyFileMark> = {};
  for (const [path, m] of Object.entries(fileMarks)) {
    const parts = path.split("/");
    // 跳过文件名本身，逐层聚合到祖先目录（src → src/ai → src/ai/x）
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = acc ? `${acc}/${parts[i]}` : parts[i];
      acc = dir;
      const prev = out[dir];
      const verdict =
        !prev || verifyVerdictRank(m.verdict) > verifyVerdictRank(prev.verdict)
          ? m.verdict
          : prev.verdict;
      out[dir] = {
        verdict,
        ccDelta: (prev?.ccDelta ?? 0) + m.ccDelta,
        deadDelta: (prev?.deadDelta ?? 0) + m.deadDelta,
        cloneDelta: (prev?.cloneDelta ?? 0) + m.cloneDelta,
        findingsDelta: (prev?.findingsDelta ?? 0) + m.findingsDelta,
        ts: Math.max(prev?.ts ?? 0, m.ts),
      };
    }
  }
  return out;
}
