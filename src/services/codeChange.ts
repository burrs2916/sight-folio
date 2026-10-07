import { invoke } from './core';

// ─── AI 改动评审台账（R47 P2-A）───
//
// 形态与 VS Code 的 Agent 编辑一致：**先落盘、再评审**。
// 落盘是必须的——本项目的验证链路（file_watcher → 增量重扫 → metrics/引用/技术债刷新）
// 全都建立在磁盘之上，改动不落盘，AI 读不到自己的修改，「改完自动验证」的闭环就断了。
// 代价是撤销必须可靠，判定逻辑全在后端（能读到磁盘真实内容的一侧）。

/** 一条 AI 改动记录（与后端 CodeChangeRow 对齐） */
export interface CodeChangeRow {
  id: string;
  analysisId: string;
  fileId: string;
  relPath: string;
  /** patch = 锚点补丁（片段替换）| full = 整文写入 */
  mode: string;
  /** agent = AI 自己写盘 | ai-apply = 用户在面板点应用 | user = 手工保存 */
  origin: string;
  reason: string;
  oldText: string;
  newText: string;
  /** 是否留有改动前全文快照（决定撤销能力强弱） */
  hasSnapshot: boolean;
  beforeLines: number;
  afterLines: number;
  deltaLines: number;
  startLine: number;
  endLine: number;
  /** 锚点是经「行尾空白归一化」后命中的，替换边界为推断值 */
  approx: boolean;
  conversationId: string;
  /** pending = 待审 | kept = 已保留 | reverted = 已撤销 */
  status: string;
  createdAt: number;
  resolvedAt: number | null;
}

/** 撤销结果：strategy 区分整文回滚与片段回滚（措辞不同，UI 需要区分） */
export interface RevertOutcome {
  id: string;
  relPath: string;
  absPath: string;
  strategy: 'snapshot' | 'fragment';
  newLines: number;
}

export const codeChangeApi = {
  /** 列出改动。status 省略=全部；"pending" 只看待审 */
  async list(analysisId: string, status?: string, limit?: number): Promise<CodeChangeRow[]> {
    return invoke('list_code_changes', {
      analysisId,
      status: status ?? null,
      limit: limit ?? null,
    });
  },
  /** 待审条数（面板徽标：不为一个数字拉全量记录） */
  async countPending(analysisId: string): Promise<number> {
    return invoke('count_pending_code_changes', { analysisId });
  },
  /** 保留（从待审移出，仍可撤销）。changeId 传空串 + analysisId = 全部保留 */
  async keep(changeId: string, analysisId?: string): Promise<number> {
    return invoke('keep_code_change', { changeId, analysisId: analysisId ?? null });
  },
  /** 撤销（后端三档降级：整文快照 → 片段反向补丁 → 拒绝并说明原因） */
  async revert(changeId: string): Promise<RevertOutcome> {
    return invoke('revert_code_change', { changeId });
  },
  /** 回退某次会话产生的全部 AI 改动（「回退本会话全部改动」；逐条三档降级，逆序保证同文件锚点正确） */
  async revertByConversation(conversationId: string): Promise<string[]> {
    return invoke('revert_code_changes_by_conversation', { conversationId });
  },
};
