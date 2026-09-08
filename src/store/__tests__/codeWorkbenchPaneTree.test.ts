import { describe, it, expect, afterEach } from "vitest";
import {
  addPaneToTree,
  removePaneFromTree,
  countPanes,
  collectPaneIds,
  firstPaneId,
  useCodeWorkbenchStore,
  type PaneNode,
  type WorkbenchTab,
} from "../codeWorkbenchStore";

function tab(fileId: string, pinned = false): WorkbenchTab {
  return {
    fileId,
    relPath: `/${fileId}.ts`,
    name: fileId,
    language: "ts",
    loading: false,
    error: null,
    content: null,
    focusLine: null,
    focusColumn: null,
    reason: null,
    marks: [],
    seq: 0,
    pinned,
    readOnly: false,
    kind: "text",
  };
}

const leaf = (id: string): PaneNode => ({ kind: "pane", id });

describe("addPaneToTree（对标 Zed PaneAxis::split）", () => {
  it("首次拆分把单个窗格包成 axis 子组", () => {
    const tree: PaneNode = leaf("p0");
    const next = addPaneToTree(tree, "p0", leaf("p1"), "right");
    expect(next.kind).toBe("axis");
    if (next.kind === "axis") {
      expect(next.axis).toBe("row"); // right → 水平并排
      expect(next.children.map((c) => c.id)).toEqual(["p0", "p1"]);
      expect(next.flexes).toEqual([1, 1]);
    }
  });

  it("同朝向插入为兄弟并复位该轴 flex 为均分（对标 insert_pane）", () => {
    let tree: PaneNode = {
      kind: "axis",
      id: "ax0",
      axis: "row",
      children: [leaf("p0"), leaf("p1")],
      flexes: [3, 1],
    };
    tree = addPaneToTree(tree, "p1", leaf("p2"), "right");
    expect(tree.kind).toBe("axis");
    if (tree.kind === "axis") {
      expect(tree.children.map((c) => c.id)).toEqual(["p0", "p1", "p2"]);
      expect(tree.flexes).toEqual([1, 1, 1]); // 复位均分
    }
  });

  it("异朝向把源窗格就地包进垂直子组（父轴 flex 不变）", () => {
    // root 水平 [p0 | p1]；p0 向下拆分 → p0 变垂直子组 [p0 | pN]，root 仍水平
    let tree: PaneNode = {
      kind: "axis",
      id: "ax0",
      axis: "row",
      children: [leaf("p0"), leaf("p1")],
      flexes: [1, 1],
    };
    tree = addPaneToTree(tree, "p0", leaf("pN"), "down");
    expect(tree.kind).toBe("axis");
    if (tree.kind === "axis") {
      expect(tree.children[0].kind).toBe("axis"); // p0 被包成子组
      expect(tree.children[1]).toEqual(leaf("p1")); // p1 不受影响
      const sub = tree.children[0];
      if (sub.kind === "axis") {
        expect(sub.axis).toBe("col");
        expect(sub.children.map((c) => c.id)).toEqual(["p0", "pN"]);
        expect(sub.flexes).toEqual([1, 1]);
      }
      expect(tree.flexes).toEqual([1, 1]); // 父轴 flex 不变
    }
  });

  it("连续异/同朝向拆分可生成三层嵌套树", () => {
    // row[p0,p1] → p0 下拆 → row[col[p0,pN],p1] → pN 右拆 → col[p0,row[pN,pN2]]
    let tree: PaneNode = {
      kind: "axis",
      id: "ax0",
      axis: "row",
      children: [leaf("p0"), leaf("p1")],
      flexes: [1, 1],
    };
    tree = addPaneToTree(tree, "p0", leaf("pN"), "down");
    tree = addPaneToTree(tree, "pN", leaf("pN2"), "right");
    expect(tree.kind).toBe("axis");
    if (tree.kind === "axis") {
      const sub0 = tree.children[0];
      expect(sub0.kind).toBe("axis");
      if (sub0.kind === "axis") {
        expect(sub0.children[0]).toEqual(leaf("p0"));
        const inner = sub0.children[1];
        expect(inner.kind).toBe("axis");
        if (inner.kind === "axis") {
          expect(inner.axis).toBe("row");
          expect(inner.children.map((c) => c.id)).toEqual(["pN", "pN2"]);
        }
      }
    }
  });
});

