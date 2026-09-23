// DOM 嵌套回归锁（2026-09-14）
//
// 事故：控制台报 `validateDOMNesting(...): <div> cannot appear as a descendant of <p>`
// （栈顶 ArchitectureLayersPanel.tsx BookVolumeView）。
//
// 根因：MUI `ListItemText` 的 `secondary` 槽默认渲染为 `<Typography component="p">`，
// 而写作面板往里塞了 `Chip`（根节点 div）或 `Stack`（根节点 div）→ `<p><div/></p>` 非法嵌套。
// 修法：给这些 ListItemText 加 `slotProps={{ secondary: { component: "div" } }}`，
// 让 secondary 槽本身成为 div（block 语义不变，无视觉影响）。
//
// 这条测试锁死两件事：① secondary 槽必须是 div（不是 p）；② 全程不得再冒出嵌套告警。
// 覆盖两条路径：直挂 Chip（大纲板）与经 Stack 包 Chip（人物板）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import type { ProjectFile } from "../../../services/tauri";

import { WritingOutlinePanel, WritingCharactersPanel } from "../WritingRightPanel";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** 造一个写作域章节虚拟文件（metadata 里带卷 / 状态 / 人物出场） */
function pf(id: string, relPath: string, meta: Record<string, unknown>): ProjectFile {
  return {
    id,
    analysisId: "a1",
    path: `/writing/${relPath}`,
    relPath,
    name: relPath.replace(/^\d+-/, ""),
    extension: "md",
    language: "markdown",
    size: 100,
    lineCount: 10,
    contentHash: null,
    parentId: null,
    isDirectory: false,
    layerId: null,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    metadata: JSON.stringify(meta),
    scannedAt: 0,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let errorSpy: ReturnType<typeof vi.spyOn>;

function mount(ui: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

beforeEach(() => {
  // React 的 DOM 嵌套警告走 console.error，抓它
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
  errorSpy.mockRestore();
});

/** 所有 console.error 里是否出现 DOM 嵌套告警 */
function nestingWarnings(): string[] {
  return errorSpy.mock.calls
    .map((c) => String(c[0]))
    .filter((s) => s.includes("validateDOMNesting") || s.includes("cannot appear as a descendant of"));
}

describe("写作面板 ListItemText secondary 不得是 <p> 包块元素", () => {
  it("大纲板：secondary 直挂 Chip 时，槽位是 div 且无嵌套告警", () => {
    const files = [pf("f1", "01-开篇.md", { chapterStatus: "draft" })];
    mount(<WritingOutlinePanel files={files} onOpenChapter={() => {}} />);

    const secondary = document.querySelector('[class*="MuiListItemText-secondary"]');
    expect(secondary, "应有 secondary 槽").not.toBeNull();
    expect(secondary!.tagName).toBe("DIV"); // 关键：不是 P
    // Chip 存在，且其祖先里没有 <p>（就是告警的那个形态）
    expect(document.querySelector('[class*="MuiChip-root"]')).not.toBeNull();
    expect(document.querySelector('[class*="MuiChip-root"]')!.closest("p")).toBeNull();
    expect(nestingWarnings()).toEqual([]);
  });

  it("人物板：secondary 经 Stack 包 Chip 时，槽位是 div 且无嵌套告警", () => {
    const files = [
      pf("f1", "01-开篇.md", { appearances: [{ id: "p1", name: "林深", count: 3, kind: "character" }] }),
    ];
    mount(<WritingCharactersPanel files={files} onOpenChapter={() => {}} />);

    const secondary = document.querySelector('[class*="MuiListItemText-secondary"]');
    expect(secondary, "应有 secondary 槽").not.toBeNull();
    expect(secondary!.tagName).toBe("DIV");
    // Stack 是 secondary 的直接子（div），其内 Chip 也不在 <p> 里
    expect(document.querySelector('[class*="MuiStack-root"]')).not.toBeNull();
    expect(document.querySelector('[class*="MuiChip-root"]')!.closest("p")).toBeNull();
    expect(nestingWarnings()).toEqual([]);
  });
});
