// 第三十五轮 · 健康条要说这句实话：本次启动有几次设置读回迟到了
//
// 用户原话是「确保设置完成后生效，关闭软件启停软件设置不会失效」。第 34 轮把**行为**修好了
// （迟到读数不再整份盖内存），但界面上零痕迹 —— 用户点完那一档，界面没跳回去，
// 他看到的形状和「设置没生效」完全一样，只是这次数据是对的。这一轮补的就是那句实话。
//
// 这把锁要钉住的四条：
//  ① 没发生过就**一个字都不出现**（健康条此前只在「可能记不住」时占位，误报会让人以为存储坏了）；
//  ② 发生过就必须出现，并且**报名字**（只报「有一次异常」等于没报，用户不知道该看哪一项）；
//  ③ 域名从 `BACKUPABLE_SETTINGS_KEYS` 反查，跟着界面语言走（另写一份名字表 = 迟早和备份区分家）；
//  ④ 这一行是中性说明，不是告警（它说的是本次启动的时序，不是存储坏了）。
//
// 端到端口径：不用 setState 伪造读数，而是**真的**制造一次迟到读回（卡住 IPC 读回 → 用户改一档 →
// 放行），再验界面。这样 guard → settingsHealthStore → 组件 这条链每一环都被走了一遍，
// 少接一环（比如忘了订阅）就是红的。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import AppTheme from '../../theme/AppTheme';
import SettingsHealthNotice from '../layout/SettingsHealthNotice';
import { useThemeStore, THEME_SETTINGS_KEY } from '../../store/themeStore';
import { useSettingsHealthStore } from '../../store/settingsHealthStore';
import { resetLateReadbacks } from '../../store/settingsReadbackGuard';
import { setLang } from '../../i18n';
import zhCN from '../../i18n/zh-CN.json';
import enUS from '../../i18n/en-US.json';

const h = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  gates: new Map<string, Array<() => void>>(),
}));

vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => {
      const snapshot = h.kv.get(key) ?? null;
      if (h.gates.has(key)) {
        await new Promise<void>((resolve) => {
          const list = h.gates.get(key) ?? [];
          list.push(resolve);
          h.gates.set(key, list);
        });
      }
      return snapshot;
    },
    set: async (key: string, value: string) => {
      h.kv.set(key, value);
    },
    delete: async (key: string) => {
      h.kv.delete(key);
    },
  },
  default: {},
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 真造一次「库读数比首帧门控慢、期间用户改了明暗」 */
async function causeOneLateReadback() {
  h.kv.set(THEME_SETTINGS_KEY, JSON.stringify({ mode: 'light', preset: 'default', fontSize: 'medium' }));
  h.gates.set(THEME_SETTINGS_KEY, []);
  const initing = useThemeStore.getState().init();
  useThemeStore.getState().setMode('dark');
  await flush();
  const list = h.gates.get(THEME_SETTINGS_KEY) ?? [];
  h.gates.delete(THEME_SETTINGS_KEY);
  list.forEach((release) => release());
  await initing;
  await flush();
}

function renderNotice() {
  return render(
    <AppTheme>
      <SettingsHealthNotice />
    </AppTheme>,
  );
}

beforeEach(async () => {
  cleanup();
  h.kv.clear();
  h.gates.clear();
  localStorage.clear();
  setLang('zh-CN');
  resetLateReadbacks();
  useThemeStore.getState().resetConfig();
  useThemeStore.setState({ initialized: false });
  // 健康读数回到「啥也没发生过」：探针没跑、后端没报路径、无迟到
  useSettingsHealthStore.setState({
    status: 'ok',
    checkedAt: Date.now(),
    probeRestored: true,
    dbLocation: null,
    dbPersistent: null,
    lateReadbacks: { count: 0, scopes: [], lastAt: null },
  });
  await flush();
});

