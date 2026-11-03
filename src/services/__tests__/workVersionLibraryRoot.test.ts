// 作品库根 service 封装（B3）：钉命令名与参数形状。
// 命令名/参数一旦和 Rust 侧漂移，界面会在运行时才炸，这里提前在单测层拦住。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('../core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { workVersionApi } from '../workVersion';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ path: '/tmp/lib', isDefault: true });
});

describe('workVersionApi 作品库根封装', () => {
  it('getLibraryRoot 调 get_works_library_root 且不带参数', async () => {
    const info = await workVersionApi.getLibraryRoot();
    expect(invokeMock).toHaveBeenCalledWith('get_works_library_root');
    expect(info.isDefault).toBe(true);
  });

  it('setLibraryRoot 调 set_works_library_root 且参数键为 path', async () => {
    await workVersionApi.setLibraryRoot('/Volumes/NAS/作品库');
    expect(invokeMock).toHaveBeenCalledWith('set_works_library_root', { path: '/Volumes/NAS/作品库' });
  });

  it('后端 reject 原样透传（不吞错、不降级）', async () => {
    invokeMock.mockRejectedValueOnce(new Error('无法创建作品库目录 /x：Permission denied'));
    await expect(workVersionApi.setLibraryRoot('/x')).rejects.toThrow('Permission denied');
  });
});
