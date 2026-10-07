// 正文编辑器样式（P3 排版可调）：按 per-book 排版设置动态生成
import { paperBackground, type BookTypography } from '../../utils/typography';

export function buildEditorBodySx(typo: BookTypography, dark: boolean) {
  const bg = paperBackground(typo.paper, dark);
  return {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    px: { xs: 2, md: 6 },
    py: 3,
    ...(bg ? { backgroundColor: bg } : {}),
    '& .ProseMirror': {
      outline: 'none',
      maxWidth: typo.pageWidth,
      mx: 'auto',
      fontSize: typo.fontSize,
      lineHeight: typo.lineHeight,
      color: 'text.primary',
      // P3 空章节占位提示（Placeholder 扩展的 is-editor-empty 标记）
      '& p.is-editor-empty:first-child::before': {
        content: 'attr(data-placeholder)',
        float: 'left',
        height: 0,
        color: 'text.disabled',
        pointerEvents: 'none',
      },
      '& h1': { fontSize: '1.6rem', fontWeight: 700, mt: 3, mb: 1.5 },
      '& h2': { fontSize: '1.3rem', fontWeight: 700, mt: 3, mb: 1.5 },
      '& p': { my: typo.paraSpacing, ...(typo.indent ? { textIndent: '2em' } : {}) },
      '& blockquote': {
        borderLeft: 3,
        borderColor: 'divider',
        pl: 2,
        my: 1.5,
        color: 'text.secondary',
      },
      '& ul, & ol': { pl: 3 },
      // 批次② T4：高亮/下划线/超链接/表格/章内批注样式
      '& mark': {
        backgroundColor: 'rgba(255, 235, 59, 0.5)',
        color: 'inherit',
        borderRadius: '2px',
        padding: '0 1px',
      },
      '& u': { textDecoration: 'underline' },
      '& a': {
        color: 'primary.main',
        textDecoration: 'underline',
        textDecorationColor: 'primary.main',
        cursor: 'pointer',
      },
      '& table': {
        borderCollapse: 'collapse',
        width: '100%',
        my: 1.5,
        tableLayout: 'fixed',
      },
      '& th, & td': {
        border: '1px solid',
        borderColor: 'divider',
        padding: '6px 10px',
        verticalAlign: 'top',
        minWidth: 48,
      },
      '& th': { bgcolor: 'action.hover', fontWeight: 600, textAlign: 'left' },
      '& .selectedCell::after': {
        content: '""',
        position: 'absolute',
        inset: 0,
        background: 'rgba(63, 81, 181, 0.14)',
        pointerEvents: 'none',
        borderRadius: 0,
      },
      '& span.writing-annotation': {
        backgroundColor: 'rgba(255, 152, 0, 0.14)',
        borderBottom: '2px dashed rgba(255, 152, 0, 0.55)',
        borderRadius: '2px',
        padding: '0 1px',
        cursor: 'pointer',
        transition: 'background-color 0.12s',
        '&:hover': { backgroundColor: 'rgba(255, 152, 0, 0.26)' },
      },
    },
  };
}
