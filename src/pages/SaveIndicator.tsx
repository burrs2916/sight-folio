// 写作台保存状态指示器（P2 性能：saveState 状态下沉）
//
// 背景：800ms 自动保存链路会翻转 saveState（idle/dirty/saving/saved）。原先该 state 挂在
// WritingPage 顶层，每次翻转触发整棵树（约 2900 行组件）重渲染——这是写作台重渲染的根因
// （P1 的 ChapterListPanel memo 隔离只是症状隔离）。下沉后每次翻转只有本组件（几行
// Typography）重渲染，WritingPage 及其整树在自动保存期间零重渲染。
//
// 写入侧（WritingPage 保存链路）通过 register 拿到 setState 句柄。句柄是完整
// Dispatch<SetStateAction>，函数式更新语义原样保留（如「保存完成但期间又有新脏输入
// 则保持 dirty」）。挂载前写入落在 no-op 默认句柄上，安全（输入只可能发生在 commit 后）。
import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import Typography from '@mui/material/Typography';
import { t } from '../i18n';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

export interface SaveIndicatorProps {
  /** WritingPage 保存链路注册 setState 句柄（useCallback 包裹，引用稳定） */
  register: (fn: Dispatch<SetStateAction<SaveState>>) => void;
}

export function SaveIndicator({ register }: SaveIndicatorProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    register(setSaveState);
  }, [register]);

  return (
    <Typography sx={{ fontSize: 11, color: saveState === 'saved' ? 'success.main' : 'text.disabled' }}>
      {saveState === 'saving'
        ? t('writing.saving')
        : saveState === 'saved'
          ? t('writing.saved')
          : saveState === 'dirty'
            ? t('writing.unsaved')
            : ''}
    </Typography>
  );
}
