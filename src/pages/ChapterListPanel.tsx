// 写作台左栏章列表（路线 B P1 收尾：从 WritingPage 抽离为 React.memo 组件）
//
// 目的：每 800ms 自动保存会翻转 WritingPage 顶层 saveState，触发整组件重渲染。
// 章列表是左栏最重的子树（逐章行 + 每行的拖拽 / 选中 / 菜单句柄）。把它抽成 memo 组件，
// 且所有 props 均为稳定引用（WritingPage 侧 openDialog=useCallback、flushSave=useCallback、
// setActiveChapter/setActiveSetting/reorderChapter=store 选择器、setSelectedChapterIds/setDropIndex=useState setter、
// visibleChapters/chapterIndexById=useMemo、dragChapterIdRef=ref、outlines=store 选择器），
// 即可在 saveState 翻转（打字 / 自动保存）时跳过整段列表重渲染——React.memo 浅比较全部命中。
//
// 注：t / logger / useToastStore 是模块级稳定单例，直接 import，不进 props，
// 既避免无意义 prop 抖动，也减小 memo 比较面。
import { Fragment, memo } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import type { WritingChapter, WritingOutline } from '../services/tauri';
import { t } from '../i18n';
import { logger } from '../utils/logger';
import { useToastStore } from '../store/toastStore';

/** 章列表只触发这三种对话框，用窄联合解耦 WritingPage 那个巨大的内联 dialog 联合。 */
export type ChapterListDialog =
  | { kind: 'move-volume'; chapterId: string }
  | { kind: 'rename-chapter'; chapterId: string }
  | { kind: 'delete-chapter'; chapterId: string };

export interface ChapterListPanelProps {
  visibleChapters: WritingChapter[];
  chapterIndexById: Map<string, number>;
  activeChapterId: string | null;
  chapterQuery: string;
  chapterSearchQuery: string;
  selectionMode: boolean;
  selectedChapterIds: string[];
  setSelectedChapterIds: Dispatch<SetStateAction<string[]>>;
  setActiveSetting: (id: string | null) => void;
  setActiveChapter: (id: string) => void;
  dragChapterIdRef: MutableRefObject<string | null>;
  flushSave: () => Promise<void>;
  setDropIndex: (i: number | null) => void;
  reorderChapter: (id: string, toIndex: number) => Promise<void>;
  dropIndex: number | null;
  openDialog: (d: ChapterListDialog, initialText?: string) => void;
  outlines: WritingOutline[];
}

