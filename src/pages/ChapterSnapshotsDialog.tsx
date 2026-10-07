// 章节版本快照对话框（批次④）：列表 + 恢复 + 手动快照 + diff 对比 + 自定义命名。
//
// 快照来源：切章时内容有改动自动存一份（origin=auto）+ 手动存（origin=manual）。
// 每章保留最近 20 份（后端事务内裁剪）。
// 恢复是可逆的：父层先把当前正文存一份快照，再 setContent。
import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import PreviewRoundedIcon from '@mui/icons-material/PreviewRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { writingSnapshotsApi, type WritingChapterSnapshot } from '../services/tauri';
import { t } from '../i18n';

function fmtTime(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ─── 行级 Diff（LCS 最长公共子序列）───
type DiffOp = { type: 'eq' | 'ins' | 'del'; line: string };

function lineDiff(a: string[], b: string[]): DiffOp[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      ops.push({ type: 'eq', line: a[i] });
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ type: 'ins', line: b[j] });
      j++;
    } else if (i < m) {
      ops.push({ type: 'del', line: a[i] });
      i++;
    } else {
      // 安全兜底，不应触发
      break;
    }
  }
  return ops;
}

function htmlToText(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.innerText || tmp.textContent || '';
}

function computeDiffOps(currentHtml: string, snapshotHtml: string): DiffOp[] {
  const a = htmlToText(currentHtml).split('\n');
  const b = htmlToText(snapshotHtml).split('\n');
  return lineDiff(a, b);
}

