import { useEffect, useState } from 'react';
import { workVersionApi } from '../services/workVersion';
import { logger } from '../utils/logger';

/** 一本书记录下的删书账（成稿版本数 / 导出产物记录数）。 */
export interface BookDeletionRead {
  versionCount: number;
  artifactCount: number;
}

export interface BookDeletionImpactState {
  /** **只有本次 bookId 的读数回来了**才非 null；换目标书期间自然回到 null = 核对中 */
  read: BookDeletionRead | null;
  /** 读数失败：界面必须显式承认「未能核对」，不许用 0 冒充「没有」 */
  readFailed: boolean;
}

interface SettledRead extends BookDeletionRead {
  bookId: string;
  failed: boolean;
}

/**
 * 删书后果的两笔账（2026-11-04 删除铁律配套）。单独成模块而不是塞进组件文件：
 * 组件文件混着导出 hook 会踩 `react-refresh/only-export-components`，热更新会整页丢状态。
 *
 * 为什么用「读数带 bookId + 渲染期比对」而不是在 effect 里先 setState 清零：
 * 后者是 `react-hooks/set-state-in-effect` 点名的级联渲染写法。带了身份标识，
 * 换书时旧读数在渲染期就自然不成立，界面直接回到「核对中」，一次多余渲染都不必造。
 */
export function useBookDeletionImpact(bookId: string | null): BookDeletionImpactState {
  const [settled, setSettled] = useState<SettledRead | null>(null);

  useEffect(() => {
    if (!bookId) return;
    let alive = true;
    Promise.all([workVersionApi.list(bookId), workVersionApi.listArtifacts(bookId)])
      .then(([versions, artifacts]) => {
        if (!alive) return;
        setSettled({ bookId, versionCount: versions.length, artifactCount: artifacts.length, failed: false });
      })
      .catch((e: unknown) => {
        logger.warn('useBookDeletionImpact', 'impact read failed', { bookId, error: String(e) });
        if (alive) setSettled({ bookId, versionCount: 0, artifactCount: 0, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [bookId]);

  if (!bookId || !settled || settled.bookId !== bookId) return { read: null, readFailed: false };
  if (settled.failed) return { read: null, readFailed: true };
  return { read: { versionCount: settled.versionCount, artifactCount: settled.artifactCount }, readFailed: false };
}
