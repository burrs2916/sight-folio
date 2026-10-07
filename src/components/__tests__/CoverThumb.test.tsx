// CoverThumb 文字封面兜底测试（2026-09-29）
//
// 无封面/坏引用时，不传 fallback 维持灰底（旧行为向后兼容）；
// 传 fallback 则渲染「主题色 + 卷章号/书名单字」文字块 —— 大规模书只有卷封面
// 甚至完全无图时，行内缩略图仍可读。fallback 仅在无图路径生效，有图不遮挡。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoverThumb, type CoverFallback } from '../CoverThumb';

vi.mock('../../editor/extensions/writingImage', () => ({
  resolveAssetRefSrc: vi.fn(),
}));

import { resolveAssetRefSrc } from '../../editor/extensions/writingImage';

const mockResolve = vi.mocked(resolveAssetRefSrc);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 渲染到独立宿主节点并 flush 异步 effect（resolveAssetRefSrc 为 promise） */
async function renderThumb(el: ReactElement): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  await act(async () => {
    await Promise.resolve();
  }); // flush effect 中的 promise resolve/reject → setUrl/setFailed
  return { host, root };
}

describe('CoverThumb 文字封面兜底', () => {
  beforeEach(() => {
    mockResolve.mockReset();
  });

  function fallback(partial: Partial<CoverFallback> = {}): CoverFallback {
    return { bookTitle: '长夜余火', pathLabel: ['卷 1', '章 3'], color: '#123456', ...partial };
  }

  it('有封面且解析成功：渲染 img，fallback 不生效', async () => {
    mockResolve.mockResolvedValue('asset://covers/a.png');
    const { host } = await renderThumb(<CoverThumb rel="assets/writing/illustrations/a.png" fallback={fallback()} />);
    const img = host.querySelector<HTMLImageElement>('img');
    expect(img).toBeTruthy();
    expect(img?.src).toContain('asset://covers/a.png');
  });

  it('解析失败且无 fallback：灰底占位块，无文字（旧行为回归）', async () => {
    mockResolve.mockRejectedValue(new Error('bad ref'));
    const { host } = await renderThumb(<CoverThumb rel="assets/writing/illustrations/bad.png" />);
    expect(host.querySelector('img')).toBeNull();
    const box = host.querySelector<HTMLElement>('.MuiBox-root');
    expect(box).toBeTruthy();
    expect(box?.textContent).toBe('');
  });

  it('解析失败 + fallback：主题色文字块，显示路径标签末段「章 3」', async () => {
    mockResolve.mockRejectedValue(new Error('bad ref'));
    const { host } = await renderThumb(<CoverThumb rel="assets/writing/illustrations/bad.png" fallback={fallback()} />);
    expect(host.querySelector('img')).toBeNull();
    const box = host.querySelector<HTMLElement>('.MuiBox-root');
    expect(box?.textContent).toBe('章 3');
    expect(box?.style.backgroundColor).toBe('rgb(18, 52, 86)'); // #123456
  });

  it('fallback 无 pathLabel：显示书名单字', async () => {
    mockResolve.mockRejectedValue(new Error('bad ref'));
    const { host } = await renderThumb(
      <CoverThumb rel="assets/writing/illustrations/bad.png" fallback={fallback({ pathLabel: undefined })} />,
    );
    expect(host.querySelector('.MuiBox-root')?.textContent).toBe('长');
  });

  it('fallback 无 pathLabel 无 bookTitle：仍渲染主题色块（空字形不炸）', async () => {
    mockResolve.mockRejectedValue(new Error('bad ref'));
    const { host } = await renderThumb(
      <CoverThumb rel="x" fallback={fallback({ pathLabel: undefined, bookTitle: undefined })} />,
    );
    const box = host.querySelector<HTMLElement>('.MuiBox-root');
    expect(box?.textContent).toBe('');
    expect(box?.style.backgroundColor).toBe('rgb(18, 52, 86)');
  });

  it('未传 color：使用默认主题色 #4A338F', async () => {
    mockResolve.mockRejectedValue(new Error('bad ref'));
    const { host } = await renderThumb(<CoverThumb rel="x" fallback={fallback({ color: undefined })} />);
    const box = host.querySelector<HTMLElement>('.MuiBox-root');
    expect(box?.style.backgroundColor).toBe('rgb(74, 51, 143)');
  });
});
