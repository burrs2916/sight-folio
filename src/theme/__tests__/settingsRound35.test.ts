// 第三十五轮 · 「迟到读回说实话」的源码扫描锁
//
// 行为锁（settingsReadbackRound35 / SettingsHealthNoticeRound35）证明的是**今天这条链接通了**；
// 这一把锁管的是「下一个改动把它悄悄拆掉时会撞红」。本仓反复栽在同一类坑上：
// 通道建好了、消费点少接一环（第 24 轮建了 store 没接消费点；第 26 轮两处死变量/死属性），
// 而这类缺失在行为测试里往往看不出来 —— 因为没人去测那一新加的那一域。
//
// 判据一律「先归一空白再匹配」，不绑 prettier 换行（第 26 轮在 Round23 那条上踩过）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import zhCN from '../../i18n/zh-CN.json';
import enUS from '../../i18n/en-US.json';

const STORE_DIR = resolve(__dirname, '../../store');
const GUARD = resolve(__dirname, '../../store/settingsReadbackGuard.ts');
const HEALTH = resolve(__dirname, '../../store/settingsHealthStore.ts');
const NOTICE = resolve(__dirname, '../../components/layout/SettingsHealthNotice.tsx');
const SYNC = resolve(__dirname, '../../store/settingsSyncStore.ts');

/** 用 exec 而不是 String.matchAll：本仓 lib 版本下 matchAll 的类型/运行时口径不稳定，
 *  而这三处扫描一旦抛异常会让整批断言以「取不到值」的形式假绿。 */
function matchesAll(source: string, pattern: RegExp): string[] {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[0]);
  return out;
}

const read = (p: string) => readFileSync(p, 'utf-8');
/** 归一空白：源码扫描锁不许绑 prettier 的换行/缩进 */
const flat = (s: string) => s.replace(/\s+/g, ' ');

/**
 * 剥掉注释再扫「不许出现 X」这类否定判据。
 * 本轮第一版就栽在这：guard 文件头第 34 轮写的时序注释里有一句 `init() 发出 settingsApi.get(...)`，
 * 于是「guard 不许调 settingsApi」这条把**注释**当成代码扫红了。否定式扫描锁不剥注释 = 迟早误报，
 * 而误报的结局是下一个人直接把整条锁删掉，比没锁更糟。
 */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');

const SEVEN_SCOPES = ['theme', 'layout', 'typography', 'typographyBooks', 'writing', 'language', 'appearance'] as const;

function storeFileNames(): string[] {
  return readdirSync(STORE_DIR).filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts'));
}
function storeSource(name: string): string {
  return read(resolve(STORE_DIR, name));
}

describe('七域的 scope 登记', () => {
  const attached = storeFileNames()
    .map((name) => ({ name, src: storeSource(name) }))
    .filter(({ src }) => /attachSettingsReadbackGuard\s*\(/.test(src));

  it('扫描本身要能扫到七个域（目录/正则写错会让下面几条整批假绿）', () => {
    expect(attached.length, '一个挂防护的域都没扫到 = 这把锁自己失效').toBeGreaterThanOrEqual(7);
  });

  it('每个域都必须显式声明 scope（少了它，界面那句报不出名字）', () => {
    for (const { name, src } of attached) {
      expect(flat(src), `${name} 的 attach 没传 scope`).toMatch(
        /attachSettingsReadbackGuard\([^)]*scope:\s*'[a-zA-Z]+'/,
      );
    }
  });

  it('七个 scope 一个不许少、也不许重复登记', () => {
    const scopes = attached.map(
      ({ src }) => flat(src).match(/attachSettingsReadbackGuard\([^)]*scope:\s*'([a-zA-Z]+)'/)?.[1],
    );
    for (const scope of SEVEN_SCOPES) {
      expect(scopes, `域 ${scope} 的 scope 不见了：健康条反查不到它的显示名`).toContain(scope);
    }
    expect(new Set(scopes).size, '同一个 scope 挂到两个域上：迟到账会把两件事报成一件事').toBe(
      scopes.filter(Boolean).length,
    );
  });

  it('guard 里的展示顺序表必须覆盖 SettingsScope 全集（联合类型加成员而顺序表漏登记，界面就少报一个域）', () => {
    const union = flat(read(SYNC)).match(/export type SettingsScope =([^;]+);/);
    expect(union, 'SettingsScope 联合类型解析不到：这条锁的判据要随之重写').not.toBeNull();

    const names = union![1]
      .split('|')
      .map((m) => (m.match(/'([a-zA-Z]+)'/) ?? [])[1])
      .filter(Boolean) as string[];
    expect(names.length, '联合成员解析为空 = 假绿').toBeGreaterThanOrEqual(7);
    const orderTable = flat(read(GUARD)).match(/const SCOPE_ORDER: Record<SettingsScope, number> = \{([^}]+)\}/);
    expect(orderTable, 'guard 里的顺序表被删或改成数组：新域会静默漏报名字').not.toBeNull();
    for (const name of names) {
      expect(orderTable![1], `SCOPE_ORDER 少了 ${name}`).toContain(name);
    }
  });
});

