/**
 * 画布原语
 *
 * persist/clearCanvas/_pending/flushPending/place/connectVertical/connect/resetPending。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { useEditorStore, type BulkComponentInput } from '../../../store/editorStore';
import { useSceneStore } from '../../../store/sceneStore';


export async function persist(analysisId: string, tag: string) {
  // 落库缓冲：所有 place/connect 收集的实体在此一次性写入（单条历史、单次 set）
  flushPending(analysisId);
  try {
    const { views, globalComponents, activeViewId } = useEditorStore.getState().exportSceneWithViews();
    await useSceneStore.getState().updateScene(analysisId, {
      views,
      globalComponents,
      activeViewId,
    } as any);
  } catch (e) {
    console.error(`[portraits] persist ${tag} failed`, e);
  }
  // 统筹全局：画像重建后自动「适应视口」，让整幅画像进入视野
  useEditorStore.getState().requestFit();
}

// ───────────────────────── 通用画布原语 ─────────────────────────

/** 清空当前视图的画布实体（画像都是「重建」语义） */
export function clearCanvas() {
  useEditorStore.setState((s: any) => {
    s.components = [];
  });
}

// 画布落库缓冲：place/connect 不再逐个 addComponent（每次触发 setState 让全画布重渲染，
// 几百节点即 O(N²) 卡顿），改为先收集到 _pending，由 persist 开头一次性 addComponentsBulk。
let _pending: BulkComponentInput[] = [];

/** 把缓冲的实体一次性落库（单条历史、单次 set），调用后清空缓冲 */
export function flushPending(_analysisId: string) {
  if (_pending.length === 0) return;
  const items = _pending;
  _pending = [];
  try {
    useEditorStore.getState().addComponentsBulk(items);
  } catch (e) {
    console.error('[portraits] flushPending failed', e);
  }
}

/** 添加实体并覆写 name / config，返回本地占位 id（供 connect 引用，落库由 flushPending 统一完成） */
export function place(
  type: string,
  pos: { x: number; y: number },
  name: string,
  config: Record<string, unknown>,
  size?: { w: number; h: number },
): string {
  const id = `p${_pending.length}`;
  _pending.push({
    type,
    name,
    x: pos.x,
    y: pos.y,
    ...(size ? { width: size.w, height: size.h } : {}),
    config,
  });
  return id;
}

/**
 * 画一条从 A 底边中点 → B 顶边中点的**纵向**依赖连线（每条依赖占一行、从上到下读）
 *
 * apiTrace / taintFlow 这类「一条链一列、节点自上而下」的画像都用这个：
 * 竖线比斜线更容易一眼读出顺序。包围盒端点换算同 connect。
 */
export function connectVertical(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  name: string,
  config: Record<string, unknown>,
): void {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h;
  const bx = b.x + b.w / 2;
  const by = b.y;
  const minX = Math.min(ax, bx);
  const minY = Math.min(ay, by);
  _pending.push({
    type: 'dependency-edge',
    name,
    x: minX,
    y: minY,
    width: Math.max(4, Math.abs(bx - ax) + 28),
    height: Math.max(4, Math.abs(by - ay) + 16),
    config: {
      ...config,
      fromX: ax - minX,
      fromY: ay - minY,
      toX: bx - minX,
      toY: by - minY,
    },
  });
}

/**
 * 画一条从 A 右边缘中点 → B 左边缘中点的依赖连线
 *
 * dependency-edge 实体的 transform 是包围盒，端点坐标要转成盒内相对坐标，
 * 这段换算在三个画像里重复了三遍，收成一个函数。
 */
export function connect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  name: string,
  config: Record<string, unknown>,
): string {
  const absFromX = a.x + a.w;
  const absFromY = a.y + a.h / 2;
  const absToX = b.x;
  const absToY = b.y + b.h / 2;
  const minX = Math.min(absFromX, absToX);
  const minY = Math.min(absFromY, absToY);
  const id = `p${_pending.length}`;
  _pending.push({
    type: 'dependency-edge',
    name,
    x: minX,
    y: minY,
    width: Math.max(4, Math.abs(absToX - absFromX) + 16),
    height: Math.max(4, Math.abs(absToY - absFromY) + 16),
    config: {
      ...config,
      fromX: absFromX - minX,
      fromY: absFromY - minY,
      toX: absToX - minX,
      toY: absToY - minY,
    },
  });
  return id;
}

/** 清空待落库缓冲（画像起手式与目录树重建前统一使用，替代直接对 _pending 赋值） */
export function resetPending() {
  _pending = [];
}
