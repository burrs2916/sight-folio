// sight-folio: 工作台 AI 面板的纯展示组件与工具函数（从 WorkbenchAiPanel 拆出）。
//
// 拆分目的：WorkbenchAiPanel 单体曾达 2531 行，编排函数与展示组件/工具函数混在一起，
// 任何改动都易牵一发动全身，是后续对标 VS Code 深活的连续性风险点。本文件只放「无状态的
// 展示组件 + 纯工具函数 + 类型」，不持有会话状态；编排逻辑仍留在 WorkbenchAiPanel。
// 行为零改动，仅搬运。

import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';
import AssessmentIcon from '@mui/icons-material/Assessment';
import HubIcon from '@mui/icons-material/Hub';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import CloseIcon from '@mui/icons-material/Close';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import CodeIcon from '@mui/icons-material/Code';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import ReplayIcon from '@mui/icons-material/Replay';
import { keyframes } from '@mui/material/styles';
import { useSemanticColors } from '../../theme/useSemanticColors';

import { getLang, t } from '../../i18n';
import { L } from '../../ai/aiLang';
import { surfaceKeyForGenre, viewKindVisibleForGenre } from '../../utils/writingSchema';
import { uiFontSize, BORDER_RADIUS_BASE } from '../../theme/appearanceScales';
import { useVerifyOverlayStore } from '../../store/verifyOverlayStore';
import { useProjectStore } from '../../store/projectStore';
import { useAgentStore } from '../../store/agentStore';
import { useToastStore } from '../../store/toastStore';
import {
  createSpeechInput,
  ensureMicPermission,
  isSpeechRecognitionSupported,
  requestSpeechAuthorization,
  type SpeechInputController,
} from './speechInput';
import { getSlashCommands } from './workbenchSlashCommands';
import type { WorkbenchMode } from './workbenchContext';
import type { AiAgent } from '../../services/tauri';
import type { EditorSelectionInfo } from './MonacoCodeEditor';
import type { EditorDiagnostic } from '../../store/editorDiagnosticsStore';

/** 轻量子序列模糊匹配（用于 # 附件选择器） */
export function fuzzyScore(text: string, q: string): number {
  const t = text.toLowerCase();
  const ql = q.toLowerCase();
  if (!ql) return 1;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < ql.length; qi++) {
    const ch = ql[qi];
    let found = -1;
    for (let k = ti; k < t.length; k++) {
      if (t[k] === ch) {
        found = k;
        break;
      }
    }
    if (found < 0) return 0;
    if (found === ti) {
      streak++;
      score += 2 + streak;
    } else {
      streak = 0;
      score += 1;
    }
    ti = found + 1;
  }
  return score - (t.length - ql.length) * 0.05;
}

/** 相对时间（用于对话历史列表）：刚发生 / 分钟 / 小时 / 天 / 日期 */
export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = 60000,
    h = 3600000,
    d = 86400000;
  if (diff < m) return L('刚刚', 'just now');
  if (diff < h) return L(`${Math.floor(diff / m)} 分钟前`, `${Math.floor(diff / m)} min`);
  if (diff < d) return L(`${Math.floor(diff / h)} 小时前`, `${Math.floor(diff / h)} h`);
  if (diff < 7 * d) return L(`${Math.floor(diff / d)} 天前`, `${Math.floor(diff / d)} d`);
  const dt = new Date(ts);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/** 单文件「代码健康度」事实快照（供改动前后对比） */
export interface FileFacts {
  /** 单函数最高圈复杂度（maxFunctionCc 与文件总 CC 取大，至少抓住最坏函数） */
  cc: number;
  lines: number;
  fns: number;
  dead: number;
  clones: number;
  /** 该文件当前「未修复」审查发现数（targetType=file 且 targetId=fileId；排除死代码双算）。
   *  接进验证卡后，AI 改完代码能直接量化「是否引入了新 bug」——VS Code 没有的闭环维度。 */
  findings: number;
}

export interface VerifyEntry {
  id: string;
  relPath: string;
  status: 'verifying' | 'done';
  before: FileFacts;
  after?: FileFacts;
}

/**
 * 快照某文件的扫描事实（复杂度 / 行数 / 函数数 / 死代码 / 克隆组 / 审查发现）。
 * 直接读 projectStore 的最新值——写盘后 file-changes → 增量重扫会刷新这些字段，
 * 所以我们只需在「改动前」「改动后」各取一次就能算出 delta。
 */
export function snapshotFileFacts(fileId: string): FileFacts {
  const st = useProjectStore.getState();
  const metric = st.metrics.find((m) => m.fileId === fileId);
  const cc = metric ? Math.max(metric.maxFunctionCc || 0, metric.cyclomaticComplexity || 0) : 0;
  const fns = metric?.functionCount ?? 0;
  const lines = metric?.totalLines ?? 0;
  const dead = st.deadSymbols.filter((d) => d.fileId === fileId).length;
  const clones = new Set(st.clones.filter((c) => c.fileId === fileId).map((c) => c.groupId)).size;
  // 审查发现：targetType=file 的发现其 target_id 即 project_files.id（后端 review.rs 写入约定），
  // 因此可按 fileId 精确归并到文件，无需脆弱的 symbol→file 反查。排除死代码类避免与 deadSymbols 双算。
  const findings = st.findings.filter(
    (f) => f.status === 'open' && f.targetType === 'file' && f.targetId === fileId && f.ruleId !== 'rule_dead_symbol',
  ).length;
  return { cc, lines, fns, dead, clones, findings };
}

export function factsSig(f: FileFacts): string {
  return `${f.cc}|${f.lines}|${f.fns}|${f.dead}|${f.clones}|${f.findings}`;
}

