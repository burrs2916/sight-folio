// 导出任务队列 service 封装（B4b）：钉命令名与参数形状。
// 命令名/参数一旦与 Rust 侧（commands/work_version.rs）漂移，界面会运行时才炸；这里先拦住。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('../core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { workVersionApi } from '../workVersion';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe('workVersionApi 导出队列封装（§5.2 / §6 命令面）', () => {
  it('enqueueExport 调 enqueue_export，specId 缺省时显式传 null（后端 Option 口径）', async () => {
    await workVersionApi.enqueueExport('ver_1', ['epub', 'md']);
    expect(invokeMock).toHaveBeenCalledWith('enqueue_export', {
      versionId: 'ver_1',
      formats: ['epub', 'md'],
      specId: null,
    });
  });

  it('enqueueExport 带上 specId 时原样透传（P2 渠道预设留的口子）', async () => {
    await workVersionApi.enqueueExport('ver_1', ['txt'], 'qidian');
    expect(invokeMock).toHaveBeenCalledWith('enqueue_export', {
      versionId: 'ver_1',
      formats: ['txt'],
      specId: 'qidian',
    });
  });

  it('listExportJobs / retry / dismiss 命令名与参数键逐一对齐', async () => {
    await workVersionApi.listExportJobs();
    expect(invokeMock).toHaveBeenLastCalledWith('list_export_jobs');
    await workVersionApi.retryExportJob('art_9');
    expect(invokeMock).toHaveBeenLastCalledWith('retry_export_job', { jobId: 'art_9' });
    await workVersionApi.dismissExportJob('art_9');
    expect(invokeMock).toHaveBeenLastCalledWith('dismiss_export_job', { jobId: 'art_9' });
  });

  it('listArtifacts 缺省不带书也传 null；带书时按 bookId 过滤', async () => {
    await workVersionApi.listArtifacts();
    expect(invokeMock).toHaveBeenLastCalledWith('list_export_artifacts', { bookId: null });
    await workVersionApi.listArtifacts('b1');
    expect(invokeMock).toHaveBeenLastCalledWith('list_export_artifacts', { bookId: 'b1' });
  });

  it('revealArtifact 调 reveal_artifact 并透传后端返回的绝对路径', async () => {
    invokeMock.mockResolvedValueOnce('/Users/x/作品库/b1/v1/书名-v1.epub');
    const p = await workVersionApi.revealArtifact('art_1');
    expect(invokeMock).toHaveBeenCalledWith('reveal_artifact', { artifactId: 'art_1' });
    expect(p).toBe('/Users/x/作品库/b1/v1/书名-v1.epub');
  });

  it('revealArtifact 的缺失错误原样 reject（界面必须能拿到带路径的原文，§9-10）', async () => {
    invokeMock.mockRejectedValueOnce(new Error('文件不在作品库记录的位置：/x/b1/v1/a.epub'));
    await expect(workVersionApi.revealArtifact('art_1')).rejects.toThrow('文件不在作品库记录的位置');
  });

  it('copyArtifactTo 调 copy_artifact_to 且回传字节数', async () => {
    invokeMock.mockResolvedValue(20480);
    const n = await workVersionApi.copyArtifactTo('art_1', '/Users/x/Desktop/交付.epub');
    expect(invokeMock).toHaveBeenCalledWith('copy_artifact_to', {
      artifactId: 'art_1',
      destPath: '/Users/x/Desktop/交付.epub',
    });
    expect(n).toBe(20480);
  });

  // B6（需求 §6）：徽标计数命令名沿用 query_completed_work_count，实现已改按 export_artifacts。
  it('exportCount 沿用 query_completed_work_count 命令名并原样回传计数', async () => {
    invokeMock.mockResolvedValue(7);
    const n = await workVersionApi.exportCount('b1', 'epub');
    expect(invokeMock).toHaveBeenCalledWith('query_completed_work_count', { bookId: 'b1', format: 'epub' });
    expect(n).toBe(7);
  });

  it('exportCount 空 format = 全书汇总的口径由参数形状承载（空串照常上送）', async () => {
    invokeMock.mockResolvedValue(0);
    const n = await workVersionApi.exportCount('b1', '');
    expect(invokeMock).toHaveBeenCalledWith('query_completed_work_count', { bookId: 'b1', format: '' });
    expect(n).toBe(0);
  });

  // B7（§9-12）：删版本必须把「是否删产物文件」显式上送，命令面 delete_work_version(version_id, delete_files)
  it('delete 把 deleteFiles 布尔原样随 versionId 上送（勾选语义不许在前端吞）', async () => {
    invokeMock.mockResolvedValue([]);
    const remaining = await workVersionApi.delete('ver_1', true);
    expect(invokeMock).toHaveBeenLastCalledWith('delete_work_version', { versionId: 'ver_1', deleteFiles: true });
    await workVersionApi.delete('ver_1', false);
    expect(invokeMock).toHaveBeenLastCalledWith('delete_work_version', { versionId: 'ver_1', deleteFiles: false });
    expect(remaining).toEqual([]);
  });
});
