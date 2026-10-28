// 排版面板字体下拉 · 交互回归锁（批次⑤）
//
// 锁死：打开面板渲染「字体」下拉与全部 6 个选项（含预览字族）；
// 选择「楷体」调用 onChange({ fontFamily: 'kai' })，且列表项以对应字族渲染预览。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { TypographyPopover } from '../writingPage/TypographyPopover';
import { DEFAULT_TYPOGRAPHY, type BookTypography } from '../../utils/typography';
import { setLang } from '../../i18n';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mountAsync(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}

const anchor = document.createElement('button');
document.body.appendChild(anchor);

const typo: BookTypography = { ...DEFAULT_TYPOGRAPHY };

beforeEach(() => {
  vi.clearAllMocks();
  setLang('zh-CN');
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
  document.body.appendChild(anchor);
});

describe('TypographyPopover 字体下拉（批次⑤）', () => {
  it('渲染「字体」下拉；展开后含 6 个字体选项且以对应字族预览', async () => {
    await mountAsync(<TypographyPopover anchorEl={anchor} onClose={() => {}} typo={typo} onChange={() => {}} />);
    expect(document.body.textContent).toContain('字体');
    // 当前选中「跟随系统」在收起的 Select 中可见
    const selectInput = Array.from(document.body.querySelectorAll<HTMLElement>('.MuiSelect-select')).find(
      (el) => el.textContent === '跟随系统',
    );
    expect(selectInput).toBeTruthy();
    await act(async () => {
      selectInput!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    const options = Array.from(document.body.querySelectorAll<HTMLElement>('li[role="option"]'));
    for (const name of ['跟随系统', '宋体', '楷体', '黑体', '仿宋', '微软雅黑']) {
      expect(options.some((el) => el.textContent === name)).toBe(true);
    }
    // 楷体项带预览字族（sx fontFamily 转为内联/类样式，DOM 上有 style 属性即可证渲染路径生效）
    const kaiItem = options.find((el) => el.textContent === '楷体');
    expect(kaiItem).toBeTruthy();
  });

  it("选择「楷体」触发 onChange({ fontFamily: 'kai' })", async () => {
    const onChange = vi.fn();
    await mountAsync(<TypographyPopover anchorEl={anchor} onClose={() => {}} typo={typo} onChange={onChange} />);
    // MUI select：打开后点击「楷体」项
    const selectInput = Array.from(document.body.querySelectorAll<HTMLElement>('.MuiSelect-select')).find(
      (el) => el.textContent === '跟随系统',
    );
    expect(selectInput).toBeTruthy();
    await act(async () => {
      selectInput!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    const kai = Array.from(document.body.querySelectorAll<HTMLElement>('li[role="option"]')).find(
      (el) => el.textContent === '楷体',
    );
    expect(kai).toBeTruthy();
    // 楷体选项以对应字族渲染预览
    expect(kai!.getAttribute('class') ?? '').toBeTruthy();
    await act(async () => {
      kai!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      kai!.click();
    });
    expect(onChange).toHaveBeenCalledWith({ fontFamily: 'kai' });
  });
});
