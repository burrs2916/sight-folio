// sight-folio: 情感弧线分析面板（写作方案 A3）
// 展示 analyzeEmotionArc 的段落级情感曲线：SVG 折线 + 平淡区/断层标记；
// 点击段落行回调上层将编辑器定位到对应区间；交互范式对齐 AiFlavorPanel。
import { t } from '../../i18n';
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import TouchAppRoundedIcon from '@mui/icons-material/TouchAppRounded';
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded';
import type { EmotionArcSegment, ArcEmotion } from '../../utils/emotionArc';

export interface EmotionArcPanelProps {
  open: boolean;
  onClose: () => void;
  segments: EmotionArcSegment[];
  /** 当前已定位（高亮）段的字符串 key，可为空 */
  activeKey?: string;
  onLocate: (seg: EmotionArcSegment) => void;
  labels: {
    title: string;
    empty: string;
    hint: string;
    flat: string;
    breakpoint: string;
    flatCount: string;
    breakCount: string;
    locate: string;
  };
  /** 情绪类别 → 展示名（zh/en 各自传入） */
  emotionLabels: Record<ArcEmotion, string>;
}

const EMOTION_COLORS: Record<ArcEmotion, string> = {
  joy: '#f9a825',
  sadness: '#5c6bc0',
  fear: '#8e24aa',
  anger: '#e53935',
  love: '#ec407a',
  calm: '#26a69a',
  tension: '#7c4dff',
  none: '#bdbdbd',
};

const CHART_W = 560;
const CHART_H = 96;
const PAD_B = 18;
const TOP = 8;

function segKey(s: EmotionArcSegment): string {
  return `${s.index}:${s.start}:${s.end}`;
}

