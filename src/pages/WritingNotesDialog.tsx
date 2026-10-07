// 写作台灵感/快速笔记收集器（T4）：全局级跨章笔记，不中断心流。
//
// 设计要点：
//   1. 对话式弹窗（非全屏），快速添加/查看/编辑笔记。
//   2. 每条笔记可绑定章节（当前激活章自动填入）、可打标签、可置顶（pin）。
//   3. 列表按 pin → updated_at 排序。
//   4. 入口：左栏「笔记」Tab + 编辑器区域浮动 FAB（随时打开）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import BookmarkRoundedIcon from '@mui/icons-material/BookmarkRounded';
import type { WritingNote } from '../services/writing';
import { writingNotesApi, newNoteId } from '../services/writing';
import { t } from '../i18n';
import { useToastStore } from '../store/toastStore';
import { logger } from '../utils/logger';
import type { WritingChapter } from '../services/tauri';

export interface WritingNotesDialogProps {
  open: boolean;
  onClose: () => void;
  /** 当前书 id */
  bookId: string;
  /** 当前书的所有章（用于下拉绑定 + 显示章名） */
  chapters: Pick<WritingChapter, 'id' | 'title'>[];
  /** 当前激活章 id（新增笔记时自动填入） */
  activeChapterId: string | null;
  /** 点击章名跳转 */
  onGotoChapter?: (chapterId: string) => void;
  /** 预填内容（浮动按钮「速记」模式时传入） */
  draftContent?: string;
  /** 清草稿回调 */
  onClearDraft?: () => void;
}

/** 解析 JSON 标签串，容错回退 */
function parseTags(tags: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tags || '[]');
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    /* 坏 JSON 回退空 */
  }
  return [];
}