/** 「改动后自动验证」结果卡：列出发生变化维度的 before→after，按方向着色 */
export function VerifyDeltas({ before, after, relPath }: { before: FileFacts; after: FileFacts; relPath: string }) {
  const dims: { key: string; label: string; b: number; a: number; better: 'down' | 'up' | 'none' }[] = [
    { key: 'cc', label: t('workbench.aiVerify.cc'), b: before.cc, a: after.cc, better: 'down' },
    { key: 'lines', label: t('workbench.aiVerify.lines'), b: before.lines, a: after.lines, better: 'none' },
    { key: 'fns', label: t('workbench.aiVerify.fns'), b: before.fns, a: after.fns, better: 'none' },
    { key: 'dead', label: t('workbench.aiVerify.dead'), b: before.dead, a: after.dead, better: 'down' },
    { key: 'clones', label: t('workbench.aiVerify.clones'), b: before.clones, a: after.clones, better: 'down' },
    { key: 'findings', label: t('workbench.aiVerify.findings'), b: before.findings, a: after.findings, better: 'down' },
  ];
  const changed = dims.filter((d) => d.b !== d.a);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
      <Typography variant="caption" sx={{ fontSize: uiFontSize(10), color: 'text.secondary' }}>
        {relPath}：
      </Typography>
      {changed.map((d) => {
        const improved = d.better === 'down' ? d.a < d.b : d.better === 'up' ? d.a > d.b : false;
        const regressed = d.better === 'down' ? d.a > d.b : d.better === 'up' ? d.a < d.b : false;
        const color = improved ? 'success.main' : regressed ? 'error.main' : 'text.secondary';
        return (
          <Chip
            key={d.key}
            size="small"
            label={`${d.label} ${d.b}→${d.a}`}
            sx={{ fontSize: uiFontSize(9), height: 16, color, borderColor: color, '& .MuiChip-label': { px: 0.5 } }}
            variant="outlined"
          />
        );
      })}
    </Box>
  );
}

/** 「本轮改动总账」：把本会话所有已结算的逐文件验证聚成一条会话级汇总（VS Code 没有的闭环汇总） */
export function VerifySummary({ entries }: { entries: { relPath: string; before: FileFacts; after: FileFacts }[] }) {
  // 单文件改动逐文件卡已讲清，聚合只在「跨多文件」时有意义，避免噪声。
  if (entries.length < 2) return null;
  let ccDown = 0,
    ccUp = 0,
    deadDown = 0,
    deadUp = 0,
    cloneDown = 0,
    cloneUp = 0,
    findingsDown = 0,
    findingsUp = 0;
  for (const e of entries) {
    if (e.after.cc < e.before.cc) ccDown++;
    else if (e.after.cc > e.before.cc) ccUp++;
    if (e.after.dead < e.before.dead) deadDown++;
    else if (e.after.dead > e.before.dead) deadUp++;
    if (e.after.clones < e.before.clones) cloneDown++;
    else if (e.after.clones > e.before.clones) cloneUp++;
    if (e.after.findings < e.before.findings) findingsDown++;
    else if (e.after.findings > e.before.findings) findingsUp++;
  }
  const chips: { label: string; tone: 'ok' | 'bad' | 'neutral' }[] = [
    { label: t('workbench.aiVerify.summaryFiles', { n: entries.length }), tone: 'neutral' },
  ];
  if (ccDown) chips.push({ label: t('workbench.aiVerify.summaryCcDown', { n: ccDown }), tone: 'ok' });
  if (ccUp) chips.push({ label: t('workbench.aiVerify.summaryCcUp', { n: ccUp }), tone: 'bad' });
  if (deadDown) chips.push({ label: t('workbench.aiVerify.summaryDeadDown', { n: deadDown }), tone: 'ok' });
  if (deadUp) chips.push({ label: t('workbench.aiVerify.summaryDeadUp', { n: deadUp }), tone: 'bad' });
  if (cloneDown) chips.push({ label: t('workbench.aiVerify.summaryCloneDown', { n: cloneDown }), tone: 'ok' });
  if (cloneUp) chips.push({ label: t('workbench.aiVerify.summaryCloneUp', { n: cloneUp }), tone: 'bad' });
  if (findingsDown) chips.push({ label: t('workbench.aiVerify.summaryFindingsDown', { n: findingsDown }), tone: 'ok' });
  if (findingsUp) chips.push({ label: t('workbench.aiVerify.summaryFindingsUp', { n: findingsUp }), tone: 'bad' });
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', px: 1, pb: 0.5 }}>
      <Typography variant="caption" sx={{ fontSize: uiFontSize(9.5), fontWeight: 700, color: 'text.primary' }}>
        {t('workbench.aiVerify.summaryTitle')}：
      </Typography>
      {chips.map((c, i) => {
        const color = c.tone === 'ok' ? 'success.main' : c.tone === 'bad' ? 'error.main' : 'text.secondary';
        const border = c.tone === 'ok' ? 'success.main' : c.tone === 'bad' ? 'error.main' : 'divider';
        return (
          <Chip
            key={i}
            size="small"
            label={c.label}
            variant="outlined"
            sx={{ fontSize: uiFontSize(9), height: 16, color, borderColor: border, '& .MuiChip-label': { px: 0.5 } }}
          />
        );
      })}
    </Box>
  );
}

