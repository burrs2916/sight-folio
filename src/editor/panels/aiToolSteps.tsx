// sight-folio: 转录内「工具步骤」渲染（对标 VS Code Copilot Agent 的 tool invocation steps）
//
// 为什么需要这个文件（Round 48 复盘结论）：
// 在 Agent / 直接改 模式下，AI 真正做的事情**不在正文里**——它读了哪些文件、搜了什么、
// 用 apply_change 改了哪一段，全部发生在工具调用里。此前面板只在 `isStreaming` 期间用一行
// 裸 Chip 显示 `名称 · 状态`，流式一结束 `loadMessages` 重刷转录，这段记录就整体消失：
//   1) 历史会话完全看不出 AI 动过什么（写盘工具是追责漏洞）；
//   2) 一行 Chip 没有入参 / 结果 / 展开，比它取代的旧 AiAgentPanel.ToolCallCard 还弱。
// VS Code 的做法是：工具步骤是转录的**一等内容**，永久留在消息里、可折叠、可点文件跳转。
// 本组件即此，并被「流式实时列表」与「历史消息回看」两处**共用**，保证两边长得一模一样。
//
// 落库格式 = `ToolCallEvent[]` 的 JSON（后端 commands/agent.rs 随助手消息写入
// `ai_messages.tool_calls`；字段名由 engine.rs 的 `rename_all = "camelCase"` 保证）。

import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
// 注意：本项目安装的 @mui/icons-material 没有 `CheckCircleOutline` / `ErrorOutline` 这两个入口
// （只有 `*Outlined` 后缀版），写成前者会直接 TS2307 编译失败。
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { t } from '../../i18n';
import { uiFontSize } from '../../theme/appearanceScales';
import { formatToolArguments } from '../../utils/toolCallDisplay';
import type { ToolCallEvent } from '../../services/tauri';

/** 单条步骤展开后结果文本的显示上限：project_context 之类工具能返回几十 KB，整段铺开会把面板顶爆 */
const RESULT_MAX_CHARS = 1200;

/**
 * 把落库的 `tool_calls` 字段解析成步骤数组。
 *
 * 容错优先：历史行是空串（Round 48 之前从没写过）、脏数据、非数组，一律当「没有轨迹」处理，
 * 绝不因为解析失败让整条消息渲染崩掉。
 */
export function parseToolTrace(raw: string | null | undefined): ToolCallEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is ToolCallEvent => !!e && typeof e === 'object' && typeof e.toolName === 'string');
  } catch {
    return [];
  }
}

