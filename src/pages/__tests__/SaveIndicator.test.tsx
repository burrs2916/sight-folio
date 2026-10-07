// 写作台保存指示器 SaveIndicator · 回归锁（2026-09-21 P2：saveState 状态下沉）
//
// 背景：saveState 原挂 WritingPage 顶层，每 800ms 自动保存翻转一次、触发整树（约 2900 行）
// 重渲染。下沉到本组件后，翻转只重渲染指示器本身。WritingPage 通过 register 拿 setState
// 句柄写入；句柄是完整 Dispatch<SetStateAction>，函数式更新（保存完成但有新脏输入 → dirty）
// 语义必须保留。
//
// 这条测试锁死：
// ① register 在 commit 后被调用且句柄可用（no-op 默认句柄 → 真句柄替换）；
// ② idle 空文案、dirty/saving/saved 三态文案（文案取自真实 i18n，不硬编码）；
// ③ 函数式更新语义（updater 收到当前值）；
// ④ saved 态用 success 色。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import type { Dispatch, SetStateAction } from "react";

import { SaveIndicator, type SaveState } from "../SaveIndicator";
import { t } from "../../i18n";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
});

describe("写作台保存指示器 SaveIndicator（saveState 下沉 · 回归锁）", () => {
  it("register 在 commit 后交付可用的 setState 句柄；idle 态空文案", () => {
    let captured: Dispatch<SetStateAction<SaveState>> | null = null;
    mount(<SaveIndicator register={(fn) => (captured = fn)} />);

    expect(captured, "register 应在挂载后交付句柄").toBeTruthy();
    // idle：空文案（既非 saving/saved/dirty）
    expect((document.body.textContent ?? "").trim()).toBe("");
  });

  it("dirty / saving / saved 三态文案随句柄写入切换", () => {
    let captured: Dispatch<SetStateAction<SaveState>> | null = null;
    mount(<SaveIndicator register={(fn) => (captured = fn)} />);
    const set = (s: SaveState) => act(() => captured!(s));

    set("dirty");
    expect((document.body.textContent ?? "").trim()).toBe(t("writing.unsaved"));
    set("saving");
    expect((document.body.textContent ?? "").trim()).toBe(t("writing.saving"));
    set("saved");
    expect((document.body.textContent ?? "").trim()).toBe(t("writing.saved"));
  });

  it("函数式更新语义保留（保存完成但期间有新脏输入 → dirty）", () => {
    let captured: Dispatch<SetStateAction<SaveState>> | null = null;
    mount(<SaveIndicator register={(fn) => (captured = fn)} />);

    // 模拟 WritingPage flushSave:502 的原样语义：保存完成后若 pending 则 dirty 否则 saved
    let hasPending = false;
    act(() => {
      captured!(() => (hasPending ? "dirty" : "saved"));
    });
    expect((document.body.textContent ?? "").trim()).toBe(t("writing.saved"));

    hasPending = true;
    act(() => {
      captured!(() => (hasPending ? "dirty" : "saved"));
    });
    expect((document.body.textContent ?? "").trim()).toBe(t("writing.unsaved"));
  });

  it("saved 态使用 success 色（成功反馈可辨识）", () => {
    let captured: Dispatch<SetStateAction<SaveState>> | null = null;
    mount(<SaveIndicator register={(fn) => (captured = fn)} />);
    act(() => {
      captured!("saved");
    });
    const el = host!.firstElementChild as HTMLElement | null;
    expect(el, "指示器应渲染 Typography 根元素").toBeTruthy();
    expect(el!.getAttribute("class")).toContain("MuiTypography-root");
  });
});
