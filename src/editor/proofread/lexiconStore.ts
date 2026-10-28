// 自定义校对词库（批次③ 增-6）。
//
// 为什么要有它：三张内置表都是 `import` 常量，能力上限从此固定在发版那一刻。
// 而 `typoPhrases.ts` 的注释里其实早写着「维护：可按书类型追加，暂时通用」——
// 这个口子留了但一直没人实现。古风文的「拜覆」「咱家」与现代文的用词规范不同，
// 平台违禁词每季度都在变，这些都不该等一次应用更新。
//
// 存储走**全局 KV**（`settingsApi` → `SqliteSettingsRepository`），刻意不用 localStorage：
// 这是作者的资产，必须跟着库文件走——能被备份、能换机带走。散在浏览器存储里的
// 作者配置，等于没有。
import { settingsApi } from '../../services/tauri';
import { logger } from '../../utils/logger';
import { SENSITIVE_WORDS_SORTED, type SensitiveEntry } from './sensitiveWords';
import { TYPO_PHRASES, type TypoPhrase } from './typoPhrases';
import { REDUNDANT_PHRASES, type RedundantPhrase } from './redundantPhrases';

/** KV 键名。改名将让既有作者的词库失效，只能通过迁移处理，不要随手改 */
export const LEXICON_SETTING_KEY = 'proofread.customLexicon';

export interface CustomLexicon {
  /** 追加的错别字对；同 `wrong` 会覆盖内置条目的 `right` */
  typos: TypoPhrase[];
  /** 追加的敏感词 */
  sensitive: SensitiveEntry[];
  /** 追加的冗余表达 */
  redundant: RedundantPhrase[];
  /**
   * 白名单：这些词形一律不再报（内置与自定义都屏蔽）。
   *
   * 为什么必须有：本项目一条贯穿始终的约束是**误报比漏报更严重**——漏一条错别字作者
   * 自己会看见，而词表误伤人名/地名/自造术语（「在在」可能是个角色名），报多了作者
   * 就会把整个校对面板关掉。没有关掉的口子，词库越"聪明"越没人用。
   */
  ignored: string[];
}

/** 引擎实际消费的最终词库 = 内置 ⊕ 自定义（已排序、已剔除白名单） */
export interface ResolvedLexicon {
  typos: readonly TypoPhrase[];
  sensitive: readonly SensitiveEntry[];
  redundant: readonly RedundantPhrase[];
}

export const EMPTY_LEXICON: CustomLexicon = { typos: [], sensitive: [], redundant: [], ignored: [] };

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * 规范化：去空白、丢空项、按词形去重（后写的覆盖先写的）。
 *
 * 纯函数、不碰 IO，便于把规则单独钉死。任何**畸形条目直接丢弃**而不是让引擎拿到
 * `{wrong: undefined}` 之类——那会让 `text.indexOf(undefined)` 变成匹配字符串
 * "undefined"，凭空造出一堆误报。
 */
export function normalizeLexicon(raw: unknown): CustomLexicon {
  // 每个分支都**新建数组**：EMPTY_LEXICON 是导出常量，把它或它的展开直接交出去，
  // 调用方一次 push 就会污染全局的"空词库"
  if (!raw || typeof raw !== 'object') return { typos: [], sensitive: [], redundant: [], ignored: [] };
  const o = raw as Record<string, unknown>;

  const typos: TypoPhrase[] = [];
  const typoIdx = new Map<string, number>();
  for (const item of Array.isArray(o.typos) ? o.typos : []) {
    const wrong = asString((item as TypoPhrase)?.wrong);
    const right = asString((item as TypoPhrase)?.right);
    if (!wrong || !right) continue;
    const at = typoIdx.get(wrong);
    if (at === undefined) {
      typoIdx.set(wrong, typos.length);
      typos.push({ wrong, right });
    } else {
      typos[at] = { wrong, right };
    }
  }

  const sensitive: SensitiveEntry[] = [];
  const sensIdx = new Map<string, number>();
  for (const item of Array.isArray(o.sensitive) ? o.sensitive : []) {
    const word = asString((item as SensitiveEntry)?.word);
    if (!word) continue;
    const level = (item as SensitiveEntry)?.level === 'block' ? 'block' : 'warning';
    const at = sensIdx.get(word);
    if (at === undefined) {
      sensIdx.set(word, sensitive.length);
      sensitive.push({ word, level });
    } else {
      sensitive[at] = { word, level };
    }
  }

  const redundant: RedundantPhrase[] = [];
  const redIdx = new Map<string, number>();
  for (const item of Array.isArray(o.redundant) ? o.redundant : []) {
    const wrong = asString((item as RedundantPhrase)?.wrong);
    const right = asString((item as RedundantPhrase)?.right);
    if (!wrong || !right) continue;
    const at = redIdx.get(wrong);
    if (at === undefined) {
      redIdx.set(wrong, redundant.length);
      redundant.push({ wrong, right });
    } else {
      redundant[at] = { wrong, right };
    }
  }

  const ignored: string[] = [];
  for (const item of Array.isArray(o.ignored) ? o.ignored : []) {
    const w = asString(item);
    if (w && !ignored.includes(w)) ignored.push(w);
  }

  return { typos, sensitive, redundant, ignored };
}

