// 笔记相对时间描述（按秒差分档，组件层负责 i18n 文案）。
// 用于左栏笔记摘要、笔记弹窗列表的时间展示，跨组件复用同一分档口径。

export interface NoteAgeBucket {
  kind: 'justNow' | 'minutes' | 'hours' | 'yesterday' | 'days';
  value: number;
}

export function noteAgeBucket(tsSec: number, nowSec: number = Math.floor(Date.now() / 1000)): NoteAgeBucket {
  const diff = Math.max(0, nowSec - tsSec);
  if (diff < 60) return { kind: 'justNow', value: 0 };
  if (diff < 3600) return { kind: 'minutes', value: Math.floor(diff / 60) };
  if (diff < 86400) return { kind: 'hours', value: Math.floor(diff / 3600) };
  if (diff < 172800) return { kind: 'yesterday', value: 0 };
  return { kind: 'days', value: Math.floor(diff / 86400) };
}
