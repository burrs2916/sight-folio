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
import MenuItem from '@mui/material/MenuItem';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
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
import { noteAgeBucket } from '../utils/writingNoteTime';
import { buildTree, treeRowIndent, type TreeNode } from '../utils/writingTree';
import type { WritingChapter } from '../services/writing';

/** 章节筛选哨兵：'' = 全部章节；'__none__' = 未绑定章节；其余为 chapterId */
const NOTE_FILTER_NONE = '__none__';

export interface WritingNotesDialogProps {
  open: boolean;
  onClose: () => void;
  /** 当前书 id */
  bookId: string;
  /** 当前书的所有章（用于下拉绑定 + 显示章名；按 parentId 建树形下拉） */
  chapters: WritingChapter[];
  /** 当前激活章 id（新增笔记时自动填入） */
  activeChapterId: string | null;
  /** 点击章名跳转 */
  onGotoChapter?: (chapterId: string) => void;
  /** 预填内容（浮动按钮「速记」模式时传入） */
  draftContent?: string;
  /** 清草稿回调 */
  onClearDraft?: () => void;
  /** 打开时预置的章节筛选（''=全部；'__none__'=未绑定；chapterId=指定章），正文入口点「本章笔记」用 */
  initialFilterChapterId?: string;
  /** 打开时聚焦的笔记 id（左栏摘要点击进弹窗直接进入该条编辑态） */
  focusNoteId?: string | null;
  /** 列表变动（增/改/删/置顶）后回传最新数组，父级（左栏摘要）同步用 */
  onNotesChange?: (notes: WritingNote[]) => void;
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
  initialFilterChapterId = '',
  focusNoteId = null,
  onNotesChange,
}: WritingNotesDialogProps) {
  const [notes, setNotes] = useState<WritingNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editChapterId, setEditChapterId] = useState('');
  const [editPin, setEditPin] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterChapterId, setFilterChapterId] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const commitNotes = useCallback(
    (next: WritingNote[]) => {
      const sorted = [...next].sort((a, b) => b.pin - a.pin || b.updatedAt - a.updatedAt);
      setNotes(sorted);
      onNotesChange?.(sorted);
    },
    [onNotesChange],
  );

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) {
      for (const tag of parseTags(n.tags)) set.add(tag);
    }
    return Array.from(set);
  }, [notes]);

  const filteredNotes = useMemo(() => {
    let rows = notes;
    if (filterTag) rows = rows.filter((n) => parseTags(n.tags).includes(filterTag));
    if (filterChapterId === NOTE_FILTER_NONE) rows = rows.filter((n) => !n.chapterId);
    else if (filterChapterId) rows = rows.filter((n) => n.chapterId === filterChapterId);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (n) => n.content.toLowerCase().includes(q) || parseTags(n.tags).some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [notes, filterTag, filterChapterId, searchQuery]);

  /** 是否处于过滤态（搜索/标签/章节筛选任一生效），用于区分「无笔记」与「无匹配」 */
  const hasActiveFilter = searchQuery.trim() !== '' || filterTag !== null || filterChapterId !== '';

  // 删除二次确认：点击「删除」图标进入确认态，4 秒未操作自动恢复
  useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = setTimeout(() => setConfirmDeleteId(null), 4000);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

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
      setFilterChapterId(initialFilterChapterId);
      setSearchQuery('');
      setFilterTag(null);
      reload().finally(() => setLoading(false));
    }
  }, [open, bookId, reload, initialFilterChapterId]);

  // 打开后若指定 focusNoteId：等列表加载完成，聚焦该条进入编辑态（startEdit 在下方定义）
  const focusAppliedRef = useRef<string | null>(null);

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
      commitNotes([...notes.filter((n) => n.id !== item.id), item]);
      setEditingId(null);
      setEditContent('');
      setEditTags('');
      setEditChapterId('');
      setEditPin(false);
      setConfirmDeleteId(null);
    } catch (e) {
      logger.warn('WritingNotesDialog', 'save note failed', { error: e });
      useToastStore.getState().error(t('writing.noteSaveFailed'));
    }
  }, [bookId, editContent, editTags, editChapterId, editPin, editingId, notes, commitNotes]);

  /** 保存并继续：保存当前内容后立即进入新建态，不打断连续速记 */
  const saveAndContinue = useCallback(async () => {
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
      commitNotes([...notes.filter((n) => n.id !== item.id), item]);
      // 连续速记：清空内容但保持新建态，绑定章沿用当前章
      setEditingId('__new__');
      setEditContent('');
      setEditTags('');
      setEditPin(false);
    } catch (e) {
      logger.warn('WritingNotesDialog', 'save note failed', { error: e });
      useToastStore.getState().error(t('writing.noteSaveFailed'));
    }
  }, [bookId, editContent, editTags, editChapterId, editPin, editingId, notes, commitNotes]);

  /** 快捷置顶：列表卡片上直接切换，不进入编辑态 */
  const quickPin = useCallback(
    async (note: WritingNote) => {
      const next: WritingNote = {
        ...note,
        pin: note.pin ? 0 : 1,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      try {
        await writingNotesApi.save(next);
        commitNotes([...notes.filter((n) => n.id !== next.id), next]);
      } catch (e) {
        logger.warn('WritingNotesDialog', 'pin note failed', { error: e });
        useToastStore.getState().error(t('writing.noteSaveFailed'));
      }
    },
    [notes, commitNotes],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      try {
        await writingNotesApi.delete(id);
        commitNotes(notes.filter((n) => n.id !== id));
        setConfirmDeleteId(null);
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
    [editingId, notes, commitNotes],
  );

  const chapterTitle = useCallback((id: string) => chapters.find((c) => c.id === id)?.title || '', [chapters]);

  // 章节树展平：供筛选/绑定下拉按树层级展开（与 WritingPage 落章下拉、大纲树共用 buildTree 口径）
  const chapterRows = useMemo(() => {
    const rows: { id: string; title: string; depth: number }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        rows.push({ id: n.node.id, title: n.node.title, depth: n.depth });
        walk(n.children);
      }
    };
    walk(buildTree(chapters));
    return rows;
  }, [chapters]);

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

  // 打开后若指定 focusNoteId：等列表加载完成，聚焦该条进入编辑态
  useEffect(() => {
    if (!open || !focusNoteId) {
      focusAppliedRef.current = null;
      return;
    }
    if (focusAppliedRef.current === focusNoteId) return;
    const target = notes.find((n) => n.id === focusNoteId);
    if (target) {
      focusAppliedRef.current = focusNoteId;
      const timer = setTimeout(() => startEdit(target), 0);
      return () => clearTimeout(timer);
    }
  }, [open, focusNoteId, notes, startEdit]);

  /** 相对时间显示（分档 i18n） */
  const formatAge = useCallback((tsSec: number): string => {
    const b = noteAgeBucket(tsSec);
    switch (b.kind) {
      case 'justNow':
        return t('writing.noteAgeJustNow');
      case 'minutes':
        return t('writing.noteAgeMinutes', { n: b.value });
      case 'hours':
        return t('writing.noteAgeHours', { n: b.value });
      case 'yesterday':
        return t('writing.noteAgeYesterday');
      default:
        return t('writing.noteAgeDays', { n: b.value });
    }
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
        {/* 搜索 + 章节筛选工具条 */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            fullWidth
            placeholder={t('writing.noteSearchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon sx={{ fontSize: 16 }} />
                  </InputAdornment>
                ),
              },
              htmlInput: { 'data-testid': 'note-search-input' },
            }}
          />
          <TextField
            select
            size="small"
            sx={{ minWidth: 150 }}
            slotProps={{
              select: { native: false },
              htmlInput: { 'data-testid': 'note-filter-chapter' },
            }}
            value={filterChapterId}
            onChange={(e) => setFilterChapterId(e.target.value)}
          >
            <MenuItem value="">{t('writing.noteAllChapters')}</MenuItem>
            <MenuItem value={NOTE_FILTER_NONE}>{t('writing.noteUnbound')}</MenuItem>
            {chapterRows.map((r) => (
              <MenuItem key={r.id} value={r.id} sx={{ pl: treeRowIndent(r.depth) }}>
                {r.title || t('writingWorkbench.untitled')}
              </MenuItem>
            ))}
          </TextField>
        </Box>

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
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void saveCurrent();
                }
              }}
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
                  select: { native: false },
                  htmlInput: { 'data-testid': 'note-chapter-select' },
                }}
                value={editChapterId}
                onChange={(e) => setEditChapterId(e.target.value)}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="">{t('writing.noteNoChapter')}</MenuItem>
                {chapterRows.map((r) => (
                  <MenuItem key={r.id} value={r.id} sx={{ pl: treeRowIndent(r.depth) }}>
                    {r.title || t('writingWorkbench.untitled')}
                  </MenuItem>
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
                <Button size="small" variant="outlined" onClick={saveAndContinue} data-testid="note-save-continue">
                  {t('writing.noteSaveAndContinue')}
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
            {hasActiveFilter ? t('writing.noteNoMatch') : t('writing.noteEmpty')}
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
                  <Tooltip title={note.pin !== 0 ? t('writing.noteUnpin') : t('writing.notePin')}>
                    <IconButton size="small" onClick={() => void quickPin(note)} data-testid="note-pin">
                      {note.pin !== 0 ? (
                        <PushPinRoundedIcon sx={{ fontSize: 14, color: 'primary.main' }} />
                      ) : (
                        <PushPinOutlinedIcon sx={{ fontSize: 14 }} />
                      )}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('writing.noteEdit')}>
                    <IconButton size="small" onClick={() => startEdit(note)} data-testid="note-edit">
                      <EditRoundedIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                  {confirmDeleteId === note.id ? (
                    <Button
                      size="small"
                      color="error"
                      variant="text"
                      onClick={() => void deleteNote(note.id)}
                      data-testid="note-delete-confirm"
                      sx={{ minWidth: 0, px: 0.5, fontSize: 10.5 }}
                    >
                      {t('writing.noteDeleteAsk')}
                    </Button>
                  ) : (
                    <Tooltip title={t('writing.noteDelete')}>
                      <IconButton size="small" onClick={() => setConfirmDeleteId(note.id)} data-testid="note-delete">
                        <DeleteRoundedIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  )}
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
              <Tooltip title={new Date(note.updatedAt * 1000).toLocaleString()} placement="left">
                <Typography
                  sx={{ fontSize: 10, color: 'text.disabled', mt: 0.25, textAlign: 'right', cursor: 'default' }}
                >
                  {formatAge(note.updatedAt)}
                </Typography>
              </Tooltip>
            </Box>
          ))
        )}
      </DialogContent>
    </Dialog>
  );
}