describe("removePaneFromTree（对标 Zed PaneAxis::remove）", () => {
  it("删除成员后单子轴坍塌为其成员（上提父轴）", () => {
    const tree: PaneNode = {
      kind: "axis",
      id: "ax0",
      axis: "row",
      flexes: [1, 1],
      children: [
        { kind: "axis", id: "ax1", axis: "col", flexes: [1, 1], children: [leaf("p0"), leaf("pN")] },
        leaf("p1"),
      ],
    };
    const next = removePaneFromTree(tree, "pN");
    expect(next.kind).toBe("axis");
    if (next.kind === "axis") {
      expect(next.children.map((c) => c.id)).toEqual(["p0", "p1"]);
      expect(next.flexes).toEqual([1, 1]); // 坍缩后父轴 flex 复位
    }
  });

  it("仅剩一个窗格时坍塌为单个根窗格", () => {
    let tree: PaneNode = {
      kind: "axis",
      id: "ax0",
      axis: "row",
      flexes: [1, 1],
      children: [leaf("p0"), leaf("p1")],
    };
    tree = removePaneFromTree(tree, "p1");
    expect(tree).toEqual(leaf("p0"));
  });

  it("无删除时保持原引用（不误清自定义 flex）", () => {
    const tree: PaneNode = {
      kind: "axis",
      id: "ax0",
      axis: "row",
      flexes: [3, 1],
      children: [leaf("p0"), leaf("p1")],
    };
    const next = removePaneFromTree(tree, "missing");
    expect(next).toBe(tree);
  });
});

describe("树工具", () => {
  it("countPanes / collectPaneIds / firstPaneId 跨嵌套树", () => {
    const tree: PaneNode = {
      kind: "axis",
      id: "ax0",
      axis: "row",
      flexes: [1, 1],
      children: [
        { kind: "axis", id: "ax1", axis: "col", flexes: [1, 1], children: [leaf("p0"), leaf("pN")] },
        leaf("p1"),
      ],
    };
    expect(countPanes(tree)).toBe(3);
    expect(collectPaneIds(tree)).toEqual(["p0", "pN", "p1"]);
    expect(firstPaneId(tree)).toBe("p0");
  });
});

describe("moveTabToPane 精确插入（对标 Zed move_item 的 destination_index）", () => {
  function setup(opts?: { pinnedInTarget?: boolean }) {
    const pinnedInTarget = opts?.pinnedInTarget ?? false;
    useCodeWorkbenchStore.setState({
      panes: {
        p0: { id: "p0", tabs: [tab("a")], activeFileId: "a" },
        p1: {
          id: "p1",
          tabs: [
            ...(pinnedInTarget ? [tab("p", true)] : []),
            tab("x"),
            tab("y"),
          ],
          activeFileId: "x",
        },
      },
      paneTree: {
        kind: "axis",
        id: "ax0",
        axis: "row",
        flexes: [1, 1],
        children: [{ kind: "pane", id: "p0" }, { kind: "pane", id: "p1" }],
      },
      activePaneId: "p1",
      draggingTab: { paneId: "p0", fileId: "a" },
    });
  }

  it("toIndex=0 把来源标签并入目标窗格首位（跨窗格精确插入）", () => {
    setup();
    useCodeWorkbenchStore.getState().moveTabToPane("a", "p1", 0);
    const s = useCodeWorkbenchStore.getState();
    expect(s.panes["p1"].tabs.map((t) => t.fileId)).toEqual(["a", "x", "y"]);
    // 来源窗格变空 → 就地收起，树坍塌为单窗格 p1
    expect(s.panes["p0"]).toBeUndefined();
    expect(s.paneTree).toEqual({ kind: "pane", id: "p1" });
    expect(s.activePaneId).toBe("p1");
  });

  it("toIndex=末尾 追加到目标窗格末位（旧行为兼容）", () => {
    setup();
    useCodeWorkbenchStore.getState().moveTabToPane("a", "p1", 2);
    const s = useCodeWorkbenchStore.getState();
    expect(s.panes["p1"].tabs.map((t) => t.fileId)).toEqual(["x", "y", "a"]);
  });

  it("省略 toIndex 仍按末尾追加（旧调用方兼容）", () => {
    setup();
    useCodeWorkbenchStore.getState().moveTabToPane("a", "p1");
    const s = useCodeWorkbenchStore.getState();
    expect(s.panes["p1"].tabs.map((t) => t.fileId)).toEqual(["x", "y", "a"]);
  });

  it("落入 pinned 区自动钉住（与 reorderTab 同口径）", () => {
    setup({ pinnedInTarget: true });
    useCodeWorkbenchStore.getState().moveTabToPane("a", "p1", 0);
    const s = useCodeWorkbenchStore.getState();
    const ids = s.panes["p1"].tabs.map((t) => t.fileId);
    expect(ids).toEqual(["a", "p", "x", "y"]);
    expect(s.panes["p1"].tabs[0].pinned).toBe(true); // a 落入 pinned 区 → 自动钉住
  });

  it("来源==目标窗格时直接返回（无自移）", () => {
    setup();
    useCodeWorkbenchStore.setState({
      draggingTab: { paneId: "p1", fileId: "x" },
      activePaneId: "p1",
    });
    useCodeWorkbenchStore.getState().moveTabToPane("x", "p1", 0);
    const s = useCodeWorkbenchStore.getState();
    // 不变：x 仍在原位置，窗格未消失
    expect(s.panes["p1"].tabs.map((t) => t.fileId)).toEqual(["x", "y"]);
    expect(s.panes["p0"]).toBeDefined();
  });

  afterEach(() => {
    useCodeWorkbenchStore.setState({
      panes: {},
      paneTree: { kind: "pane", id: "p0" },
      activePaneId: "p0",
      draggingTab: null,
    });
  });
});

