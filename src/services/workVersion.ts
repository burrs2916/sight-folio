/**
 * 成稿版本与导出产物（Sight Folio 完结作品重设计）
 * 对应后端 work_versions / work_version_chapters / export_artifacts
 */

export interface WorkVersion {
  id: string;
  bookId: string;
  seq: number;
  label: string;
  note: string;
  isFinal: boolean;
  chapterCount: number;
  wordCount: number;
  contentHash: string;
  schemaVer: number;
  lockedAt: number;
}

export interface WorkVersionChapter {
  versionId: string;
  sortOrder: number;
  srcChapterId: string;
  title: string;
  content: string;
  kind: string;
  parentId?: string | null;
  status: string;
  wordCount: number;
}

export type ExportArtifactFormat = 'epub' | 'pdf' | 'docx' | 'html' | 'md' | 'txt';
export type ExportArtifactStatus = 'queued' | 'running' | 'ready' | 'failed' | 'missing';
export type ExportArtifactOrigin = 'export' | 'import';

export interface ExportArtifact {
  id: string;
  versionId: string;
  bookId: string;
  format: ExportArtifactFormat;
  specId: string;
  fileRelPath: string;
  fileSize: number;
  status: ExportArtifactStatus;
  error: string;
  origin: ExportArtifactOrigin;
  createdAt: number;
}
