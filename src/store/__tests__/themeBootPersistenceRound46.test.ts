// 主题「改完 → 重启读回」端到端锁（2026-11-03 插单八）。
//
// 李先生报修：设置完颜色/主题，重新启动就不对，「持久化没做好」。
// 浏览器实测的真实时序是：各 store 先 init 读回（这一次看着是对的）→ authStore.init() 的
// 全量存储清扫把 `sightfolio.settings:*` 删掉 → **下一次重启全回默认**。所以这条锁必须把
// 三段一起钉住：写盘、清扫不许越界、重启读回。少任何一段都会重现同一个观感。
import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, THEME_SETTINGS_KEY, normalizeThemeConfig } from '../themeStore';
import { BROWSER_SETTINGS_PREFIX } from '../../services/settings';
import { cleanupDisallowedKeys } from '../../utils/cacheWhitelist';

const KEY = `${BROWSER_SETTINGS_PREFIX}${THEME_SETTINGS_KEY}`;

describe('主题改完 → 清扫 → 重启读回（端到端）', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('三项设置落盘、活过一次启动清扫、init 仍能读回', async () => {
    await useThemeStore.getState().init();
    const st = useThemeStore.getState();
    st.setMode('dark');
    st.setPreset('custom');
    st.setCustomPrimary('#1a2378');
    await new Promise((r) => setTimeout(r, 0));

    const raw = localStorage.getItem(KEY);
    expect(raw, `主题没有落盘（键 ${KEY} 不存在）`).toBeTruthy();
    expect(raw).toContain('"dark"');
    expect(raw).toContain('#1a2378');

    // 关键一步：跑一次认证域的启动清扫（authStore.init 每次启动都会调它）。
    // 修好之前，就是这里把上面那条键静默删掉，于是「第二次重启」才暴露丢设置。
    cleanupDisallowedKeys();
    expect(localStorage.getItem(KEY), '认证清扫越界删掉了设置库兜底通道的键').toBeTruthy();

    // 模拟重启：内存回默认，再走一次 init()
    useThemeStore.setState({ config: normalizeThemeConfig(null), initialized: false });
    await useThemeStore.getState().init();
    const back = useThemeStore.getState().config;
    expect(back.mode).toBe('dark');
    expect(back.preset).toBe('custom');
    expect(back.customPrimary).toBe('#1a2378');
  });

  it('崩溃恢复草稿等应用自有键也不许被启动清扫吃掉', () => {
    localStorage.setItem('sight-folio:writing-draft:b1:c1', '没写完的一章');
    localStorage.setItem('workbench.ai.width', '420');
    localStorage.setItem('ps.workbench.verifyCanvas', '{}');
    localStorage.setItem('sightFolio.writingBookSearch.history', '[]');
    localStorage.setItem('project-sight-locale', 'zh-CN');
    localStorage.setItem('settings_probe_last_boot', 'boot-1');
    // 真正该被清扫的是"来历不明的杂键"
    localStorage.setItem('some_stray_junk_key', 'x');

    cleanupDisallowedKeys();

    expect(localStorage.getItem('sight-folio:writing-draft:b1:c1')).toBe('没写完的一章');
    expect(localStorage.getItem('workbench.ai.width')).toBe('420');
    expect(localStorage.getItem('ps.workbench.verifyCanvas')).toBe('{}');
    expect(localStorage.getItem('sightFolio.writingBookSearch.history')).toBe('[]');
    expect(localStorage.getItem('project-sight-locale')).toBe('zh-CN');
    expect(localStorage.getItem('settings_probe_last_boot')).toBe('boot-1');
    expect(localStorage.getItem('some_stray_junk_key')).toBeNull();
  });
});
