import { useMemo } from 'react';
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded';
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded';
import FormatStrikethroughRoundedIcon from '@mui/icons-material/FormatStrikethroughRounded';
import HighlightRoundedIcon from '@mui/icons-material/HighlightRounded';
import FormatUnderlinedRoundedIcon from '@mui/icons-material/FormatUnderlinedRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded';
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded';
import { Typography } from '@mui/material';
import { useAssetPickerStore } from '../../store/assetPickerStore';
import { t } from '../../i18n';
import { insertIllustrationIntoEditor } from '../../editor/extensions/writingImage';
import type { Editor } from '@tiptap/react';

export interface ToolbarButton {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: (e?: React.MouseEvent<HTMLElement>) => void;
}

export interface ToolbarDeps {
  editor: Editor | null;
  openDialog: (payload: { kind: 'insert-link' }) => void;
  handleStartAnnotation: () => void;
  setTableMenuAnchor: (el: HTMLElement | null) => void;
}

/** 工具栏按钮统一收口：格式化 / 链接 / 标题 / 表格 / 插图 / 批注 */
export function useToolbarButtons({ editor, openDialog, handleStartAnnotation, setTableMenuAnchor }: ToolbarDeps) {
  const toolbarBtnSx = (active: boolean) => ({
    color: active ? 'primary.main' : 'text.secondary',
    bgcolor: active ? 'action.selected' : 'transparent',
    '&:hover': { bgcolor: 'action.hover' },
  });

  const toolButtons: ToolbarButton[] = useMemo(() => {
    const buttons: ToolbarButton[] = [];
    if (!editor) return buttons;
    buttons.push(
      {
        icon: <FormatBoldRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtBold'),
        active: editor.isActive('bold'),
        onClick: () => editor.chain().focus().toggleBold().run(),
      },
      {
        icon: <FormatItalicRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtItalic'),
        active: editor.isActive('italic'),
        onClick: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        icon: <FormatStrikethroughRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtStrike'),
        active: editor.isActive('strike'),
        onClick: () => editor.chain().focus().toggleStrike().run(),
      },
      {
        icon: <HighlightRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtHighlight'),
        active: editor.isActive('highlight'),
        onClick: () => editor.chain().focus().toggleHighlight().run(),
      },
      {
        icon: <FormatUnderlinedRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtUnderline'),
        active: editor.isActive('underline'),
        onClick: () => editor.chain().focus().toggleUnderline().run(),
      },
      {
        icon: <LinkRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtLink'),
        active: editor.isActive('link'),
        onClick: () => openDialog({ kind: 'insert-link' }),
      },
      {
        icon: <Typography sx={{ fontSize: 12, fontWeight: 700 }}>H1</Typography>,
        label: t('writing.fmtH1'),
        active: editor.isActive('heading', { level: 1 }),
        onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        icon: <Typography sx={{ fontSize: 12, fontWeight: 700 }}>H2</Typography>,
        label: t('writing.fmtH2'),
        active: editor.isActive('heading', { level: 2 }),
        onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        icon: <FormatQuoteRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtQuote'),
        active: editor.isActive('blockquote'),
        onClick: () => editor.chain().focus().toggleBlockquote().run(),
      },
      {
        icon: <FormatListBulletedRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtBullet'),
        active: editor.isActive('bulletList'),
        onClick: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        icon: <FormatListNumberedRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.fmtOrdered'),
        active: editor.isActive('orderedList'),
        onClick: () => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        icon: <TableChartRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.insertTable'),
        active: editor.isActive('table'),
        onClick: (e) => {
          // 光标已在表格内：按钮变为表格操作菜单入口（增删行/列、删表）
          if (editor.isActive('table')) {
            if (e) setTableMenuAnchor(e.currentTarget);
          } else {
            editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run();
          }
        },
      },
      {
        icon: <ImageRoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.insertImage'),
        active: false,
        onClick: () =>
          useAssetPickerStore.getState().openPicker({
            editorInserter: (a) => {
              if (editor) void insertIllustrationIntoEditor(editor, a);
            },
          }),
      },
      {
        icon: <StickyNote2RoundedIcon sx={{ fontSize: 18 }} />,
        label: t('writing.annotationAdd'),
        active: editor.isActive('writingAnnotation'),
        onClick: handleStartAnnotation,
      },
    );
    return buttons;
  }, [editor, openDialog, handleStartAnnotation, setTableMenuAnchor]);

  return { toolButtons, toolbarBtnSx };
}
