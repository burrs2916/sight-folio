import { useMemo } from 'react';
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded';
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded';
import FormatStrikethroughRoundedIcon from '@mui/icons-material/FormatStrikethroughRounded';
import FormatUnderlinedRoundedIcon from '@mui/icons-material/FormatUnderlinedRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import { Typography } from '@mui/material';
import { t } from '../../i18n';
import type { Editor } from '@tiptap/react';
import { uiFontSize } from '../../theme/appearanceScales';

export interface ToolbarButton {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: (e?: React.MouseEvent<HTMLElement>) => void;
}

export interface ToolbarDeps {
  editor: Editor | null;
  openDialog: (payload: { kind: 'insert-link' }) => void;
}

/**
 * 工具栏按钮统一收口（创作台重设计 · 方向 B）：
 * primary = 行内高频 ≤10 项（B/I/U/S、H1/H2、引用、列表、链接），
 * 格式全家桶（表格/插图/批注/排版/有序列表）收进「Aa 格式」子菜单，
 * 多色高亮色板在 WritingPage 内联渲染（含色板 Popover）。
 */
export function useToolbarButtons({ editor, openDialog }: ToolbarDeps) {
  const toolbarBtnSx = (active: boolean) => ({
    color: active ? 'primary.main' : 'text.secondary',
    bgcolor: active ? 'action.selected' : 'transparent',
    '&:hover': { bgcolor: 'action.hover' },
  });

  const primary: ToolbarButton[] = useMemo(() => {
    const buttons: ToolbarButton[] = [];
    if (!editor) return buttons;
    buttons.push(
      {
        icon: <FormatBoldRoundedIcon sx={{ fontSize: uiFontSize(17) }} />,
        label: t('writing.fmtBold'),
        active: editor.isActive('bold'),
        onClick: () => editor.chain().focus().toggleBold().run(),
      },
      {
        icon: <FormatItalicRoundedIcon sx={{ fontSize: uiFontSize(17) }} />,
        label: t('writing.fmtItalic'),
        active: editor.isActive('italic'),
        onClick: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        icon: <FormatUnderlinedRoundedIcon sx={{ fontSize: uiFontSize(17) }} />,
        label: t('writing.fmtUnderline'),
        active: editor.isActive('underline'),
        onClick: () => editor.chain().focus().toggleUnderline().run(),
      },
      {
        icon: <FormatStrikethroughRoundedIcon sx={{ fontSize: uiFontSize(17) }} />,
        label: t('writing.fmtStrike'),
        active: editor.isActive('strike'),
        onClick: () => editor.chain().focus().toggleStrike().run(),
      },
      {
        icon: <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 700 }}>H1</Typography>,
        label: t('writing.fmtH1'),
        active: editor.isActive('heading', { level: 1 }),
        onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        icon: <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 700 }}>H2</Typography>,
        label: t('writing.fmtH2'),
        active: editor.isActive('heading', { level: 2 }),
        onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        icon: <FormatQuoteRoundedIcon sx={{ fontSize: uiFontSize(17) }} />,
        label: t('writing.fmtQuote'),
        active: editor.isActive('blockquote'),
        onClick: () => editor.chain().focus().toggleBlockquote().run(),
      },
      {
        icon: <FormatListBulletedRoundedIcon sx={{ fontSize: uiFontSize(17) }} />,
        label: t('writing.fmtBullet'),
        active: editor.isActive('bulletList'),
        onClick: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        icon: <LinkRoundedIcon sx={{ fontSize: uiFontSize(17) }} />,
        label: t('writing.fmtLink'),
        active: editor.isActive('link'),
        onClick: () => openDialog({ kind: 'insert-link' }),
      },
    );
    return buttons;
  }, [editor, openDialog]);

  return { primary, toolbarBtnSx };
}
