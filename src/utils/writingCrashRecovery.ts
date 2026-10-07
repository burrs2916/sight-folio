// T5 崩溃恢复：SQLite 防抖保存之外的一层 localStorage 兜底草稿。
//
// 语义设计（与 WritingPage 保存链路协同）：
//   - 草稿存在 ⟺ 最后一次成功入库（saveChapterContent）之后仍有未确认输入。
//   - 正常出库（防抖 flush / ⌘S / 删除 / 卸载 flush / 恢复入库）成功后立即清除草稿；
//     应用崩溃、强杀、断电等未走完保存链路的场景会残留草稿。
//   - 下次打开该章时若发现残留草稿，弹恢复条让作者选择「恢复 / 放弃」，
//     恢复后立即入库并清除草稿，避免重复提示。
//
// 清理策略：
//   - 入库即清（见集成点）；- TTL 清扫：启动时清除超过 DRAFT_TTL_MS 的过期草稿，
//     防 localStorage 膨胀（删除书等其他场景不主动清，由 TTL 兜底）。

/** localStorage key 前缀，collect/清理都在该前缀下枚举。 */
const DRAFT_PREFIX = 'sight-folio:writing-draft:';

/** 草稿有效期：超过 7 天未确认的草稿视为垃圾，启动清扫时移除。 */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 输入防抖之外的草稿落盘节流窗口：15s 写一次，不随每次按键触达 localStorage。 */
export const DRAFT_SNAP_INTERVAL_MS = 15_000;

export interface WritingDraftSnap {
  /** 章节正文 HTML（与 SQLite writing_chapters.content 同构，可直接 setContent 回填）。 */
  html: string;
  wordCount: number;
  /** 来源：auto=自动防抖快照；manual=保留扩展（当前统一 auto）。 */
  source: 'auto' | 'manual';
  /** 快照时间（epoch 秒）。 */
  savedAt: number;
}

export function draftKey(bookId: string, chapterId: string): string {
  return `${DRAFT_PREFIX}${bookId}:${chapterId}`;
}

/** 节流写草稿（同名书章覆盖，仅存最新一份）。 */
export function saveDraftSnap(
  bookId: string,
  chapterId: string,
  html: string,
  wordCount: number,
  source: WritingDraftSnap['source'] = 'auto',
): void {
  try {
    const snap: WritingDraftSnap = {
      html,
      wordCount,
      source,
      savedAt: Math.floor(Date.now() / 1000),
    };
    localStorage.setItem(draftKey(bookId, chapterId), JSON.stringify(snap));
  } catch {
    // 配额满/隐私模式等写入失败：忽略——SQLite 主保存链路不依赖草稿层。
  }
}

/** 读取草稿；缺失或坏数据返回 null（坏数据不抛出，由调用方视为「无草稿」）。 */
export function loadDraftSnap(bookId: string, chapterId: string): WritingDraftSnap | null {
  try {
    const raw = localStorage.getItem(draftKey(bookId, chapterId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WritingDraftSnap>;
    if (typeof parsed?.html !== 'string') return null;
    return {
      html: parsed.html,
      wordCount: typeof parsed.wordCount === 'number' ? parsed.wordCount : 0,
      source: parsed.source === 'manual' ? 'manual' : 'auto',
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Math.floor(Date.now() / 1000),
    };
  } catch {
    return null;
  }
}

/** 确认草稿已安全入库（或已放弃），从 localStorage 移除。 */
export function clearDraftSnap(bookId: string, chapterId: string): void {
  try {
    localStorage.removeItem(draftKey(bookId, chapterId));
  } catch {
    /* 忽略 */
  }
}

/** 枚举全部草稿 key（供清扫/调试）。 */
export function collectDraftKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
  } catch {
    /* 忽略 */
  }
  return keys;
}

/**
 * 清扫过期/损坏草稿，返回清理条数。
 * 启动时调用一次；底层 write 失败已由 saveDraftSnap 消化，这里只负责膨胀控制。
 */
export function clearExpiredDrafts(now: number = Date.now()): number {
  let cleared = 0;
  for (const k of collectDraftKeys()) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) {
        continue;
      }
      const parsed = JSON.parse(raw) as Partial<WritingDraftSnap>;
      const savedAtMs = (typeof parsed?.savedAt === 'number' ? parsed.savedAt : 0) * 1000;
      if (savedAtMs <= 0 || now - savedAtMs > DRAFT_TTL_MS) {
        localStorage.removeItem(k);
        cleared += 1;
      }
    } catch {
      // 坏数据：一律移除
      try {
        localStorage.removeItem(k);
        cleared += 1;
      } catch {
        /* 忽略 */
      }
    }
  }
  return cleared;
}
