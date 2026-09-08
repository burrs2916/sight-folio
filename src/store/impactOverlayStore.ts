/**
 * impactOverlayStore —— 「作用域级影响面」在画布侧的唯一数据源（R18）。
 *
 * 与 insightOverlayStore / verifyOverlayStore 同源模式：渲染器用 O(1) 选择器查表，
 * 无标记时取到 false → 几百个实体一个都不重渲染。数据来源是右侧 AI 面板按调用图
 * 反向闭包算出的「改这个实体会波及哪些文件」(relPath 集合)，经 Tauri 全局事件跨窗口
 * 广播（面板在代码工作台窗口、画布在主窗口，两个独立 webview，普通 store 不跨窗口）。
 *
 * 为什么独立建 store：影响面是「AI 对当前焦点的爆炸半径认知」，与洞察（模型结论）、
 * 验证（本次改动的即时效应）性质都不同，混在一起会让三套刷新互相拖累。
 */
import { create } from "zustand";

interface ImpactOverlayState {
  /** 受波及的文件 relPath → true（画布文件卡 O(1) 查表） */
  filePaths: Record<string, true>;
  /** 受波及目录 relPath → true（文件集沿路径冒泡聚合，目录卡 O(1) 查表） */
  dirPaths: Record<string, true>;
  /** 画布是否显示影响面高亮（用户可关，避免与洞察/验证角标抢注意力） */
  enabled: boolean;
  /** 面板每次算出影响面后写入完整 relPath 列表，store 内部一次性聚合 + 目录冒泡 */
  setPaths: (relPaths: string[]) => void;
  /** 跨窗口事件收到的远端集合（直接覆盖，保持与来源窗口一致） */
  applyRemote: (relPaths: string[], enabled?: boolean) => void;
  setEnabled: (v: boolean) => void;
  clear: () => void;
}

/** 把文件集合沿路径冒泡成目录集合（src/a/b.ts → src、src/a 都标记） */
function bubbleDirs(relPaths: string[]): { filePaths: Record<string, true>; dirPaths: Record<string, true> } {
  const filePaths: Record<string, true> = {};
  const dirPaths: Record<string, true> = {};
  for (const p of relPaths) {
    if (!p) continue;
    filePaths[p] = true;
    const parts = p.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = acc ? `${acc}/${parts[i]}` : parts[i];
      acc = dir;
      dirPaths[dir] = true;
    }
  }
  return { filePaths, dirPaths };
}

export const useImpactOverlayStore = create<ImpactOverlayState>((set) => ({
  filePaths: {},
  dirPaths: {},
  // Opt-in by default (VS Code-style): AI impact-surface highlighting does not
  // stain the canvas unless the user enables the toggle in the panel.
  enabled: false,

  setPaths: (relPaths) => set(bubbleDirs(relPaths)),

  applyRemote: (relPaths, enabled) =>
    set((s) => ({
      ...bubbleDirs(relPaths),
      enabled: enabled === undefined ? s.enabled : enabled,
    })),

  setEnabled: (v) => set({ enabled: v }),

  clear: () => set({ filePaths: {}, dirPaths: {} }),
}));

/**
 * 渲染器专用选择器：关掉画布标注或该文件不在爆炸半径内 → false，
 * 让几百个渲染器在「开关关闭」或「无影响」这两个常见状态下彻底不参与重渲染。
 */
export function selectImpactMark(path: string | undefined) {
  return (s: ImpactOverlayState): boolean => (!path || !s.enabled ? false : !!s.filePaths[path]);
}

/**
 * 目录级影响面选择器：返回该目录子树内是否存在受波及文件（任一下级文件在爆炸半径内
 * 则整条祖先链都点亮）。关掉画布标注或该目录无子树波及时取到 false → 目录卡零重渲染。
 */
export function selectDirImpactMark(dirPath: string | undefined) {
  return (s: ImpactOverlayState): boolean => (!dirPath || !s.enabled ? false : !!s.dirPaths[dirPath]);
}
