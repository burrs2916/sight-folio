// 正文编辑器样式（P3 排版可调）：按 per-book 排版设置动态生成
import { resolveBodyFont, paperBackground, type BookTypography } from '../../utils/typography';

export function buildEditorBodySx(typo: BookTypography, dark: boolean) {
  const bg = paperBackground(typo.paper, dark);
  // 西文字体 + 中文字体分离组合：英文走 latinFontFamily（美观优先），中文走 fontFamily
  const fontFamily = resolveBodyFont(typo.latinFontFamily, typo.fontFamily);
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
      // 字体可配置：全跟随系统（空串）时补上通用中文字族回退，保证西文/符号有正常兜底
      fontFamily: fontFamily || "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
      lineHeight: typo.lineHeight,
      color: 'text.primary',
      // P3 空章节占位提示（Placeholder 扩展的 is-editor-empty 标记）
      // 用 :first-of-type 而非 :first-child：emotion 对 :first-child 做 SSR 安全检查会抛
      // "potentially unsafe" 警告；空占位必为首个段落，语义等价。
      '& p.is-editor-empty:first-of-type::before': {
        content: 'attr(data-placeholder)',
        float: 'left',
        height: 0,
        color: 'text.disabled',
        pointerEvents: 'none',
      },
      '& h1': { fontSize: '1.6rem', fontWeight: 700, mt: 3, mb: 1.5 },
      '& h2': { fontSize: '1.3rem', fontWeight: 700, mt: 3, mb: 1.5 },
      // 批次⑥ 专业格式控件：整体缩进走 padding-left（textIndent 属性由扩展渲染内联样式）
      '& p, & h1, & h2': { transition: 'padding-left 0.12s ease' },
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
