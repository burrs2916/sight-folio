// 章内批注管理接口（批次② T4）：
// 批注内容持久化在 SQLite（writing_annotations 表），正文 HTML 只存 `data-annotation-id` 引用。
// 本接口由宿主（WritingPage）注入编辑器扩展与批注面板，集中读写 SQLite。
export interface WritingAnnotation {
  id: string;
  chapterId: string;
  bookId: string;
  /** 批注内容（便签正文），与正文字符流完全隔离。 */
  text: string;
  /** 被批注选区的文本快照（展示用，不用于定位——定位靠正文 data-annotation-id）。 */
  excerpt: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnnotationManager {
  /** 某章的全部批注（新→旧）。 */
  listForChapter(chapterId: string): Promise<WritingAnnotation[]>;
  /** 新增/更新一条批注（前端持完整对象 INSERT OR REPLACE）。 */
  save(item: WritingAnnotation): Promise<void>;
  /** 删除批注（同时宿主负责从正文剥离对应 mark）。 */
  remove(id: string): Promise<void>;
}

/** 从正文 HTML 提取引用的批注 id 集合（供渲染/清理去重用）。 */
export function extractAnnotationIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /data-annotation-id="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) ids.add(m[1]);
  }
  return Array.from(ids);
}

/** 从正文 HTML 剥离全部批注 span（保留内部文本），用于导出/迁移时清引用。 */
export function stripAnnotationMarksFromHtml(html: string): string {
  if (!html.includes('writing-annotation')) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('span.writing-annotation[data-annotation-id]').forEach((el) => {
    const span = el as HTMLElement;
    span.replaceWith(...Array.from(span.childNodes));
  });
  return doc.body.innerHTML;
}