/**
 * 合并内置与自定义。三条规则都是**行为契约**，不是实现细节：
 *
 * 1. 自定义同名词形覆盖内置：作者说「这个词我建议改成 X」应当生效，否则内置表成了
 *    不可协商的权威，作者只能整条 ignore 掉（连带丢掉这条本来有用的提醒）。
 * 2. `ignored` 同时过滤内置与自定义：白名单的意义就是"别报"，只对一半就失去意义。
 * 3. 敏感词合并后**必须按词长降序**重排。内置那份 `SENSITIVE_WORDS_SORTED` 就是这么排的
 *    （长词优先，避免短词抢先命中同一区间）；只在内置上做排序、把自定义追加在尾部，
 *    自定义的短词就会插队——这条是最容易在"看起来能用"的状态下埋进去的 bug。
 */
export function mergeLexicon(builtin: CustomLexicon, custom: CustomLexicon): ResolvedLexicon {
  const ignoreSet = new Set(builtin.ignored.concat(custom.ignored));

  const joinBy = <T>(a: readonly T[], b: readonly T[], key: (x: T) => string): T[] => {
    const out: T[] = [];
    const at = new Map<string, number>();
    for (const x of [...a, ...b]) {
      const k = key(x);
      const prev = at.get(k);
      if (prev === undefined) {
        at.set(k, out.length);
        out.push(x);
      } else {
        out[prev] = x;
      }
    }
    return out;
  };

  return {
    typos: joinBy(builtin.typos, custom.typos, (x) => x.wrong).filter((x) => !ignoreSet.has(x.wrong)),
    redundant: joinBy(builtin.redundant, custom.redundant, (x) => x.wrong).filter(
      (x) => !ignoreSet.has(x.wrong),
    ),
    sensitive: joinBy(builtin.sensitive, custom.sensitive, (x) => x.word)
      .filter((x) => !ignoreSet.has(x.word))
      .sort((a, b) => b.word.length - a.word.length),
  };
}

// ─── 运行时状态 ────────────────────────────────────────────────────
// 校对在输入时以 1.2s 防抖跑，体检更是整本书逐章跑，所以**不能每轮都 IPC 读库**：
// 这里做模块级缓存，只在显式保存或首次加载时打一次 KV。
//
// 扫描成本是 `词数 × 文本长度`（逐词 indexOf）。这个数字**已经量过**，别再凭直觉重写：
// 内置 189 条扫一章 1.8ms；叠到 6,000 条 × 5,000 字是 6.2ms；最坏组合
// （50,000 字 + 1,000 条）32ms —— 相对 1.2s 的防抖窗口约 2.6%。
// 真要快可以并成单正则（实测快约 116 倍，构建 0.28ms 只在词库变更时付），但那是另一件事：
// 会丢掉"哪个词命中、建议改成什么"的对应关系，得先把正确性设计补齐。
// 数据与复现见 `__bench__/lexiconCost.test.tsx`、`docs/功能推进方案-增删减.md` 增-6 一节。
let current: CustomLexicon = normalizeLexicon(null);
let loaded = false;
let loadError: string | null = null;
let resolved: ResolvedLexicon | null = null;

/** 内置那份"基线"（未叠加自定义、未过滤 ignore） */
const BUILTIN: CustomLexicon = {
  typos: TYPO_PHRASES,
  sensitive: SENSITIVE_WORDS_SORTED,
  redundant: REDUNDANT_PHRASES,
  ignored: [],
};

/** 内置词表条数（UI 显示「内置 N 条」用；不在 UI 里再 import 一次三张表） */
export const BUILTIN_COUNTS = {
  typos: TYPO_PHRASES.length,
  sensitive: SENSITIVE_WORDS_SORTED.length,
  redundant: REDUNDANT_PHRASES.length,
};

/**
 * 首次加载。之后都命中缓存。
 *
 * 读失败/JSON 坏掉时：记错误、按空词库继续跑，**但绝不回写覆盖原值**——
 * 一次解析失败就把作者的词库清空，是最不可接受的那种"修复"。
 */
export async function loadCustomLexicon(force = false): Promise<CustomLexicon> {
  if (loaded && !force) return current;
  try {
    const raw = await settingsApi.get(LEXICON_SETTING_KEY);
    current = raw ? normalizeLexicon(JSON.parse(raw)) : normalizeLexicon(null);
    loadError = null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 读不到 ≠ 没有词库：保留上一次已知内容，别退化成"内置词库"却让用户以为配置没了
    loadError = msg;
    logger.warn('proofreadLexicon', 'custom lexicon unreadable, keeping previous copy', { error: msg });
  }
  loaded = true;
  resolved = null;
  return current;
}

export async function saveCustomLexicon(next: CustomLexicon): Promise<CustomLexicon> {
  const clean = normalizeLexicon(next);
  await settingsApi.set(LEXICON_SETTING_KEY, JSON.stringify(clean));
  current = clean;
  loaded = true;
  loadError = null;
  resolved = null;
  return clean;
}

/** 同步取（引擎用）。返回内置 ⊕ 自定义的最终词库 */
export function resolveLexicon(): ResolvedLexicon {
  if (!resolved) resolved = mergeLexicon(BUILTIN, current);
  return resolved;
}

export function getCustomLexicon(): CustomLexicon {
  return current;
}

/** 加载错误（供 UI 显示"词库未能加载"，而不是静默按内置跑） */
export function getCustomLexiconError(): string | null {
  return loadError;
}

/** 自定义条目总数（入口徽章用） */
export function countCustomEntries(l: CustomLexicon): number {
  return l.typos.length + l.sensitive.length + l.redundant.length + l.ignored.length;
}
