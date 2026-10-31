import { describe, it, expect } from 'vitest';
import { resolveWritingActiveChapterFile } from '../studioAiFile';
import type { WritingChapter } from '../../services/tauri';

const ch = (over: Partial<WritingChapter> = {}): WritingChapter =>
  ({
    id: 'c1',
    bookId: 'b1',
    title: '第一章',
    content: '',
    sortOrder: 1,
    wordCount: 100,
    status: 'draft',
    volume: '',
    parentId: null,
    kind: '章',
    extra: '{}',
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }) as WritingChapter;

describe('resolveWritingActiveChapterFile（工作室正文 tab 合成章节 activeFile）', () => {
  it('有书 + 有激活章 + 章存在 → 合成路径/fileId/language 对齐 scan_writing_book 约定', () => {
    const f = resolveWritingActiveChapterFile('b1', 'c1', [ch()]);
    expect(f).not.toBeNull();
    expect(f!.fileId).toBe('wfile_c1');
    expect(f!.relPath).toBe('writing://b1/c1.md');
    expect(f!.language).toBe('md');
    expect(f!.name).toBe('第一章');
  });

  it('章 title 为空 → 回退「未命名」（对齐 chapterCardConfig 空名兜底）', () => {
    const f = resolveWritingActiveChapterFile('b1', 'c1', [ch({ title: '' })]);
    expect(f!.name).toBe('未命名');
  });

  it('缺书 id / 缺激活章 id / 章不在列表 → 一律 null（不误合成，快捷动作退回静默无上下文）', () => {
    expect(resolveWritingActiveChapterFile('', 'c1', [ch()])).toBeNull();
    expect(resolveWritingActiveChapterFile('b1', '', [ch()])).toBeNull();
    expect(resolveWritingActiveChapterFile(null, null, [ch()])).toBeNull();
    expect(resolveWritingActiveChapterFile('b1', 'ghost', [ch()])).toBeNull();
  });
});
