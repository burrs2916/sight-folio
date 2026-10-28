// 集成验证：实体 tab 目录树 <-> 画布 双向定位的数据链路。
// 用与 SceneEditorPage 同步画布完全相同的路径（buildTreeLayout + addComponentsBulk）
// 建出画布实体，确认 config 携带 filePath/fileId/dirPath，并验证
// tree->canvas（handleTreeDirFocus/handleTreeFileClick 的匹配）与
// canvas->tree（ProjectTree 反向联动的 findNodeChain/findNodeByIdWithChain）两条匹配逻辑。
import { describe, it, expect, beforeEach } from "vitest";
import { buildTreeLayout } from "../../utils/syncLayout";
import { entityTypeForFile } from "../../utils/fileKind";
import { buildFileTree, type TreeNode } from "../../utils/fileTree";
import { findNearestDirComponent, findComponentForDirPath } from "../../utils/canvasLink";
import { useEditorStore } from "../../../store/editorStore";
import { registerProjectEntities } from "../../registerProjectEntities";
import type { ProjectFile } from "../../../services/tauri";

// 真实 app 启动时已注册；测试里必须显式注册，否则 addComponentsBulk 会因
// 类型未注册而静默跳过（editorStore.ts:494），导致组件一个都不建。
registerProjectEntities();

function pf(
  id: string,
  name: string,
  relPath: string,
  isDirectory: boolean,
  parentId: string | null,
  language = isDirectory ? null : "typescript"
): ProjectFile {
  return {
    id,
    analysisId: "a1",
    path: "/p/" + relPath,
    relPath,
    name,
    extension: isDirectory ? null : relPath.split(".").pop() || "",
    language,
    size: 0,
    lineCount: 0,
    contentHash: null,
    parentId,
    isDirectory,
    layerId: null,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    metadata: "",
    scannedAt: 0,
  };
}

describe("tree <-> canvas 双向定位数据链路", () => {
  beforeEach(() => {
    // 清空画布与选中，避免单例 store 串味
    useEditorStore.setState((s: any) => {
      s.components = [];
      s.selection.selectedIds = [];
      s.focusRequest = null;
    });
  });

  function syncCanvas() {
    const files: ProjectFile[] = [
      pf("d1", "src", "src", true, null),
      pf("d2", "components", "src/components", true, "d1"),
      pf("f1", "App.tsx", "src/App.tsx", false, "d1"),
      pf("f2", "Button.tsx", "src/components/Button.tsx", false, "d2"),
    ];
    const layout = buildTreeLayout(files, [], () => ({}));
    const items = [
      ...layout.nodes
        .filter((n) => n.isDirectory)
        .map((n) => ({ type: "folder" as const, name: n.name, x: n.x, y: n.y, width: n.width, height: n.height, config: n.config })),
      ...layout.nodes
        .filter((n) => !n.isDirectory)
        .map((n) => ({ type: entityTypeForFile(n.raw), name: n.name, x: n.x, y: n.y, width: n.width, height: n.height, config: n.config })),
    ];
    useEditorStore.getState().addComponentsBulk(items as any);
    return { files, layout };
  }

  it("画布实体 config 携带 filePath/fileId（文件）与 dirPath（目录）", () => {
    syncCanvas();
    const comps = useEditorStore.getState().components;
    const folder = comps.find((c) => c.type === "folder");
    // items 构建顺序：folders 全部在前、files 在后；files 的布局序是
    // [Button.tsx(f2), App.tsx(f1)]（components 子树先于 App.tsx 遍历），
    // 所以第一个 type==="file" 的实体是 Button.tsx —— 断言按 f2 口径写。
    const file = comps.find((c) => c.type === "file");
    expect(folder?.config).toMatchObject({ dirPath: "src" });
    expect(file?.config).toMatchObject({ filePath: "src/components/Button.tsx", fileId: "f2" });
    const app = comps.find((c: any) => c.config?.fileId === "f1");
    expect(app?.config).toMatchObject({ filePath: "src/App.tsx", fileId: "f1" });
  });

  it("tree->canvas：目录行双击按 dirPath 命中文件夹实体", () => {
    syncCanvas();
    const tree = buildFileTree([
      pf("d1", "src", "src", true, null),
      pf("f1", "App.tsx", "src/App.tsx", false, "d1"),
    ]);
    const dirNode = tree[0];
    const comp = useEditorStore
      .getState()
      .components.find((c: any) => c.config?.dirPath === dirNode.relPath || c.config?.filePath === dirNode.relPath);
    expect(comp?.config?.dirPath).toBe("src");
  });

  it("tree->canvas：文件行双击按 fileId 命中文件实体（与 relPath 解耦）", () => {
    syncCanvas();
    const tree = buildFileTree([
      pf("d1", "src", "src", true, null),
      pf("f1", "App.tsx", "src/App.tsx", false, "d1"),
    ]);
    const fileNode = tree[0].children[0];
    // 模拟 handleTreeFileClick 的匹配（fileId || filePath）
    const comp = useEditorStore
      .getState()
      .components.find((c: any) => c.config?.fileId === fileNode.id || c.config?.filePath === fileNode.relPath);
    expect(comp?.id).toBeTruthy();
    expect(comp?.config?.fileId).toBe("f1");
  });

  it("canvas->tree：双击文件实体后 selectedIds 驱动的 selector 能取到 filePath", () => {
    const { files } = syncCanvas();
    const tree = buildFileTree(files);
    // 选中文件实体（模拟 canvas 双击 selectComponent）
    const fileComp = useEditorStore.getState().components.find((c: any) => c.config?.fileId === "f2");
    useEditorStore.getState().selectComponent(fileComp!.id, false);
    const sel = useEditorStore.getState().selection.selectedIds;
    const comp = useEditorStore.getState().components.find((c) => c.id === sel[0]);
    const filePath = (comp?.config as any)?.filePath;
    // findNodeChain 按 filePath 命中树节点
    const chain = findNodeChain(tree, filePath);
    expect(chain).not.toBeNull();
    expect(chain![chain!.length - 1].relPath).toBe("src/components/Button.tsx");
    // 兜底：按 fileId 命中
    const chain2 = findNodeByIdWithChain(tree, (comp?.config as any)?.fileId);
    expect(chain2).not.toBeNull();
    expect(chain2![chain2!.length - 1].id).toBe("f2");
  });
});

