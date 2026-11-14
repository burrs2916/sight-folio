// 素材库面板（Writing Phase 1 · T8 前端「素材库」Tab）
//
// 嵌入创作台右抽屉第三 Tab：列出当前书（bookId）的外部素材，展示 AI 分析结果
// （人生轨迹时间线 + 创作价值 + 建议卡片），支持打开采集对话框、重新分析与**插入正文**。
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
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import { t } from '../../i18n';
import { L } from '../../ai/aiLang';
import {
  externalCapturesApi,
  parseCaptureAnalysis,
  parseCaptureTags,
  type ExternalCapture,
  type ExternalCaptureKind,
} from '../../services/writing';
import type { AiAgent } from '../../services/agent';
import {
  buildCaptureAnalysisMessage,
  normalizeCaptureAnalysis,
  runCaptureTask,
  tryParseCaptureJson,
} from '../../ai/writingCapture';
import { useToastStore } from '../../store/toastStore';
import { useWritingStore } from '../../store/writingStore';
import { buildCaptureInsertText, type CaptureInsertAnalysis, type CaptureInsertPart } from './captureInsert';
import { logger } from '../../utils/logger';
import { uiFontSize } from '../../theme/appearanceScales';

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
  const sx = { fontSize: uiFontSize(13) };
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
  /** 素材分析复用写作台 AI agent（与采集对话框同一 chatAgentId / agents） */
  agentId: string;
  agents: AiAgent[];
  /**
   * 插入正文回调（由 WritingPage 注入，与灵感扩写同一链路：插入后自动定位并选中）。
   * 缺省时不渲染「插入正文」入口——素材库此前只能采集/分析/删除，
   * 采到的素材要进正文只能手抄，是 素材→正文 闭环的最后一道断口。
   */
  onInsertText?: (text: string) => void;
}

