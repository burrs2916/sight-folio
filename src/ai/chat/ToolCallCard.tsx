// sight-folio: AI 对话页工具调用状态卡片
//
// 从 AiAgentPage 内联实现提取为独立组件，并升级：
// - 结果/参数区 JSON 语法高亮（复用 codeHighlight，lang=json）
// - running 状态：标题旁转圈动画 + 整体边框高亮；error 状态错误色边框
// - 展开/收起保留，行数与体积提示
import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import BuildIcon from '@mui/icons-material/Build';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTheme } from '@mui/material/styles';
import { formatToolArguments, toolStatusColor, toolStatusLabel, toolDisplayName } from '../../utils/toolCallDisplay';
import { highlightCode } from '../../editor/panels/codeHighlight';
import { t } from '../../i18n';
import type { ToolCallEvent } from '../../services/tauri';

function StatusMeta({ status }: { status: ToolCallEvent['status'] }) {
  return (
    <Chip
      label={toolStatusLabel(status)}
      color={toolStatusColor(status)}
      size="small"
      sx={{ height: 20, fontSize: 11 }}
    />
  );
}

/** 只读 JSON 视图：语法高亮，超出限制折叠 */
function JsonView({ text, maxHeight = 220 }: { text: string; maxHeight?: number }) {
  const dark = useTheme().palette.mode === 'dark';
  const highlighted = React.useMemo(() => highlightCode(text, 'json', dark), [text, dark]);
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        fontSize: 11.5,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        fontFamily: 'monospace',
        maxHeight,
        overflow: 'auto',
        color: 'text.primary',
      }}
    >
      {highlighted}
    </Box>
  );
}

export interface ToolCallCardProps {
  toolCall: ToolCallEvent;
}

/**
 * 工具调用卡片：标题行（工具名 + 状态 + 展开箭头）与展开详情（参数 / 结果）。
 * 单次调用两次推送（running 带参数、done/error 带结果）由上游 mergeToolCallEvent 合并，
 * 本组件只负责把合并后的记录渲染成一张可折叠卡片。
 */
export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const argsText = formatToolArguments(toolCall.arguments);
  const running = toolCall.status === 'running';
  const failed = toolCall.status === 'error' || toolCall.status === 'denied';

  // running 时默认展开（让用户看到正在执行的入参）；
  // 失败/未批准也默认展开 —— 出问题时解释文案必须立刻可见，不能藏在折叠后面
  const showBody = expanded || running || failed;

  return (
    <Box
      sx={{
        mb: 1.5,
        border: 1,
        borderColor: failed ? 'error.main' : running ? 'primary.main' : 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        overflow: 'hidden',
        maxWidth: 900,
        mx: 'auto',
        width: '100%',
        transition: 'border-color 0.3s',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {running ? (
          <CircularProgress size={16} thickness={5} color="primary" />
        ) : (
          <BuildIcon sx={{ fontSize: 16, color: failed ? 'error.main' : 'warning.main' }} />
        )}
        <Typography sx={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>
          {toolDisplayName(toolCall.toolName)}
          {toolCall.toolName !== toolDisplayName(toolCall.toolName) && (
            <Box component="span" sx={{ ml: 0.75, fontWeight: 400, fontSize: 10.5, color: 'text.disabled' }}>
              {toolCall.toolName}
            </Box>
          )}
        </Typography>
        <StatusMeta status={toolCall.status} />
        {showBody ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
      </Box>
      {showBody && (
        <Box
          sx={{
            px: 1.5,
            pb: 1.25,
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)'),
          }}
        >
          {argsText ? (
            <Box sx={{ mt: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>
                  {t('agent.form.args')}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>
                  {argsText.split('\n').length} 行
                </Typography>
              </Box>
              <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1 }}>
                <JsonView text={argsText} maxHeight={180} />
              </Box>
            </Box>
          ) : null}
          {toolCall.result ? (
            <Box sx={{ mt: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>
                  {t('agent.form.result')}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>
                  {toolCall.result.split('\n').length} 行
                </Typography>
              </Box>
              <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1 }}>
                <JsonView text={toolCall.result} />
              </Box>
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

export default ToolCallCard;
