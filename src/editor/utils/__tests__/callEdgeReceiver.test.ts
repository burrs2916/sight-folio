import { describe, it, expect } from "vitest";
import { receiverQualifiedName } from "../callEdgeReceiver";

describe("receiverQualifiedName (P1 · joern CALL.methodFullName 对标)", () => {
  it("裸调用（无接收者）仅返回方法名", () => {
    expect(receiverQualifiedName("doWork", "")).toBe("doWork");
    expect(receiverQualifiedName("doWork", undefined)).toBe("doWork");
    expect(receiverQualifiedName("doWork", null)).toBe("doWork");
    expect(receiverQualifiedName("doWork", "   ")).toBe("doWork");
  });

  it("成员调用拼回收件者限定名，区分同名 sink", () => {
    // child_process.exec 与 RegExp.exec 在 joern CPG 中是不同 CALL 边；这里同样可分。
    expect(receiverQualifiedName("exec", "child_process")).toBe("child_process.exec");
    expect(receiverQualifiedName("exec", "re")).toBe("re.exec");
  });

  it("链式调用取最左根标识符（a.b.c.method → a.method）", () => {
    expect(receiverQualifiedName("method", "a")).toBe("a.method");
  });

  it("接收者首尾空白被裁剪", () => {
    expect(receiverQualifiedName("save", "  repo ")).toBe("repo.save");
  });
});
