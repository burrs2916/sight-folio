// sight-folio: C3 写法对照工作台
// 选中平淡句 → 从语料库召回语义相近的优质句 → 逐句对照节奏/视角/细节密度差异 →
// 勾选对照组交 AI 对照改写（1-3 版、标注手法）。
// 交互范式对齐 AiFlavorPanel（Dialog + 列表 + 底部动作）与 AiCorpusPanel（corpusApi.search 召回）；
// 本地可算差异只用字符规模节奏（compareCraft），视角/细节密度交由 LLM 改写请求承担，不在前端伪造。
import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import { corpusApi } from '../../services/tauri';
import { useToastStore } from '../../store/toastStore';
import { logger } from '../../utils/logger';
import { filterReferenceHits, compareCraft, type CraftComparison } from '../../utils/craftCompare';
import type { CorpusSearchHit } from '../../services/corpus';
import { uiFontSize } from '../../theme/appearanceScales';

/** 交 AI 改写时携带的一个对照句（去重后将原文/出处给 LLM 参考，不暴露 chunkId 等内部结构） */
export interface CraftReference {
  book: string;
  chapter: string;
  content: string;
}

export interface CraftComparePanelProps {
  open: boolean;
  onClose: () => void;
  /** 源句（编辑器选中文本或 A2 问题句摘录；打开时带入编辑区） */
  source: string;
  onSourceChange: (v: string) => void;
  /** 请 AI 对照改写：携带源句 + 勾选的对照组（1-3 条即可，上限由上层提示 LLM 给 1-3 版） */
  onRequestRewrite: (payload: { original: string; references: CraftReference[] }) => void;
  labels: {
    title: string;
    hint: string;
    source: string;
    recall: string;
    recalling: string;
    empty: string;
    tempoLonger: string;
    tempoShorter: string;
    tempoSimilar: string;
    reference: string;
    rewrite: string;
  };
}

/** 打开时重置编辑区为源句 */
export function CraftComparePanel({
  open,
  onClose,
  source,
  onSourceChange,
  onRequestRewrite,
  labels,
}: CraftComparePanelProps) {
  const [hits, setHits] = useState<CorpusSearchHit[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!open) return;
    // A2/选中句变化：重置编辑区与结果，避免上一轮的对照残留误导
    setHits([]);
    setSelected(new Set());
    setSearched(false);
  }, [open, source]);

  const handleRecall = async () => {
    const q = source.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await corpusApi.search(q, null, 20, 0);
      const refs = filterReferenceHits(res.hits);
      setHits(refs);
      setSelected(new Set());
      setSearched(true);
    } catch (e) {
      logger.warn('WritingPage', 'craft compare recall failed', { error: e });
      useToastStore.getState().error(String(e));
      setSearched(true);
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  const toggle = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleRewrite = () => {
    const refs = [...selected]
      .sort((a, b) => a - b)
      .map((idx) => {
        const h = hits[idx];
        return { book: h.bookTitle, chapter: h.chapterTitle, content: h.content } satisfies CraftReference;
      });
    onRequestRewrite({ original: source.trim(), references: refs });
  };

  const canRecall = source.trim().length > 0 && !searching;
  const selectedCount = selected.size;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: uiFontSize(15), display: 'flex', alignItems: 'center', gap: 1 }}>
        <CompareArrowsRoundedIcon sx={{ fontSize: uiFontSize(18), color: 'text.secondary' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>{labels.title}</Box>
        <IconButton size="small" onClick={onClose} aria-label={t('ui.close')}>
          <CloseRoundedIcon sx={{ fontSize: uiFontSize(18) }} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 1.5, minHeight: 240, maxHeight: 480, overflowY: 'auto' }}>
        <Stack spacing={1}>
          {/* 源句编辑区 */}
          <TextField
            size="small"
            fullWidth
            multiline
            minRows={2}
            maxRows={4}
            label={labels.source}
            placeholder={labels.hint}
            value={source}
            onChange={(e) => onSourceChange(e.target.value)}
            sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) } }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              size="small"
              variant="outlined"
              color="primary"
              startIcon={
                searching ? <CircularProgress size={13} /> : <SearchRoundedIcon sx={{ fontSize: uiFontSize(15) }} />
              }
              onClick={() => void handleRecall()}
              disabled={!canRecall}
              data-testid="craft-compare-recall"
            >
              {searching ? labels.recalling : labels.recall}
            </Button>
          </Box>

          {/* 对照句列表：本地节奏徽标 + 出处 + 勾选 */}
          {searched && hits.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 5 }}>
              <AutoAwesomeRoundedIcon sx={{ fontSize: uiFontSize(30), color: 'text.disabled', mb: 1 }} />
              <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary' }}>{labels.empty}</Typography>
            </Box>
          )}
          {hits.map((h, idx) => {
            const cmp: CraftComparison = compareCraft(source, h);
            const tempoLabel =
              cmp.tempo === 'longer'
                ? labels.tempoLonger
                : cmp.tempo === 'shorter'
                  ? labels.tempoShorter
                  : labels.tempoSimilar;
            const checked = selected.has(idx);
            return (
              <Box
                key={`${h.chunkId}-${idx}`}
                onClick={() => toggle(idx)}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 0.75,
                  px: 1,
                  py: 0.75,
                  borderRadius: 1,
                  border: 1,
                  borderColor: checked ? 'primary.main' : 'divider',
                  bgcolor: checked ? 'action.selected' : 'background.paper',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
                data-testid="craft-compare-card"
              >
                <Checkbox size="small" checked={checked} sx={{ p: 0.25, mt: 0.25 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: uiFontSize(11.5), fontWeight: 700, color: 'text.secondary' }}>
                      《{h.bookTitle} · {h.chapterTitle}》
                    </Typography>
                    <Chip
                      size="small"
                      label={`${tempoLabel} ${cmp.ratio >= 0 ? '+' : ''}${cmp.ratio}%`}
                      color={cmp.tempo === 'longer' ? 'info' : cmp.tempo === 'shorter' ? 'warning' : 'default'}
                      variant="outlined"
                      sx={{ fontSize: uiFontSize(10), height: 18 }}
                    />
                  </Box>
                  <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.primary', mt: 0.25, lineHeight: 1.65 }}>
                    {h.content}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Stack>
      </DialogContent>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, px: 2, py: 1.25 }}>
        <Tooltip title={selectedCount > 0 ? `${labels.reference} ${selectedCount}` : labels.reference}>
          <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary' }}>
            {labels.reference} {selectedCount}
          </Typography>
        </Tooltip>
        <Button
          size="small"
          variant="contained"
          color="primary"
          startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: uiFontSize(15) }} />}
          disabled={selectedCount === 0}
          onClick={handleRewrite}
          data-testid="craft-compare-rewrite"
        >
          {labels.rewrite}
        </Button>
      </Box>
    </Dialog>
  );
}
