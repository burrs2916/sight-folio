// 素材库面板（Writing Phase 1 · T8 前端「素材库」Tab）
//
// 嵌入创作台右抽屉第三 Tab：列出当前书（bookId）的外部素材，展示 AI 分析结果
// （人生轨迹时间线 + 创作价值 + 建议卡片），支持打开采集对话框与删除。
// 数据自管：bookId 变化或 refreshKey 递增时重新拉取；删除成功后本地移除。
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded';
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import { t } from '../../i18n';
import {
  externalCapturesApi,
  parseCaptureAnalysis,
  parseCaptureTags,
  type ExternalCapture,
  type ExternalCaptureKind,
} from '../../services/writing';
import { useToastStore } from '../../store/toastStore';
import { logger } from '../../utils/logger';

function kindLabel(kind: ExternalCaptureKind): string {
  switch (kind) {
    case 'image':
      return t('writing.captureKindImage');
    case 'note':
      return t('writing.captureKindNote');
    case 'link':
      return t('writing.captureKindLink');
    default:
      return t('writing.captureKindText');
  }
}

function kindIcon(kind: ExternalCaptureKind) {
  const sx = { fontSize: 13 };
  switch (kind) {
    case 'image':
      return <ImageRoundedIcon sx={sx} />;
    case 'note':
      return <StickyNote2RoundedIcon sx={sx} />;
    case 'link':
      return <LinkRoundedIcon sx={sx} />;
    default:
      return <TextFieldsRoundedIcon sx={sx} />;
  }
}

export interface ExternalCapturePanelProps {
  /** 归属书 id；'' = 全局素材 */
  bookId: string;
  /** 打开采集对话框（父级控制 open） */
  onOpenCapture: () => void;
  /** 递增触发重新拉取（对话框保存成功后由父级更新） */
  refreshKey: number;
}

export function ExternalCapturePanel({ bookId, onOpenCapture, refreshKey }: ExternalCapturePanelProps) {
  const [items, setItems] = useState<ExternalCapture[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    let alive = true;
    setLoading(true);
    externalCapturesApi
      .list(bookId)
      .then((rows) => {
        if (alive) setItems(rows);
      })
      .catch((e) => {
        logger.warn('ExternalCapturePanel', 'list failed', { error: e });
        if (alive) useToastStore.getState().error(t('writing.captureListFail'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [bookId, t]);

  useEffect(() => reload(), [reload, refreshKey]);

  const handleDelete = useCallback(
    async (captureId: string) => {
      setDeletingId(captureId);
      try {
        await externalCapturesApi.delete(captureId);
        setItems((prev) => prev.filter((c) => c.id !== captureId));
      } catch (e) {
        logger.warn('ExternalCapturePanel', 'delete failed', { error: e });
        useToastStore.getState().error(t('writing.captureDeleteFail'));
      } finally {
        setDeletingId(null);
      }
    },
    [t],
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1.25,
          py: 0.6,
          borderBottom: 1,
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', flex: 1, minWidth: 0 }}>
          {t('writing.capturePanelTitle')}
        </Typography>
        <Button
          size="small"
          variant="contained"
          startIcon={<AddRoundedIcon sx={{ fontSize: 14 }} />}
          onClick={onOpenCapture}
          sx={{
            fontSize: 11.5,
            minWidth: 0,
            px: 1,
            py: 0.25,
            textTransform: 'none',
            '& .MuiButton-startIcon svg': { fontSize: 14 },
          }}
        >
          {t('writing.captureAdd')}
        </Button>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1 }}>
        {loading && items.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={18} />
          </Box>
        ) : items.length === 0 ? (
          <Box sx={{ py: 2.5, px: 1, textAlign: 'center' }}>
            <AutoAwesomeRoundedIcon sx={{ fontSize: 22, color: 'text.disabled', mb: 0.5 }} />
            <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.7 }}>
              {t('writing.captureEmpty')}
            </Typography>
          </Box>
        ) : (
          items.map((c) => {
            const analysis = parseCaptureAnalysis(c.analysisJson);
            const tags = parseCaptureTags(c.tags);
            return (
              <Box
                key={c.id}
                sx={{
                  mb: 1,
                  borderRadius: 1.5,
                  border: 1,
                  borderColor: 'divider',
                  p: 1.1,
                  bgcolor: 'background.paper',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                  <Box
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                    }}
                  >
                    <Box sx={{ color: 'text.secondary', display: 'flex' }}>{kindIcon(c.kind)}</Box>
                    <Typography
                      sx={{
                        fontSize: 12,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={c.title}
                    >
                      {c.title}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    aria-label={t('writing.captureDelete')}
                    title={t('writing.captureDelete')}
                    disabled={deletingId === c.id}
                    onClick={() => void handleDelete(c.id)}
                    sx={{ color: 'text.disabled', p: 0.25 }}
                  >
                    {deletingId === c.id ? (
                      <CircularProgress size={13} />
                    ) : (
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
                    )}
                  </IconButton>
                </Box>

                {/* 人生轨迹时间线 */}
                {analysis.timeline && analysis.timeline.length > 0 && (
                  <Box sx={{ mt: 0.75 }}>
                    {analysis.timeline.map((item, i) => (
                      <Typography key={i} sx={{ fontSize: 11.5, lineHeight: 1.7, color: 'text.secondary' }}>
                        <b style={{ color: 'text.primary' }}>{item.at || '—'}</b>：{item.event}
                      </Typography>
                    ))}
                  </Box>
                )}

                {/* 创作价值 / 建议卡片 */}
                {analysis.creativeValue && (
                  <Typography sx={{ fontSize: 11.5, lineHeight: 1.7, mt: 0.5, color: 'text.secondary' }}>
                    {analysis.creativeValue}
                  </Typography>
                )}
                {analysis.suggestions && analysis.suggestions.length > 0 && (
                  <Box sx={{ mt: 0.6, display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                    {analysis.suggestions.map((s, i) => (
                      <Chip
                        key={i}
                        size="small"
                        label={s}
                        sx={{
                          fontSize: 11,
                          height: 'auto',
                          py: 0.3,
                          whiteSpace: 'normal',
                          justifyContent: 'flex-start',
                          '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.5 },
                        }}
                      />
                    ))}
                  </Box>
                )}
                {!analysis.creativeValue &&
                  (!analysis.suggestions || analysis.suggestions.length === 0) &&
                  c.extractedText && (
                    <Typography
                      sx={{
                        fontSize: 11.5,
                        lineHeight: 1.7,
                        mt: 0.5,
                        color: 'text.secondary',
                        maxHeight: 64,
                        overflow: 'hidden',
                      }}
                    >
                      {c.extractedText}
                    </Typography>
                  )}

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75, flexWrap: 'wrap' }}>
                  <Chip size="small" label={kindLabel(c.kind)} sx={{ height: 18, fontSize: 10.5 }} />
                  {tags.map((tag) => (
                    <Chip key={tag} size="small" label={tag} sx={{ height: 18, fontSize: 10.5 }} color="default" />
                  ))}
                </Box>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
