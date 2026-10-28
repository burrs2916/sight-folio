import Box from '@mui/material/Box';

/** 大小写不敏感子串高亮：把 query 命中段包成主色片段（query 空则原样返回）。
 *  多词 query（空格分隔）按词分别标注，命中区间合并后一次渲染，避免嵌套标签。
 *  （自 LibraryPage 提取为共享：语料库页与写作台语料检索对话框共用同一渲染） */
export function highlight(content: string, query: string) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return content;
  const lower = content.toLowerCase();
  const marks: Array<{ start: number; end: number }> = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    let idx = lower.indexOf(needle);
    while (idx >= 0) {
      marks.push({ start: idx, end: idx + needle.length });
      idx = lower.indexOf(needle, idx + needle.length);
    }
  }
  if (marks.length === 0) return content;
  marks.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m.start <= last.end) last.end = Math.max(last.end, m.end);
    else merged.push({ ...m });
  }
  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const m of merged) {
    if (m.start > cursor) parts.push({ text: content.slice(cursor, m.start), hit: false });
    parts.push({ text: content.slice(m.start, m.end), hit: true });
    cursor = m.end;
  }
  if (cursor < content.length) parts.push({ text: content.slice(cursor), hit: false });
  return parts.map((p, i) =>
    p.hit ? (
      <Box key={i} component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>
        {p.text}
      </Box>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}