export function WritingNotesDialog({
  open,
  onClose,
  bookId,
  chapters,
  activeChapterId,
  onGotoChapter,
  draftContent,
  onClearDraft,
}: WritingNotesDialogProps) {
  const [notes, setNotes] = useState<WritingNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editChapterId, setEditChapterId] = useState('');
  const [editPin, setEditPin] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) {
      for (const tag of parseTags(n.tags)) set.add(tag);
    }
    return Array.from(set);
  }, [notes]);

  const filteredNotes = useMemo(() => {
    if (!filterTag) return notes;
    return notes.filter((n) => parseTags(n.tags).includes(filterTag));
  }, [notes, filterTag]);

  // 加载列表
  const reload = useCallback(async () => {
    try {
      const rows = await writingNotesApi.list(bookId);
      setNotes(rows);
    } catch (e) {
      logger.warn('WritingNotesDialog', 'load notes failed', { error: e });
    }
  }, [bookId]);

  useEffect(() => {
    if (open && bookId) {
      setLoading(true);
      reload().finally(() => setLoading(false));
    }
  }, [open, bookId, reload]);

  // 关闭后清理
  const prevOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (wasOpen && !open) {
      const timer = setTimeout(() => {
        setEditingId(null);
        setEditContent('');
        setEditTags('');
        setEditChapterId('');
        setEditPin(false);
        setFilterTag(null);
        onClearDraft?.();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open, onClearDraft]);

  // 草稿模式：有 draftContent 时自动开启新建态
  useEffect(() => {
    if (open && draftContent) {
      setEditingId('__new__');
      setEditContent(draftContent);
      setEditTags('');
      setEditChapterId(activeChapterId ?? '');
      setEditPin(false);
    }
  }, [open, draftContent, activeChapterId]);

  const saveCurrent = useCallback(async () => {
    const content = editContent.trim();
    if (!content) return;
    const now = Math.floor(Date.now() / 1000);
    const tagsArr = editTags
      .split(/[,，;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const item: WritingNote = {
      id: editingId === '__new__' ? newNoteId() : (editingId ?? newNoteId()),
      bookId,
      chapterId: editChapterId,
      content,
      tags: JSON.stringify(tagsArr),
      pin: editPin ? 1 : 0,
      createdAt: editingId === '__new__' ? now : (notes.find((n) => n.id === editingId)?.createdAt ?? now),
      updatedAt: now,
    };
    try {
      await writingNotesApi.save(item);
      useToastStore.getState().success(t('writing.noteSaved'));
      setNotes((prev) => {
        const rest = prev.filter((n) => n.id !== item.id);
        return [...rest, item].sort((a, b) => b.pin - a.pin || b.updatedAt - a.updatedAt);
      });
      setEditingId(null);
      setEditContent('');
      setEditTags('');
      setEditChapterId('');
      setEditPin(false);
    } catch (e) {
      logger.warn('WritingNotesDialog', 'save note failed', { error: e });
      useToastStore.getState().error(t('writing.noteSaveFailed'));
    }
  }, [bookId, editContent, editTags, editChapterId, editPin, editingId, notes]);

  const deleteNote = useCallback(
    async (id: string) => {
      try {
        await writingNotesApi.delete(id);
        setNotes((prev) => prev.filter((n) => n.id !== id));
        if (editingId === id) {
          setEditingId(null);
          setEditContent('');
          setEditTags('');
          setEditChapterId('');
          setEditPin(false);
        }
      } catch (e) {
        logger.warn('WritingNotesDialog', 'delete note failed', { error: e });
        useToastStore.getState().error(t('writing.noteDeleteFailed'));
      }
    },
    [editingId],
  );

  const chapterTitle = useCallback((id: string) => chapters.find((c) => c.id === id)?.title || '', [chapters]);

  const startNew = useCallback(() => {
    setEditingId('__new__');
    setEditContent('');
    setEditTags('');
    setEditChapterId(activeChapterId ?? '');
    setEditPin(false);
  }, [activeChapterId]);

  const startEdit = useCallback((note: WritingNote) => {
    setEditingId(note.id);
    setEditContent(note.content);
    setEditTags(parseTags(note.tags).join(', '));
    setEditChapterId(note.chapterId);
    setEditPin(note.pin !== 0);
  }, []);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <BookmarkRoundedIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        {t('writing.notesTitle')}
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={startNew}
          data-testid="note-new"
        >
          {t('writing.noteAdd')}
        </Button>
        <IconButton size="small" onClick={onClose} aria-label={t('ui.close')}>
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {/* 标签过滤 */}
        {allTags.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
            <Chip
              size="small"
              label={t('writing.noteAll')}
              variant={filterTag === null ? 'filled' : 'outlined'}
              onClick={() => setFilterTag(null)}
            />
            {allTags.map((tag) => (
              <Chip
                key={tag}
                size="small"
                label={tag}
                variant={filterTag === tag ? 'filled' : 'outlined'}
                onClick={() => setFilterTag(tag)}
                sx={{ fontSize: 11 }}
              />
            ))}
          </Box>
        )}

        {/* 编辑/新建区 */}
        {editingId && (
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1.5,
              p: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <TextField
              multiline
              rows={4}
              fullWidth
              autoFocus
              placeholder={t('writing.notePlaceholder')}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              slotProps={{ htmlInput: { 'data-testid': 'note-content-input' } }}
            />
            <TextField
              size="small"
              fullWidth
              placeholder={t('writing.noteTagsHint')}
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              helperText={t('writing.noteTagsHelper')}
              slotProps={{ htmlInput: { 'data-testid': 'note-tags-input' } }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
              <TextField
                select
                size="small"
                slotProps={{
                  select: { native: true },
                  htmlInput: { 'data-testid': 'note-chapter-select' },
                }}
                value={editChapterId}
                onChange={(e) => setEditChapterId(e.target.value)}
                sx={{ minWidth: 180 }}
              >
                <option value="">{t('writing.noteNoChapter')}</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title || t('writingWorkbench.untitled')}
                  </option>
                ))}
              </TextField>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={editPin}
                    onChange={(e) => setEditPin(e.target.checked)}
                    icon={<PushPinRoundedIcon sx={{ fontSize: 16 }} />}
                    checkedIcon={<PushPinRoundedIcon sx={{ fontSize: 16, color: 'primary.main' }} />}
                    size="small"
                  />
                }
                label={t('writing.notePin')}
                sx={{ fontSize: 12, '& .MuiTypography-root': { fontSize: 12 } }}
              />
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button size="small" onClick={() => setEditingId(null)}>
                  {t('ui.cancel')}
                </Button>
                <Button size="small" variant="contained" onClick={saveCurrent} data-testid="note-save">
                  {t('ui.save')}
                </Button>
              </Box>
            </Box>
          </Box>
        )}

        {/* 笔记列表 */}
        {loading ? (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center', py: 4 }}>
            {t('writing.noteLoading')}
          </Typography>
        ) : filteredNotes.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center', py: 4 }}>
            {t('writing.noteEmpty')}
          </Typography>
        ) : (
          filteredNotes.map((note) => (
            <Box
              key={note.id}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1.5,
                p: 1,
                position: 'relative',
                ...(note.pin !== 0 ? { borderColor: 'primary.light', bgcolor: 'action.hover' } : {}),
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 12.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1, mr: 1 }}>
                  {note.content}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
                  <Tooltip title={t('writing.noteEdit')}>
                    <IconButton size="small" onClick={() => startEdit(note)} data-testid="note-edit">
                      <EditRoundedIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('writing.noteDelete')}>
                    <IconButton size="small" onClick={() => deleteNote(note.id)} data-testid="note-delete">
                      <DeleteRoundedIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              {note.chapterId && (
                <Chip
                  size="small"
                  label={chapterTitle(note.chapterId) || t('writingWorkbench.untitled')}
                  variant="outlined"
                  onClick={() => onGotoChapter?.(note.chapterId)}
                  sx={{ mt: 0.5, fontSize: 10.5, height: 18, cursor: onGotoChapter ? 'pointer' : 'default' }}
                  clickable={!!onGotoChapter}
                />
              )}
              {parseTags(note.tags).length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {parseTags(note.tags).map((tag) => (
                    <Chip
                      key={tag}
                      size="small"
                      label={tag}
                      variant="outlined"
                      sx={{ fontSize: 10.5, height: 18 }}
                      onClick={() => setFilterTag(tag)}
                      clickable
                    />
                  ))}
                </Box>
              )}
              <Typography sx={{ fontSize: 10, color: 'text.disabled', mt: 0.25, textAlign: 'right' }}>
                {new Date(note.updatedAt * 1000).toLocaleString()}
              </Typography>
            </Box>
          ))
        )}
      </DialogContent>
    </Dialog>
  );
}