export function EmotionArcPanel({
  open,
  onClose,
  segments,
  activeKey,
  onLocate,
  labels,
  emotionLabels,
}: EmotionArcPanelProps) {
  const flatCount = segments.filter((s) => s.flat).length;
  const breakCount = segments.filter((s) => s.breakpoint).length;

  // 断层红叉标记：仅在断层段落处生成 X 形 path
  const crossMarks = useMemo(() => {
    const n = segments.length;
    if (n === 0) return '';
    const step = n > 1 ? (CHART_W - 12) / (n - 1) : 0;
    return segments
      .map((s, i) => ({
        s,
        x: 6 + (n > 1 ? i * step : 0),
        y: TOP + (CHART_H - PAD_B - TOP) * (1 - (s.intensity - 1) / 4),
      }))
      .filter((p) => p.s.breakpoint)
      .map((p) => `M${p.x - 3},${p.y - 3} L${p.x + 3},${p.y + 3} M${p.x + 3},${p.y - 3} L${p.x - 3},${p.y + 3}`)
      .join(' ');
  }, [segments]);

  const polyline = useMemo(() => {
    const n = segments.length;
    if (n === 0) return '';
    const step = n > 1 ? (CHART_W - 12) / (n - 1) : 0;
    return segments
      .map((s, i) => {
        const x = 6 + (n > 1 ? i * step : 0);
        const y = TOP + (CHART_H - PAD_B - TOP) * (1 - (s.intensity - 1) / 4);
        return `${x},${y}`;
      })
      .join(' ');
  }, [segments]);

  // 平淡区：连续 flat 段画浅灰背景条带
  const flatBands = useMemo(() => {
    const n = segments.length;
    if (n === 0) return [];
    const step = n > 1 ? (CHART_W - 12) / (n - 1) : 0;
    const bands: { x: number; w: number }[] = [];
    let i = 0;
    while (i < n) {
      if (segments[i].flat) {
        const start = i;
        while (i < n && segments[i].flat) i += 1;
        const end = i - 1;
        const x0 = 6 + (n > 1 ? start * step : 0) - step / 2;
        const x1 = 6 + (n > 1 ? end * step : 0) + step / 2;
        bands.push({ x: Math.max(0, x0), w: x1 - x0 + 6 });
      } else {
        i += 1;
      }
    }
    return bands;
  }, [segments]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 1 }}>
        <ShowChartRoundedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>{labels.title}</Box>
        <IconButton size="small" onClick={onClose} aria-label={t('ui.close')}>
          <CloseRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 1.5, minHeight: 160, maxHeight: 460, overflowY: 'auto' }}>
        <Stack direction="row" spacing={0.75} sx={{ mb: 1.25, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            size="small"
            label={labels.flatCount.replace('{n}', String(flatCount))}
            color="default"
            variant="outlined"
          />
          <Chip
            size="small"
            label={labels.breakCount.replace('{n}', String(breakCount))}
            color="error"
            variant="outlined"
          />
        </Stack>
        {segments.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <ShowChartRoundedIcon sx={{ fontSize: 34, color: 'success.main', mb: 1 }} />
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{labels.empty}</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 0.5 }}>{labels.hint}</Typography>
          </Box>
        ) : (
          <>
            {/* 弧线图：灰带 = 平淡区，红叉 = 断层，折线 = 段落强度 */}
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 1.25, px: 1, pt: 1 }}>
              <svg
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                width="100%"
                height={CHART_H}
                role="img"
                aria-label={labels.title}
              >
                {flatBands.map((b, idx) => (
                  <rect
                    key={idx}
                    x={b.x}
                    y={TOP - 2}
                    width={b.w}
                    height={CHART_H - PAD_B - TOP + 4}
                    fill="#f5f5f5"
                    rx={2}
                  />
                ))}
                <line
                  x1={6}
                  y1={CHART_H - PAD_B}
                  x2={CHART_W - 6}
                  y2={CHART_H - PAD_B}
                  stroke="#bdbdbd"
                  strokeWidth={1}
                />
                <polyline
                  points={polyline}
                  fill="none"
                  stroke="#1976d2"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <path d={crossMarks} fill="none" stroke="#e53935" strokeWidth={1.6} strokeLinecap="round" />
                {/* 段落圆点（按情绪着色） */}
                {segments.map((s, i) => {
                  const n = segments.length;
                  const step = n > 1 ? (CHART_W - 12) / (n - 1) : 0;
                  const x = 6 + (n > 1 ? i * step : 0);
                  const y = TOP + (CHART_H - PAD_B - TOP) * (1 - (s.intensity - 1) / 4);
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={2.6}
                      fill={s.emotion === 'none' ? '#bdbdbd' : EMOTION_COLORS[s.emotion]}
                    />
                  );
                })}
              </svg>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 0.5, mt: 0.25 }}>
                <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>1</Typography>
                <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>5</Typography>
              </Box>
            </Box>
            <Stack spacing={0.75}>
              {segments.map((s, idx) => {
                const key = segKey(s);
                const active = key === activeKey;
                return (
                  <Box
                    key={`${key}-${idx}`}
                    data-testid="emotion-arc-seg"
                    onClick={() => onLocate(s)}
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 1,
                      px: 1,
                      py: 0.75,
                      borderRadius: 1,
                      border: 1,
                      borderColor: active ? 'primary.main' : s.breakpoint ? 'error.main' : 'divider',
                      bgcolor: active ? 'action.selected' : s.flat ? 'action.hover' : 'background.paper',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Box sx={{ width: 30, flexShrink: 0, textAlign: 'center' }}>
                      <Box
                        sx={{
                          width: 9,
                          height: 9,
                          borderRadius: '50%',
                          bgcolor: s.emotion === 'none' ? 'text.disabled' : EMOTION_COLORS[s.emotion],
                          mx: 'auto',
                          mb: 0.25,
                        }}
                      />
                      <Typography
                        sx={{ fontSize: 10, fontWeight: 700, color: s.breakpoint ? 'error.main' : 'text.secondary' }}
                      >
                        {s.intensity}
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Typography
                          sx={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: s.emotion === 'none' ? 'text.disabled' : EMOTION_COLORS[s.emotion],
                            flexShrink: 0,
                          }}
                        >
                          {emotionLabels[s.emotion]}
                        </Typography>
                        {s.breakpoint && (
                          <Typography sx={{ fontSize: 10, color: 'error.main', flexShrink: 0 }}>
                            {labels.breakpoint}
                          </Typography>
                        )}
                        {s.flat && !s.breakpoint && (
                          <Typography sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}>
                            {labels.flat}
                          </Typography>
                        )}
                      </Box>
                      <Typography
                        sx={{
                          fontSize: 12.5,
                          color: 'text.primary',
                          mt: 0.25,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.text}
                      </Typography>
                    </Box>
                    <Tooltip title={labels.locate}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLocate(s);
                        }}
                        aria-label={labels.locate}
                      >
                        <TouchAppRoundedIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                );
              })}
            </Stack>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
