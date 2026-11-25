import {spawn} from "node:child_process";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";

/** Only retry a Windows process creation failure with no PID. A started worker owns its attempt. */
export async function spawnFormalLauncher(executable: string, directory: string, signal: AbortSignal,
  report: (entry: {attempt: number; state: "STARTED" | "START_FAILED"; code?: string; process_started: boolean}) => void) {
  const waits = [0, 200, 600, 1600, 3200];
  for (const [index, wait] of waits.entries()) {
    if (wait) await delay(wait, undefined, {signal});
    signal.throwIfAborted();
    let child: ReturnType<typeof spawn> | undefined;
    try {
      child = spawn(executable, [], {cwd: directory, windowsHide: true, stdio: "ignore"});
      const exited = once(child, "close").catch(() => [-1]);
      await once(child, "spawn");
      report({attempt: index + 1, state: "STARTED", process_started: true});
      return {child, exited};
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      report({attempt: index + 1, state: "START_FAILED", code, process_started: !!child?.pid});
      if (code !== "EPERM" || child?.pid || index === waits.length - 1) throw error;
    }
  }
  throw new Error("Unreachable launcher state");
}