function ChapterListPanelInner(props: ChapterListPanelProps) {
  const {
    visibleChapters,
    chapterIndexById,
    activeChapterId,
    chapterQuery,
    chapterSearchQuery,
    selectionMode,
    selectedChapterIds,
    setSelectedChapterIds,
    setActiveSetting,
    setActiveChapter,
    dragChapterIdRef,
    flushSave,
    setDropIndex,
    reorderChapter,
    dropIndex,
    openDialog,
    outlines,
  } = props;

  const searching = chapterSearchQuery.length > 0;

  if (searching && visibleChapters.length === 0) {
    return (
      <Typography sx={{ fontSize: 11.5, color: 'text.disabled', textAlign: 'center', py: 2 }}>
        {t('writing.searchNoMatch', { q: chapterQuery.trim() })}
      </Typography>
    );
  }

  return (
    <>
      {visibleChapters.map((chapter, vIdx) => {
        // P1 性能：memo 化的下标 Map，O(1) 取代 chapters.indexOf 的 O(n²) 整书重扫
        const idx = chapterIndexById.get(chapter.id) ?? 0;
        const selected = chapter.id === activeChapterId;
        const boundBeat = outlines.find((o) => o.chapterId === chapter.id);
        // 卷分组头（P6）：书里出现过任一命名卷才启用分组展示
        const prev = vIdx > 0 ? visibleChapters[vIdx - 1] : null;
        const anyNamedVolume = visibleChapters.some((c) => c.volume);
        const showVolumeHeader =
          anyNamedVolume && chapter.volume !== (prev ? prev.volume : '\u0000no-prev');
        const header = showVolumeHeader ? (
          <Typography
            key={`hdr_${chapter.id}`}
            sx={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 0.5,
              color: 'primary.main',
              textTransform: 'uppercase',
              px: 1,
              pt: 1,
              pb: 0.25,
            }}
          >
            {chapter.volume || t('writing.volumeNone')}
          </Typography>
        ) : null;

        const row = (
          <Box
            key={chapter.id}
            data-testid={`chapter-row-${chapter.id}`}
            onClick={() => {
              // 批量模式：点击行 = 切换选中，不打开章节
              if (selectionMode) {
                setSelectedChapterIds((ids) =>
                  ids.includes(chapter.id) ? ids.filter((x) => x !== chapter.id) : [...ids, chapter.id],
                );
                return;
              }
              setActiveSetting(null);
              setActiveChapter(chapter.id);
            }}
            draggable={!searching && !selectionMode}
            onDragStart={(e) => {
              dragChapterIdRef.current = chapter.id;
              e.dataTransfer.effectAllowed = 'move';
              // 排序会全行写回落库，先 flush 未保存正文避免旧内容覆盖新输入
              void flushSave();
            }}
            onDragOver={(e) => {
              if (!dragChapterIdRef.current || searching || selectionMode) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropIndex(idx);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const draggedId = dragChapterIdRef.current;
              dragChapterIdRef.current = null;
              setDropIndex(null);
              if (draggedId && draggedId !== chapter.id) {
                void reorderChapter(draggedId, idx).catch((err) => {
                  logger.warn('WritingPage', 'reorder chapter failed', { error: err });
                  useToastStore.getState().error(String(err));
                });
              }
            }}
            onDragEnd={() => {
              dragChapterIdRef.current = null;
              setDropIndex(null);
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1,
              py: 0.6,
              borderRadius: 1.5,
              cursor: 'pointer',
              bgcolor: selected ? 'rgba(74,51,143,0.08)' : 'transparent',
              '&:hover': { bgcolor: 'action.hover' },
              '& .row-actions': { opacity: 0 },
              '&:hover .row-actions': { opacity: 1 },
              // 放置指示线：落在该行上方
              boxShadow: (th) =>
                dropIndex === idx ? `inset 0 2px 0 0 ${th.palette.primary.main}` : undefined,
            }}
          >
            {selectionMode &&
              (selectedChapterIds.includes(chapter.id) ? (
                <CheckCircleRoundedIcon sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
              ) : (
                <RadioButtonUncheckedRoundedIcon
                  sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }}
                />
              ))}
            <Typography
              noWrap
              sx={{ fontSize: 12.5, fontWeight: selected ? 600 : 400, flex: 1, minWidth: 0 }}
            >
              <Box component="span" sx={{ color: 'text.disabled', mr: 0.75, fontSize: 11 }}>
                {idx + 1}
              </Box>
              {chapter.title}
            </Typography>
            {boundBeat && (
              <Tooltip title={`${t('writing.tabOutline')} · ${boundBeat.title}`}>
                <FlagRoundedIcon sx={{ fontSize: 12, color: 'primary.main', flexShrink: 0 }} />
              </Tooltip>
            )}
            <Typography sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }}>
              {chapter.wordCount > 0 ? t('writing.words', { n: chapter.wordCount }) : ''}
            </Typography>
            <Box
              className="row-actions"
              sx={{ display: selectionMode ? 'none' : 'flex', transition: 'opacity 0.15s' }}
            >
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  openDialog({ kind: 'move-volume', chapterId: chapter.id }, chapter.volume);
                }}
              >
                <DriveFileMoveRoundedIcon sx={{ fontSize: 13 }} />
              </IconButton>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  openDialog({ kind: 'rename-chapter', chapterId: chapter.id }, chapter.title);
                }}
              >
                <EditRoundedIcon sx={{ fontSize: 13 }} />
              </IconButton>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  openDialog({ kind: 'delete-chapter', chapterId: chapter.id });
                }}
              >
                <DeleteOutlineRoundedIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Box>
          </Box>
        );
        return (
          <Fragment key={chapter.id}>
            {header}
            {row}
          </Fragment>
        );
      })}
    </>
  );
}

export const ChapterListPanel = memo(ChapterListPanelInner);