describe('计数实现唯一 + 不越界', () => {
  it('迟到计数只在 guard 一处，别的 store 不许各写一份', () => {
    const others = storeFileNames().filter(
      (name) =>
        name !== 'settingsReadbackGuard.ts' && /lateCount|recordLateReadback|lateScopes/.test(storeSource(name)),
    );
    expect(others, '又写一份迟到账 = 迟早两份数分家，界面报的次数不可信').toEqual([]);
  });

  it('guard 不写库、不新增 KV 键（这一格描述的是本次启动，跨启动留着就会说谎）', () => {
    const src = flat(code(read(GUARD)));
    expect(src, 'guard 里出现 persistSettings = 诊断读数混进用户设置的落盘状态').not.toMatch(/persistSettings\s*\(/);
    expect(src, 'guard 里直接调 settingsApi = 绕开可信层，失败又会变回看不见').not.toMatch(/settingsApi\./);
    expect(src, 'guard 里 import 了 services/tauri 或落库层 = 它开始自己写库了').not.toMatch(
      /import\s+\{[^}]*settingsApi[^}]*\}\s+from/,
    );
  });

  it('界面只经 settingsHealthStore 取这一读数，不直连 guard（直连拿不到重渲染）', () => {
    const src = read(NOTICE);
    expect(src).not.toMatch(/getLateReadbackSnapshot|subscribeLateReadbacks/);
    expect(flat(src), '健康条没订这一格 = 迟到发生了界面也不会冒出来').toMatch(
      /useSettingsHealthStore\(\(s\)\s*=>\s*s\.lateReadbacks\)/,
    );
  });

  it('健康 store 的初始读数取快照，而不是等订阅回调（init 比这个模块更早，迟到很可能已经发生）', () => {
    const src = flat(read(HEALTH));
    const initAt = src.indexOf('create<SettingsHealthState>');
    const resetAt = src.indexOf('reset: () =>');
    expect(initAt, '健康 store 结构变了：这条锁的判据要跟着改').toBeGreaterThan(-1);
    const initialBlock = src.slice(initAt, resetAt > initAt ? resetAt : src.length);
    expect(initialBlock).toMatch(/lateReadbacks:\s*getLateReadbackSnapshot\(\)/);
    expect(src, '没订阅 guard = 启动之后才发生的迟到界面看不见').toMatch(/subscribeLateReadbacks\(/);
  });

  it('reset 必须同时清真源与镜像（只清镜像下一条用例会读到上一条的次数）', () => {
    expect(flat(read(HEALTH))).toMatch(/resetLateReadbacks\(\)[^}]*set\(\{/);
  });
});

describe('界面文案与档位口径', () => {
  it('健康条这一行不许再写裸 px 字号（要跟随「字体大小」档位）', () => {
    const src = read(NOTICE);
    expect(src, '没有 uiFontSize 就还在写裸 px，切档位时这一行不动').toMatch(
      /from\s+['"][^'"]*theme\/appearanceScales['"]/,
    );
    const bare = matchesAll(flat(src), /fontSize:\s*\d+(\.\d+)?\s*[,)}]/g);
    expect(bare, `裸 px 字号回潮：${bare.join(' , ')}`).toEqual([]);
  });

  it('三个新文案键 zh / en 双包都在位，且占位符两边一致（少一个 {count} 界面就会报「次」不带数）', () => {
    const keys = ['healthLateReadback', 'healthLateReadbackHint', 'healthLateReadbackJoin'] as const;
    for (const key of keys) {
      expect(typeof (zhCN.settings as Record<string, unknown>)[key], `zh 缺 settings.${key}`).toBe('string');
      expect(typeof (enUS.settings as Record<string, unknown>)[key], `en 缺 settings.${key}`).toBe('string');
    }
    const zh = (zhCN.settings as Record<string, string>).healthLateReadback;
    const en = (enUS.settings as Record<string, string>).healthLateReadback;
    const ph = (s: string) =>
      matchesAll(s, /\{(\w+)\}/g)
        .sort()
        .join(',');
    expect(ph(en), '中英两侧的占位符不一致：切语言时会有一边显示出 {count} 这种残渣').toBe(ph(zh));
    expect(zh).toContain('{count}');
    expect(zh).toContain('{scopes}');
  });

  it('域名走 BACKUPABLE_SETTINGS_KEYS 反查，不许再写一份名字表（两处叫法分家 = 用户以为是两样东西）', () => {
    const src = flat(read(NOTICE));
    expect(src).toMatch(/BACKUPABLE_SETTINGS_KEYS/);
    expect(src, '写死了中文域名：英文界面下会冒中文').not.toMatch(/'主题色彩'|"主题色彩"/);
  });
});
