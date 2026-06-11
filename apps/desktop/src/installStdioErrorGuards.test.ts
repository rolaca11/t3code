import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  guardStreamAgainstBrokenPipe,
  installStdioErrorGuards,
  isBrokenPipeError,
} from "./installStdioErrorGuards.ts";

const errorWithCode = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`write ${code}`), { code });

describe("isBrokenPipeError", () => {
  it("matches broken-pipe write codes", () => {
    expect(isBrokenPipeError(errorWithCode("EPIPE"))).toBe(true);
    expect(isBrokenPipeError(errorWithCode("ERR_STREAM_DESTROYED"))).toBe(true);
  });

  it("ignores unrelated errors and non-errors", () => {
    expect(isBrokenPipeError(errorWithCode("ENOENT"))).toBe(false);
    expect(isBrokenPipeError(new Error("plain"))).toBe(false);
    expect(isBrokenPipeError(undefined)).toBe(false);
    expect(isBrokenPipeError(null)).toBe(false);
    expect(isBrokenPipeError("EPIPE")).toBe(false);
  });
});

describe("guardStreamAgainstBrokenPipe", () => {
  it("documents the unguarded baseline: an EPIPE error event crashes", () => {
    // Without an `error` listener, Node throws the emitted error — this is the
    // uncaught exception that surfaces as Electron's fatal dialog.
    expect(() => new EventEmitter().emit("error", errorWithCode("EPIPE"))).toThrow(/EPIPE/);
  });

  it("swallows broken-pipe errors instead of crashing", () => {
    const stream = new EventEmitter();
    guardStreamAgainstBrokenPipe(stream);

    expect(() => stream.emit("error", errorWithCode("EPIPE"))).not.toThrow();
    expect(() => stream.emit("error", errorWithCode("ERR_STREAM_DESTROYED"))).not.toThrow();
  });

  it("rethrows other stream errors to preserve crash-and-report behavior", () => {
    const stream = new EventEmitter();
    guardStreamAgainstBrokenPipe(stream);

    expect(() => stream.emit("error", errorWithCode("ENOENT"))).toThrow(/ENOENT/);
  });

  it("attaches the listener only once per stream", () => {
    const stream = new EventEmitter();
    guardStreamAgainstBrokenPipe(stream);
    guardStreamAgainstBrokenPipe(stream);

    expect(stream.listenerCount("error")).toBe(1);
  });

  it("is a no-op for a missing stream", () => {
    expect(() => guardStreamAgainstBrokenPipe(undefined)).not.toThrow();
  });
});

describe("installStdioErrorGuards", () => {
  it("guards both stdout and stderr", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "on");
    const stderrSpy = vi.spyOn(process.stderr, "on");
    try {
      installStdioErrorGuards();
      expect(stdoutSpy).toHaveBeenCalledWith("error", expect.any(Function));
      expect(stderrSpy).toHaveBeenCalledWith("error", expect.any(Function));
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });
});
