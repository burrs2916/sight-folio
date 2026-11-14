/**
 * 洼地③：节点创作状态（待写/草稿/已完）按体裁 + 透传到 ChapterStatusDot 锁。
 *
 * 两层：
 *   ① 纯函数层：statusLabelKey(status, genre) —— novel 回落通用词、poetry/script/diary 各领本体裁词、
 *      essay 登记通用词（值=默认，显示零变化）。
 *   ② 渲染层：ChapterStatusDot 的 title 在传 genre 后确实反映体裁词（防将来删 genre={genre} 静默回退 novel）。
 *      这是 2B prop drilling（ChapterTreePanel/WritingTreeTab/writingPanes 三处透传）的护栏。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { statusLabelKey } from '../../../utils/writingSchema';
import { ChapterStatusDot } from '../ChapterStatusDot';
import { t, setLang } from '../../../i18n';

describe('statusLabelKey 按体裁（洼地③ 2A）', () => {
  it('小说 / 空 / 脏体裁：逐字通用词（零回归基准）', () => {
    for (const g of ['novel', '', 'poemx']) {
      expect(t(statusLabelKey('', g))).toBe('待写');
      expect(t(statusLabelKey('draft', g))).toBe('草稿');
      expect(t(statusLabelKey('finished', g))).toBe('已完');
    }
  });

  it('诗集：未起 / 初稿 / 定稿', () => {
    expect(t(statusLabelKey('', 'poetry'))).toBe('未起');
    expect(t(statusLabelKey('draft', 'poetry'))).toBe('初稿');
    expect(t(statusLabelKey('finished', 'poetry'))).toBe('定稿');
  });

  it('剧本：未排 / 草排 / 排定', () => {
    expect(t(statusLabelKey('', 'script'))).toBe('未排');
    expect(t(statusLabelKey('draft', 'script'))).toBe('草排');
    expect(t(statusLabelKey('finished', 'script'))).toBe('排定');
  });

  it('日记：待记 / 草记 / 已记', () => {
    expect(t(statusLabelKey('', 'diary'))).toBe('待记');
    expect(t(statusLabelKey('draft', 'diary'))).toBe('草记');
    expect(t(statusLabelKey('finished', 'diary'))).toBe('已记');
  });

  it('散文：显式登记但值=通用词（显示零变化，满足三体裁对称白名单锁）', () => {
    expect(t(statusLabelKey('', 'essay'))).toBe('待写');
    expect(t(statusLabelKey('finished', 'essay'))).toBe('已完');
  });
});

describe('ChapterStatusDot 渲染透传 genre（洼地③ 2B 护栏）', () => {
  const titleOf = (genre?: string): string => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(<ChapterStatusDot status="finished" depth={0} {...(genre ? { genre } : {})} />);
    });
    const title = el.querySelector('span')?.getAttribute('title') ?? '';
    act(() => root.unmount());
    el.remove();
    return title;
  };

  afterEach(() => setLang('zh-CN'));

  it('传 genre 后 title 反映体裁词（证明透传链未断，不会静默回退 novel）', () => {
    expect(titleOf('poetry')).toContain('定稿');
    expect(titleOf('diary')).toContain('已记');
    expect(titleOf('script')).toContain('排定');
  });

  it('不传 genre（走默认）：title 回退小说通用词（向后兼容）', () => {
    const title = titleOf();
    expect(title).toContain('已完');
    expect(title).not.toContain('定稿');
  });
});
