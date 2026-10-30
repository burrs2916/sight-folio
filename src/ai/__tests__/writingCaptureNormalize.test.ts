// normalizeCaptureAnalysis 回归锁（2026-10-31 缺口①「素材库重新分析」）
// 面板「重新分析」与采集对话框共用这一口径：AI 松散 JSON → 结构化结果，缺失/错型一律降级 undefined，绝不抛。
import { describe, it, expect } from 'vitest';
import { normalizeCaptureAnalysis } from '../writingCapture';

describe('normalizeCaptureAnalysis', () => {
  it('完整字段全部保留', () => {
    const out = normalizeCaptureAnalysis({
      timeline: [{ at: '早期', event: '相遇' }],
      profile: { appearance: '高瘦', personality: '内敛', motivation: '复仇' },
      creativeValue: '张力强',
      suggestions: ['写成第 3 章冲突', '拆成两幕'],
    });
    expect(out.timeline).toEqual([{ at: '早期', event: '相遇' }]);
    expect(out.profile?.motivation).toBe('复仇');
    expect(out.creativeValue).toBe('张力强');
    expect(out.suggestions).toHaveLength(2);
  });

  it('timeline 非数组 → undefined（不因脏字段抛错）', () => {
    const out = normalizeCaptureAnalysis({ timeline: 'not-an-array' });
    expect(out.timeline).toBeUndefined();
    expect(out.profile).toBeUndefined();
    expect(out.creativeValue).toBeUndefined();
    expect(out.suggestions).toBeUndefined();
  });

  it('profile 非对象 → undefined；creativeValue 非字符串 → undefined；suggestions 非数组 → undefined', () => {
    const out = normalizeCaptureAnalysis({
      profile: 'nope',
      creativeValue: 123,
      suggestions: { a: 1 },
    });
    expect(out.profile).toBeUndefined();
    expect(out.creativeValue).toBeUndefined();
    expect(out.suggestions).toBeUndefined();
  });

  it('空对象 → 全 undefined（无字段时安全降级，供 save 仍写出空分析结构）', () => {
    expect(normalizeCaptureAnalysis({})).toEqual({
      timeline: undefined,
      profile: undefined,
      creativeValue: undefined,
      suggestions: undefined,
    });
  });
});
