// ⌘K 章节快速跳转（批次③ 效率）：输入即筛（标题/正文），↑↓ 选择、Enter 跳转。
//
// 章节列表按 sortOrder 排序；匹配口径与左栏搜索一致（标题或去标签正文）。
// 只渲染前 50 条防长书卡顿；高亮项自动 scrollIntoView。
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { WritingChapter } from '../services/tauri';
import { t } from '../i18n';

const MAX_RESULTS = 50;

export function ChapterQuickJump({
  open,
  onClose,
  chapters,
  activeChapterId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  chapters: WritingChapter[];
  activeChapterId: string | null;
  onPick: (chapterId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);

  // 打开时重置检索；输入变化时重置高亮。
  // 用 React 官方推荐的「渲染期调整 state」模式（比较 props/state 后条件 setState），
  // 不用 effect 同步 setState——后者触发级联渲染（react-hooks/set-state-in-effect）。
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setQ('');
  }
  const [prevQ, setPrevQ] = useState(q);
  if (prevQ !== q) {
    setPrevQ(q);
    setHl(0);
  }

  const query = q.trim().toLowerCase();
  const matched = useMemo(() => {
    const sorted = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);
    if (!query) return sorted.slice(0, MAX_RESULTS);
    return sorted
      .filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          (c.content || '')
            .replace(/<[^>]*>/g, '')
            .toLowerCase()
            .includes(query),
      )
      .slice(0, MAX_RESULTS);
  }, [chapters, query]);

  const pick = (c: WritingChapter) => {
    onPick(c.id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHl((i) => Math.min(i + 1, matched.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHl((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && matched[hl]) {
      e.preventDefault();
      pick(matched[hl]);
    }
  };

  // 高亮项滚进可视区
  useEffect(() => {
    document.querySelector('[data-quickjump-hl="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [hl]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <Box sx={{ p: 1.5, pb: 0.75 }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder={t('writing.quickJumpPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </Box>
      <List dense sx={{ maxHeight: 320, overflowY: 'auto', pt: 0 }}>
        {matched.map((c, i) => (
          <ListItemButton
            key={c.id}
            data-quickjump-hl={i === hl || undefined}
            selected={i === hl}
            onClick={() => pick(c)}
          >
            <ListItemText
              primary={
                <Typography sx={{ fontSize: 12.5, fontWeight: c.id === activeChapterId ? 700 : 400 }}>
                  {c.title || t('writingTree.untitledChapter')}
                </Typography>
              }
              secondary={`${c.kind || ''}${c.wordCount > 0 ? ` · ${t('writing.words', { n: c.wordCount })}` : ''}`}
              slotProps={{ secondary: { sx: { fontSize: 10.5 } } }}
            />
          </ListItemButton>
        ))}
        {matched.length === 0 && (
          <Typography sx={{ fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 2 }}>
            {t('writing.quickJumpEmpty')}
          </Typography>
        )}
      </List>
    </Dialog>
  );
}
