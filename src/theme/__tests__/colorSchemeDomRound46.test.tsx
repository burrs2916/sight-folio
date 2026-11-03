// 明暗 DOM 门面锁（2026-11-03 插单八）。
//
// 李先生报修：「重启后颜色会乱，深色文字压深色背景」。实测抓到的是**半套主题**：
// theme.palette（JS 侧）已是 dark，而挂在 data-mui-color-scheme 上的 CSS 变量仍是浅色套 ——
// 走 var() 的文字因此还是深字，压在走内联样式的深底上（「书架」标题 1.17:1、空态 1.10:1）。
//
// 三道闸逐条钉住（来龙去脉见 theme/colorSchemeFacade.ts 头注释）：
//  ① 主题只带当前那一套 colorScheme；② MUI 的 localStorage['mui-mode'] 第三真源被拔掉；
//  ③ 祖先侧 passive effect 兜最后一次写，且全仓只有 colorSchemeFacade 一个写者。
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTheme } from '@mui/material/styles';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AppTheme from '../AppTheme';
import { useColorSchemeFacade } from '../colorSchemeFacade';
import { normalizeThemeConfig } from '../../store/themeStore';

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 复刻真实挂载形状：明暗门面在**祖先**，AppTheme 在其内 —— 闸门顺序就是被这个形状决定的。
function Ancestor({ mode, children }: { mode: 'light' | 'dark'; children: ReactNode }) {
  useColorSchemeFacade(mode);
  return <>{children}</>;
}

function ModeProbe() {
  const theme = useTheme();
  // v9 的 Theme 类型上不声明 colorSchemes（只有 CssVarsTheme 有），这里只为验证闸门①，读一次做断言
  const schemes = Object.keys((theme as unknown as { colorSchemes?: Record<string, unknown> }).colorSchemes ?? {}).join(
    ',',
  );
  return (
    <>
      <span id="probe-mode">{theme.palette.mode}</span>
      <span id="probe-schemes">{schemes}</span>
    </>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function tree(mode: 'light' | 'dark') {
  const config = normalizeThemeConfig({ mode, preset: 'custom', customPrimary: '#1a2378' });
  return (
    <Ancestor mode={mode}>
      <AppTheme config={config}>
        <ModeProbe />
      </AppTheme>
    </Ancestor>
  );
}

function mount(mode: 'light' | 'dark') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(tree(mode));
  });
}

function patch(mode: 'light' | 'dark') {
  act(() => {
    root!.render(tree(mode));
  });
}

const attr = () => document.documentElement.getAttribute('data-mui-color-scheme');
const probeMode = () => document.getElementById('probe-mode')?.textContent ?? '';

const probeSchemes = () => document.getElementById('probe-schemes')?.textContent ?? '';

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});

describe('明暗 DOM 门面与主题对象同源（插单八）', () => {
  it('深色挂载：palette.mode 与 data-mui-color-scheme 同为 dark', () => {
    mount('dark');
    expect(probeMode()).toBe('dark');
    expect(attr(), '主题已是深色而门面没跟上 = 半套主题').toBe('dark');
  });

  it('更新路径（不重挂载）：改明暗后门面必须当场跟着 palette 走', () => {
    mount('light');
    expect(attr()).toBe('light');
    patch('dark');
    expect(probeMode()).toBe('dark');
    expect(attr(), '这就是现场那条：palette 已 dark，门面停在 light').toBe('dark');
    patch('light');
    expect(probeMode()).toBe('light');
    expect(attr()).toBe('light');
  });

  it('闸①：主题只带当前那一套 colorScheme（两套都在时 MUI 会自己挑明暗）', () => {
    mount('dark');
    expect(probeSchemes()).toBe('dark');
    patch('light');
    expect(probeSchemes()).toBe('light');
  });

  it('闸②：ThemeProvider 关掉 MUI 自己的 mode 存储（localStorage 不是第二真源）', () => {
    const text = readFileSync(join(SRC_DIR, 'theme/AppTheme.tsx'), 'utf8');
    expect(text).toMatch(/storageManager=\{null\}/);
  });

  it('闸③：全仓只有 colorSchemeFacade 一处写这个属性', () => {
    const needle = "setAttribute('data-mui-color-scheme'";
    const writers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && readFileSync(full, 'utf8').includes(needle)) {
          writers.push(full.replace(`${SRC_DIR}/`, ''));
        }
      }
    };
    walk(SRC_DIR);
    expect(writers).toEqual(['theme/colorSchemeFacade.ts']);
  });
});
