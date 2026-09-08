/**
 * 左侧面板的「全量可检索」基础设施（R32）
 *
 * ## 为什么需要它
 *
 * R32 之前，左侧实体面板每一组都是硬截断的：
 * `visibleFindings.slice(0, 40)`、`visibleCoupling.slice(0, 40)`、
 * 符号「每类前 40 条」、技术债「每组 30 条」、克隆组「前 40 组」。
 *
 * 这带来两个后果，恰好就是用户说的「左侧面板是死的」：
 * 1. **数据看不全**：库里 3800+ 审查发现，面板只给 40 条，剩下 99% 无路可达 ——
 *    既不能翻页也不能搜索，分析结果等于没有交付给人。
 * 2. **想放开又会卡**：直接去掉 slice 让 MUI 渲染几千行（每行含 Typography/Tooltip/sx），
 *    首屏与滚动都会掉帧。所以「放开截断」必须和「虚拟滚动」一起做，缺一不可。
 *
 * 本模块提供两块纯逻辑（不含任何 React/DOM，可直接单测）：
 * - `computeVirtualWindow`：定高行的可视窗口计算（虚拟滚动的核心算术）
 * - `tokenizeQuery` / `matchesTokens` / `filterByQuery`：面板统一搜索的匹配口径
 *
 * 刻意不引第三方虚拟列表库（react-window 等）：面板行是定高的简单场景，
 * 30 行算术就能覆盖，引库反而增加打包体积与升级负担。
 */

// ══════════════════════════════════════════════════════════════════
// 一、虚拟滚动窗口
// ══════════════════════════════════════════════════════════════════

export interface VirtualWindowInput {
  /** 列表项总数 */
  itemCount: number;
  /** 单行高度（px，定高） */
  rowHeight: number;
  /** 滚动容器当前 scrollTop */
  scrollTop: number;
  /** 滚动容器可视高度（px） */
  viewportHeight: number;
  /**
   * 视口外额外渲染的行数（上下各 overscan 行）。
   * 作用是滚动时先把即将进入视口的行画好，避免出现白条。默认 6 行。
   */
  overscan?: number;
}

export interface VirtualWindow {
  /** 需要渲染的首行下标（含） */
  startIndex: number;
  /** 需要渲染的末行下标（不含，可直接用于 slice） */
  endIndex: number;
  /** 首行相对列表顶部的像素偏移（用于 transform: translateY） */
  offsetY: number;
  /** 列表完整高度（撑开滚动条用） */
  totalHeight: number;
}

/**
 * 计算定高列表在当前滚动位置下需要渲染的窗口。
 *
 * 约定：
 * - 任何非法输入（负数/0 行高/NaN）都退化为「渲染全部」，
 *   宁可慢一点也绝不出现「列表空白但滚动条还在」的诡异状态；
 * - `endIndex` 为开区间，调用方 `items.slice(startIndex, endIndex)` 即可；
 * - `offsetY` 永远等于 `startIndex * rowHeight`，与 `totalHeight` 一起
 *   保证滚动条长度和内容位置严格对齐（不会出现"滚到底还有半屏"）。
 */
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const { itemCount, rowHeight, scrollTop, viewportHeight } = input;
  const overscan = input.overscan ?? 6;

  const safeCount = Number.isFinite(itemCount) && itemCount > 0 ? Math.floor(itemCount) : 0;
  const safeRow = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 0;

  // 行高非法 或 容器尚未测量（高度 0）→ 全量渲染兜底
  if (safeCount === 0) {
    return { startIndex: 0, endIndex: 0, offsetY: 0, totalHeight: 0 };
  }
  if (safeRow === 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return {
      startIndex: 0,
      endIndex: safeCount,
      offsetY: 0,
      totalHeight: safeRow * safeCount,
    };
  }

  const top = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const totalHeight = safeRow * safeCount;

  const rawStart = Math.floor(top / safeRow) - overscan;
  const startIndex = Math.max(0, Math.min(rawStart, Math.max(0, safeCount - 1)));

  const visibleRows = Math.ceil(viewportHeight / safeRow);
  const rawEnd = Math.floor(top / safeRow) + visibleRows + overscan + 1;
  const endIndex = Math.max(startIndex, Math.min(safeCount, rawEnd));

  return {
    startIndex,
    endIndex,
    offsetY: startIndex * safeRow,
    totalHeight,
  };
}

// ══════════════════════════════════════════════════════════════════
// 二、统一搜索匹配
// ══════════════════════════════════════════════════════════════════

/**
 * 把搜索框文本切成 token。
 *
 * 口径：空白分词 + 全部小写 + 去空 token。多个 token 之间是 **AND** 关系，
 * 即输入 `user service` 命中 `UserServiceImpl.ts` 也命中 `service/user.ts`，
 * 但不命中只含 user 的文件。代码检索里 AND 比 OR 有用得多 ——
 * OR 在几千条数据上几乎等于不过滤。
 */
export function tokenizeQuery(query: string): string[] {
  if (!query) return [];
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** 单个字符串是否命中全部 token（大小写不敏感的子串匹配） */
export function matchesTokens(text: string | null | undefined, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  if (!text) return false;
  const lower = text.toLowerCase();
  return tokens.every((t) => lower.includes(t));
}

/**
 * 多字段命中：token 可以分散命中不同字段。
 *
 * 例如搜索 `login critical`，条目的 message 含 login、severity 含 critical
 * 也应命中 —— 因为用户脑子里想的是「登录相关的严重问题」，
 * 而不是「某一个字段里同时出现这两个词」。
 */
export function matchesFields(fields: readonly (string | null | undefined)[], tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const lowers = fields.filter(Boolean).map((f) => String(f).toLowerCase());
  if (lowers.length === 0) return false;
  return tokens.every((t) => lowers.some((f) => f.includes(t)));
}

/**
 * 按查询过滤列表。
 *
 * @param items    原始列表
 * @param tokens   已 tokenize 的查询（调用方 useMemo 一次，避免每条重复切词）
 * @param fieldsOf 取出该条目参与匹配的字段
 */
export function filterByTokens<T>(
  items: readonly T[],
  tokens: readonly string[],
  fieldsOf: (item: T) => (string | null | undefined)[]
): T[] {
  if (tokens.length === 0) return items as T[];
  const out: T[] = [];
  for (const it of items) {
    if (matchesFields(fieldsOf(it), tokens)) out.push(it);
  }
  return out;
}

/**
 * 组头计数文案：有搜索时显示「命中/总数」，无搜索时只显示总数。
 * 抽成函数是为了让 7 个分组的口径完全一致（此前每组各写各的）。
 */
export function countLabel(matched: number, total: number, filtering: boolean): string {
  return filtering && matched !== total ? `${matched}/${total}` : String(total);
}
