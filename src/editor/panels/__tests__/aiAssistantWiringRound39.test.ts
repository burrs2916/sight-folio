// aiAssistantWiringRound39.test.ts —— 阶段 B 批次 2「max_tokens 接线」回归锁（2026-11-02 第三十九轮）。
//
// 病史：用户填的最大输出已落库 ai_models.max_tokens，但 AgentEngine::new 签名没有这个参数、
// 构造写死 4096（engine.rs），每次请求静默腰斩。本轮改签名 + 调用点传 model.max_tokens。
//
// 锁三处接线（Rust 侧行为锁见 engine.rs #[cfg(test)] agent_engine_new_uses_passed_max_tokens_not_hardcoded）：
//   ① engine.rs 剥注释后不得再出现 `max_tokens: 4096`（写死回潮即红）；`new` 必须收 i64 参数
//      并透传给 ChatOptions（max_tokens: self.max_tokens）。
//   ② commands/agent.rs 的 AgentEngine::new 调用必须传 model.max_tokens（本次生效模型的库值，
//      不是 agent/前端任何一处的手抄数字）。
//   ③ 顺手项：AppTheme.tsx 字号/圆角兜底不得自造档位数值（?? 14 / ?? 1 / ?? 6），
//      一律回落 *_BASE.medium / *_SCALE.medium 真源。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
// 否定式判据先剥注释再匹配（轮次任务书陷阱清单⑥）；Rust 的 /// 文档注释行同样被剥掉
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');

describe('批次2 · max_tokens 接线锁（第 39 轮）', () => {
  const engineSrc = stripComments(read('src-tauri/src/plugins/ai_agent/engine.rs'));

  it('engine.rs 构造函数不再写死 4096', () => {
    expect(engineSrc).not.toMatch(/max_tokens:\s*4096/);
  });

  it('AgentEngine::new 签名收 max_tokens 参数并原样构造', () => {
    expect(engineSrc).toMatch(/pub fn new\([\s\S]*?max_tokens:\s*i64,\s*\)\s*->\s*Self/);
    // 构造走字段简写：值来自参数而不是字面量
    expect(engineSrc).toMatch(/max_iterations,\s*\n\s*max_tokens,\s*\n\s*\}/);
  });

  it('ChatOptions 透传 self.max_tokens（下游请求体生效链路不断）', () => {
    expect(engineSrc).toMatch(/max_tokens:\s*self\.max_tokens/);
  });

  it('commands/agent.rs 调用点传 model.max_tokens', () => {
    const callSrc = stripComments(read('src-tauri/src/commands/agent.rs'));
    const call = callSrc.match(/AgentEngine::new\(([\s\S]*?)\);/);
    expect(call).not.toBeNull();
    expect(call?.[1]).toMatch(/model\.max_tokens/);
  });
});

describe('顺手项 · AppTheme 兜底档位值收口（第 39 轮）', () => {
  const appThemeSrc = stripComments(read('src/theme/AppTheme.tsx'));

  it('不许出现 ?? 裸数字 的档位兜底（分身值必然与真源漂移）', () => {
    expect(appThemeSrc).not.toMatch(/\?\?\s*\d/);
  });

  it('三兄弟兜底一律回落 medium 真源', () => {
    expect(appThemeSrc).toMatch(/FONT_SIZE_BASE\[fontSize\]\s*\?\?\s*FONT_SIZE_BASE\.medium/);
    expect(appThemeSrc).toMatch(/FONT_SIZE_SCALE\[fontSize\]\s*\?\?\s*FONT_SIZE_SCALE\.medium/);
    expect(appThemeSrc).toMatch(/radiusBasePx\(\{ borderRadius, borderRadiusCustom \}\)/);
  });
});