describe("文件不在画布时的回退定位（目录画像只画目录/有上限）", () => {
  beforeEach(() => {
    useEditorStore.setState((s: any) => {
      s.components = [];
      s.selection.selectedIds = [];
      s.focusRequest = null;
    });
  });

  /** 模拟目录画像（showFiles=false）：只有目录实体，没有文件实体 */
  function syncDirsOnly() {
    useEditorStore.getState().addComponentsBulk([
      {
        type: "folder",
        name: "src",
        x: 0,
        y: 0,
        width: 200,
        height: 88,
        config: { dirPath: "src", name: "src", childCount: 3 },
      },
      {
        type: "folder",
        name: "components",
        x: 100,
        y: 100,
        width: 200,
        height: 88,
        config: { dirPath: "src/components", name: "components", childCount: 1 },
      },
    ] as any);
  }

  it("findComponentForDirPath 精确命中目录实体", () => {
    syncDirsOnly();
    expect(findComponentForDirPath("src/components")?.name).toBe("components");
    expect(findComponentForDirPath("nope")).toBeUndefined();
  });

  it("文件无实体时回退到最近的已渲染父目录（跨多级）", () => {
    syncDirsOnly();
    // src/components/Button.tsx 的直属目录已渲染 → 直接命中
    const near = findNearestDirComponent("src/components/Button.tsx");
    expect((near?.config as any)?.dirPath).toBe("src/components");
    // 直属目录没渲染（被截断/超上限）→ 逐级上溯到 src
    const far = findNearestDirComponent("src/deep/nested/File.tsx");
    expect((far?.config as any)?.dirPath).toBe("src");
    // 目录节点同理：深层目录没渲染 → 回溯父目录
    const dir = findNearestDirComponent("src/components/ui/buttons");
    expect((dir?.config as any)?.dirPath).toBe("src/components");
  });

  it("画布只有根目录实体（dirPath 为空串）时根下文件回退到根", () => {
    useEditorStore.getState().addComponentsBulk([
      {
        type: "folder",
        name: "root",
        x: 0,
        y: 0,
        width: 200,
        height: 88,
        config: { dirPath: "", name: "root", childCount: 9 },
      },
    ] as any);
    const root = findNearestDirComponent("README.md");
    expect((root?.config as any)?.dirPath).toBe("");
  });

  it("画布完全没有目录实体时返回 undefined（调用方走告警分支）", () => {
    const none = findNearestDirComponent("src/App.tsx");
    expect(none).toBeUndefined();
  });
});

// 复制 ProjectTree 的两个纯函数以便单测（与组件内实现保持一致）
function findNodeChain(nodes: TreeNode[], relPath: string): TreeNode[] | null {
  for (const n of nodes) {
    if (n.relPath === relPath) return [n];
    if (n.isDirectory && n.children && n.children.length > 0) {
      const sub = findNodeChain(n.children, relPath);
      if (sub) return [n, ...sub];
    }
  }
  return null;
}
function findNodeByIdWithChain(nodes: TreeNode[], id: string): TreeNode[] | null {
  for (const n of nodes) {
    if (n.id === id) return [n];
    if (n.isDirectory && n.children && n.children.length > 0) {
      const sub = findNodeByIdWithChain(n.children, id);
      if (sub) return [n, ...sub];
    }
  }
  return null;
}
