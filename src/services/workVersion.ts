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

/**
 * 成品页产物视图（后端 `ArtifactView`）：产物记录全字段 + **join 现取的书名**。
 * 库里没有 book_title 列（需求 §3），界面拿到的 bookTitle 只可能来自 writing_books 实时 join。
 */
export interface ArtifactView extends ExportArtifact {
  bookTitle: string;
}

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

/**
 * 作品库根读数（B3）：后端读取时即保证目录可用（不存在则创建）；
 * 创建失败会原样 reject —— 界面必须把错误如实展示，不许静默降级回「另存为」（需求 §4）。
 */
export interface WorksLibraryRootInfo {
  /** 绝对路径 */
  path: string;
  /** true = 当前生效的是默认根（~/Documents/SightFolio 作品库） */
  isDefault: boolean;
}

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
  /** 读作品库根（不存在则后端创建；失败 reject，调用方如实上报） */
  getLibraryRoot(): Promise<WorksLibraryRootInfo> {
    return invoke<WorksLibraryRootInfo>('get_works_library_root');
  },
  /** 换作品库根：只改配置不搬文件；后端建目录成功后才落库，失败不动旧值 */
  setLibraryRoot(path: string): Promise<WorksLibraryRootInfo> {
    return invoke<WorksLibraryRootInfo>('set_works_library_root', { path });
  },
  /**
   * 入队导出（B4b）：一格式一条 queued 任务，后台队列消化（并发上限 2，Q5）。
   * 渲染取数是后端从快照表读的死口径，前端只报版本号与格式（需求 §5.2）。
   */
  enqueueExport(versionId: string, formats: string[], specId?: string): Promise<ExportArtifact[]> {
    return invoke<ExportArtifact[]>('enqueue_export', { versionId, formats, specId: specId ?? null });
  },
  /** 任务面板视图：queued/running/failed（ready 归产物列表，missing 同） */
  listExportJobs(): Promise<ExportArtifact[]> {
    return invoke<ExportArtifact[]>('list_export_jobs');
  },
  /** 原地重试：仅 failed 可回队（running 拒绝是后端诚实口径，别在前端绕） */
  retryExportJob(jobId: string): Promise<void> {
    return invoke<void>('retry_export_job', { jobId });
  },
  /** 移除任务记录：queued 取消排队 / failed 清失败账 */
  dismissExportJob(jobId: string): Promise<void> {
    return invoke<void>('dismiss_export_job', { jobId });
  },
  /** 产物列表（含 queued/running 排队态；书名后端 join 现取） */
  listArtifacts(bookId?: string): Promise<ArtifactView[]> {
    return invoke<ArtifactView[]>('list_export_artifacts', { bookId: bookId ?? null });
  },
  /**
   * 取回：解析相对路径并高亮文件，成功返回绝对路径。
   * 解析不到时后端改判 missing 并抛错 —— 界面必须把错误原样上屏（§9-10）。
   */
  revealArtifact(artifactId: string): Promise<string> {
    return invoke<string>('reveal_artifact', { artifactId });
  },
  /** 复制到其他位置（§4 交付动作）：返回字节数；库内记录与本体不动 */
  copyArtifactTo(artifactId: string, destPath: string): Promise<number> {
    return invoke<number>('copy_artifact_to', { artifactId, destPath });
  },
  /**
   * 某书某格式的 ready 产物计数（写作台「已有 n 个」徽标，需求 §6）。
   * 命令名沿用退役前的 query_completed_work_count（§6 明文保留命令名），
   * 实现已改按 export_artifacts —— 只数 ready，排队/失败/缺失不冒充成品。
   * format 传空串 = 该书全部格式总数。
   */
  exportCount(bookId: string, format: string): Promise<number> {
    return invoke<number>('query_completed_work_count', { bookId, format });
  },
};