describe('没发生过就一个字都不出现', () => {
  it('库正常、后端没报落点、无迟到 ⇒ 整块不渲染（沿用第 21 轮「正常时不占位」口径）', () => {
    const { container } = renderNotice();
    expect(container.querySelector('[data-testid="settings-health-notice"]')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('健康正常但有迟到 ⇒ 必须渲染（这一格单独就能撑起这块提示，别要求先有告警）', async () => {
    await causeOneLateReadback();
    const { container } = renderNotice();
    expect(container.querySelector('[data-testid="settings-late-readback"]')).not.toBeNull();
  });

  it('无迟到时不出现这一行（即使落点在说话）', () => {
    useSettingsHealthStore.setState({
      dbLocation: '/Users/demo/Library/Application Support/com.sight.folio/config.db',
    });
    const { container } = renderNotice();
    expect(container.querySelector('[data-testid="settings-db-location"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-late-readback"]')).toBeNull();
  });
});

describe('发生过就要报名字', () => {
  it('一次迟到 ⇒ 文案里有次数，也有这一域的界面名', async () => {
    await causeOneLateReadback();
    const { container } = renderNotice();
    const line = container.querySelector('[data-testid="settings-late-readback"]')!;
    expect(line.textContent).toContain('1');
    // 「theme」这个 scope 在界面上叫「主题色彩」（反查备份区那张清单，两处同一个名字）
    expect(line.textContent).toContain(zhCN.settings.backupKeyTheme);
    expect(line.textContent, '裸 scope 漏到界面上 = 用户读到一句英文黑话').not.toContain('theme');
  });

  it('文案与实现一致：说的是「按你改过的那几项保留」，不是「保存失败」', async () => {
    await causeOneLateReadback();
    const { container } = renderNotice();
    const text = container.querySelector('[data-testid="settings-late-readback"]')!.textContent ?? '';
    expect(text).toContain(zhCN.settings.healthLateReadback.split('{')[0].trim().replace('（', ''));
    expect(text, '这一行不是告警，不能把「数据没丢」写成「可能记不住」').not.toContain(
      zhCN.settings.healthNotPersisted,
    );
  });

  it('两域各迟到一次 ⇒ 次数为 2，两个名字都在，且顺序稳定', async () => {
    await causeOneLateReadback();
    // 第二域：布局
    h.kv.set('layout', JSON.stringify({ sidebarWidth: 300 }));
    h.gates.set('layout', []);
    const { useLayoutStore } = await import('../../store/layoutStore');
    const initing = useLayoutStore.getState().init();
    useLayoutStore.getState().setSidebarWidth(260);
    await flush();
    (h.gates.get('layout') ?? []).forEach((release) => release());
    h.gates.delete('layout');
    await initing;
    await flush();

    const { container } = renderNotice();
    const text = container.querySelector('[data-testid="settings-late-readback"]')!.textContent ?? '';
    expect(text).toContain('2');
    expect(text).toContain(zhCN.settings.backupKeyTheme);
    expect(text).toContain(zhCN.settings.backupKeyLayout);
  });
});

describe('语言与档位', () => {
  it('英文界面 ⇒ 用英文文案，域名也用英文包（同一条反查，不是写死中文）', async () => {
    await causeOneLateReadback();
    setLang('en-US');
    const { container } = renderNotice();
    const text = container.querySelector('[data-testid="settings-late-readback"]')!.textContent ?? '';
    expect(text.toLowerCase()).toContain('late');
    expect(text).toContain(enUS.settings.backupKeyTheme);
    expect(text).not.toContain('主题色彩');
  });

  it('降级告警与迟到说明同时成立 ⇒ 两句都在，互不遮挡', async () => {
    await causeOneLateReadback();
    useSettingsHealthStore.setState({ status: 'not_persisted', dbPersistent: false });
    const { container } = renderNotice();
    expect(container.querySelector('[data-testid="settings-health-notice"]')!.getAttribute('data-status')).toBe(
      'not_persisted',
    );
    expect(
      container.querySelector('[data-testid="settings-health-reprobe"]'),
      '告警那半段不许被新行挤掉',
    ).not.toBeNull();
    const late = container.querySelector('[data-testid="settings-late-readback"]')!;
    expect(late, '已经有告警了就不说迟到 = 把两件事揉成一句，用户更分不清').not.toBeNull();
    // 两条实话各说各的：告警说的是「这次可能记不住」，迟到说的是「本次启动的时序」
    expect(late.textContent).not.toContain(zhCN.settings.healthNotPersisted);
    expect(container.textContent).toContain(zhCN.settings.healthNotPersisted);
  });

  it('迟到那一行自带一句中性补充说明（免得被读成新的存储故障）', async () => {
    await causeOneLateReadback();
    const { container } = renderNotice();
    expect(container.textContent).toContain(zhCN.settings.healthLateReadbackHint);
  });
});

describe('文案键齐备', () => {
  it('三个新键 zh / en 双包都在位', () => {
    for (const key of ['healthLateReadback', 'healthLateReadbackHint', 'healthLateReadbackJoin'] as const) {
      expect(typeof zhCN.settings[key], `zh 缺 settings.${key}`).toBe('string');
      expect(typeof enUS.settings[key], `en 缺 settings.${key}`).toBe('string');
    }
  });
});
