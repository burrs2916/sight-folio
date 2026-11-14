import { create } from 'zustand';
import { logger } from '../utils/logger';

/**
 * 全局「危险动作确认」的唯一出口（2026-11-04 李先生删除铁律：
 * ① 删除前必须确认 ② 必须讲清后果 ③ 关联数据一次清干净）。
 *
 * 为什么做成全局而不是各面板自己写弹窗：本仓有 20+ 个删除入口，各写一份
 * 「标题 + 一句『确定吗？』」的后果就是本仓头号病灶「真源分身」——改一处漏一处，
 * 而且天然会退化成没人读的口水文案。后果清单的形状由这里定死。
 *
 * 硬约束：`impact`（后果清单）**必填且不能为空**。
 * 写不出后果的删除，说明发起方自己都没想清楚要删什么，这种确认框不如不弹。
 */
export interface ConfirmRequest {
  /** 标题写清「删什么」，不要只写「确认」二字 */
  title: string;
  /** 逐条上屏的后果：连带删了什么 / 磁盘文件留不留 / 能不能撤销 */
  impact: string[];
  /** 确认按钮文案必须是动词（「删除」「清空」），不要写「确定」 */
  confirmLabel: string;
  cancelLabel: string;
  /** 只有用户在 GlobalConfirmDialog 里点了确认按钮才会被调用 */
  onConfirm: () => void;
}

interface ConfirmStore {
  pending: ConfirmRequest | null;
  request: (req: ConfirmRequest) => void;
  /** proceed=false 只关闭；**绝不执行** onConfirm */
  settle: (proceed: boolean) => void;
}

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  pending: null,

  request: (req) => {
    if (req.impact.length === 0) {
      // 不抛错打断用户操作，但这条必须留下痕迹：空后果 = 铁律②被绕过
      logger.warn('confirmStore', 'confirm request without impact lines', { title: req.title });
    }
    // 一次只允许一张确认卡：后到的**丢弃**而不是排队。
    // 排队会让用户答完一张又冒一张，那正是「弹到麻木、闭眼点确认」的开始。
    if (get().pending !== null) {
      logger.warn('confirmStore', 'a confirm is already pending; new request dropped', { title: req.title });
      return;
    }
    set({ pending: req });
  },

  settle: (proceed) => {
    const req = get().pending;
    // 先清态再回调：onConfirm 里可能再发请求或触发别的 store，别让它看到半闭的确认卡
    set({ pending: null });
    if (!proceed) return;
    req?.onConfirm();
  },
}));

/** 发起一次危险动作确认。见 ConfirmRequest 的口径说明。 */
export function confirmDestructive(req: ConfirmRequest): void {
  useConfirmStore.getState().request(req);
}
