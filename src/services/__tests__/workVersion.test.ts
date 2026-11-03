import { describe, expect, it } from 'vitest';
import type { WorkVersion, WorkVersionChapter, ExportArtifact } from '../workVersion';

describe('WorkVersion types and structure', () => {
  it('creates valid WorkVersion object', () => {
    const version: WorkVersion = {
      id: 'wv_1',
      bookId: 'b_1',
      seq: 1,
      label: '定稿',
      note: '首发完本',
      isFinal: true,
      chapterCount: 30,
      wordCount: 100000,
      contentHash: 'abc123hash',
      schemaVer: 1,
      lockedAt: 1730600000,
    };
    expect(version.seq).toBe(1);
    expect(version.isFinal).toBe(true);
  });

  it('creates valid WorkVersionChapter object', () => {
    const chapter: WorkVersionChapter = {
      versionId: 'wv_1',
      sortOrder: 1,
      srcChapterId: 'c_1',
      title: '第1章',
      content: '<p>正文内容</p>',
      kind: '章',
      parentId: null,
      status: 'finished',
      wordCount: 3000,
    };
    expect(chapter.title).toBe('第1章');
    expect(chapter.wordCount).toBe(3000);
  });

  it('creates valid ExportArtifact object', () => {
    const artifact: ExportArtifact = {
      id: 'art_1',
      versionId: 'wv_1',
      bookId: 'b_1',
      format: 'epub',
      specId: 'default',
      fileRelPath: 'b_1/v1/书名-v1.epub',
      fileSize: 1024,
      status: 'ready',
      error: '',
      origin: 'export',
      createdAt: 1730600000,
    };
    expect(artifact.format).toBe('epub');
    expect(artifact.status).toBe('ready');
  });
});