/** 工具名 → 人话标签（对标 VS Code「Read file / Searched codebase」式动作描述） */
function argSummary(name: string, args: unknown): [string, string | null] {
  if (!args || typeof args !== 'object') return ['', null];
  const a = args as Record<string, unknown>;
  const str = (k: string): string | null => (typeof a[k] === 'string' && a[k] ? String(a[k]) : null);
  const num = (k: string): number | null => (typeof a[k] === 'number' ? (a[k] as number) : null);

  const path = str('file_path');
  switch (name) {
    case 'file_read': {
      const start = num('start_line');
      const end = num('end_line');
      const range = start && end ? `:${start}-${end}` : start ? `:${start}` : '';
      return path ? [`${path}${range}`, path] : ['', null];
    }
    case 'apply_change': {
      const occ = num('occurrence');
      return path ? [`${path}${occ && occ > 1 ? ` #${occ}` : ''}`, path] : ['', null];
    }
    case 'code_search': {
      const q = str('query') ?? '';
      const pattern = str('file_pattern');
      return [pattern ? `${q} · ${pattern}` : q, null];
    }
    case 'symbol_lookup':
      return [[str('name'), str('kind')].filter(Boolean).join(' · '), null];
    case 'architecture_query':
    case 'project_context':
      return [str('query_type') ?? str('section_keys') ?? '', null];
    case 'scan_records':
      return [str('analysis_id') ?? str('query_type') ?? '', null];
    case 'impact_assess':
      return [[str('target_type'), str('target')].filter(Boolean).join(' · '), null];
    case 'review_explain':
      return [str('rule_id') ?? str('finding') ?? '', null];
    case 'context_insight':
      return [[str('action'), str('title')].filter(Boolean).join(' · '), null];
    default: {
      // 未知工具：优先展示看着像路径的字段，其次第一个短字符串入参
      if (path) return [path, path];
      const first = Object.values(a).find((v) => typeof v === 'string' && v.length > 0 && v.length < 80);
      return [typeof first === 'string' ? first : '', null];
    }
  }
}

function toolLabel(name: string): string {
  const key = `workbench.aiTool.${name}`;
  const label = t(key);
  // i18n 未命中时 t() 回传 key 本身，此时退回原始工具名，别把 "workbench.aiTool.xxx" 摆给用户
  return label === key ? name : label;
}

function StepRow({ step, onOpenPath }: { step: ToolCallEvent; onOpenPath?: (relPath: string, line?: number) => void }) {
  const [open, setOpen] = useState(false);
  const [summary, jumpPath] = useMemo(() => argSummary(step.toolName, step.arguments), [step.toolName, step.arguments]);
  const argsText = useMemo(() => formatToolArguments(step.arguments), [step.arguments]);
  const running = step.status === 'running';
  const failed = step.status === 'error' || step.success === false;
  const result = step.result ?? '';
  const truncated = result.length > RESULT_MAX_CHARS;
  // 展开后才有内容可看：入参/结果任一非空
  const expandable = !!argsText || !!result;

  // 点击文件名跳转时带上起始行：AI 读的是第 120 行，跳到文件开头没意义
  const jumpLine =
    step.arguments && typeof step.arguments === 'object'
      ? (() => {
          const v = (step.arguments as Record<string, unknown>).start_line;
          return typeof v === 'number' ? v : undefined;
        })()
      : undefined;

  return (
    <Box
      sx={{
        borderLeft: 2,
        borderColor: failed ? 'error.main' : running ? 'warning.main' : 'success.main',
        pl: 0.75,
        mb: 0.25,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 20 }}>
        {running ? (
          <CircularProgress size={10} />
        ) : failed ? (
          <ErrorOutlinedIcon sx={{ fontSize: uiFontSize(13), color: 'error.main' }} />
        ) : (
          <CheckCircleOutlinedIcon sx={{ fontSize: uiFontSize(13), color: 'success.main' }} />
        )}
        <Typography
          variant="caption"
          sx={{ fontSize: uiFontSize(10), fontWeight: 600, color: 'text.primary', whiteSpace: 'nowrap' }}
        >
          {toolLabel(step.toolName)}
        </Typography>
        {summary && (
          <Typography
            variant="caption"
            onClick={jumpPath && onOpenPath ? () => onOpenPath(jumpPath, jumpLine) : undefined}
            sx={{
              fontSize: uiFontSize(10),
              fontFamily: 'monospace',
              color: jumpPath && onOpenPath ? 'primary.main' : 'text.secondary',
              cursor: jumpPath && onOpenPath ? 'pointer' : 'default',
              textDecoration: jumpPath && onOpenPath ? 'underline dotted' : 'none',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={summary}
          >
            {summary}
          </Typography>
        )}
        {!summary && <Box sx={{ flex: 1 }} />}
        {jumpPath && onOpenPath && (
          <Tooltip title={t('workbench.aiToolStep.open')}>
            <IconButton
              size="small"
              sx={{ p: 0.1 }}
              onClick={() => onOpenPath(jumpPath, jumpLine)}
              aria-label={t('workbench.aiToolStep.open')}
            >
              <OpenInNewIcon sx={{ fontSize: uiFontSize(12) }} />
            </IconButton>
          </Tooltip>
        )}
        {expandable && (
          <Tooltip title={open ? t('workbench.aiToolStep.collapse') : t('workbench.aiToolStep.expand')}>
            <IconButton
              size="small"
              sx={{ p: 0.1 }}
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? t('workbench.aiToolStep.collapse') : t('workbench.aiToolStep.expand')}
            >
              {open ? (
                <ExpandLessIcon sx={{ fontSize: uiFontSize(13) }} />
              ) : (
                <ExpandMoreIcon sx={{ fontSize: uiFontSize(13) }} />
              )}
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {open && (
        <Box sx={{ pb: 0.5 }}>
          {argsText && (
            <>
              <Typography
                variant="caption"
                sx={{ display: 'block', fontSize: uiFontSize(10), color: 'text.secondary', mt: 0.25 }}
              >
                {t('workbench.aiToolStep.args')}
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  fontSize: uiFontSize(10.5),
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 120,
                  overflow: 'auto',
                  color: 'text.primary',
                }}
              >
                {argsText}
              </Box>
            </>
          )}
          {result && (
            <>
              <Typography
                variant="caption"
                sx={{ display: 'block', fontSize: uiFontSize(10), color: 'text.secondary', mt: 0.25 }}
              >
                {t('workbench.aiToolStep.result')}
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  fontSize: uiFontSize(10.5),
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 160,
                  overflow: 'auto',
                  color: failed ? 'error.main' : 'text.primary',
                }}
              >
                {truncated ? `${result.slice(0, RESULT_MAX_CHARS)}\n…` : result}
              </Box>
              {truncated && (
                <Typography
                  variant="caption"
                  sx={{ display: 'block', fontSize: uiFontSize(10), color: 'text.secondary' }}
                >
                  {t('workbench.aiToolStep.truncated', { n: result.length })}
                </Typography>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

export interface ToolStepListProps {
  steps: ToolCallEvent[];
  /** 点击工具涉及的文件名时打开它（历史回看的关键：AI 改的往往不是当前标签） */
  onOpenPath?: (relPath: string, line?: number) => void;
  /** 步骤数超过该值时整组默认折叠，只留一行汇总（长 Agent 轨迹不至于把转录挤爆） */
  collapseOver?: number;
}

/**
 * 工具步骤列表。流式实时轨迹与历史消息轨迹共用同一渲染，避免两处长得不一样。
 */
export function ToolStepList({ steps, onOpenPath, collapseOver = 4 }: ToolStepListProps) {
  const shouldCollapse = steps.length > collapseOver;
  const [expanded, setExpanded] = useState(false);
  if (steps.length === 0) return null;

  const failedCount = steps.filter((s) => s.status === 'error' || s.success === false).length;
  const showAll = !shouldCollapse || expanded;

  return (
    <Box sx={{ mb: 0.5 }}>
      {shouldCollapse && (
        <Box
          onClick={() => setExpanded((v) => !v)}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', py: 0.25 }}
        >
          {expanded ? (
            <ExpandLessIcon sx={{ fontSize: uiFontSize(13) }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: uiFontSize(13) }} />
          )}
          <Typography
            variant="caption"
            sx={{ fontSize: uiFontSize(10), color: failedCount > 0 ? 'error.main' : 'text.secondary' }}
          >
            {failedCount > 0
              ? t('workbench.aiToolStep.summaryWithError', { n: steps.length, e: failedCount })
              : t('workbench.aiToolStep.summary', { n: steps.length })}
          </Typography>
        </Box>
      )}
      {showAll && steps.map((s, i) => <StepRow key={`${s.toolName}-${i}`} step={s} onOpenPath={onOpenPath} />)}
    </Box>
  );
}
