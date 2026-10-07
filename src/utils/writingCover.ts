// 封面主题色常量（文字封面兜底用）。
//
// 与 writing_books.coverColor 默认值同源（novel 体裁主题色 #4A338F，见 utils/writingSchema
// WRITING_GENRES.novel.color）；单独成模块是因为 CoverThumb 是组件文件，按
// react-refresh 约定禁止在组件文件里导出函数/常量（会破坏 Fast Refresh 精度）。
// 纯前端常量：数据层缺省 color 时兜底，不参与数据写入。
export const COVER_FALLBACK_COLOR = '#4A338F';
