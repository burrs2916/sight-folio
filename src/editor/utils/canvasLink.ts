// project-sight: 画布联动工具
// 左侧实体面板 / 文件树 / 审查结果 → 画布定位的共享逻辑。
// 画布实体通过 config 中的 filePath / fileName / moduleName 等字段与
// projectStore 的扫描结果（ProjectFile / ProjectModule / ProjectSymbol）双向匹配。
import { useEditorStore } from "../../store/editorStore";
import type { SceneComponent } from "../../types/editor";
import type { ProjectFile } from "../../services/tauri";

export type CanvasMatch = (comp: SceneComponent) => boolean;

/** 在画布中查找与文件匹配的实体（config.filePath 相对路径优先，退化到文件名） */
export function findComponentForFile(file: ProjectFile): SceneComponent | undefined {
  const comps = useEditorStore.getState().components;
  return (
    comps.find((c) => c.config?.filePath === file.relPath) ??
    comps.find((c) => c.config?.fileName === file.name && String(c.config?.language ?? "") === (file.language ?? "")) ??
    comps.find((c) => c.name === file.name)
  );
}

/** 在画布中查找与模块匹配的实体（module 实体 config.moduleName 或名称） */
export function findComponentForModule(moduleName: string): SceneComponent | undefined {
  const comps = useEditorStore.getState().components;
  return (
    comps.find((c) => c.type === "module" && (c.config?.moduleName === moduleName || c.config?.name === moduleName || c.name === moduleName)) ??
    comps.find((c) => c.type === "folder" && c.name === moduleName)
  );
}

/** 按目录完整路径精确查找目录实体（config.dirPath，目录画像/树形布局共用该字段） */
export function findComponentForDirPath(dirPath: string): SceneComponent | undefined {
  return useEditorStore.getState().components.find((c) => c.config?.dirPath === dirPath);
}

/**
 * 从任意 relPath（文件或目录）向上逐级回溯，找到「最近的已渲染祖先目录实体」。
 *
 * 为什么需要它：目录画像默认不画文件叶子（showFiles=false），且带
 * MAX_FILES_PER_DIR（每目录 20）/ MAX_FILE_LEAVES（全树 600）上限，深目录还可能
 * 被截断 —— 这些文件/目录在画布上没有自己的实体。此时定位到最近的已渲染父目录
 * （而不是静默无动作），保证「树上任何节点双击都有反应」。
 *
 * 回溯链例：src/a/b.ts → src/a → src → ""（根目录画像行的 dirPath 为空串）。
 */
export function findNearestDirComponent(startPath: string): SceneComponent | undefined {
  let dir = startPath;
  for (;;) {
    const comp = findComponentForDirPath(dir);
    if (comp) return comp;
    if (dir === "") return undefined;
    const i = dir.lastIndexOf("/");
    dir = i < 0 ? "" : dir.slice(0, i);
  }
}

/**
 * 定位并聚焦画布中的组件：
 * 找到 → focusComponent（选中 + 居中请求），返回 true
 * 未找到 → 返回 false（调用方决定是否提示）
 */
export function locateComponentInCanvas(
  comp: SceneComponent | undefined,
  onMissing?: () => void
): boolean {
  if (!comp) {
    onMissing?.();
    return false;
  }
  useEditorStore.getState().focusComponent(comp.id);
  return true;
}

/**
 * 定位文件到画布（供文件树 / 实体面板 / 审查结果共用）
 * 返回是否成功定位
 */
export function locateFileInCanvas(file: ProjectFile | undefined, onMissing?: () => void): boolean {
  if (!file) {
    onMissing?.();
    return false;
  }
  return locateComponentInCanvas(findComponentForFile(file), onMissing);
}

// ══════════════════════════════════════════════════════════════════
// 批量联动（R32：左侧面板搜索命中 → 画布高亮命中集合）
//
// 这是「实体不只是画像」的关键一环：面板里搜 "auth"，画布上所有
// 与 auth 相关的实体同时点亮并被框进视野 —— 面板与画布共享同一份
// 分析数据，而不是各画各的。
// ══════════════════════════════════════════════════════════════════

