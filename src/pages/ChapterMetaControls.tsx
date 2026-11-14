// 章节头部元信息控件（批次② 写作动线）：状态徽章 + 层级名徽章。
//
// 背景：写作台此前改不了章节状态/层级名——只能跑回主窗口画布弹窗，写作动线断裂。
// 状态：点开菜单三选一（待写 '' / 草稿 draft / 已完 finished），与画布大纲树
// NODE_STATUS_CYCLE 同一组枚举；层级名（kind）：点开小气泡输入，走 renameNodeKind。
import { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';
import type { WritingChapter } from '../services/tauri';
import { t } from '../i18n';
import { statusLabelKey } from '../utils/writingSchema';

const STATUS_OPTIONS: Array<{
  value: string;
  labelKey: 'writingDesign.statusTodo' | 'writingDesign.statusDraft' | 'writingDesign.statusFinished';
}> = [
  { value: '', labelKey: 'writingDesign.statusTodo' },
  { value: 'draft', labelKey: 'writingDesign.statusDraft' },
  { value: 'finished', labelKey: 'writingDesign.statusFinished' },
];

function statusLabel(status: string): string {
  return t(statusLabelKey(status));
}

function statusColor(status: string): string {
  if (status === 'finished') return 'success.main';
  if (status === 'draft') return 'warning.main';
  return 'text.disabled';
}

export function ChapterMetaControls({
  chapter,
  onStatusChange,
  onKindChange,
}: {
  chapter: WritingChapter;
  onStatusChange: (id: string, status: string) => Promise<void> | void;
  onKindChange: (id: string, kind: string) => Promise<void> | void;
}) {
  const [statusAnchor, setStatusAnchor] = useState<HTMLElement | null>(null);
  const [kindAnchor, setKindAnchor] = useState<HTMLElement | null>(null);
  const [kindDraft, setKindDraft] = useState(chapter.kind);

  const openKind = (el: HTMLElement) => {
    setKindDraft(chapter.kind);
    setKindAnchor(el);
  };
  const commitKind = () => {
    setKindAnchor(null);
    const v = kindDraft.trim();
    if (v && v !== chapter.kind) void onKindChange(chapter.id, v);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Chip
        size="small"
        variant="outlined"
        label={statusLabel(chapter.status)}
        onClick={(e) => setStatusAnchor(e.currentTarget)}
        sx={{ fontSize: 11, height: 22, color: statusColor(chapter.status), borderColor: 'divider' }}
      />
      <Menu anchorEl={statusAnchor} open={!!statusAnchor} onClose={() => setStatusAnchor(null)}>
        {STATUS_OPTIONS.map((o) => (
          <MenuItem
            key={o.value}
            selected={o.value === chapter.status}
            onClick={() => {
              setStatusAnchor(null);
              if (o.value !== chapter.status) void onStatusChange(chapter.id, o.value);
            }}
          >
            {t(o.labelKey)}
          </MenuItem>
        ))}
      </Menu>
      <Chip
        size="small"
        variant="outlined"
        label={chapter.kind || t('writingTree.untitledChapter')}
        onClick={(e) => openKind(e.currentTarget)}
        sx={{ fontSize: 11, height: 22, borderColor: 'divider' }}
      />
      <Popover
        anchorEl={kindAnchor}
        open={!!kindAnchor}
        onClose={() => setKindAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 1.5 }}>
          <TextField
            autoFocus
            size="small"
            label={t('writing.editKindLabel')}
            value={kindDraft}
            onChange={(e) => setKindDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitKind();
              if (e.key === 'Escape') setKindAnchor(null);
            }}
            sx={{ width: 150, '& .MuiInputBase-input': { fontSize: 12.5 } }}
          />
        </Box>
      </Popover>
    </Box>
  );
}
