/**
 * 窗格滚动同步总线（对标 Zed `PaneGroup` 多窗格同文件对照滚动）。
 *
 * 设计要点：
 *  - 不进 zustand：滚动事件高频（每帧多次），放进 store 会触发全局 re-render；
 *    用独立极轻量 pub/sub 仅在点对点窗格间传递「滚动比例」，零 React 重渲染。
 *  - 消息携带来源 paneId，订阅方据此忽略自身回声，从根源杜绝「A 滚 → B 滚 → A 再滚」死循环。
 *  - ratio 为 0~1 的归一化滚动比例（scrollTop / 可滚动总量），与各行高/总行数解耦，
 *    同一文件拆成两视图时比例对齐即「同位置对照」；不同文件则平行滚动作为附带能力。
 */
export interface PaneScrollMsg {
  /** 来源窗格 id（与 store 中 pane.id 一致） */
  paneId: string;
  /** 归一化滚动比例 0~1 */
  ratio: number;
}

type Listener = (msg: PaneScrollMsg) => void;

const listeners = new Set<Listener>();

export const paneScrollBus = {
  /** 广播一次滚动（由来源窗格在用户滚动时调用） */
  publish(msg: PaneScrollMsg) {
    for (const l of listeners) l(msg);
  },
  /** 订阅；返回取消订阅函数 */
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