/**
 * 把一批「文件相对路径 / 模块名」映射为画布实体 id。
 *
 * 匹配口径与单体定位保持一致（config.filePath → config.moduleName → name），
 * 差别只在于这里一次遍历完成 N 个匹配（O(N+M) 而不是 O(N×M)）：
 * 大项目里 components 上千、命中集合上百，逐个 find 会是明显的卡顿源。
 */
export function findComponentIdsFor(keys: {
  filePaths?: readonly string[];
  moduleNames?: readonly string[];
  /**
   * 目录完整路径（对应目录实体的 `config.dirPath`）。
   *
   * 单列一档而不是塞进 moduleNames：目录实体的 `name` 只是最后一段（`ai`），
   * 而调用方手里通常是完整路径（`src/ai`）—— 用 moduleNames 匹配要么打不中，
   * 要么把所有同名的 `utils` 目录一起点亮。AI 洞察直接点名目录时就撞上了这个问题。
   */
  dirPaths?: readonly string[];
}): string[] {
  const comps = useEditorStore.getState().components;
  const pathSet = new Set((keys.filePaths ?? []).filter(Boolean));
  const moduleSet = new Set((keys.moduleNames ?? []).filter(Boolean));
  const dirSet = new Set((keys.dirPaths ?? []).filter(Boolean));
  if (pathSet.size === 0 && moduleSet.size === 0 && dirSet.size === 0) return [];

  const ids: string[] = [];
  for (const c of comps) {
    const fp = c.config?.filePath as string | undefined;
    if (fp && pathSet.has(fp)) {
      ids.push(c.id);
      continue;
    }
    if (dirSet.size > 0) {
      const dp = c.config?.dirPath as string | undefined;
      if (dp && dirSet.has(dp)) {
        ids.push(c.id);
        continue;
      }
    }
    if (moduleSet.size > 0) {
      const mn = (c.config?.moduleName as string | undefined) ?? (c.type === "folder" ? c.name : undefined);
      if (mn && moduleSet.has(mn)) ids.push(c.id);
    }
  }
  return ids;
}

/**
 * 批量高亮：选中全部命中实体并把视野收敛到它们。
 * 返回实际点亮的实体数（0 表示这些文件/模块尚未同步到画布）。
 */
export function highlightInCanvas(keys: {
  filePaths?: readonly string[];
  moduleNames?: readonly string[];
  dirPaths?: readonly string[];
}): number {
  const ids = findComponentIdsFor(keys);
  if (ids.length === 0) return 0;
  const store = useEditorStore.getState();
  store.selectComponents(ids);
  store.requestFit(ids);
  return ids.length;
}

/**
 * 按文本子串批量高亮画布实体（目录树搜索联动用）。
 *
 * 与 highlightInCanvas 的区别：那个要调用方先收集好精确的
 * filePaths / moduleNames；这里直接对画布上所有实体做「名称 /
 * 路径包含搜索词」的子串匹配，省掉一次 projectFiles → 实体的
 * 反向映射。目录树里搜 "auth"，画布上所有名字或路径含 auth 的实体
 * （auth 目录的 folder 实体、auth.ts 的 file 实体、auth 模块）会
 * 同时点亮并被框进视野 —— 面板与画布共享同一份分析数据，而不是各看各的。
 *
 * @returns 实际点亮的实体数（0 表示还没同步到画布或没有匹配）
 */
export function highlightInCanvasByText(query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const comps = useEditorStore.getState().components;
  if (comps.length === 0) return 0;
  const ids: string[] = [];
  for (const c of comps) {
    const hay = [
      c.name,
      (c.config?.filePath as string | undefined) ?? "",
      (c.config?.fileName as string | undefined) ?? "",
      (c.config?.moduleName as string | undefined) ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (hay.includes(q)) ids.push(c.id);
  }
  if (ids.length === 0) return 0;
  const store = useEditorStore.getState();
  store.selectComponents(ids);
  store.requestFit(ids);
  return ids.length;
}