/** 「改动后自动验证」区块：改动落盘后回读扫描台账，量化本次改动影响（通用 IDE 插件没有的闭环） */
export function VerifySection({
  entries,
  settled,
  onDismiss,
  onToggleCanvas,
}: {
  entries: VerifyEntry[];
  settled: { relPath: string; before: FileFacts; after: FileFacts }[];
  onDismiss: (id: string) => void;
  onToggleCanvas: () => void;
}) {
  const T = useSemanticColors().tone;
  const canvasEnabled = useVerifyOverlayStore((s) => s.enabled);
  if (entries.length === 0 && settled.length < 2) return null;
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: T.success.tint }}>
      <VerifySummary entries={settled} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25 }}>
        <AssessmentIcon sx={{ fontSize: uiFontSize(14), color: 'success.main' }} />
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, fontSize: uiFontSize(10.5), flex: 1, color: 'text.primary' }}
        >
          {t('workbench.aiVerify.title')}
        </Typography>
        <Tooltip title={canvasEnabled ? t('workbench.aiVerify.canvasOn') : t('workbench.aiVerify.canvasOff')}>
          <IconButton
            size="small"
            onClick={onToggleCanvas}
            sx={{ p: 0.2 }}
            aria-label={canvasEnabled ? t('workbench.aiVerify.canvasOn') : t('workbench.aiVerify.canvasOff')}
          >
            {canvasEnabled ? (
              <VisibilityIcon sx={{ fontSize: uiFontSize(14), color: 'success.main' }} />
            ) : (
              <VisibilityOffIcon sx={{ fontSize: uiFontSize(14), color: 'text.disabled' }} />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title={t('workbench.aiVerify.tip')}>
          <Box sx={{ cursor: 'help', display: 'flex' }}>
            <LightbulbIcon sx={{ fontSize: uiFontSize(13), color: 'text.secondary' }} />
          </Box>
        </Tooltip>
      </Box>
      {/* 图例：解释画布上 AI✓ / AI! 角标的含义（护城河对用户是「未知符号」unless 解释） */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, pb: 0.25, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <span style={{ ...legendBadge, color: '#22c55e', borderColor: '#22c55e' }}>AI✓</span>
          <Typography variant="caption" sx={{ fontSize: uiFontSize(8.5), color: 'text.secondary' }}>
            {t('workbench.aiVerify.legendImproved')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <span style={{ ...legendBadge, color: '#dc2626', borderColor: '#dc2626' }}>AI!</span>
          <Typography variant="caption" sx={{ fontSize: uiFontSize(8.5), color: 'text.secondary' }}>
            {t('workbench.aiVerify.legendWorsened')}
          </Typography>
        </Box>
      </Box>
      {entries.map((e) => (
        <Box key={e.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pb: 0.5, flexWrap: 'wrap' }}>
          {e.status === 'verifying' ? (
            <>
              <CircularProgress size={10} />
              <Typography variant="caption" sx={{ fontSize: uiFontSize(10), color: 'text.secondary' }}>
                {t('workbench.aiVerify.verifying', { file: e.relPath })}
              </Typography>
            </>
          ) : e.after && factsSig(e.after) !== factsSig(e.before) ? (
            <VerifyDeltas before={e.before} after={e.after} relPath={e.relPath} />
          ) : (
            <Typography variant="caption" sx={{ fontSize: uiFontSize(10), color: 'text.secondary' }}>
              {t('workbench.aiVerify.noChange')} · {e.relPath}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <IconButton
            size="small"
            onClick={() => onDismiss(e.id)}
            sx={{ p: 0.2 }}
            aria-label={t('workbench.aiVerify.dismiss')}
          >
            <CloseIcon sx={{ fontSize: uiFontSize(13) }} />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}

/**
 * 作用域级影响面（比 VS Code 更强）：聚焦某文件后，按调用图反向闭包列出「改它会波及哪些文件」。
 * 纯前端消费 projectStore.callEdges（扫描时已加载），无需额外后端调用 / 权限；
 * 点击文件可经 onOpenPath 跳转到代码工作台查看。VS Code 的 AI 完全没有这层「爆炸半径」认知。
 */
export function ImpactSurfaceBlock({
  files,
  onOpenPath,
  enabled,
  onToggle,
}: {
  files: { fileId: string; relPath: string }[];
  onOpenPath?: (relPath: string, line?: number) => void;
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;
  return (
    <Box
      sx={{
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: (theme) =>
          theme.palette.mode === 'dark'
            ? 'rgb(var(--template-palette-warning-mainChannel) / 0.12)'
            : 'rgb(var(--template-palette-warning-mainChannel) / 0.05)',
      }}
    >
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <HubIcon sx={{ fontSize: uiFontSize(14), color: 'warning.main', flexShrink: 0 }} />
        <Typography
          variant="caption"
          sx={{ fontWeight: 600, fontSize: uiFontSize(11), flex: 1, color: 'text.primary' }}
        >
          {t('workbench.aiImpact.title', { n: files.length })}
        </Typography>
        {onToggle && (
          <Tooltip title={t('workbench.aiImpact.canvasToggleTip')}>
            <span onClick={(e) => e.stopPropagation()}>
              <IconButton
                size="small"
                onClick={() => onToggle(!enabled)}
                sx={{ p: 0.25, ml: 0.5 }}
                aria-label={t('workbench.aiImpact.canvasToggleTip')}
              >
                {enabled ? (
                  <VisibilityIcon sx={{ fontSize: uiFontSize(15), color: 'primary.main' }} />
                ) : (
                  <VisibilityOffIcon sx={{ fontSize: uiFontSize(15), color: 'text.disabled' }} />
                )}
              </IconButton>
            </span>
          </Tooltip>
        )}
        {open ? (
          <ExpandLessIcon sx={{ fontSize: uiFontSize(16) }} />
        ) : (
          <ExpandMoreIcon sx={{ fontSize: uiFontSize(16) }} />
        )}
      </Box>
      {/* 图例：解释画布上靛蓝「波及」标记的语义（护城河对用户是「未知符号」unless 解释，与 verify 图例同形） */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, px: 1, pb: 0.25 }}>
        <span style={{ ...legendBadge, color: '#6366f1', borderColor: '#6366f1' }}>
          {t('workbench.aiImpact.canvasBadge')}
        </span>
        <Typography variant="caption" sx={{ fontSize: uiFontSize(8.5), color: 'text.secondary' }}>
          {t('workbench.aiImpact.legend')}
        </Typography>
      </Box>
      {open && (
        <Box sx={{ px: 1, pb: 0.5, maxHeight: 200, overflow: 'auto' }}>
          <Typography
            variant="caption"
            sx={{ display: 'block', fontSize: uiFontSize(9.5), color: 'text.secondary', mb: 0.25 }}
          >
            {t('workbench.aiImpact.hint')}
          </Typography>
          {files.map((f) => (
            <Box
              key={f.fileId}
              onClick={() => onOpenPath?.(f.relPath)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.25,
                px: 0.5,
                py: 0.2,
                cursor: onOpenPath ? 'pointer' : 'default',
                '&:hover': onOpenPath ? { bgcolor: 'action.selected' } : {},
              }}
            >
              <CallSplitIcon sx={{ fontSize: uiFontSize(12), color: 'text.disabled', flexShrink: 0 }} />
              <Typography
                variant="caption"
                sx={{
                  fontSize: uiFontSize(10),
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'text.secondary',
                }}
              >
                {f.relPath}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** 模式标签（Ask/Direct/Agent），供头部模式组渲染。
 *  getter 而非模块级 const：L() 每次调用才读当前语言，const 会在模块加载时
 *  固化一次 → 切语言不刷新（历史教训 ×3，见 aiLang.ts 注释）。 */
export function modeLabel(m: WorkbenchMode): string {
  const zh: Record<WorkbenchMode, string> = { ask: '问答', edit: '直接改', agent: '代理' };
  const en: Record<WorkbenchMode, string> = { ask: 'Ask', edit: 'Direct', agent: 'Agent' };
  return L(zh[m], en[m]);
}

/** 验证图例小药丸（与画布角标同形，仅用于面板内图例说明） */
export const legendBadge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: uiFontSize(8.5),
  fontWeight: 700,
  lineHeight: 1,
  height: 14,
  padding: '0 3px',
  borderRadius: 3,
  border: '1px solid',
};

/**
 * VS Code 式「修复此错误」诊断条：把编辑器里真实的语法/类型错误暴露给用户，
 * 一键让 AI 以 edit 模式修复（apply_change 真实改盘，改动进台账供评审）。
 * 这是原面板（围着预计算扫描台账转）完全缺失、却最像传统 IDE 的能力。
 */
export function DiagnosticsStrip({ diagnostics, onFix }: { diagnostics: EditorDiagnostic[]; onFix: () => void }) {
  if (diagnostics.length === 0) return null;
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const first = diagnostics[0];
  return (
    <Box sx={{ px: 1, pt: 0.5 }}>
      <Box
        sx={{
          borderRadius: 1,
          border: 1,
          borderColor: errors.length > 0 ? 'error.main' : 'warning.main',
          bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(248,81,73,0.08)' : 'rgba(248,81,73,0.05)'),
          px: 1,
          py: 0.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.25,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
          {errors.length > 0 && (
            <Chip
              size="small"
              label={t('workbench.aiDiag.errorCount', { n: errors.length })}
              color="error"
              sx={{ fontSize: uiFontSize(9.5), height: 18 }}
            />
          )}
          {warnings.length > 0 && (
            <Chip
              size="small"
              label={t('workbench.aiDiag.warnCount', { n: warnings.length })}
              color="warning"
              sx={{ fontSize: uiFontSize(9.5), height: 18 }}
            />
          )}
          <Typography
            variant="caption"
            sx={{
              fontSize: uiFontSize(10),
              color: 'text.secondary',
              lineHeight: 1.4,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {`L${first.startLine}: ${first.message}`}
          </Typography>
          <Button
            size="small"
            variant="contained"
            color="error"
            onClick={onFix}
            sx={{ fontSize: uiFontSize(9.5), height: 20, minWidth: 0, px: 0.75 }}
          >
            {t('workbench.aiDiag.fix')}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * 统一输入栏（对标 VS Code Copilot Chat 的单一、连贯输入框）。
 *
 * 此前 Chat 视图与 Edits 视图各自复制了一整套「诊断条 + 快捷动作 + 输入框 + 斜杠菜单」
 * （约 250 行重复 JSX）。这是 R31 警告过的典型「跨视图共用 UI 写回输入框」发散源——
 * 一处修了 bug，另一处不会跟着动，最终导致两个视图行为漂移、面板「不像一个连贯的 IDE 面板」。
 *
 * 这里抽成单一组件，两个视图共用同一份状态寻址逻辑：所有写回都按 `ctx.view` 落到对应
 * （chat / edits）输入框，行为零改动，从根上消除发散。槽位（ctx）只暴露本组件真正需要的字段。
 */

/** 录音中麦克风按钮的脉冲光环动画（红圈扩散，提示正在拾音） */
const voicePulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(244, 67, 54, 0.35); }
  70% { box-shadow: 0 0 0 9px rgba(244, 67, 54, 0); }
  100% { box-shadow: 0 0 0 0 rgba(244, 67, 54, 0); }
`;
export interface WorkbenchInputBarCtx {
  view: 'chat' | 'edits';
  input: string;
  setInput: (v: string) => void;
  editInput: string;
  setEditInput: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  editInputRef: React.RefObject<HTMLTextAreaElement>;
  submitInput: (raw: string) => void;
  detectHashMention: (v: string, origin: 'chat' | 'edits') => void;
  detectSlashCommand: (v: string, target: 'chat' | 'edits') => void;
  setSlashAnchor: (el: HTMLElement | null) => void;
  setSlashQuery: (v: string) => void;
  setSlashTarget: (t: 'chat' | 'edits') => void;
  slashAnchor: HTMLElement | null;
  slashQuery: string;
  slashTarget: 'chat' | 'edits';
  fileDiagnostics: EditorDiagnostic[];
  fixErrors: () => void;
  quickAction: (
    kind:
      | 'file'
      | 'selection'
      | 'test'
      | 'review'
      | 'fix'
      | 'book-understand'
      | 'book-explain-sel'
      | 'book-polish'
      | 'book-consistency'
      | 'book-plot'
      | 'book-consistency-world',
  ) => void;
  queued: string[];
  /** 书场景（novel-zh）：快捷动作与占位符切换为写作向文案 */
  isBookScene?: boolean;
  /** 当前书体裁（novel/essay/poetry/script/diary；'' 或未传 = 按小说口径）。
   *  斜杠菜单必须按体裁出对应那一支：诗集作者敲 `/` 拿到 6 条小说命令（伏笔/连续性/人物/时间线）
   *  是 W-0a 修掉的运行时断口（2026-11-10）。判据单一真源 = writingSchema.workbenchCommandSet。 */
  genre?: string;
  /** 模型覆盖：传统聊天 UI 把模型选择器放在底部、与输入框同区（而非藏在头部菜单），
   *  便于随时切换当前会话模型；affiliation（端点·供应商）在输入栏内从 store 现算，避免选错端点。 */
  /** 助手选择：从头部下沉到底部输入条、与输入框同行对齐（传统聊天/IDE composer 把助手选择器放在输入条一端）。 */
  agents: AiAgent[];
  selectedAgentId: string | null;
  selectAgent: (id: string | null) => void;
}

// composer 卡的圆角乘数 —— 必须与上方卡片 sx 的 borderRadius 字面量保持一致，
// 行内收量按这个乘数复算弧位置（composerEdgeClearance 锁会核对两处同步）。
const CARD_RADIUS_MULT = 3;
// 贴边行内容与弧线之间保留的最小气口（px）：描边 1px + 视觉留白，避免「挨着=压线」观感。
const EDGE_GAP = 2;
// 卡片 px/py = 1.5 × spacing(8)：贴边行默认起笔位，内收量以此为基准做差值。
const CARD_EDGE_PAD = 12;

/**
 * 贴边行（快捷标签排 / 底部动作条）的动态左收量 = 弧在该行顶边高度上的横向位置
 * 往后推的气口对齐值（2026-11-03 李先生定案：「算出圆角从哪开始变圆，按那个往后推」）。
 *
 * 卡圆角 r = 档位 × 3（全圆档 60px，卡保持全圆不钳）。左上角弧是圆心 (r, r)、
 * 半径 r 的圆；行顶边在 y = CARD_EDGE_PAD(12px)，弧在该高度的横坐标是
 * x = r − √(r² − (r−y)²)。内容左缘 ≥ x + 气口才算「对齐到弧线之后」。
 * 返回的是在既有 12px 内边距上**追加**的量：none~large 档弧切不到行（返回 0，
 * 逐像素零改动），round 档返回 14（24px 弧位 + 2 气口 − 12 内边距）。
 * 只依赖档位不依赖宽高 —— 拖动左/右边框改变面板宽度时，圆角位置不变、内收量
 * 不变，控件相对卡片角的位置恒定，不会飘。
 */
export function composerRowInsetExtra(theme: { shape: { borderRadius: unknown } }): number {
  const base = typeof theme.shape.borderRadius === 'number' ? theme.shape.borderRadius : BORDER_RADIUS_BASE.medium;
  const r = base * CARD_RADIUS_MULT;
  if (!(r > 0) || CARD_EDGE_PAD >= r) return 0;
  const arcX = r - Math.sqrt(r * r - (r - CARD_EDGE_PAD) * (r - CARD_EDGE_PAD));
  return Math.max(0, arcX + EDGE_GAP - CARD_EDGE_PAD);
}

export function WorkbenchInputBar({
  ctx,
  selection,
  isStreaming,
}: {
  ctx: WorkbenchInputBarCtx;
  selection: EditorSelectionInfo | null;
  isStreaming: boolean;
}) {
  const interruptRequested = useAgentStore((s) => s.interruptRequested);
  const value = ctx.view === 'edits' ? ctx.editInput : ctx.input;
  const setValue = ctx.view === 'edits' ? ctx.setEditInput : ctx.setInput;
  const inputRef = ctx.view === 'edits' ? ctx.editInputRef : ctx.inputRef;
  const placeholder =
    ctx.view === 'edits'
      ? ctx.isBookScene
        ? t('workbench.aiEdits.bookPlaceholder')
        : t('workbench.aiEdits.placeholder')
      : ctx.isBookScene
        ? t('workbench.aiInput.bookPlaceholder')
        : t('workbench.aiInput.placeholder');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    ctx.detectHashMention(v, ctx.view);
    ctx.detectSlashCommand(v, ctx.view);
  };
  const submit = () => {
    ctx.submitInput(value);
    setValue('');
  };

  // ---- 语音输入（方案 A：Web Speech API，纯前端）----
  const [listening, setListening] = useState(false);
  const [micGuideOpen, setMicGuideOpen] = useState(false);
  // 引导原因：false=权限未授权/被拒（去系统设置放行）；true=进程启动形态非法（必须用 .app 启动）
  const [micGuideLaunch, setMicGuideLaunch] = useState(false);
  const [voiceDiag, setVoiceDiag] = useState<string>('');
  const speechRef = useRef<SpeechInputController | null>(null);
  const valueRef = useRef(value);
  const setValueRef = useRef(setValue);
  useEffect(() => {
    // 每次渲染后同步最新值与 setter（回调闭包创建于挂载时，靠 ref 取到最新值拼接）
    valueRef.current = value;
    setValueRef.current = setValue;
  });
  useEffect(() => {
    if (!isSpeechRecognitionSupported()) return;
    const ctrl = createSpeechInput(getLang() === 'en-US' ? 'en-US' : 'zh-CN', {
      onResult: (text) => {
        // 结果回填输入框，不自动发送；setValue 非函数式，用 ref 取最新值拼接
        const cur = valueRef.current;
        setValueRef.current(cur ? (cur.endsWith(' ') || cur.endsWith('\n') ? cur + text : `${cur} ${text}`) : text);
      },
      onError: (code, detail) => {
        setVoiceDiag(
          `rec.onerror=${code}${detail ? ` "${detail}"` : ''} [supported=${isSpeechRecognitionSupported()}]`,
        );
        if (code === 'no-speech') return; // 未检测到语音：静默，不打扰
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          // 权限被拒/语音服务被系统拦截：展开引导提示，而不是只弹错误 toast
          setListening(false);
          setMicGuideLaunch(false);
          setMicGuideOpen(true);
          return;
        }
        useToastStore.getState().showToast(t('workbench.aiVoice.errService'), 'error');
      },
      onStart: () => setListening(true),
      onEnd: () => setListening(false),
    });
    speechRef.current = ctrl;
    return () => {
      ctrl?.cancel();
      speechRef.current = null;
    };
  }, []);
  const toggleVoice = async () => {
    const ctrl = speechRef.current;
    if (!ctrl) return;
    if (listening) {
      ctrl.stop();
      return;
    }
    // macOS：Web Speech API 走 SFSpeechRecognizer，需要独立于麦克风的
    // 「语音识别」系统权限；未主动请求过的 app 在系统设置里没有该条目，
    // 用户无法勾选。这里调用原生 command 主动请求（授权过则立即返回，
    // 未决则弹系统授权框），授权成功后才继续麦克风流程。
    //
    // ⚠️ 关键防线：若 command 返回 'needs-app-launch'（当前以非 LaunchServices
    // 形态启动，如从终端/Cursor 直接运行），**绝不能继续执行** —— WebKit 的
    // SpeechRecognition.start() 会内部代发 SFSpeechRecognizer 授权请求，非合法
    // 形态下 TCC 直接以 SIGABRT 终止整个进程（崩溃栈 __TCCAccessRequest_block_invoke）。
    // 此时只展开"请用 .app 启动"引导并终止。
    setVoiceDiag(`speechAuth=… [supported=${isSpeechRecognitionSupported()}]`);
    const speechAuth = await requestSpeechAuthorization();
    setVoiceDiag(`speechAuth=${speechAuth} ensureMicPermission()=… [supported=${isSpeechRecognitionSupported()}]`);
    if (
      speechAuth === 'denied' ||
      speechAuth === 'restricted' ||
      speechAuth === 'notDetermined' ||
      speechAuth === 'needs-app-launch'
    ) {
      // needs-app-launch：提示改用 .app（LaunchServices）启动；其余为权限未放行，提示去系统设置
      setMicGuideLaunch(speechAuth === 'needs-app-launch');
      setMicGuideOpen(true);
      return;
    }
    // 先探测/申请麦克风权限：未授权时走系统授权，被拒则展开引导而非直接报错
    const perm = await ensureMicPermission();
    setVoiceDiag(
      `speechAuth=${speechAuth} ensureMicPermission()=${perm} [supported=${isSpeechRecognitionSupported()}]`,
    );
    if (perm === 'denied') {
      setMicGuideLaunch(false);
      setMicGuideOpen(true);
      return;
    }
    setMicGuideOpen(false);
    ctrl.start();
  };

  return (
    <>
      {ctx.fileDiagnostics.length > 0 && <DiagnosticsStrip diagnostics={ctx.fileDiagnostics} onFix={ctx.fixErrors} />}

      {/* 一体化 composer 卡片（对标主流 AI 聊天输入框：圆角大卡片 + 无边框编辑区 + 底部动作条）。
          快捷动作、助手选择、斜杠命令、发送/停止全部收进同一张卡，取代此前「分割线 + 裸 TextField」
          的粗放布局；聚焦时描边 + 光晕，行为（提交/斜杠/排队/中断）零改动。 */}
      <Box
        sx={{
          m: 1,
          mt: 0.5,
          // 圆角挂档位（乘数 3）：卡片里包的编辑区已从第 32 轮起跟随「圆角风格」，
          // 外壳若继续写死 20px，切到「直角」就会出现「方框套圆卡」的错位。
          // medium 档 6×3 = 18px（原 20px，差 2px，档位一致性优先）。
          // 全圆档 60px 弧与贴边控件的冲突**不靠钳卡解决**（钳卡 = 牺牲用户选的档位，
          // 2026-11-03 李先生驳回）：卡保持全圆，改由 composerRowInsetExtra 把贴边行
          // 对齐到弧线之后。乘数若改，必须同步 CARD_RADIUS_MULT。
          borderRadius: 3,
          border: 1,
          borderColor: 'divider',
          bgcolor: (theme) =>
            theme.palette.mode === 'dark'
              ? 'rgb(var(--template-palette-text-primaryChannel) / 0.04)'
              : 'rgb(var(--template-palette-text-primaryChannel) / 0.02)',
          px: 1.5,
          py: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          transition: 'border-color 120ms ease, box-shadow 120ms ease',
          '&:focus-within': {
            borderColor: 'primary.main',
            boxShadow: (theme) =>
              `0 0 0 3px ${theme.palette.mode === 'dark' ? 'rgb(var(--template-palette-primary-mainChannel) / 0.16)' : 'rgb(var(--template-palette-primary-mainChannel) / 0.12)'}`,
          },
        }}
      >
        {/* 卡片内第一排：编辑快捷动作 pill（左）+ 助手选择框（右）
            圆角例外（第 32 轮逐处拍板，共 12 枚 pill）：它们的 borderRadius 一律 '11px' = height 22 的一半，
            是**胶囊**而不是圆角档 —— 挂上档位会在「大圆角 / 全圆」档溢出成椭圆，「直角」档又失去 pill 语义。 */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
            alignItems: 'center',
            // 全圆档弧切到这一排的高度时，左缘对齐到弧线之后（只推左、右缘自然换行，
            // 整排不会"往中间挤"；量由档位算出，拖动宽高不变 —— 李先生定案口径）
            pl: composerRowInsetExtra,
          }}
        >
          {ctx.isBookScene ? (
            <>
              {selection && (
                <>
                  <Chip
                    size="small"
                    clickable
                    variant="outlined"
                    label={t('workbench.aiExplainSelectionBook')}
                    onClick={() => ctx.quickAction('book-explain-sel')}
                    sx={{ fontSize: uiFontSize(10), height: 22, borderRadius: '11px' }}
                  />
                  <Chip
                    size="small"
                    clickable
                    variant="outlined"
                    label={t('workbench.aiPolishSelection')}
                    onClick={() => ctx.quickAction('book-polish')}
                    sx={{ fontSize: uiFontSize(10), height: 22, borderRadius: '11px' }}
                  />
                </>
              )}
              {/* ㉕ P14（轮 32）：标签走 `chipUnderstand` 槽位——诗集叫「读懂这首」、剧本「读懂这场」、
                  日记「读懂这天」、散文「读懂这篇」；小说与旧书回落原键「读懂本章」逐字不动。 */}
              <Chip
                size="small"
                clickable
                variant="outlined"
                label={t(surfaceKeyForGenre(ctx.genre ?? '', 'chipUnderstand'))}
                onClick={() => ctx.quickAction('book-understand')}
                sx={{ fontSize: uiFontSize(10), height: 22, borderRadius: '11px' }}
              />
              <Chip
                size="small"
                clickable
                variant="outlined"
                label={t('workbench.aiConsistencyChapter')}
                onClick={() => ctx.quickAction('book-consistency')}
                sx={{ fontSize: uiFontSize(10), height: 22, borderRadius: '11px' }}
              />
              {/* ㊽ 入口族（2026-11-11 轮 29）：这两枚动作的判据分别指向 storylines/foreshadowing
                  与 worldview，而这两类栏对散文集·诗集·日记（前三枚全裁）与剧本（裁 worldview）
                  已被 hiddenViewKindsForGenre 收掉。栏都不长，还递一颗「我帮你审它」的chip，
                  就是 ⑲ 写过的「藏视图不藏入口」。判据只查那一页签表，不另立映射表。 */}
              {viewKindVisibleForGenre(ctx.genre ?? '', 'storylines') && (
                <Chip
                  size="small"
                  clickable
                  variant="outlined"
                  label={t('workbench.aiPlotChapter')}
                  onClick={() => ctx.quickAction('book-plot')}
                  sx={{ fontSize: uiFontSize(10), height: 22, borderRadius: '11px' }}
                />
              )}
              {viewKindVisibleForGenre(ctx.genre ?? '', 'worldview') && (
                <Chip
                  size="small"
                  clickable
                  variant="outlined"
                  label={t('workbench.aiConsistencyWorld')}
                  onClick={() => ctx.quickAction('book-consistency-world')}
                  sx={{ fontSize: uiFontSize(10), height: 22, borderRadius: '11px' }}
                />
              )}
            </>
          ) : (
            <>
              {selection && (
                <>
                  <Chip
                    size="small"
                    clickable
                    variant="outlined"
                    label={t('workbench.aiExplainSelection')}
                    onClick={() => ctx.quickAction('selection')}
                    sx={{ fontSize: uiFontSize(10), height: 22, borderRadius: '11px' }}
                  />
                  <Chip
                    size="small"
                    clickable
                    variant="outlined"
                    label={t('workbench.aiFixSelection')}
                    onClick={() => ctx.quickAction('fix')}
                    sx={{ fontSize: uiFontSize(10), height: 22, borderRadius: '11px' }}
                  />
                </>
              )}
              <Chip
                size="small"
                clickable
                variant="outlined"
                label={t('workbench.aiExplainFile')}
                onClick={() => ctx.quickAction('file')}
                sx={{ fontSize: uiFontSize(10), height: 22, borderRadius: '11px' }}
              />
              <Chip
                size="small"
                clickable
                variant="outlined"
                label={t('workbench.aiGenTest')}
                onClick={() => ctx.quickAction('test')}
                sx={{ fontSize: uiFontSize(10), height: 22, borderRadius: '11px' }}
              />
              <Chip
                size="small"
                clickable
                variant="outlined"
                label={t('workbench.aiReviewFile')}
                onClick={() => ctx.quickAction('review')}
                sx={{ fontSize: uiFontSize(10), height: 22, borderRadius: '11px' }}
              />
            </>
          )}
          {ctx.queued.length > 0 && (
            <Tooltip title={t('workbench.aiQueue.queued')}>
              <Chip
                size="small"
                label={t('workbench.aiQueue.badge', { n: ctx.queued.length })}
                color="info"
                sx={{ fontSize: uiFontSize(9.5), height: 20 }}
              />
            </Tooltip>
          )}
        </Box>

        {/* 输入区：占位提示词贴左上角；下方工具行承载语音/斜杠（左）与助手选择/发送（右） */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <TextField
            inputRef={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            size="small"
            multiline
            minRows={5}
            maxRows={8}
            sx={{
              flex: 1,
              minWidth: 0,
              '& .MuiInputBase-root': {
                fontSize: uiFontSize(12.5),
                p: 0,
                py: 0.25,
                pl: '6px',
                pr: '10px',
                alignItems: 'flex-start',
                // 圆角走 MUI 乘数（= shape 基准 × 2）而非 '12px' 字面量：此前它是写死值，
                // 「设置 → 圆角风格」切到「直角 / 大圆角」时这个输入框纹丝不动（第 32 轮收第 31 轮待办 1）。
                // 刻意用乘数而不是 calc(var(--app-radius-base) + 6px)：乘数在「直角」档真的归零，
                // 加固定值不会 —— 用户选了直角还留着圆角，就又是一处「设置了没生效」。
                // medium 档 6×2 = 12px，与改动前逐像素一致，老用户观感不变。
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgb(var(--template-palette-text-primaryChannel) / 0.055)'
                    : 'rgb(var(--template-palette-text-primaryChannel) / 0.045)',
                transition: 'border-color 120ms ease, background-color 120ms ease',
                '&:hover': { borderColor: 'text.secondary' },
                '&.Mui-focused': { borderColor: 'primary.main' },
                '&::before, &::after': { display: 'none' },
              },
              '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
              // 占位提示词：明显淡于正文（text.disabled），明暗主题都保持低对比，一眼可辨是提示而非用户内容
              '& textarea::placeholder': {
                textAlign: 'left',
                color: 'text.disabled',
                opacity: 0.75,
                fontWeight: 400,
              },
            }}
          />
          {/* 输入框下方工具行：左侧语音/斜杠，右侧助手选择 + 发送/停止，同高同线不突兀 */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              // 两端各对齐到所在下角弧线之后：左缘（麦克风/斜杠）与右缘（助手/发送）
              // 由同一条弧几何推出，档位不变量不变，拖拽面板不飘
              pl: composerRowInsetExtra,
              pr: composerRowInsetExtra,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
              {isSpeechRecognitionSupported() && (
                <Tooltip title={listening ? t('workbench.aiVoice.stop') : t('workbench.aiVoice.start')}>
                  <IconButton
                    size="small"
                    onClick={toggleVoice}
                    sx={{
                      p: 0.4,
                      '& .MuiSvgIcon-root': { fontSize: uiFontSize(17) },
                      flexShrink: 0,
                      color: listening ? 'error.main' : 'text.secondary',
                      animation: listening ? `${voicePulse} 1.4s ease-in-out infinite` : undefined,
                    }}
                    aria-label={listening ? t('workbench.aiVoice.stop') : t('workbench.aiVoice.start')}
                  >
                    {listening ? <MicOffIcon /> : <MicIcon />}
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={t('workbench.aiSlash')}>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    if (ctx.view === 'edits') {
                      ctx.setSlashTarget('edits');
                      ctx.setSlashQuery('');
                    }
                    ctx.setSlashAnchor(e.currentTarget);
                  }}
                  sx={{
                    p: 0.4,
                    '& .MuiSvgIcon-root': { fontSize: uiFontSize(17) },
                    flexShrink: 0,
                    color: 'text.secondary',
                  }}
                  aria-label={t('workbench.aiSlash')}
                >
                  <CodeIcon />
                </IconButton>
              </Tooltip>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {ctx.agents.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 96, flexShrink: 0 }}>
                  <Select
                    value={ctx.selectedAgentId ?? ''}
                    onChange={(e) => ctx.selectAgent((e.target.value as string) || null)}
                    sx={{
                      fontSize: uiFontSize(9.5),
                      height: 24,
                      '& .MuiSelect-select': { py: 0, pl: 0.5, pr: '18px !important', fontSize: uiFontSize(9.5) },
                      '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
                      '&:hover .MuiOutlinedInput-notchedOutline': { border: 'none' },
                      '&.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 'none' },
                      '& .MuiSelect-icon': { fontSize: uiFontSize(14), right: 0 },
                    }}
                    displayEmpty
                    MenuProps={{
                      sx: { '& .MuiPaper-root': { maxWidth: 300 }, '& .MuiMenuItem-root': { whiteSpace: 'normal' } },
                    }}
                  >
                    <MenuItem value="" disabled sx={{ fontSize: uiFontSize(10) }}>
                      {t('workbench.aiAgent.none')}
                    </MenuItem>
                    {ctx.agents.map((a) => (
                      <MenuItem
                        key={a.id}
                        value={a.id}
                        sx={{
                          fontSize: uiFontSize(10),
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          py: 0.75,
                          gap: 0.25,
                        }}
                      >
                        <Box component="span" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                          {a.name}
                        </Box>
                        {a.description && (
                          <Box
                            component="span"
                            sx={{ fontSize: uiFontSize(9), color: 'text.secondary', lineHeight: 1.4 }}
                          >
                            {a.description}
                          </Box>
                        )}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              {isStreaming ? (
                <IconButton
                  size="small"
                  color="error"
                  disabled={interruptRequested}
                  onClick={() => useAgentStore.getState().requestInterrupt()}
                  sx={{ p: 0.4, '& .MuiSvgIcon-root': { fontSize: uiFontSize(17) }, flexShrink: 0 }}
                  aria-label={t('workbench.aiQueue.queued')}
                >
                  <StopRoundedIcon />
                </IconButton>
              ) : (
                <IconButton
                  size="small"
                  color="primary"
                  onClick={submit}
                  disabled={!value.trim()}
                  sx={{ p: 0.4, '& .MuiSvgIcon-root': { fontSize: uiFontSize(17) }, flexShrink: 0 }}
                  aria-label={t('workbench.aiQueue.send')}
                >
                  <SendRoundedIcon />
                </IconButton>
              )}
            </Box>
          </Box>
          {/* 麦克风权限引导条：未授权/被拒时展开，引导去系统或站点设置开启，而非仅报错 */}
          {micGuideOpen && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 0.75,
                borderRadius: 1.5,
                border: 1,
                borderColor: 'warning.main',
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(237,108,2,0.10)' : 'rgba(237,108,2,0.06)'),
                px: 1,
                py: 0.75,
              }}
            >
              <MicOffIcon sx={{ fontSize: uiFontSize(14), color: 'warning.main', mt: 0.125, flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: uiFontSize(11), fontWeight: 600, color: 'text.primary', lineHeight: 1.4 }}>
                  {micGuideLaunch ? t('workbench.aiVoice.micGuideLaunchTitle') : t('workbench.aiVoice.micGuideTitle')}
                </Typography>
                <Typography sx={{ fontSize: uiFontSize(10), color: 'text.secondary', lineHeight: 1.5, mt: 0.25 }}>
                  {micGuideLaunch ? t('workbench.aiVoice.micGuideLaunchBody') : t('workbench.aiVoice.micGuideBody')}
                </Typography>
                {voiceDiag && (
                  <Typography
                    sx={{
                      fontSize: uiFontSize(9),
                      fontFamily: 'monospace',
                      color: 'text.disabled',
                      lineHeight: 1.4,
                      mt: 0.25,
                      wordBreak: 'break-all',
                    }}
                  >
                    {voiceDiag}
                  </Typography>
                )}
              </Box>
              <IconButton
                size="small"
                onClick={toggleVoice}
                aria-label={t('workbench.aiVoice.micGuideRetry')}
                sx={{
                  p: 0.3,
                  flexShrink: 0,
                  fontSize: uiFontSize(10),
                  '& .MuiSvgIcon-root': { fontSize: uiFontSize(15) },
                }}
              >
                <ReplayIcon />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => setMicGuideOpen(false)}
                aria-label={t('workbench.aiVoice.micGuideClose')}
                sx={{ p: 0.3, flexShrink: 0, '& .MuiSvgIcon-root': { fontSize: uiFontSize(15) } }}
              >
                <CloseIcon />
              </IconButton>
            </Box>
          )}
        </Box>
      </Box>

      {/* 斜杠命令菜单（VS Code 式：输入 / 唤起，按前缀实时过滤；选中把「/cmd 」回填到对应输入框，
          真正的行为在 send 里由 parseSlashCommand 路由为动作——强制模式 + 折叠正文） */}
      <Menu anchorEl={ctx.slashAnchor} open={!!ctx.slashAnchor} onClose={() => ctx.setSlashAnchor(null)}>
        {getSlashCommands(ctx.isBookScene, ctx.genre)
          .filter((s) => s.cmd.startsWith(ctx.slashQuery))
          .map((s) => (
            <MenuItem
              key={s.cmd}
              onClick={() => {
                const prefill = `/${s.cmd} `;
                if (ctx.slashTarget === 'edits') {
                  ctx.setEditInput(prefill);
                  ctx.editInputRef.current?.focus();
                } else {
                  ctx.setInput(prefill);
                  ctx.inputRef.current?.focus();
                }
                ctx.setSlashAnchor(null);
              }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                  <Typography
                    variant="caption"
                    sx={{ fontFamily: 'monospace', color: 'primary.main', fontWeight: 700 }}
                  >{`/${s.cmd}`}</Typography>
                  <Typography variant="caption" sx={{ fontSize: uiFontSize(11) }}>
                    {s.label()}
                  </Typography>
                </Box>
                <Typography variant="caption" sx={{ fontSize: uiFontSize(9.5), color: 'text.secondary' }}>
                  {s.description()}
                </Typography>
              </Box>
            </MenuItem>
          ))}
      </Menu>
    </>
  );
}
