import { describe, it, expect } from "vitest";
import { parseCanvasOps, buildCanvasOpsMessage, captureCanvasSnapshot } from "../canvasAssistant";
import { useEditorStore } from "../../store/editorStore";

describe("parseCanvasOps", () => {
  it("裸 JSON 数组直接解析", () => {
    const { ops, parseError } = parseCanvasOps(
      '[{"op":"move","id":"comp_1","x":10,"y":20}]'
    );
    expect(parseError).toBeNull();
    expect(ops.length).toBe(1);
    expect(ops[0]).toEqual({ op: "move", id: "comp_1", x: 10, y: 20 });
  });

  it("带解释文字和代码围栏的回复也能抠出 JSON", () => {
    const reply = '好的，方案如下：\n```json\n[{"op":"remove","id":"comp_9"}]\n```\n请确认。';
    const { ops, parseError } = parseCanvasOps(reply);
    expect(parseError).toBeNull();
    expect(ops.length).toBe(1);
    expect(ops[0].op).toBe("remove");
  });

  it("非法 op 被丢弃并计数：未知类型 / add 越白名单 / 非数字坐标", () => {
    const { ops, dropped } = parseCanvasOps(
      JSON.stringify([
        { op: "teleport", id: "x" }, // 未知 op
        { op: "add", type: "image", name: "图", x: 0, y: 0 }, // add 类型越白名单
        { op: "move", id: "c1", x: "abc", y: 3 }, // 坐标非数字
        { op: "rename", id: "c1", name: "改名" }, // 合法
        "garbage",
      ])
    );
    expect(ops.length).toBe(1);
    expect(ops[0].op).toBe("rename");
    expect(dropped).toBe(4);
  });

  it("move/resize 校验数字与尺寸下限，set_text 截断超长文本", () => {
    const { ops } = parseCanvasOps(
      JSON.stringify([
        { op: "resize", id: "c1", width: 10, height: 50 }, // 尺寸过小 → 丢
        { op: "resize", id: "c1", width: 400, height: 99999 }, // 超上限 → 收敛
        { op: "set_text", id: "c1", text: "x".repeat(600) },
      ])
    );
    expect(ops.length).toBe(2);
    expect(ops[0]).toMatchObject({ op: "resize", width: 400, height: 2000 });
    expect(ops[1]).toMatchObject({ op: "set_text" });
    expect((ops[1] as { text: string }).text.length).toBe(500);
  });

  it("无数组 / 坏 JSON 返回 parseError", () => {
    expect(parseCanvasOps("我觉得没法做").parseError).toBe("no-array");
    expect(parseCanvasOps("[{bad json}]").parseError).toBe("invalid-json");
    // 对象串没有 [ ] 括号对 → 同样按「找不到数组」处理
    expect(parseCanvasOps('{"op":"move"}').parseError).toBe("no-array");
    expect(parseCanvasOps("").parseError).toBe("empty");
  });
});

describe("buildCanvasOpsMessage + captureCanvasSnapshot", () => {
  it("快照包含 id/type/名称/位置/文字，prompt 内含清单与规则", () => {
    // 造一个最小组件塞进 store
    const comp = {
      id: "comp_test_1",
      type: "writing-chapter",
      name: "第一章",
      transform: { x: 10, y: 20, width: 232, height: 64, rotation: 0, scale: 1 },
      layerId: "layer_1",
      zIndex: 0,
      locked: false,
      visible: true,
      config: { title: "第一章", wordCount: 800 },
    };
    useEditorStore.setState((s: any) => {
      s.components = [...s.components, comp];
    });
    const snap = captureCanvasSnapshot();
    const mine = snap.find((s) => s.id === "comp_test_1");
    expect(mine).toBeDefined();
    expect(mine!.text).toBe("第一章");
    const msg = buildCanvasOpsMessage([mine!], "把第一章移到右上角");
    expect(msg).toContain("comp_test_1");
    expect(msg).toContain("arrange_grid");
    expect(msg).toContain("把第一章移到右上角");
    // 清理
    useEditorStore.setState((s: any) => {
      s.components = s.components.filter((c: any) => c.id !== "comp_test_1");
    });
  });
});
