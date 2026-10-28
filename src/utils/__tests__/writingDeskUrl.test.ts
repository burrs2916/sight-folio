// 写作台定位 URL 组装测试（含 O7 轮新增的 inspirationId → insp 参数）
//
// openWritingDesk 冷启动时把定位参数经 query 传给写作台窗口（WebviewWindow 全新
// webview，state 传不过去）；WritingPage 侧消费 query 后 replace 清参数。
// 本测试锁死 writingDeskUrl 对四类定位载荷的组装：
//   book → book、chapter → chapter、setting → setting、inspirationId → insp。
// 扩展号约定：多参数并存时按固定顺序排列（desk → book → chapter → setting → insp），
// 防止以后加参数打乱既有消费方（WritingPage query 解析）的假设。
import { describe, it, expect } from 'vitest';
import { writingDeskUrl } from '../writingDeskWindow';

describe('writingDeskUrl（冷启动定位 query 组装）', () => {
  it('无定位载荷 → 仅 desk=1', () => {
    expect(writingDeskUrl({})).toBe('/writing?desk=1');
    expect(writingDeskUrl({ bookId: null, chapterId: null, settingId: null })).toBe('/writing?desk=1');
  });

  it('book / chapter / setting 各自落到对应参数', () => {
    expect(writingDeskUrl({ bookId: 'b1' })).toBe('/writing?desk=1&book=b1');
    expect(writingDeskUrl({ bookId: 'b1', chapterId: 'c2' })).toBe('/writing?desk=1&book=b1&chapter=c2');
    expect(writingDeskUrl({ bookId: 'b1', settingId: 's3' })).toBe('/writing?desk=1&book=b1&setting=s3');
  });

  it('inspirationId → insp 参数（O7 跨视图预选冷启动）', () => {
    expect(writingDeskUrl({ bookId: 'b1', inspirationId: 'o9' })).toBe('/writing?desk=1&book=b1&insp=o9');
  });

  it('四类载荷并存按 desk→book→chapter→setting→insp 顺序组装', () => {
    expect(writingDeskUrl({ bookId: 'b1', chapterId: 'c2', settingId: 's3', inspirationId: 'o9' })).toBe(
      '/writing?desk=1&book=b1&chapter=c2&setting=s3&insp=o9',
    );
  });

  it('空字符串 / 空灵感 id 不产生参数（undefined 与空值等价）', () => {
    expect(writingDeskUrl({ bookId: '', inspirationId: '' })).toBe('/writing?desk=1');
    expect(writingDeskUrl({ bookId: 'b1', inspirationId: null })).toBe('/writing?desk=1&book=b1');
  });
});
