// 第三十四轮：设置读回竞态防护的源码扫描锁
//
// 为什么需要扫描锁而不是只测行为：本仓最大的复发教训是「新增一个设置域，只做了落库，
// 没接生效链路 / 没接防护」（第 24 轮建了 writingPrefsStore 却没接消费点，第 25 轮才收）。
// 行为锁只能证明**今天这七个域**没问题；这一把锁证明的是「第八个域进来时不接防护就撞红」。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const STORE_DIR = resolve(__dirname, '../../store');

/** 落库层自己不算设置域（它就是被接的那个东西） */
const NOT_A_SETTINGS_DOMAIN = new Set(['settingsSyncStore.ts', 'settingsReadbackGuard.ts']);

function storeFiles(): string[] {
  return readdirSync(STORE_DIR).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.d.ts') && statSync(resolve(STORE_DIR, name)).isFile(),
  );
}

function readStore(name: string): string {
  return readFileSync(resolve(STORE_DIR, name), 'utf-8');
}

/** 本域落库的唯一入口是可信层 persistSettings —— 调了它就算一个「设置域」 */
function filesThatPersist(): { name: string; src: string }[] {
  return storeFiles()
    .filter((name) => !NOT_A_SETTINGS_DOMAIN.has(name))
    .map((name) => ({ name, src: readStore(name) }))
    .filter(({ src }) => /\bpersistSettings\(/.test(src));
}

describe('读回竞态防护 · 覆盖所有会落库的 store', () => {
  const domains = filesThatPersist();

  it('扫描本身要能扫到东西（正则/目录写错会让下面几条整批假绿）', () => {
    expect(domains.length, 'src/store 下一个调用 persistSettings 的域都没扫到 = 扫描本身失效').toBeGreaterThanOrEqual(
      7,
    );
  });

  it('每个落库域都必须挂读回防护', () => {
    for (const { name, src } of domains) {
      expect(src, `${name} 会写设置库却没有竞态防护：init 迟到时会整份盖掉用户刚改的那一项`).toMatch(
        /attachSettingsReadbackGuard\s*\(/,
      );
    }
  });

  it('每个落库域的 init 都必须「先拍号 → 再读库 → 后判 stale」', () => {
    for (const { name, src } of domains) {
      const captureAt = src.search(/[\w$]+\.capture\(\)/);
      const getAt = src.search(/settingsApi\.get\s*\(/);
      const staleAt = src.search(/[\w$]+\.isStale\s*\(/);
      expect(captureAt, `${name} 的 init 没有拍号`).toBeGreaterThan(-1);
      expect(staleAt, `${name} 拍了号却没判 stale = 拍了个寂寞`).toBeGreaterThan(-1);
      expect(getAt, `${name} 里没有 settingsApi.get：这一把锁的判据要随之重写`).toBeGreaterThan(-1);
      expect(captureAt, `${name} 拍号必须在读库之前，否则读回期间的改动统计不到`).toBeLessThan(getAt);
      expect(staleAt, `${name} 的 stale 判定必须在读库之后，否则形同虚设`).toBeGreaterThan(getAt);
    }
  });

  it('七个已知设置域一个都不许被静默摘掉', () => {
    const covered = new Set(domains.map((d) => d.name));
    for (const name of [
      'themeStore.ts',
      'layoutStore.ts',
      'typographyDefaultsStore.ts',
      'writingPrefsStore.ts',
      'languageStore.ts',
      'bookTypographyStore.ts',
      'appearanceStore.ts',
    ]) {
      expect(covered.has(name), `${name} 不再落库了？若是刻意迁走，请连同本清单一起改`).toBe(true);
    }
  });

  it('取整份 state 的域必须显式关掉「同值重写也算改过」（否则门控标志翻动会被误判）', () => {
    const appearance = readStore('appearanceStore.ts');
    expect(appearance).toMatch(/select:\s*\(s\)\s*=>\s*s,/);
    expect(appearance, 'select 取整份 state 却不关同值重写：initialized 一翻就被判成用户改过，白写一次库').toMatch(
      /countSameValueRewrite:\s*false/,
    );
  });
});

describe('读回竞态防护 · 实现唯一', () => {
  it('合并逻辑只有 settingsReadbackGuard.ts 一处', () => {
    const implementers = storeFiles().filter(
      (name) => name !== 'settingsReadbackGuard.ts' && /function\s+mergeStaleReadback/.test(readStore(name)),
    );
    expect(implementers, '又写一份合并实现 = 迟早两份口径分家').toEqual([]);
  });

  it('七个域都从单一真源导入合并函数，不各自实现', () => {
    for (const { name, src } of filesThatPersist()) {
      expect(src, `${name} 的合并实现必须来自 settingsReadbackGuard`).toMatch(
        /from\s+['"]\.\/settingsReadbackGuard['"]/,
      );
    }
  });

  it('首帧门控的兜底超时仍然存在（防护是补这条窗口，不是把窗口关掉）', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf-8');
    expect(app).toMatch(/APPEARANCE_READBACK_TIMEOUT_MS\s*=\s*1500/);
    // 六个域都在门控里等读回（外观预设刻意不参与，见 App.tsx 注释）
    for (const flag of [
      'themeInitialized',
      'layoutInitialized',
      'typographyDefaultsInitialized',
      'languageInitialized',
      'writingPrefsInitialized',
    ]) {
      expect(app, `首帧门控少了 ${flag}：界面会先按默认画一遍再跳成用户那一套`).toContain(flag);
    }
  });
});