describe("toggleSyncScroll（窗格同步滚动开关）", () => {
  it("默认关闭，两次切换后在 开/关 间往返", () => {
    useCodeWorkbenchStore.setState({ syncScroll: false });
    expect(useCodeWorkbenchStore.getState().syncScroll).toBe(false);
    useCodeWorkbenchStore.getState().toggleSyncScroll();
    expect(useCodeWorkbenchStore.getState().syncScroll).toBe(true);
    useCodeWorkbenchStore.getState().toggleSyncScroll();
    expect(useCodeWorkbenchStore.getState().syncScroll).toBe(false);
  });
});

describe("openDiffTab（窗格差异对照 · 对标 Zed DiffEditor 双 buffer 对照）", () => {
  afterEach(() => {
    useCodeWorkbenchStore.setState({
      panes: {},
      paneTree: { kind: "pane", id: "p0" },
      activePaneId: "p0",
      draggingTab: null,
    });
  });

  it("跨窗格定位目标 fileId 并挂载 diff 规格，同时激活其所在窗格", () => {
    useCodeWorkbenchStore.setState({
      panes: {
        p0: { id: "p0", tabs: [tab("a.ts")], activeFileId: "a.ts" },
        p1: { id: "p1", tabs: [tab("b.ts")], activeFileId: "b.ts" },
      },
      paneTree: {
        kind: "axis",
        id: "ax",
        axis: "row",
        children: [
          { kind: "pane", id: "p0" },
          { kind: "pane", id: "p1" },
        ],
        flexes: [1, 1],
      },
      activePaneId: "p0",
    });
    useCodeWorkbenchStore.getState().openDiffTab("b.ts", {
      kind: "file",
      modifiedLabel: "b.ts",
      modifiedText: "modified",
      originalLabel: "a.ts",
      originalText: "original",
    });
    const s = useCodeWorkbenchStore.getState();
    const diff = s.panes.p1.tabs[0].diff;
    expect(diff?.kind).toBe("file");
    expect(diff?.originalText).toBe("original");
    expect(diff?.modifiedText).toBe("modified");
    // 承载着 b.ts 的 p1 被激活，且其为激活标签（对比视图立即可见）
    expect(s.activePaneId).toBe("p1");
    expect(s.panes.p1.activeFileId).toBe("b.ts");
  });

  it("kind=saved 对照写入目标标签，diff 两侧文本快照保留", () => {
    useCodeWorkbenchStore.setState({
      panes: { p0: { id: "p0", tabs: [tab("a.ts")], activeFileId: "a.ts" } },
      activePaneId: "p0",
    });
    useCodeWorkbenchStore.getState().openDiffTab("a.ts", {
      kind: "saved",
      modifiedLabel: "a.ts — working",
      modifiedText: "live buffer",
      originalLabel: "saved on disk",
      originalText: "disk version",
    });
    const t = useCodeWorkbenchStore.getState().panes.p0.tabs[0];
    expect(t.diff?.kind).toBe("saved");
    expect(t.diff?.modifiedText).toBe("live buffer");
    expect(t.diff?.originalText).toBe("disk version");
  });

  it("目标 fileId 不存在时静默无操作（不抛错、不改动布局）", () => {
    useCodeWorkbenchStore.setState({
      panes: { p0: { id: "p0", tabs: [tab("a.ts")], activeFileId: "a.ts" } },
      activePaneId: "p0",
    });
    useCodeWorkbenchStore.getState().openDiffTab("missing.ts", {
      kind: "file",
      modifiedLabel: "x",
      modifiedText: "m",
      originalLabel: "y",
      originalText: "o",
    });
    const s = useCodeWorkbenchStore.getState();
    expect(s.panes.p0.tabs[0].diff).toBeUndefined();
    expect(s.activePaneId).toBe("p0");
  });
});

