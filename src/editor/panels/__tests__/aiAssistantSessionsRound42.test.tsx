// aiAssistantSessionsRound42.test.tsx —— 阶段 B 批次 5「会话功能三件」回归锁（第 42 轮，2026-11-02）。
//
// 病史：工作室历史会话删不掉（deleteConversation 真源早已存在，但只有 AI 助手页在用，
// 工作台历史菜单没有入口）；单条消息无法删除（全仓只有 truncateMessagesFrom 的隐式截断，
// 语义是「撤掉这一轮重来」，不是「抹掉一条」）；contextPersist.ts 无容量上限、无清理入口
// （包按 scope×module 存库只在显式删除时才走 delete，删掉的书/项目留下孤儿包无限累积）。
//
// 锁四组：
//   ① agentStore.deleteMessage 行为锁——仅删该条其后保留 / local_ 只走本地 / 流式期间拒绝 /
//      删库失败界面不动。
//   ② contextPersist 容量闸与清理行为锁——超限按最旧先删 / 刚写入的包豁免 / 单包失败不中断其余 /
//      clearAllContextPacks 删全表并作废整份内存缓存。
//   ③ persistModuleContext 接线锁——成功落库后后台触发一次配额回收（fire-and-forget）。
//   ④ WorkbenchAiPanel 源码锁——历史菜单/消息条/缓存三处入口全部「先进确认框、确认才删」，
//      破坏性操作在面板源码里的直接调用点各自只许出现在 confirm 处理器内；i18n 双包新键同步。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const h = vi.hoisted(() => {
  return {
    deleteMessages: vi.fn(async (ids: string[]) => ids.length),
    listAiContextPacks: vi.fn(async () => [] as any[]),
    deleteAiContextPack: vi.fn(async (_id: string) => {}),
    listAiInsights: vi.fn(async () => [] as any[]),
    saveAiContextPack: vi.fn(async (pack: any) => `${pack.scopeId}:${pack.moduleId}`),
    listAiContextSectionStamps: vi.fn(async () => [] as any[]),
  };
});

