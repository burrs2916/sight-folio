import type { AiContextSection } from "./contextTypes";

/**
 * token 估算与预算装箱。
 *
 * 估算不追求与某个具体分词器完全一致（不同模型分词器不同，也不该为此引入依赖），
 * 只要求「同一份内容前后一致、CJK 与 ASCII 分开计」，用于：
 *   - 给 Agent 展示每个分节的成本，让它自己决定取不取；
 *   - 在装箱时把有限预算优先分给高价值分节。
 *
 * 经验系数：ASCII ≈ 4 字符/token（代码与路径偏碎，取 3.6 更保守）；
 * CJK ≈ 1 字符/token 略多（取 1.5，中文标点也算进去）。
 */
const ASCII_CHARS_PER_TOKEN = 3.6;
const CJK_CHARS_PER_TOKEN = 1.5;

const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** 估算一段文本的 token 数 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    if (CJK_RE.test(ch)) cjk += 1;
  }
  const ascii = text.length - cjk;
  return Math.ceil(ascii / ASCII_CHARS_PER_TOKEN + cjk / CJK_CHARS_PER_TOKEN);
}

/**
 * 内容指纹（FNV-1a 32bit，与后端 content_hash 同族算法，纯前端够用）。
 * 用途：数据没变就不重新生成上下文包、不重复烧一次 AI 分析。
 */
export function digestOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // FNV prime 16777619，用移位组合避免 32 位溢出丢精度
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export interface PackedSections {
  sections: AiContextSection[];
  truncatedSections: string[];
  tokenEstimate: number;
}

/**
 * 按 priority 升序装箱。超预算的分节不丢弃，而是降级为「仅摘要」——
 * 丢弃会让 Agent 完全不知道存在这一维度数据，摘要至少让它知道可以用工具单独取。
 */
export function packWithinBudget(
  sections: AiContextSection[],
  tokenBudget?: number,
): PackedSections {
  const ordered = [...sections].sort((a, b) => a.priority - b.priority);

  if (!tokenBudget || tokenBudget <= 0) {
    return {
      sections: ordered,
      truncatedSections: [],
      tokenEstimate: ordered.reduce((sum, s) => sum + s.tokenEstimate, 0),
    };
  }

  const kept: AiContextSection[] = [];
  const truncated: string[] = [];
  let used = 0;

  for (const section of ordered) {
    if (used + section.tokenEstimate <= tokenBudget) {
      kept.push(section);
      used += section.tokenEstimate;
      continue;
    }
    // 降级：只留摘要，并明确标注正文可用工具按需取。
    // 可信度警示必须跟着降级内容一起保留——否则被裁掉正文的盲区分节，
    // 只剩一句「未发现 X」的摘要，反而更容易被读成结论。
    const notice =
      section.dataQuality && section.dataQuality.status !== "ok"
        ? `⚠️ 数据可信度：${section.dataQuality.status}${section.dataQuality.reason ? `（${section.dataQuality.reason}）` : ""}\n\n`
        : "";
    const degradedContent =
      `${notice}${section.summary}\n\n> 正文因 token 预算未展开，` +
      `如需完整内容请调用工具 project_context（action="section", section_keys=["${section.key}"]）。`;
    const degradedTokens = estimateTokens(degradedContent);
    kept.push({ ...section, content: degradedContent, tokenEstimate: degradedTokens });
    truncated.push(section.key);
    used += degradedTokens;
  }

  return { sections: kept, truncatedSections: truncated, tokenEstimate: used };
}
