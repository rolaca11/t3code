/**
 * Broken-pipe guards for the Electron main process stdio streams.
 *
 * In packaged builds — most reliably the Linux AppImage launched without an
 * attached terminal — `process.stdout` / `process.stderr` are connected to a
 * pipe whose read end can close while the app keeps running. The next write to
 * that pipe fails with `EPIPE`, which Node surfaces as an `error` event on the
 * stream. With no `error` listener attached, Node promotes it to an uncaught
 * exception and Electron shows the fatal "A JavaScript error occurred in the
 * main process" dialog, killing the app.
 *
 * Two console sinks write to these streams and both hit this, which is why the
 * crash recurs on a timer rather than at a single moment:
 *   - our Effect `Logger.consolePretty()` logger (`console.log`), and
 *   - electron-updater's built-in logger (`console.info`) during the update
 *     poll (see `DesktopUpdates` `AUTO_UPDATE_POLL_INTERVAL`).
 *
 * Attaching an `error` listener that swallows broken-pipe codes stops the
 * uncaught exception at its source for every console sink at once. Durable
 * logging is unaffected: traces and backend child output are persisted to
 * rotating log files independently of the console.
 */

/** Write-side error codes that mean "the consumer of this stream went away". */
const BROKEN_PIPE_ERROR_CODES: ReadonlySet<string> = new Set(["EPIPE", "ERR_STREAM_DESTROYED"]);

export const isBrokenPipeError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === "string" && BROKEN_PIPE_ERROR_CODES.has(code);
};

const guardedStreams = new WeakSet<NodeJS.EventEmitter>();

/**
 * Attach an idempotent `error` listener that swallows broken-pipe errors. Any
 * other stream error is rethrown so genuinely unexpected failures keep their
 * existing crash-and-report behavior.
 */
export const guardStreamAgainstBrokenPipe = (stream: NodeJS.EventEmitter | undefined): void => {
  if (!stream || guardedStreams.has(stream)) {
    return;
  }
  guardedStreams.add(stream);
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (isBrokenPipeError(error)) {
      return;
    }
    throw error;
  });
};

/**
 * Install broken-pipe guards on the main process stdio streams. Must run before
 * anything writes to the console, so call it first in the main entry point.
 */
export const installStdioErrorGuards = (): void => {
  guardStreamAgainstBrokenPipe(process.stdout);
  guardStreamAgainstBrokenPipe(process.stderr);
};
