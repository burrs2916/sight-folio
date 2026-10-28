import { describe, it, expect } from "vitest";
import { LEAK_CONSOLE_RE, countSwallowedLoggerErrors } from "../portraits";

/** 把代码行拼成文本，统计泄漏数（模拟 runLoggingPortrait 的 code 拼接） */
function leakCount(lines: string[]): number {
  return (lines.join("\n").match(LEAK_CONSOLE_RE) || []).length;
}

describe("日志卫生画像（R42）", () => {
  it("console.log/debug/info 泄漏被命中，console.error 不命中", () => {
    expect(leakCount(["console.log('debug', x)", "const a = 1;"])).toBe(1);
    expect(leakCount(["console.debug('trace')"])).toBe(1);
    expect(leakCount(["console.info('boot')"])).toBe(1);
    expect(leakCount(["console.warn('deprecated')"])).toBe(1);
    // console.error 是合理的错误输出，不视为泄漏
    expect(leakCount(["console.error('real failure', err)"])).toBe(0);
  });

  it("logger.error 后无 throw/return = 吞错误，有 throw 不吞", () => {
    // 吞掉：error 后只做记录
    expect(
      countSwallowedLoggerErrors(["logger.error('failed', err);", "  doNothing();"])
    ).toBe(1);
    // 处理了：error 后紧跟 throw
    expect(
      countSwallowedLoggerErrors(["logger.error('failed', err);", "  throw new Error('x');"])
    ).toBe(0);
    // 处理了：error 后 return
    expect(
      countSwallowedLoggerErrors(["logger.error('failed', err);", "  return null;"])
    ).toBe(0);
    // 多行连续吞错逐条计数（两处 error 后 3 行内均无处理动作）
    expect(
      countSwallowedLoggerErrors([
        "logger.error('a');",
        "log('b');",
        "logger.error('c');",
        "log('d');",
      ])
    ).toBe(2);
  });
});
