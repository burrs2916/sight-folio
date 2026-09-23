import { describe, expect, it } from "vitest";
import { clampRightTab, rightTabCount } from "../rightTabClamp";

// 背景：SceneEditor 跨场景类型切换不重挂载（SceneEditorPage 无 key），
// rightTab 带旧场景索引进新场景第一帧 → MUI Tabs value 命不中子 Tab
// （"provided to the Tabs component is invalid"）+ 指示条乱跑 + 内容栏空白。
// 锁：渲染期夹紧，越界一律回第一栏。

describe("rightTabClamp", () => {
  it("栏数口径：书场景 3 栏，代码场景 6 栏", () => {
    expect(rightTabCount(true)).toBe(3);
    expect(rightTabCount(false)).toBe(6);
  });

  it("书场景：代码场景残留索引（3/4/5）夹回第一栏", () => {
    expect(clampRightTab(3, true)).toBe(0);
    expect(clampRightTab(5, true)).toBe(0);
  });

  it("书场景：合法索引（0/1/2）原样保留", () => {
    expect(clampRightTab(0, true)).toBe(0);
    expect(clampRightTab(1, true)).toBe(1);
    expect(clampRightTab(2, true)).toBe(2);
  });

  it("代码场景：合法索引（0~5）原样保留", () => {
    for (let i = 0; i < 6; i += 1) {
      expect(clampRightTab(i, false)).toBe(i);
    }
  });

  it("代码场景：书场景残留索引合法（≤5）不误伤", () => {
    // 书场景 AI=2 → 代码场景 2=「分层」，索引本身合法，语义复位交给既有 effect
    expect(clampRightTab(2, false)).toBe(2);
  });

  it("负值防御：夹回第一栏", () => {
    expect(clampRightTab(-1, true)).toBe(0);
    expect(clampRightTab(-1, false)).toBe(0);
  });
});