function SnapshotName({
  snapshot,
  editingId,
  draftName,
  onStartEdit,
  onChange,
  onSave,
  onCancel,
}: {
  snapshot: WritingChapterSnapshot;
  editingId: string | null;
  draftName: string;
  onStartEdit: (s: WritingChapterSnapshot) => void;
  onChange: (v: string) => void;
  onSave: (id: string, name: string | null) => void;
  onCancel: () => void;
}) {
  const isEditing = editingId === snapshot.id;
  const displayName = snapshot.name?.trim();
  const label = displayName
    ? displayName
    : snapshot.origin === 'manual'
      ? t('writing.snapshots.originManual')
      : t('writing.snapshots.originAuto');

  if (isEditing) {
    return (
      <TextField
        autoFocus
        size="small"
        fullWidth
        value={draftName}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onSave(snapshot.id, draftName.trim() || null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(snapshot.id, draftName.trim() || null);
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={t('writing.snapshots.renamePlaceholder')}
        slotProps={{ input: { sx: { fontSize: 12, py: 0.2 } } }}
        sx={{ flex: 1 }}
      />
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
      <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0 }}>
        {label}
      </Typography>
      <Tooltip title={t('writing.snapshots.rename')}>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit(snapshot);
          }}
          sx={{ p: 0.3, '& .MuiSvgIcon-root': { fontSize: 13 } }}
        >
          <EditRoundedIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function DiffPanel({
  currentHtml,
  snapshot,
  onRestore,
  onBack,
}: {
  currentHtml: string;
  snapshot: WritingChapterSnapshot;
  onRestore: (content: string, wordCount: number) => void;
  onBack: () => void;
}) {
  const ops = useMemo(() => computeDiffOps(currentHtml, snapshot.content), [currentHtml, snapshot.content]);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <IconButton size="small" onClick={onBack} sx={{ p: 0.3 }}>
          <ArrowBackRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <Typography sx={{ fontSize: 13, fontWeight: 700, flex: 1 }}>
          {t('writing.snapshots.diffTitle', { time: fmtTime(snapshot.createdAt) })}
        </Typography>
        <Button size="small" variant="contained" onClick={() => onRestore(snapshot.content, snapshot.wordCount)}>
          {t('writing.snapshots.restoreThisVersion')}
        </Button>
      </Box>
      <Divider sx={{ mb: 1 }} />
      <Box sx={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6 }}>
        {ops.map((op, idx) => (
          <Box
            key={idx}
            sx={{
              px: 1,
              py: 0.25,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              bgcolor:
                op.type === 'ins'
                  ? 'rgba(46, 204, 113, 0.12)'
                  : op.type === 'del'
                    ? 'rgba(231, 76, 60, 0.12)'
                    : 'transparent',
              color: op.type === 'eq' ? 'text.secondary' : 'text.primary',
              borderLeft: 3,
              borderColor: op.type === 'ins' ? 'success.main' : op.type === 'del' ? 'error.main' : 'transparent',
            }}
          >
            {op.type === 'ins' ? '+ ' : op.type === 'del' ? '- ' : '  '}
            {op.line || '\u00A0'}
          </Box>
        ))}
        {ops.length === 0 && (
          <Typography sx={{ fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 4 }}>
            {t('writing.snapshots.noDiff')}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export function ChapterSnapshotsDialog({
  open,
  onClose,
  chapterId,
  currentContent,
  currentWordCount,
  onManualSnapshot,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  chapterId: string | null;
  /** 当前正文 HTML，用于 diff 对比 */
  currentContent: string;
  currentWordCount: number;
  /** 手动快照（编辑器实例在父层，取当前正文由父层完成） */
  onManualSnapshot: () => Promise<void>;
  /** 恢复某快照：父层负责先存当前内容快照 + setContent + 落库 */
  onRestore: (content: string, wordCount: number) => void;
}) {
  const [items, setItems] = useState<WritingChapterSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<WritingChapterSnapshot | null>(null);

  // Diff 预览状态
  const [diffSnapshot, setDiffSnapshot] = useState<WritingChapterSnapshot | null>(null);

  // 重命名状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const refresh = useCallback(async () => {
    if (!chapterId) return;
    setLoading(true);
    try {
      setItems(await writingSnapshotsApi.list(chapterId));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [chapterId]);

  // 对话框每次打开清掉上次遗留的恢复确认（渲染期调整 state，避免 effect 同步 setState）
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setPending(null);
      setDiffSnapshot(null);
      setEditingId(null);
    }
  }

  useEffect(() => {
    // 打开时加载快照：走微任务发起（refresh 同步段含 setLoading，移出 effect
    // 同步调用链避免级联渲染；拉取本身仍为异步）
    if (open) void Promise.resolve().then(refresh);
  }, [open, refresh]);

  const handleStartRename = useCallback((s: WritingChapterSnapshot) => {
    setEditingId(s.id);
    setDraftName(s.name || '');
  }, []);

  const handleSaveRename = useCallback(async (id: string, name: string | null) => {
    setEditingId(null);
    // 先乐观更新 UI
    setItems((prev) => prev.map((s) => (s.id === id ? { ...s, name: name ?? undefined } : s)));
    try {
      await writingSnapshotsApi.rename(id, name);
    } catch (_e) {
      // 后端未实现 rename API 时静默回退到 localStorage
      try {
        const key = `sf_snapshot_names`;
        const raw = localStorage.getItem(key);
        const map: Record<string, string | null> = raw ? JSON.parse(raw) : {};
        map[id] = name;
        localStorage.setItem(key, JSON.stringify(map));
      } catch {
        // 忽略 localStorage 错误
      }
    }
  }, []);

  const handleCancelRename = useCallback(() => {
    setEditingId(null);
    setDraftName('');
  }, []);

  // 对话框关闭时清理
  const handleClose = useCallback(() => {
    setPending(null);
    setDiffSnapshot(null);
    setEditingId(null);
    onClose();
  }, [onClose]);

  // 合并 localStorage 中的重命名（后端未支持时）
  const mergedItems = useMemo(() => {
    try {
      const raw = localStorage.getItem('sf_snapshot_names');
      const map: Record<string, string | null> = raw ? JSON.parse(raw) : {};
      return items.map((s) => {
        if (map[s.id] !== undefined) return { ...s, name: map[s.id] ?? undefined };
        return s;
      });
    } catch {
      return items;
    }
  }, [items]);

  const [currentSnapshotNow] = useState(() => Math.floor(Date.now() / 1000));
  const currentSnapshot: WritingChapterSnapshot = useMemo(
    () => ({
      id: '__current__',
      chapterId: chapterId ?? '',
      bookId: '',
      content: currentContent,
      wordCount: currentWordCount,
      origin: 'manual',
      createdAt: currentSnapshotNow,
      name: t('writing.snapshots.currentContent'),
    }),
    [chapterId, currentContent, currentWordCount, currentSnapshotNow],
  );

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{t('writing.snapshots.title')}</Typography>
        <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>
          {t('writing.snapshots.keepHint', { n: 20 })}
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ px: 1, minHeight: 360 }}>
        {diffSnapshot ? (
          <DiffPanel
            currentHtml={currentContent}
            snapshot={diffSnapshot}
            onRestore={(content, wordCount) => {
              setDiffSnapshot(null);
              onRestore(content, wordCount);
            }}
            onBack={() => setDiffSnapshot(null)}
          />
        ) : (
          <>
            {pending && (
              <Box
                sx={{
                  mb: 1,
                  mx: 0.5,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: 'rgba(139,92,246,0.08)',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mb: 1, lineHeight: 1.6 }}>
                  {t('writing.snapshots.restoreHint', { time: fmtTime(pending.createdAt) })}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                  <Button size="small" onClick={() => setPending(null)}>
                    {t('nav.cancel')}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => {
                      onRestore(pending.content, pending.wordCount);
                      setPending(null);
                    }}
                  >
                    {t('writing.snapshots.restore')}
                  </Button>
                </Box>
              </Box>
            )}
            <List dense disablePadding>
              {/* 当前正文行（与快照列表对比） */}
              <ListItemButton
                key="__current__"
                onClick={() => setDiffSnapshot(currentSnapshot)}
                disabled={!!pending}
                sx={{
                  borderRadius: 1,
                  mb: 0.5,
                  bgcolor: 'action.hover',
                  '&:hover': { bgcolor: 'rgba(74,51,143,0.08)' },
                }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        size="small"
                        label={t('writing.snapshots.currentContent')}
                        color="primary"
                        variant="outlined"
                        sx={{ fontSize: 10, height: 18 }}
                      />
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                        {t('writing.words', { n: currentWordCount })}
                      </Typography>
                    </Box>
                  }
                  secondary={t('writing.snapshots.diffCurrentHint')}
                  slotProps={{ secondary: { sx: { fontSize: 10.5 } } }}
                />
                <Tooltip title={t('writing.snapshots.previewDiff')}>
                  <IconButton
                    size="small"
                    edge="end"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDiffSnapshot(currentSnapshot);
                    }}
                    sx={{ p: 0.3, ml: 0.5, '& .MuiSvgIcon-root': { fontSize: 14 } }}
                  >
                    <PreviewRoundedIcon />
                  </IconButton>
                </Tooltip>
              </ListItemButton>
              <Divider sx={{ my: 0.5 }} />

              {mergedItems.map((s) => (
                <ListItemButton
                  key={s.id}
                  onClick={() => setPending(s)}
                  disabled={!!pending}
                  sx={{ borderRadius: 1, mb: 0.25 }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <SnapshotName
                          snapshot={s}
                          editingId={editingId}
                          draftName={draftName}
                          onStartEdit={handleStartRename}
                          onChange={setDraftName}
                          onSave={handleSaveRename}
                          onCancel={handleCancelRename}
                        />
                        <Typography sx={{ fontSize: 11, color: 'text.disabled', flexShrink: 0 }}>
                          {fmtTime(s.createdAt)}
                        </Typography>
                      </Box>
                    }
                    secondary={t('writing.words', { n: s.wordCount })}
                    slotProps={{ secondary: { sx: { fontSize: 10.5 } } }}
                  />
                  <Tooltip title={t('writing.snapshots.previewDiff')}>
                    <IconButton
                      size="small"
                      edge="end"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDiffSnapshot(s);
                      }}
                      sx={{ p: 0.3, ml: 0.5, '& .MuiSvgIcon-root': { fontSize: 14 } }}
                    >
                      <PreviewRoundedIcon />
                    </IconButton>
                  </Tooltip>
                </ListItemButton>
              ))}
              {!loading && mergedItems.length === 0 && (
                <Typography sx={{ fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 2, px: 1 }}>
                  {t('writing.snapshots.empty')}
                </Typography>
              )}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          size="small"
          onClick={async () => {
            await onManualSnapshot();
            void refresh();
          }}
        >
          {t('writing.snapshots.manual')}
        </Button>
        <Button size="small" onClick={handleClose}>
          {t('nav.cancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