export function ExternalCapturePanel({
  bookId,
  onOpenCapture,
  refreshKey,
  agentId,
  agents,
  onInsertText,
}: ExternalCapturePanelProps) {
  const [items, setItems] = useState<ExternalCapture[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 正在重新分析的素材 id（一次只允许一条；runCaptureTask 内建全局并发闸门兜底别处发起的流）
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);
  // 「插入正文」菜单锚点（null = 未展开）：一次只开一张卡的菜单，菜单项按该卡可得的口径渲染
  const [insertMenu, setInsertMenu] = useState<{ id: string; el: HTMLElement } | null>(null);

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

  /**
   * 插入正文：取该卡当前分析产物按用户选定的口径组装，插入即关闭菜单。
   * 与灵感/语料同一落正文链路（WritingPage 侧 handleInspirationInsert：插入后定位并高亮）。
   */
  const handleInsert = useCallback(
    (c: ExternalCapture, analysis: CaptureInsertAnalysis, part: CaptureInsertPart) => {
      setInsertMenu(null);
      // 没回调就没有插入动作，绝不能弹「已插入正文」（假成功——与左栏切书假成功同一类病灶）
      if (!onInsertText) return;
      const text = buildCaptureInsertText(part, c, analysis);
      if (!text) {
        useToastStore.getState().warning(t('writing.captureInsertEmpty'));
        return;
      }
      onInsertText(text);
      useToastStore.getState().success(t('writing.captureInserted'));
    },
    [onInsertText],
  );

  // 就地「重新分析」：复用采集对话框同款分析流水线（runCaptureTask→tryParse→normalize），
  // 成功后以同一 id upsert 落库（save 为 upsert 语义），失败/中断一律保留旧结果、绝不抹掉。
  // 补齐素材库此前只有「新建 / 删除」的缺口——分析失败或想换 agent 重跑不必删了重建。
  const handleReanalyze = useCallback(
    async (c: ExternalCapture) => {
      if (!agentId || agents.length === 0) {
        useToastStore.getState().warning(t('writing.aiGoConfigure'));
        return;
      }
      if (reanalyzingId) return;
      setReanalyzingId(c.id);
      try {
        const res = await runCaptureTask({
          agentId,
          title: L('素材分析 · ', 'Capture Analysis · ') + (c.title || c.id),
          message: buildCaptureAnalysisMessage({
            kind: c.kind,
            title: c.title,
            sourceRaw: c.sourceRaw,
            extractedText: c.extractedText,
            // ㉟ AI-5（轮 12）：素材「被谁使用」按体裁（本书面板天然按 bookId 现读）
            genre: useWritingStore.getState().books.find((b) => b.id === bookId)?.genre ?? '',
          }),
          onDelta: () => undefined,
        });
        if (res.interrupted) return; // 手动停止：保留旧分析结果
        const parsed = tryParseCaptureJson(res.text);
        if (!parsed) {
          // 模型输出非合法 JSON：不动旧结果，仅提示（与采集对话框同口径）
          useToastStore.getState().warning(t('writing.captureBadAnalysis'));
          return;
        }
        const next: ExternalCapture = {
          ...c,
          analysisJson: JSON.stringify(normalizeCaptureAnalysis(parsed)),
          updatedAt: Math.floor(Date.now() / 1000),
        };
        await externalCapturesApi.save(next);
        setItems((prev) => prev.map((x) => (x.id === next.id ? next : x)));
        useToastStore.getState().success(t('writing.captureReanalyzed'));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('ExternalCapturePanel', 'reanalyze failed', { error: e });
        useToastStore.getState().error(t('writing.captureAnalyzeFail', { msg }));
      } finally {
        setReanalyzingId(null);
      }
    },
    [agentId, agents.length, reanalyzingId, bookId, t],
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
        <Typography sx={{ fontSize: uiFontSize(11), fontWeight: 600, color: 'text.secondary', flex: 1, minWidth: 0 }}>
          {t('writing.capturePanelTitle')}
        </Typography>
        <Button
          size="small"
          variant="contained"
          startIcon={<AddRoundedIcon sx={{ fontSize: uiFontSize(14) }} />}
          onClick={onOpenCapture}
          sx={{
            fontSize: uiFontSize(11.5),
            minWidth: 0,
            px: 1,
            py: 0.25,
            textTransform: 'none',
            '& .MuiButton-startIcon svg': { fontSize: uiFontSize(14) },
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
            <AutoAwesomeRoundedIcon sx={{ fontSize: uiFontSize(22), color: 'text.disabled', mb: 0.5 }} />
            <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', lineHeight: 1.7 }}>
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
                        fontSize: uiFontSize(12),
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
                  {/* 「插入正文」：素材→正文闭环入口。口径由用户选（原文 / AI 创作价值 / AI 建议），
                      不替作者拍板——三者都可能正是要进正文的东西。仅在传入 onInsertText 时渲染。 */}
                  {onInsertText && (
                    <>
                      <IconButton
                        size="small"
                        aria-label={t('writing.captureInsert')}
                        title={t('writing.captureInsert')}
                        onClick={(e) => setInsertMenu({ id: c.id, el: e.currentTarget })}
                        sx={{ color: 'text.disabled', p: 0.25, '&:hover': { color: 'primary.main' } }}
                        data-testid={`capture-insert-${c.id}`}
                      >
                        <MoreVertRoundedIcon sx={{ fontSize: uiFontSize(15) }} />
                      </IconButton>
                      <Menu
                        open={insertMenu?.id === c.id}
                        anchorEl={insertMenu?.el ?? null}
                        onClose={() => setInsertMenu(null)}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                      >
                        {(
                          [
                            ['raw', 'writing.captureInsertRaw'],
                            ['value', 'writing.captureInsertValue'],
                            ['suggestions', 'writing.captureInsertSuggest'],
                          ] as Array<[CaptureInsertPart, string]>
                        ).map(([part, key]) => (
                          <MenuItem
                            key={part}
                            disabled={buildCaptureInsertText(part, c, analysis) === null}
                            onClick={() => handleInsert(c, analysis, part)}
                            data-testid={`capture-insert-${part}`}
                          >
                            <ListItemText sx={{ '&': { fontSize: uiFontSize(12.5) } }}>{t(key)}</ListItemText>
                          </MenuItem>
                        ))}
                      </Menu>
                    </>
                  )}
                  {/* 「重新分析」：补齐素材库此前只有新建/删除的缺口。有 extractedText 才有分析意义。 */}
                  {c.extractedText.trim() && (
                    <IconButton
                      size="small"
                      aria-label={t('writing.captureReanalyze')}
                      title={t('writing.captureReanalyze')}
                      disabled={Boolean(reanalyzingId)}
                      onClick={() => void handleReanalyze(c)}
                      sx={{ color: 'text.disabled', p: 0.25, '&:hover': { color: 'primary.main' } }}
                      data-testid={`capture-reanalyze-${c.id}`}
                    >
                      {reanalyzingId === c.id ? (
                        <CircularProgress size={13} />
                      ) : (
                        <RefreshRoundedIcon sx={{ fontSize: uiFontSize(15) }} />
                      )}
                    </IconButton>
                  )}
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
                      <DeleteOutlineRoundedIcon sx={{ fontSize: uiFontSize(15) }} />
                    )}
                  </IconButton>
                </Box>

                {/* 人生轨迹时间线 */}
                {analysis.timeline && analysis.timeline.length > 0 && (
                  <Box sx={{ mt: 0.75 }}>
                    {analysis.timeline.map((item, i) => (
                      <Typography key={i} sx={{ fontSize: uiFontSize(11.5), lineHeight: 1.7, color: 'text.secondary' }}>
                        <b style={{ color: 'text.primary' }}>{item.at || '—'}</b>：{item.event}
                      </Typography>
                    ))}
                  </Box>
                )}

                {/* 创作价值 / 建议卡片 */}
                {analysis.creativeValue && (
                  <Typography sx={{ fontSize: uiFontSize(11.5), lineHeight: 1.7, mt: 0.5, color: 'text.secondary' }}>
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
                          fontSize: uiFontSize(11),
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
                        fontSize: uiFontSize(11.5),
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
                  <Chip size="small" label={kindLabel(c.kind)} sx={{ height: 18, fontSize: uiFontSize(10.5) }} />
                  {tags.map((tag) => (
                    <Chip
                      key={tag}
                      size="small"
                      label={tag}
                      sx={{ height: 18, fontSize: uiFontSize(10.5) }}
                      color="default"
                    />
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
