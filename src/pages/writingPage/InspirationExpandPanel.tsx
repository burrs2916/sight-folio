// 写作台灵感扩写面板（O7）：灵感念头池 → AI 扩写成段落/场景 → 一键插入正文
//
// 设计要点（对应上一轮《AI 语料与写作辅助优化评估报告》O7）：
// - 数据源：灵感念头池 = looseBeats（未落章节拍，与 INSPIRATION_KEY/buildInspirationCorpus 同源），
//   面板只读展示，扩写动作不改念头本身，零新数据模型。
// - 会话策略：per (agentId, 书) 复用同名会话「灵感扩写 · 书名」——与 AiCorpusPanel 同一策略
//   （find 同名最新 → 没有才 create；历史消息直读 agentApi.listMessages，不碰 store.messages）。
// - 每次扩写请求自包含人设 HINT + 整篇/本章上下文 + 扩写指令，不依赖会话历史——
//   换念头/换参数立即生效，扩写批次之间互不污染；「版本数」轻参数 1–3。
// - 输出协议：AI 回复中「>>> 标题行 + 多段正文」由 extractInspirationVersions 切成候选版本，
//   每版本一张卡片带「插入正文」→ onInsertText（复用 handleCorpusInsert → textToParagraphHtml）；
//   本组件不碰编辑器。
// - 流式：订阅 store.streamingContent（isStreaming 并发闸门），停止走 requestInterrupt（全局先例）。
// - 零新增后端：会话、流式、agent 体系全部复用 agentApi / agentStore。
import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { alpha } from '@mui/material/styles';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import PsychologyRoundedIcon from '@mui/icons-material/PsychologyRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import { agentApi, type AiMessage } from '../../services/tauri';
import type { WritingOutline, WritingSetting } from '../../services/writing';
import { parseBeatExtra } from '../../utils/writingOutline';
import {
  INSPIRATION_EXPAND_MAX_VERSIONS,
  INSPIRATION_EXPAND_SYSTEM_HINT,
  buildInspirationExpandPrompt,
  extractInspirationVersions,
  type InspirationExpandVersion,
} from '../../utils/inspirationExpand';
import { useAgentStore } from '../../store/agentStore';
import { useToastStore } from '../../store/toastStore';
import { t } from '../../i18n';
import { logger } from '../../utils/logger';
import { uiFontSize } from '../../theme/appearanceScales';

export interface InspirationExpandPanelProps {
  open: boolean;
  onClose: () => void;
  /** 灵感念头池（looseBeats 未落章节拍；父级从 writingStore.outlines 派生） */
  beats: WritingOutline[];
  /** 当前书设定（人物/场景），用于把念头 extra 挂载 id 解析成名字展示给 AI */
  settings: WritingSetting[];
  /** 会话标题（per 书唯一：「灵感扩写 · 书名」） */
  chatTitle: string;
  /** 每次扩写自动注入的写作上下文（整篇 + 当前章节，L() 双语） */
  buildContextBlock: () => string;
  /** 插入正文回调（复用 handleCorpusInsert，闭环与语料库/AI 语料一致） */
  onInsertText: (text: string) => void;
  /** 打开时预选的念头 id（跨视图从 L2 灵感卡发起扩写时传入）；未指定则沿用默认第一条 */
  initialBeatId?: string | null;
  /** 预选已生效（消费一次）后的通知，父级据此清空避免重复触发 */
  onInitialBeatConsumed?: () => void;
  agentId: string;
  onAgentChange: (agentId: string) => void;
  /** 未配置任何 agent 时的「去配置」出口 */
  onOpenSettings: () => void;
}

/** 版本数档位（与引擎 INSPIRATION_EXPAND_MAX_VERSIONS 收敛一致） */
const COUNT_STEPS = [1, 2, 3] as const;

