import { describe, it, expect } from "vitest";
import { parseCadFile } from "../cadParser";

describe("parseCadFile（v2.15 按需 CAD 解析服务）", () => {
  it("非 CADBIN 文件（magic 不符）→ null", () => {
    const bytes = new Uint8Array(256);
    bytes.set([0x44, 0x57, 0x47, 0x00], 0); // "DWG\x00"
    expect(parseCadFile("a.dwg", bytes.buffer)).toBeNull();
  });

  it("文件过短（<128 头）→ null，不抛异常", () => {
    expect(parseCadFile("a.cadbin", new Uint8Array(64).buffer)).toBeNull();
  });

  it("空 buffer → null", () => {
    expect(parseCadFile("a.cadbin", new ArrayBuffer(0))).toBeNull();
  });
});
