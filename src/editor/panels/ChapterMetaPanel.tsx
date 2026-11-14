// 章详情卡（书场景大纲点章 → 右栏「属性」tab，2026-09-29）
//
// 形态对齐「发布作品封面」（BookMetaPanel）：章信息 + 132×176 封面预览（无封面/加载失败
// 走文字兜底：主题色 + 卷章号）+ 设置/更换/清除按钮。封面协议与写作台章树完全一致：
// 素材库选择器 coverSetter.kind === 'chapter'，落章 extra.coverImage（parseChapterCover
// 唯一口径），setChapterCover(id, illustrationAssetRef(name)) 即可，零后端字段。
// 章信息只读展示（标题/层级路径/字数/状态），编辑收敛大纲行与写作台。
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import { useWritingStore } from '../../store/writingStore';
import { statusLabelKey } from '../../utils/writingSchema';
import { useAssetPickerStore } from '../../store/assetPickerStore';
import { illustrationAssetRef } from '../extensions/writingImage';
import { CoverThumb } from '../../components/CoverThumb';
import { parseChapterCover } from '../../utils/writingOutline';
import { buildTree, chapterPathLabelMap } from '../../utils/writingTree';
import { COVER_FALLBACK_COLOR } from '../../utils/writingCover';
import { t } from '../../i18n';
import { surfaceKeyForGenre } from '../../utils/writingSchema';



function statusColor(status: string): string {
  if (status === 'finished') return '#2e7d32';
  if (status === 'draft') return '#ed6c02';
  return 'rgba(0,0,0,0.38)';
}

export function ChapterMetaPanel({ chapterId, bookId }: { chapterId: string; bookId: string | null }) {
  const chapter = useWritingStore((s) => s.chapters.find((c) => c.id === chapterId) ?? null);
  const chapters = useWritingStore((s) => s.chapters);
  const book = useWritingStore((s) => s.books.find((b) => b.id === bookId) ?? null);

  // 层级路径标签（卷 1 · 章 3）：与大纲行同一推导口径（chapterPathLabelMap + buildTree）
  const pathLabel = useMemo(() => {
    if (!chapter) return undefined;
    return chapterPathLabelMap(buildTree(chapters)).get(chapter.id);
  }, [chapter, chapters]);

  if (!chapter) return null;

  const cover = parseChapterCover(chapter.extra);
  const openCoverPicker = () => {
    useAssetPickerStore.getState().openPicker({
      coverSetter: {
        kind: 'chapter',
        title: chapter.title || t('writingTree.untitledChapter'),
        hasCover: !!cover,
        clear: () => {
          void useWritingStore.getState().setChapterCover(chapter.id, null);
        },
        apply: (a) => {
          void useWritingStore.getState().setChapterCover(chapter.id, illustrationAssetRef(a.name));
        },
      },
    });
  };

  return (
    <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, p: 1.5 }}>
      {/* 章节信息：层级路径 + 状态徽章 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'text.secondary',
          }}
        >
          {t(surfaceKeyForGenre(book?.genre ?? '', 'unitDetail'))}
        </Typography>
        <Typography
          component="span"
          sx={{
            fontSize: 10,
            fontWeight: 700,
            px: 0.6,
            py: 0.15,
            borderRadius: 0.75,
            color: statusColor(chapter.status),
            bgcolor: 'action.hover',
          }}
        >

        </Typography>
      </Box>
      <Typography sx={{ fontSize: 13.5, fontWeight: 700, wordBreak: 'break-word', mt: 0.5 }}>
        {chapter.title || t('writingTree.untitledChapter')}
      </Typography>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }}>
        {pathLabel?.join(' · ') ?? ''}
        {pathLabel && pathLabel.length > 0 ? ' · ' : ''}
        {t('writing.words', { n: chapter.wordCount })}
      </Typography>

      {/* 章封面：预览（CoverThumb 若显示则无法加载时做文字兜底用关键词） + 设置/更换/清除 */}
      <Typography
        sx={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'text.secondary',
          mt: 2,
          mb: 0.75,
        }}
      >
        {t('writing.chapterCoverTitle')}
      </Typography>
      <Box
        sx={{
          width: 132,
          height: 176,
          borderRadius: 1.5,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          bgcolor: 'action.hover',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {cover ? (
          <CoverThumb
            rel={cover}
            width={132}
            height={176}
            fallback={{
              bookTitle: book?.title,
              pathLabel,
              color: book?.coverColor || COVER_FALLBACK_COLOR,
            }}
          />
        ) : (
          <Box sx={{ textAlign: 'center', color: 'text.disabled', px: 1 }}>
            <MenuBookRoundedIcon sx={{ fontSize: 30, opacity: 0.4 }} />
            <Typography sx={{ fontSize: 10.5, mt: 0.5 }}>{t('writing.chapterCoverEmpty')}</Typography>
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Button
          size="small"
          variant={cover ? 'outlined' : 'contained'}
          onClick={openCoverPicker}
          sx={{ textTransform: 'none', fontSize: 11 }}
        >
          {cover ? t('writing.coverReplace') : t('writing.coverSet')}
        </Button>
        {cover && (
          <Button
            size="small"
            color="inherit"
            onClick={() => void useWritingStore.getState().setChapterCover(chapter.id, null)}
            sx={{ textTransform: 'none', fontSize: 11 }}
          >
            {t('writing.coverClear')}
          </Button>
        )}
      </Box>
    </Box>
  );
}
