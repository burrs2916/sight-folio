/**
 * 成稿版本与导出产物（Sight Folio 完结作品重设计）
 * 对应后端 work_versions / work_version_chapters / export_artifacts
 */
import { invoke } from './core';

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

/**
 * 同指纹拦截的错误标记：后端在 Validation 消息里带此前缀（见
 * `application/work_version::lock_version`），前端据此区分「内容与上一版一致」
 * 与普通失败 —— 不能靠中文字面判，词典换文案出口就断。
 */
export const SAME_CONTENT_ERROR_MARK = 'SAME_CONTENT|';

export const workVersionApi = {
  /**
   * 锁定一版。正文由后端从库里的落盘态自取，前端只负责调用前把未保存改动冲干净
   * （B1 决策：否则「锁进版本的字」与「库里的字」有二义性）。
   * force=true 是同指纹拦截后的「仍然锁定」出口（需求 §5.1 第 3 步）。
   */
  lock(bookId: string, label: string, note: string, isFinal: boolean, force = false): Promise<WorkVersion> {
    return invoke<WorkVersion>('lock_work_version', { bookId, label, note, isFinal, force });
  },
  /** 某书全部版本（seq 倒序） */
  list(bookId: string): Promise<WorkVersion[]> {
    return invoke<WorkVersion[]>('list_work_versions', { bookId });
  },
  /** 版本快照正文明细（预览/比对用） */
  snapshot(versionId: string): Promise<WorkVersionChapter[]> {
    return invoke<WorkVersionChapter[]>('get_version_snapshot', { versionId });
  },
  /** 换正稿（全书唯一，后端单事务原子清旧） */
  setFinal(bookId: string, versionId: string): Promise<void> {
    return invoke<void>('set_final_version', { bookId, versionId });
  },
  /** 删版本，返回被连带抹掉的产物相对路径 */
  delete(versionId: string): Promise<string[]> {
    return invoke<string[]>('delete_work_version', { versionId });
  },
};