export function InspirationExpandPanel({
  open,
  onClose,
  beats,
  settings,
  chatTitle,
  buildContextBlock,
  onInsertText,
  initialBeatId,
  onInitialBeatConsumed,
  agentId,
  onAgentChange,
  onOpenSettings,
}: InspirationExpandPanelProps) {
  const agents = useAgentStore((s) => s.agents);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const currentStreamConversationId = useAgentStore((s) => s.currentStreamConversationId);
  const lastStreamError = useAgentStore((s) => s.lastStreamError);
  const stoppedConversationId = useAgentStore((s) => s.stoppedConversationId);
  const loadAgents = useAgentStore((s) => s.loadAgents);

  // 选中的念头；切换念头时清空上一轮扩写结果（避免串台显示）
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [versions, setVersions] = useState<InspirationExpandVersion[]>([]);
  const [genAttempted, setGenAttempted] = useState(false);
  const [count, setCount] = useState<number>(2);
  const lastSendRef = useRef<{ input: ReturnType<typeof buildInspirationExpandPrompt> | null } | null>(null);

  const selectedBeat = beats.find((b) => b.id === selectedBeatId) ?? null;

  // 挂载/打开时刷新 agent 列表；打开时若未选中念头且池非空，默认选中第一条
  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);
  useEffect(() => {
    if (open && !selectedBeatId && beats.length > 0) setSelectedBeatId(beats[0].id);
    if (open) {
      setVersions([]);
      setGenAttempted(false);
      setStreamText('');
    }
  }, [open, beats, selectedBeatId]);
  // 跨视图预选：打开且指定 initialBeatId 且念头池已就绪 → 覆盖默认选择为指定念头，
  // 生效即通知父级清空（消费一次），避免面板关闭再打开时旧预选残留。
  useEffect(() => {
    if (!open || !initialBeatId || selectedBeatId === initialBeatId) return;
    if (beats.some((b) => b.id === initialBeatId)) {
      setSelectedBeatId(initialBeatId);
      setVersions([]);
      setGenAttempted(false);
      onInitialBeatConsumed?.();
    }
  }, [open, initialBeatId, beats, selectedBeatId, onInitialBeatConsumed]);

  // 流式订阅：面板挂载期间常驻（isStreaming 才渲染原文，避免残留文本误显）
  useEffect(() => {
    return useAgentStore.subscribe((s) => setStreamText(s.streamingContent));
  }, []);

  // 挂载（或切 agent / 标题）→ 复用同名会话；直读 API 存本地，不碰 store.messages
  useEffect(() => {
    if (!agentId || !open) return;
    let cancelled = false;
    setLoading(true);
    setStreamText('');
    (async () => {
      try {
        const convs = await agentApi.listConversations(agentId);
        const mine = convs.filter((c) => c.title === chatTitle).sort((a, b) => b.updatedAt - a.updatedAt);
        const conv = mine[0] ?? (await agentApi.createConversation(agentId, chatTitle));
        if (cancelled) return;
        setConvId(conv.id);
      } catch (e) {
        logger.warn('InspirationExpandPanel', 'open failed', { error: e });
        useToastStore.getState().error(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, chatTitle, open]);

  const noAgent = agents.length === 0;
  /** 最新一轮流式是否属于本面板会话（防别处流串台） */
  const isOwnStreaming = isStreaming && currentStreamConversationId === convId;

  /** 把念头 extra 中挂载的设定 id 解析成名字（人物/场景，供 AI 扩写素材与 UI 展示） */
  const resolvedNames = useCallback(
    (beat: WritingOutline) => {
      const settingById = new Map(settings.map((s) => [s.id, s.name]));
      const ex = parseBeatExtra(beat.extra);
      return {
        castNames: (ex.cast ?? []).map((id) => settingById.get(id) ?? '').filter(Boolean),
        sceneNames: (ex.scenes ?? []).map((id) => settingById.get(id) ?? '').filter(Boolean),
      };
    },
    [settings],
  );

  /** 组装扩写指令并发送；结果解析为版本卡片 */
  const handleExpand = useCallback(async () => {
    if (!convId || isStreaming || !selectedBeat) return;
    setGenAttempted(true);
    setVersions([]);
    const { castNames, sceneNames } = resolvedNames(selectedBeat);
    const instruction = buildInspirationExpandPrompt({
      title: selectedBeat.title,
      summary: selectedBeat.summary,
      castNames,
      sceneNames,
      count,
    });
    // 扩写请求自包含：每次带最新 HINT + 上下文 + 指令，不依赖会话历史——
    // 换念头/换参数立即生效，扩写批次之间互不污染
    const content = `${INSPIRATION_EXPAND_SYSTEM_HINT}\n\n${buildContextBlock()}\n\n---\n\n${instruction}`;
    lastSendRef.current = { input: instruction };
    try {
      // 直读 API 建会话不进 store.conversations、写作台窗口不设置 selectedAgentId——
      // 必须显式传 agentId，否则 store 无法推导 agent 归属会放弃发送
      await useAgentStore.getState().sendMessage(convId, content, undefined, undefined, agentId);
      const rows = await agentApi.listMessages(convId);
      setStreamText('');
      // 若本轮被停止（手动 / 超时兜底）：后端只保留半截回复，不固化为版本（防止把半截内容插入正文）
      if (useAgentStore.getState().stoppedConversationId === convId) return;
      const lastAssistant = [...rows].reverse().find((m): m is AiMessage => m.role === 'assistant');
      if (lastAssistant) setVersions(extractInspirationVersions(lastAssistant.content));
    } catch (e) {
      logger.warn('InspirationExpandPanel', 'expand failed', { error: e });
      useToastStore.getState().error(String(e));
    }
  }, [convId, isStreaming, selectedBeat, resolvedNames, count, buildContextBlock, agentId]);

  /** 换一批：相同参数重跑一次扩写 */
  const handleRegenerate = useCallback(() => {
    void handleExpand();
  }, [handleExpand]);

  // 流式期间渲染「扩写原文」预览（让用户看到过程），完成后切到版本卡片
  const showStreamPreview = isOwnStreaming && streamText.length > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: uiFontSize(15), display: 'flex', alignItems: 'center', gap: 1 }}>
        <PsychologyRoundedIcon sx={{ fontSize: uiFontSize(18), color: 'text.secondary' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>{t('writing.inspirationExpandTitle')}</Box>
        {!noAgent && (
          <Select
            size="small"
            value={agentId || ''}
            onChange={(e) => onAgentChange(e.target.value)}
            displayEmpty
            disabled={isStreaming}
            sx={{ height: 26, '& .MuiSelect-select': { py: 0, fontSize: uiFontSize(12) } }}
            data-testid="inspiration-expand-agent"
          >
            {!agentId && (
              <MenuItem value="" sx={{ fontSize: uiFontSize(12) }}>
                {t('writing.aiAgent')}
              </MenuItem>
            )}
            {agents.map((a) => (
              <MenuItem key={a.id} value={a.id} sx={{ fontSize: uiFontSize(12) }}>
                {a.name}
              </MenuItem>
            ))}
          </Select>
        )}
        <Box sx={{ flexShrink: 0, ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {isOwnStreaming && (
            <Tooltip title={t('writing.aiChatStop')}>
              <IconButton size="small" color="error" onClick={() => useAgentStore.getState().requestInterrupt()}>
                <StopRoundedIcon sx={{ fontSize: uiFontSize(18) }} />
              </IconButton>
            </Tooltip>
          )}
          <IconButton size="small" onClick={onClose} aria-label={t('ui.close')}>
            <CloseRoundedIcon sx={{ fontSize: uiFontSize(18) }} />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 1.5, minHeight: 340 }}>
        {/* 无 agent：给「去配置」出口（对齐 AiCorpusPanel 引导） */}
        {noAgent ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, px: 2, py: 6 }}>
            <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary', textAlign: 'center' }}>
              {t('writing.inspirationExpandNoAgent')}
            </Typography>
            <Button size="small" variant="outlined" onClick={onOpenSettings}>
              {t('writing.aiGoConfigure')}
            </Button>
          </Box>
        ) : loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={22} />
          </Box>
        ) : beats.length === 0 ? (
          // 念头池空：引导先去灵念头池记一条（与灵感工作台口径一致：looseBeats）
          <Box sx={{ textAlign: 'center', py: 7 }}>
            <PsychologyRoundedIcon sx={{ fontSize: uiFontSize(34), color: 'text.disabled', mb: 1 }} />
            <Typography sx={{ fontSize: uiFontSize(13), color: 'text.secondary' }}>
              {t('writing.inspirationExpandEmpty')}
            </Typography>
            <Typography sx={{ fontSize: uiFontSize(11), color: 'text.disabled', mt: 0.5 }}>
              {t('writing.inspirationExpandEmptyHint')}
            </Typography>
          </Box>
        ) : (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ height: '100%', minHeight: 300 }}>
            {/* 左：念头池列表（未落章节拍） */}
            <Box
              sx={{
                width: { xs: '100%', sm: 240 },
                flexShrink: 0,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                overflowY: 'auto',
                maxHeight: 380,
              }}
            >
              {beats.map((b) => {
                const { castNames, sceneNames } = resolvedNames(b);
                return (
                  <Box
                    key={b.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedBeatId(b.id);
                      setVersions([]);
                      setGenAttempted(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedBeatId(b.id);
                    }}
                    sx={{
                      px: 1,
                      py: 0.75,
                      cursor: 'pointer',
                      borderBottom: 1,
                      borderColor: 'divider',
                      bgcolor: b.id === selectedBeatId ? (th) => alpha(th.palette.primary.main, 0.08) : 'transparent',
                      '&:hover': { bgcolor: (th) => alpha(th.palette.primary.main, 0.05) },
                    }}
                    data-testid="inspiration-expand-beat"
                  >
                    <Typography
                      sx={{
                        fontSize: uiFontSize(12.5),
                        fontWeight: b.id === selectedBeatId ? 700 : 500,
                        lineHeight: 1.4,
                      }}
                    >
                      {b.title || t('writing.inspirationExpandUntitled')}
                    </Typography>
                    {b.summary && (
                      <Typography
                        sx={{
                          fontSize: uiFontSize(11),
                          color: 'text.secondary',
                          mt: 0.25,
                          lineHeight: 1.5,
                          display: '-webkit-box',
                          overflow: 'hidden',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {b.summary}
                      </Typography>
                    )}
                    {(castNames.length > 0 || sceneNames.length > 0) && (
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                        {castNames.slice(0, 2).map((n) => (
                          <Chip
                            key={`c-${n}`}
                            size="small"
                            label={n}
                            variant="outlined"
                            sx={{ height: 17, fontSize: uiFontSize(10) }}
                          />
                        ))}
                        {sceneNames.slice(0, 2).map((n) => (
                          <Chip
                            key={`s-${n}`}
                            size="small"
                            label={n}
                            variant="outlined"
                            color="info"
                            sx={{ height: 17, fontSize: uiFontSize(10) }}
                          />
                        ))}
                      </Stack>
                    )}
                  </Box>
                );
              })}
            </Box>

            {/* 右：选中念头 + 扩写结果 */}
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 320 }}>
              {!selectedBeat ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                  <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary' }}>
                    {t('writing.inspirationExpandPickOne')}
                  </Typography>
                </Box>
              ) : (
                <>
                  <Box sx={{ px: 0.5, pb: 1 }}>
                    <Typography sx={{ fontSize: uiFontSize(13.5), fontWeight: 700 }}>
                      {selectedBeat.title || t('writing.inspirationExpandUntitled')}
                    </Typography>
                    {selectedBeat.summary && (
                      <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mt: 0.25, lineHeight: 1.6 }}>
                        {selectedBeat.summary}
                      </Typography>
                    )}
                    {/* 扩写控制条：版本数 + 扩写/换一批 */}
                    <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
                      <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', flexShrink: 0 }}>
                        {t('writing.inspirationExpandCount')}
                      </Typography>
                      <Select
                        size="small"
                        value={count}
                        onChange={(e) => setCount(Number(e.target.value))}
                        disabled={isStreaming}
                        sx={{ height: 26, '& .MuiSelect-select': { py: 0, fontSize: uiFontSize(12) } }}
                        data-testid="inspiration-expand-count"
                      >
                        {COUNT_STEPS.map((c) => (
                          <MenuItem key={c} value={c} sx={{ fontSize: uiFontSize(12) }}>
                            {c}
                          </MenuItem>
                        ))}
                      </Select>
                      {isOwnStreaming ? (
                        <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary' }}>
                          {t('writing.inspirationExpandRunning')}
                        </Typography>
                      ) : genAttempted ? (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<ReplayRoundedIcon sx={{ fontSize: uiFontSize(15) }} />}
                          onClick={() => void handleRegenerate()}
                          sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}
                          data-testid="inspiration-expand-regenerate"
                        >
                          {t('writing.inspirationExpandRegenerate')}
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<AutoAwesomeRoundedIcon sx={{ fontSize: uiFontSize(15) }} />}
                          onClick={() => void handleExpand()}
                          sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}
                          data-testid="inspiration-expand-run"
                        >
                          {t('writing.inspirationExpandRun')}
                        </Button>
                      )}
                    </Stack>
                  </Box>

                  {/* 流错误 / 停止回执（错误优先于停止，对齐 AiCorpusPanel） */}
                  {!isStreaming && !loading && lastStreamError && currentStreamConversationId === convId && (
                    <Box sx={{ px: 0.5, py: 0.5 }}>
                      <Alert
                        severity="error"
                        variant="outlined"
                        sx={{ fontSize: uiFontSize(12), '& .MuiAlert-message': { py: 0.25 } }}
                      >
                        {lastStreamError === 'timeout' ? t('writing.aiTimeout') : lastStreamError}
                      </Alert>
                    </Box>
                  )}
                  {!isStreaming && !loading && !lastStreamError && stoppedConversationId === convId && (
                    <Box sx={{ px: 0.5, py: 0.5 }}>
                      <Chip
                        size="small"
                        icon={<StopRoundedIcon sx={{ fontSize: uiFontSize(12) }} />}
                        label={t('writing.aiStopped')}
                        color="error"
                        variant="outlined"
                        sx={{ fontSize: uiFontSize(10.5), height: 20 }}
                      />
                    </Box>
                  )}

                  {/* 扩写结果区 */}
                  <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 0.5, py: 0.5 }}>
                    {showStreamPreview && (
                      <Typography
                        sx={{
                          fontSize: uiFontSize(12.5),
                          lineHeight: 1.7,
                          whiteSpace: 'pre-wrap',
                          color: 'text.secondary',
                        }}
                      >
                        {streamText}
                      </Typography>
                    )}
                    {!isOwnStreaming && genAttempted && versions.length === 0 && (
                      <Box sx={{ textAlign: 'center', py: 5 }}>
                        <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary' }}>
                          {t('writing.inspirationExpandNone')}
                        </Typography>
                      </Box>
                    )}
                    {!isOwnStreaming &&
                      versions.map((v, i) => (
                        <Box
                          key={`${v.title}-${i}`}
                          sx={{
                            mb: 0.75,
                            px: 1,
                            py: 0.75,
                            borderRadius: 1,
                            bgcolor: (th) => alpha(th.palette.primary.main, 0.06),
                            border: 1,
                            borderColor: 'divider',
                          }}
                          data-testid="inspiration-expand-version"
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                            <Chip
                              size="small"
                              label={v.title}
                              color="primary"
                              variant="outlined"
                              sx={{ height: 19, fontSize: uiFontSize(11) }}
                            />
                            <Box sx={{ flex: 1 }} />
                            <Button
                              size="small"
                              variant="contained"
                              sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: uiFontSize(12), textTransform: 'none' }}
                              onClick={() => onInsertText(v.body)}
                              data-testid={`inspiration-expand-insert-${i}`}
                            >
                              {t('writing.corpusInsert')}
                            </Button>
                          </Box>
                          <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                            {v.body}
                          </Typography>
                        </Box>
                      ))}
                  </Box>
                </>
              )}
            </Box>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