vi.mock('../../../services/tauri', () => ({
  agentApi: {
    listAgents: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    runAgent: vi.fn(async () => ''),
    cancelAgentRun: vi.fn(async () => {}),
    deleteMessages: (ids: string[]) => h.deleteMessages(ids),
    deleteConversation: vi.fn(async () => {}),
  },
  aiContextApi: {
    listAiContextPacks: () => h.listAiContextPacks(),
    deleteAiContextPack: (id: string) => h.deleteAiContextPack(id),
    listAiInsights: () => h.listAiInsights(),
    saveAiContextPack: (p: any) => h.saveAiContextPack(p),
    listAiContextSectionStamps: () => h.listAiContextSectionStamps(),
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

const { useAgentStore } = await import('../../../store/agentStore');
const {
  persistModuleContext,
  resetContextPersistCache,
  enforceContextPackQuota,
  clearAllContextPacks,
  CONTEXT_PACK_MAX_COUNT,
} = await import('../../../ai/contextPersist');
const { stampSections, packDigestFromSections } = await import('../../../ai/sectionDiff');
const { AI_CONTEXT_SCHEMA_VERSION } = await import('../../../ai/contextTypes');

/** 造一条已落库消息（形状对齐 services/tauri 的 AiMessage） */
const msg = (id: string, role: 'user' | 'assistant' = 'user') => ({
  id,
  conversationId: 'c1',
  role,
  content: `正文-${id}`,
  toolCalls: null,
  createdAt: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.deleteMessages.mockImplementation(async (ids: string[]) => ids.length);
  h.listAiContextPacks.mockImplementation(async () => [] as any[]);
  h.deleteAiContextPack.mockImplementation(async () => {});
  h.listAiInsights.mockImplementation(async () => [] as any[]);
  h.saveAiContextPack.mockImplementation(async (pack: any) => `${pack.scopeId}:${pack.moduleId}`);
  h.listAiContextSectionStamps.mockImplementation(async () => [] as any[]);
  useAgentStore.setState({ messages: [], isStreaming: false, interruptRequested: false });
});

describe('批次5② · agentStore.deleteMessage 行为锁', () => {
  it('仅删该条：命中消息从 store 摘掉，前后消息原样保留，按显式 id 单条删库', async () => {
    useAgentStore.setState({ messages: [msg('m1'), msg('m2', 'assistant'), msg('m3')] });
    const ok = await useAgentStore.getState().deleteMessage('m2');
    expect(ok).toBe(true);
    expect(h.deleteMessages).toHaveBeenCalledTimes(1);
    expect(h.deleteMessages).toHaveBeenCalledWith(['m2']);
    expect(useAgentStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  it('乐观渲染的 local_ 消息未落库：只从界面摘除，不许空转调删库', async () => {
    useAgentStore.setState({ messages: [msg('m1'), msg('local_42')] });
    const ok = await useAgentStore.getState().deleteMessage('local_42');
    expect(ok).toBe(true);
    expect(h.deleteMessages).not.toHaveBeenCalled();
    expect(useAgentStore.getState().messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('流式期间拒绝执行（删除会与落库竞争），既不删库也不改界面', async () => {
    useAgentStore.setState({ messages: [msg('m1')], isStreaming: true });
    const ok = await useAgentStore.getState().deleteMessage('m1');
    expect(ok).toBe(false);
    expect(h.deleteMessages).not.toHaveBeenCalled();
    expect(useAgentStore.getState().messages).toHaveLength(1);
    // 中断请求挂起同样算在途，一并锁死
    useAgentStore.setState({ isStreaming: false, interruptRequested: true });
    expect(await useAgentStore.getState().deleteMessage('m1')).toBe(false);
    useAgentStore.setState({ interruptRequested: false });
  });

  it('不在当前转录里的 id 返回 false 且不碰库', async () => {
    useAgentStore.setState({ messages: [msg('m1')] });
    expect(await useAgentStore.getState().deleteMessage('ghost')).toBe(false);
    expect(h.deleteMessages).not.toHaveBeenCalled();
  });

  it('删库失败必须抛错且本地视图不动：否则界面少一条、库里还在，重开会话又冒出来', async () => {
    useAgentStore.setState({ messages: [msg('m1'), msg('m2')] });
    h.deleteMessages.mockImplementation(async () => {
      throw new Error('db locked');
    });
    await expect(useAgentStore.getState().deleteMessage('m1')).rejects.toThrow('db locked');
    expect(useAgentStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('批次5③ · contextPersist 容量闸与清理入口行为锁', () => {
  const packs = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${from + i}`,
      scopeId: `scope${from + i}`,
      moduleId: 'code-analysis',
      scopeLabel: '',
      schemaVersion: 1,
      generatedAt: 1_000 + from + i,
      tokenEstimate: 10,
      digest: '',
      truncatedSections: [],
      sectionKeys: [],
      sectionCount: 0,
    }));

  it('上限是显式硬闸常量（档位数值只许出现在自己文件里 —— 这里钉的是本模块自己的闸值）', () => {
    expect(CONTEXT_PACK_MAX_COUNT).toBe(48);
  });

  it('不超限零动作', async () => {
    h.listAiContextPacks.mockImplementation(async () => packs(CONTEXT_PACK_MAX_COUNT));
    expect(await enforceContextPackQuota()).toBe(0);
    expect(h.deleteAiContextPack).not.toHaveBeenCalled();
  });

  it('超限按 generatedAt 最旧先淘汰，且刚写入的包（即便最旧）豁免', async () => {
    const list = packs(CONTEXT_PACK_MAX_COUNT + 3);
    list[0].generatedAt = 1; // p0 变成最旧 —— 若豁免失效，第一个被删的就会是它
    h.listAiContextPacks.mockImplementation(async () => list);
    const removed = await enforceContextPackQuota('p0');
    expect(removed).toBe(3);
    const ids = h.deleteAiContextPack.mock.calls.map((c: any[]) => c[0]);
    expect(ids).toEqual(['p1', 'p2', 'p3']);
  });

  it('单个包删除失败不中断其余淘汰，返回值只数成功', async () => {
    const list = packs(CONTEXT_PACK_MAX_COUNT + 3);
    h.listAiContextPacks.mockImplementation(async () => list);
    h.deleteAiContextPack.mockImplementation(async (id: string) => {
      if (id === 'p1') throw new Error('busy');
    });
    expect(await enforceContextPackQuota()).toBe(2);
    expect(h.deleteAiContextPack).toHaveBeenCalledTimes(3);
  });

  it('clearAllContextPacks 删全表并返回删除数', async () => {
    h.listAiContextPacks.mockImplementation(async () => packs(3));
    expect(await clearAllContextPacks()).toBe(3);
    const ids = h.deleteAiContextPack.mock.calls.map((c: any[]) => c[0]);
    expect(ids).toEqual(['p0', 'p1', 'p2']);
  });

  it('空表幂等：返回 0 且不误发删除', async () => {
    expect(await clearAllContextPacks()).toBe(0);
    expect(h.deleteAiContextPack).not.toHaveBeenCalled();
  });

  it('persistModuleContext 成功落库后后台触发配额回收：超额最旧包被清掉，刚写入的包不动', async () => {
    const scope = 'round42-quota';
    resetContextPersistCache();
    const provider = {
      moduleId: 'test-quota-module',
      label: '配额测试',
      description: '',
      isAvailable: () => true,
      buildPack: (scopeId: string, options?: any) => {
        const now = options?.now ?? 1_700_000_000_000;
        const raw = [
          {
            key: 'overview',
            title: 'overview',
            summary: 's',
            content: 'v1',
            tokenEstimate: 10,
            priority: 0,
            digest: '',
            updatedAt: 0,
          },
        ];
        const { sections, changed, unchanged } = stampSections(raw, options?.previousSections, now);
        return {
          moduleId: 'test-quota-module',
          scopeId,
          scopeLabel: scopeId,
          schemaVersion: AI_CONTEXT_SCHEMA_VERSION,
          generatedAt: now,
          sections,
          tokenEstimate: 10,
          digest: packDigestFromSections(scopeId, AI_CONTEXT_SCHEMA_VERSION, sections),
          truncatedSections: [],
          changedSections: changed,
          unchangedSections: unchanged,
        };
      },
    };
    // 落库后表里将是 上限+1 个包（含本次写入的），最旧者是 oldest-pack
    const others = packs(CONTEXT_PACK_MAX_COUNT).map((p, i) => ({ ...p, id: `q${i}`, generatedAt: 100 + i }));
    h.listAiContextPacks.mockImplementation(async () => [
      { ...others[0], id: 'oldest-pack', generatedAt: 1 },
      ...others,
    ]);
    const res = await persistModuleContext(provider as any, scope);
    expect(res?.mode).toBe('full');
    // fire-and-forget：让后台配额跑完（微任务 + 串行 await 的删除链）
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(h.deleteAiContextPack).toHaveBeenCalledWith('oldest-pack');
    expect(h.deleteAiContextPack).not.toHaveBeenCalledWith(`${scope}:test-quota-module`);
  });
});

// ── ④ 面板源码锁（读源 + 剥注释后匹配，判据口径与第 40/41 轮一致）──
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'));

describe('批次5①②③ · WorkbenchAiPanel 删除/清理入口源码锁', () => {
  const panel = read('src/editor/panels/WorkbenchAiPanel.tsx');

  it('历史菜单带删除图标且 stopPropagation 后只登记意图——不许一点即删', () => {
    expect(panel).toMatch(/setPendingConvDelete\(\{ id: c\.id, title: c\.title \}\)/);
    expect(panel).toMatch(/e\.stopPropagation\(\);\s*setHistoryAnchor\(null\);\s*setPendingConvDelete/);
  });

  it('会话删除的真源调用只许出现在确认回调里（全文件唯一一处）', () => {
    const calls = panel.match(/\.deleteConversation\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(panel).toMatch(
      /const confirmDeleteConversation = async \(\) => \{[\s\S]*?\.deleteConversation\(target\.id\)/,
    );
    expect(panel).toMatch(/open=\{!!pendingConvDelete\}/);
  });

  it('消息条挂删除入口（人人有份、流式禁用），真源调用同样唯一且在确认回调内', () => {
    expect(panel).toMatch(/onDelete=\{\(\) =>\s*setPendingMsgDelete/);
    const calls = panel.match(/\.deleteMessage\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(panel).toMatch(/const confirmDeleteMessage = async \(\) => \{[\s\S]*?\.deleteMessage\(target\.id\)/);
    expect(panel).toMatch(/open=\{!!pendingMsgDelete\}/);
    // 与「重试/截断」语义分开：确认文案必须讲清「仅删这一条」
    expect(panel).toMatch(/t\('workbench\.aiMsgAction\.deleteConfirmBody'\)/);
  });

  it('上下文缓存清理入口进「更多」菜单，确认后走 clearAllContextPacks 真源并 toast 回执', () => {
    expect(panel).toMatch(/import \{ clearAllContextPacks \} from '\.\.\/\.\.\/ai\/contextPersist'/);
    expect(panel).toMatch(/setClearCtxOpen\(true\)/);
    expect(panel).toMatch(/const confirmClearContextPacks = async \(\) => \{[\s\S]*?clearAllContextPacks\(\)/);
    expect(panel).toMatch(/t\('workbench\.aiContextClear\.cleared', \{ n \}\)/);
    expect(panel).toMatch(/t\('workbench\.aiContextClear\.failed'\)/);
  });

  it('删除/清理失败不许静默吞掉——三个失败分支都挂 error toast', () => {
    for (const key of [
      'workbench.aiThread.deleteFailed',
      'workbench.aiMsgAction.deleteFailed',
      'workbench.aiContextClear.failed',
    ]) {
      expect(panel).toContain(`t('${key}')`);
    }
    const errs = panel.match(/showToast\(t\('workbench\.[A-Za-z.]+'\), 'error'\)/g) ?? [];
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });

  it('agentStore 截断真源不许被顺手改写语义：truncateMessagesFrom 仍是「删到该条为止」', () => {
    const store = read('src/store/agentStore.ts');
    expect(store).toMatch(/if \(persistedIds\.length > 0\) await agentApi\.deleteMessages\(persistedIds\)/);
    expect(store).toMatch(/set\(\(s\) => \(\{ messages: s\.messages\.slice\(0, idx\) \}\)\)/);
  });

  it('i18n 新键双包同步在位（缺任何一侧当场红）', () => {
    const zh = JSON.parse(readFileSync(join(ROOT, 'src/i18n/zh-CN.json'), 'utf-8'));
    const en = JSON.parse(readFileSync(join(ROOT, 'src/i18n/en-US.json'), 'utf-8'));
    const paths = [
      ['workbench', 'aiThread', 'delete'],
      ['workbench', 'aiThread', 'deleteConfirmTitle'],
      ['workbench', 'aiThread', 'deleteConfirmBody'],
      ['workbench', 'aiThread', 'deleteFailed'],
      ['workbench', 'aiMore', 'clearContext'],
      ['workbench', 'aiContextClear', 'title'],
      ['workbench', 'aiContextClear', 'body'],
      ['workbench', 'aiContextClear', 'ok'],
      ['workbench', 'aiContextClear', 'clearing'],
      ['workbench', 'aiContextClear', 'cleared'],
      ['workbench', 'aiContextClear', 'failed'],
      ['workbench', 'aiMsgAction', 'delete'],
      ['workbench', 'aiMsgAction', 'deleteConfirmTitle'],
      ['workbench', 'aiMsgAction', 'deleteConfirmBody'],
      ['workbench', 'aiMsgAction', 'deleteFailed'],
    ] as const;
    for (const pkg of [zh, en]) {
      for (const p of paths) {
        const v = p.reduce<any>((o: any, k) => o?.[k], pkg);
        expect(typeof v, p.join('.')).toBe('string');
        expect((v as string).length, p.join('.')).toBeGreaterThan(0);
      }
    }
  });
});
