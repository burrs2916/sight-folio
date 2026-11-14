// 删除作品的「后果清单」行为测试（2026-11-04 李先生删除铁律：先确认 + 讲清后果 + 不留脏数据）。
//
// 钉死的契约：
// 1. 成稿版本数 / 导出产物记录数走 workVersionApi，真数上屏；
// 2. 零账要说「没有」，**不能显示 0 个版本**糊过去，也不能喊「去清文件」（没导过产物就是噪声）；
// 3. 读数失败必须显式承认「未能核对」，并同时提醒产物文件不会被删 —— 不许拿 0 冒充干净；
// 4. 换目标书时先回到「核对中」：沿用上一本的读数 = 拿别人的账给这一本作保；
// 5. 两个删书入口（写作台 / 工作室 L1）必须都挂本组件 —— 后果文案只允许一个真源。
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const listImpl = vi.fn();
const artifactsImpl = vi.fn();

vi.mock('../../../services/workVersion', () => ({
  workVersionApi: {
    list: (bookId: string) => listImpl(bookId),
    listArtifacts: (bookId: string) => artifactsImpl(bookId),
  },
}));
vi.mock('../../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params
      ? `${key}:${Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')}`
      : key,
}));
vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { BookDeletionImpact } from '../BookDeletionImpact';

afterEach(() => {
  cleanup();
  listImpl.mockReset();
  artifactsImpl.mockReset();
});

const ok = (versions: unknown[], artifacts: unknown[]) => {
  listImpl.mockResolvedValue(versions);
  artifactsImpl.mockResolvedValue(artifacts);
};
const one = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${i}` })) as never[];
const text = () => document.body.textContent ?? '';

describe('BookDeletionImpact 后果清单', () => {
  it('读数成功且有账：真数上屏，并提醒产物文件不会被删', async () => {
    ok(one(3), one(5));
    render(<BookDeletionImpact bookId="b1" />);
    await waitFor(() => expect(text()).toContain('writing.bookDeleteImpact.versionsArtifacts:versions=3,artifacts=5'));
    expect(text()).toContain('writing.bookDeleteImpact.filesKept');
    expect(text()).toContain('writing.bookDeleteImpact.subDomains');
    expect(text()).toContain('writing.bookDeleteImpact.deskWindow');
  });

  it('零账：说「还没有」，且不喊去清文件（没导过产物就是噪声）', async () => {
    ok([], []);
    render(<BookDeletionImpact bookId="b1" />);
    await waitFor(() => expect(text()).toContain('writing.bookDeleteImpact.none'));
    expect(text()).not.toContain('versionsArtifacts');
    expect(text()).not.toContain('writing.bookDeleteImpact.filesKept');
  });

  it('读数失败：承认「未能核对」并仍提醒文件保留 —— 不许用 0 冒充干净', async () => {
    listImpl.mockRejectedValue(new Error('ipc down'));
    artifactsImpl.mockResolvedValue([]);
    render(<BookDeletionImpact bookId="b1" />);
    await waitFor(() => expect(text()).toContain('writing.bookDeleteImpact.readFailed'));
    expect(text()).toContain('writing.bookDeleteImpact.filesKept');
    expect(text()).not.toContain('versionsArtifacts');
    expect(text()).not.toContain('none');
  });

  it('读数未回：显示「核对中」而不是先画一个数（防闪假账）', async () => {
    listImpl.mockReturnValue(new Promise(() => {}));
    artifactsImpl.mockReturnValue(new Promise(() => {}));
    render(<BookDeletionImpact bookId="b1" />);
    expect(text()).toContain('writing.bookDeleteImpact.reading');
    expect(text()).not.toContain('versionsArtifacts');
  });

  it('换目标书：先回到「核对中」，不吃上一本的读数', async () => {
    ok(one(3), one(5));
    const { rerender } = render(<BookDeletionImpact bookId="b1" />);
    await waitFor(() => expect(text()).toContain('versions=3'));

    const gate = new Promise<never[]>(() => {});
    listImpl.mockReturnValue(gate);
    artifactsImpl.mockReturnValue(gate);
    rerender(<BookDeletionImpact bookId="b2" />);
    expect(text()).toContain('writing.bookDeleteImpact.reading');
    expect(text()).not.toContain('versions=3');
  });

  it('bookId 为空（弹窗未开）：不发任何读数请求', () => {
    render(<BookDeletionImpact bookId={null} />);
    expect(listImpl).not.toHaveBeenCalled();
    expect(artifactsImpl).not.toHaveBeenCalled();
  });
});

describe('源码扫描锁：删书入口只允许一套后果文案', () => {
  it('写作台与工作室两个删书弹窗都必须挂 BookDeletionImpact', () => {
    for (const rel of ['src/pages/writingPage/useDialogActions.tsx', 'src/editor/components/SceneTabBar.tsx']) {
      const src = readFileSync(`${process.cwd()}/${rel}`, 'utf8');
      expect(src, rel).toMatch(/import \{ BookDeletionImpact \} from '[^']*components\/ui\/BookDeletionImpact';/);
      expect(src, rel).toMatch(/<BookDeletionImpact bookId=\{/);
    }
  });
});
