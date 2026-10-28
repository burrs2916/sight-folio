// 画布辅助函数：实体文件 id 解析 / 载体视图名去重 / 空台体裁接管判断
import { useEditorStore } from '../../store/editorStore';
import { useWritingStore } from '../../store/writingStore';
import { parseBookIdFromScene, openTypedCarrierView } from '../../utils/studioBook';
import { hasWritingCanvasCard } from '../../utils/writingPaneSeed';
import type { SceneComponent } from '../../types/editor';
import type { ProjectFile } from '../../services/tauri';

/** 从实体 config 解析关联的项目文件 id（同步落库时写入 fileId，旧实体按 filePath 兜底） */
export function compFileId(comp: SceneComponent, fileByPath: Map<string, ProjectFile>): string | null {
  const cfg = (comp.config ?? {}) as Record<string, unknown>;
  const fid = cfg.fileId;
  if (typeof fid === 'string' && fid) return fid;
  const path = cfg.filePath;
  if (typeof path === 'string' && path) return fileByPath.get(path)?.id ?? null;
  return null;
}

/**
 * 视图名去重：重复拖同载体渲染新视图时，自动加「 2 /  3 …」序号，避免 Tab 重名。
 * 仅作用于载体视图命名（新书/新章），不影响用户手动双击改名。
 */
export function dedupViewName(base: string): string {
  const taken = new Set(useEditorStore.getState().views.map((v) => v.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/** 空书画布的题材载体拖入（2026-09-21 用户拍板）：书场景画布还没有任何载体时，
 * 拖题材 = 打开**当前书**的大纲编辑视图（openTypedCarrierView 命中即切、缺省即建），
 * 不再新建一本书 —— 「拖入载体，开始创作」空态引导承诺的就是开始创作当前书，
 * 新建作品走 L1「＋」/书架入口。体裁优先取当前书的（书场景=当前书），
 * 缺失时回落拖入载体的体裁。返回 true 表示已接管；
 * 画布已有载体时返回 false，调用方保持 2026-09-12 语义（再拖 = 新建一本书，多开）。 */
export function dropOpensCurrentBookView(isBookScene: boolean, dropGenre: string): boolean {
  if (!isBookScene) return false;
  const ed = useEditorStore.getState();
  if (ed.views.some((v) => hasWritingCanvasCard(v.components))) return false;
  const bookId = parseBookIdFromScene();
  const book = useWritingStore.getState().books.find((b) => b.id === bookId);
  openTypedCarrierView(book?.genre || dropGenre, 'catalog');
  return true;
}
