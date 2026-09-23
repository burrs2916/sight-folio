// 写作台全书搜索对话框（骨架走查 P1-G1）：
// 查找/替换此前只作用于当前章，长篇「某句话在哪章」无处可查——此处跨章检索，
// 算法复用 utils/writingSearch（唯一口径）；结果点行切章（setActiveChapter 由调用方执行），
// 章内精确定位交给既有章内查找（Ctrl+F 语境），v1 不做替换（跨章替换风险大、章内已有）。
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import type { WritingChapter } from '../services/tauri';
import { searchBookInChapters, type BookSearchHit } from '../utils/writingSearch';
import { t } from '../i18n';

export interface WritingBookSearchDialogProps {
  open: boolean;
  onClose: () => void;
  /** 本书全部章（含正文）；由调用方从 writingStore 取，组件保持纯展示 */
  chapters: Pick<WritingChapter, 'id' | 'title' | 'content'>[];
  /** 点结果行 → 切章（写作台语境 = setActiveChapter + 关对话框） */
  onPick: (chapterId: string) => void;
}

export function WritingBookSearchDialog({ open, onClose, chapters, onPick }: WritingBookSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<BookSearchHit[]>([]);
  const [ran, setRan] = useState(false);

  const run = useCallback(() => {
    setHits(searchBookInChapters(chapters, query));
    setRan(true);
  }, [chapters, query]);

  // 关闭即清态：下次打开不残留上次结果
  useEffect(() => {
    if (!open) {
      setQuery('');
      setHits([]);
      setRan(false);
    }
  }, [open]);

  const totalMatches = hits.reduce((n, h) => n + h.count, 0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>{t('writing.bookSearchTitle')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            fullWidth
            size="small"
            autoFocus
            placeholder={t('writing.bookSearchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run();
            }}
            slotProps={{ htmlInput: { 'data-testid': 'book-search-input' } }}
          />
          <Button variant="contained" size="small" startIcon={<SearchRoundedIcon />} onClick={run} data-testid="book-search-run">
            {t('writing.bookSearchRun')}
          </Button>
        </Box>
        {ran && hits.length === 0 && (
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', textAlign: 'center', py: 3 }}>
            {t('writing.bookSearchEmpty')}
          </Typography>
        )}
        {ran && hits.length > 0 && (
          <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
            {t('writing.bookSearchHitCount', { n: hits.length, m: totalMatches })}
          </Typography>
        )}
        {hits.map((h) => (
          <Box key={h.chapterId} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
              {h.chapterTitle || t('writingWorkbench.untitled')} · {t('writing.bookSearchMatchCount', { n: h.count })}
            </Typography>
            {h.snippets.map((s, i) => (
              <Box
                key={i}
                component="button"
                type="button"
                onClick={() => onPick(h.chapterId)}
                title={t('writing.bookSearchJump')}
                data-testid="book-search-row"
                sx={{
                  cursor: 'pointer', width: '100%', textAlign: 'left', fontSize: 11.5,
                  p: '3px 6px', mt: 0.5, borderRadius: 1, border: 1, borderColor: 'divider',
                  bgcolor: 'transparent', color: 'text.primary', overflow: 'hidden',
                  whiteSpace: 'nowrap', textOverflow: 'ellipsis', display: 'block',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                …{s.before}
                <Box component="span" sx={{ fontWeight: 700, color: 'primary.main' }}>{s.match}</Box>
                {s.after}…
              </Box>
            ))}
          </Box>
        ))}
      </DialogContent>
    </Dialog>
  );
}
