import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

export interface BatchOperations {
  selectionMode: boolean;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  selectedChapterIds: string[];
  setSelectedChapterIds: Dispatch<SetStateAction<string[]>>;
  /** 开关批量模式；开启时清空历史选中，避免残留脏选 */
  toggleSelectionMode: () => void;
  /** 批量动作完成后整组复位（移卷/删除共用） */
  resetBatch: () => void;
}

/**
 * 批量章节管理（P9）：多选模式 + 选中集合。状态与操作内聚，
 * 由 ChapterTreePanel（勾选）、batch 操作按钮（移卷/删除）与对话框状态机共享。
 */
export function useBatchOperations(): BatchOperations {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => !prev);
    setSelectedChapterIds([]);
  }, []);

  const resetBatch = useCallback(() => {
    setSelectionMode(false);
    setSelectedChapterIds([]);
  }, []);

  return {
    selectionMode,
    setSelectionMode,
    selectedChapterIds,
    setSelectedChapterIds,
    toggleSelectionMode,
    resetBatch,
  };
}
