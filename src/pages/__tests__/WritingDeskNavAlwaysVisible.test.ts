// 写作台「导航常在」回归锁（2026-11-03，用户定调）
//
// 病灶：用户报「正文左右两侧的目录树和 tips 全没了，重启也没回来」。查证不是删码，
// 而是 focusMode 档位把导航整块抹掉 —— WritingPage 里四处 `focusMode` 门控（左栏
// 容器 display:none、左栏三页签条件渲染、拖宽手柄 display:none、速记 FAB）+ 右抽屉
// `hidden={focusMode==='zen'}` / `remindersVisible={focusMode==='normal'}`，再叠加独立
// 窗口设置宿主在 zen 下连齿轮一起 `return null`。因为 focusMode 属持久化字段
// （writingPrefsStore 的 WRITING_PREFS_PERSISTED_FIELDS），误切一次档就跨重启保留，
// 用户只能看到「功能凭空消失」。
//
// 新契约：档位只改正文列几何与留白，**不得决定任何导航/功能入口的存亡**。要清净走
// 右抽屉自身的折叠窄条（用户主动动作），不走档位副作用。
//
// 口径与 WritingColumnWidthConsistency.test.ts 一致：读源码断言代码形态，注释里的
// 历史字样不误伤（故正则都带代码上下文特征，不匹配裸中文）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = process.cwd();
const page = readFileSync(`${ROOT}/src/pages/WritingPage.tsx`, 'utf8');
const deskHost = readFileSync(`${ROOT}/src/components/layout/DeskSettingsPanel.tsx`, 'utf8');

describe('① 左栏容器 / 拖宽手柄不许被档位隐藏', () => {
  it('全文件不再存在 display: focusMode !== \'normal\' ? \'none\' 的门控形态', () => {
    expect(page).not.toMatch(/display:\s*focusMode\s*!==\s*'normal'\s*\?\s*'none'/);
  });

  it('左栏 Paper 恒定 display: flex', () => {
    const at = page.indexOf('─── 左栏：书架 + 章节数/设定 双 tab ───');
    expect(at).toBeGreaterThan(-1);
    const block = page.slice(at, at + 700);
    expect(block).toMatch(/display:\s*'flex',/);
  });
});

describe('② 左栏三页签（章节目录树 / 设定 / 笔记）只跟作品绑定走', () => {
  it('不再出现 focusMode === \'normal\' && activeBook 的条件渲染', () => {
    expect(page).not.toMatch(/focusMode\s*===\s*'normal'\s*&&\s*activeBook/);
  });

  it('页签区由 activeBook 单独把关（未 bind 作品时仍是空态引导，不是白屏）', () => {
    const at = page.indexOf('<Tab value="chapters"');
    expect(at).toBeGreaterThan(-1);
    const before = page.slice(Math.max(0, at - 1200), at);
    expect(before).toMatch(/\{activeBook && \(/);
  });
});

describe('③ 右抽屉（tips / 提醒 / 语料参考 / 章详情入口）任何档位都在', () => {
  it('抽屉不再按档位隐藏，提醒区不再按档位静音', () => {
    const at = page.indexOf('<WritingDrawer');
    expect(at).toBeGreaterThan(-1);
    const call = page.slice(at, at + 1600);
    expect(call).toMatch(/hidden=\{false\}/);
    expect(call).not.toMatch(/hidden=\{focusMode/);
    expect(call).not.toMatch(/remindersVisible=\{focusMode/);
    // 提醒区必须在位：shorthand `remindersVisible`（=true）或显式 {true} 二者其一
    expect(call).toMatch(/remindersVisible(\s*\n|\s*=true|\s*\})/);
  });

  it('速记 FAB 等功能入口不再按档位收起', () => {
    expect(page).not.toMatch(/activeBook\s*&&\s*focusMode\s*===\s*'normal'/);
  });
});

describe('④ 独立窗口设置宿主：zen 不再收掉唯一可见出口', () => {
  it('WritingDeskSettingsHost 无条件渲染入口（不得有档位早退）', () => {
    expect(deskHost).not.toMatch(/if\s*\(focusMode\s*===\s*'zen'\s*&&\s*!open\)\s*return\s+null/);
    expect(deskHost).toMatch(/data-testid="desk-settings-open"/);
  });
});

describe('⑤ 反向锁：档位仍要有效用（防止有人整块删掉模式逻辑来过关）', () => {
  it('正文列几何依旧跟随 focusMode（zen 收窄居中列、focus 加宽左右留白）', () => {
    const at = page.indexOf('批③：外栏几何跟随 focusMode');
    expect(at).toBeGreaterThan(-1);
    const region = page.slice(at, at + 2600);
    expect(region).toMatch(/focusMode === 'zen'/);
    expect(region).toMatch(/focusMode === 'focus'/);
  });

  it('档位三循环与持久化字段口径未被改动', () => {
    const prefs = readFileSync(`${ROOT}/src/store/writingPrefsStore.ts`, 'utf8');
    expect(prefs).toMatch(/export function nextDeskFocusMode\(current: DeskFocusMode\)/);
    expect(prefs).toMatch(/WRITING_PREFS_PERSISTED_FIELDS\s*=\s*\[[^\]]*'focusMode'/);
  });
});
