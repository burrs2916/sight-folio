// 工作室正文（writing）页签的 AI「当前文件」合成（第十八轮 批次3）
//
// 背景：主窗口 AI 面板的 activeFile 只从「选中的画布卡」反查 filePath。工作室正文
// 页签是铺满画布的文档容器（WritingDocsRenderer），创作者在 L2 正文 tab 里往往没有
// 选中任何画布卡 → activeFile 为 null → AI 面板 quickAction 里「读懂本章 / 人设一致性 /
// 情节连贯」等**章节级只读动作**全部在 `if (!activeFile) return` 处静默早退——在最常待的
// 正文视图点了没反应。
//
// 修法：无选中卡时，以正文「当前激活章」（writingDocsStore.activeChapterByBook——与右栏
// 详情卡 / 左栏目录树 / 正文语料 buildManuscriptCorpus 同一真相源）合成一个章节虚拟文件，
// 路径 / fileId / language 全部对齐 studioBook.chapterCardConfig 与 Rust scan_writing_book
// 约定（writing://{bookId}/{chapterId}.md、wfile_{chapterId}、md），保证 AI 的 file_read 与
// 快捷动作 prompt 里的章节相对路径都能命中真实数据。抽成纯函数便于单测。
import type { WritingChapter } from '../services/tauri';

export interface StudioAiFileShape {
  fileId: string;
  relPath: string;
  language: string | null;
  name: string;
  totalLines?: number;
}

/**
 * 正文页签合成当前章 activeFile。
 * @param activeBookId 当前书 id（空 → null）
 * @param activeChapterId 正文当前激活章 id（writingDocsStore.activeChapterByBook[bookId]，空 → null）
 * @param chapters 当前书章节列表（用于按 id 找章；找不到 → null）
 */
export function resolveWritingActiveChapterFile(
  activeBookId: string | null | undefined,
  activeChapterId: string | null | undefined,
  chapters: WritingChapter[],
): StudioAiFileShape | null {
  if (!activeBookId || !activeChapterId) return null;
  const ch = chapters.find((c) => c.id === activeChapterId);
  if (!ch) return null;
  return {
    fileId: `wfile_${ch.id}`,
    relPath: `writing://${activeBookId}/${ch.id}.md`,
    language: 'md',
    name: ch.title || '未命名',
    totalLines: undefined,
  };
}
