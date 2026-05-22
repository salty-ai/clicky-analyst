import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { getMacScreenCaptureHelperPath } from "./nativePaths";

let notchIslandProcess: ChildProcessWithoutNullStreams | null = null;
let notchIslandReady = false;
const pendingCommands: unknown[] = [];

function flushPendingCommands(): void {
  if (!notchIslandProcess || !notchIslandReady) return;
  while (pendingCommands.length > 0) {
    const command = pendingCommands.shift();
    notchIslandProcess.stdin.write(`${JSON.stringify(command)}\n`);
  }
}

function writeCommand(command: unknown): void {
  if (!notchIslandProcess || notchIslandProcess.killed || notchIslandProcess.stdin.destroyed) {
    pendingCommands.push(command);
    return;
  }
  if (!notchIslandReady) {
    pendingCommands.push(command);
    return;
  }
  notchIslandProcess.stdin.write(`${JSON.stringify(command)}\n`);
}

export function startNativeNotchIsland(): void {
  if (process.platform !== "darwin") {
    return;
  }
  if (notchIslandProcess) {
    flushPendingCommands();
    return;
  }

  notchIslandReady = false;
  notchIslandProcess = spawn(getMacScreenCaptureHelperPath(), ["--notch-island"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  notchIslandProcess.stdout.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8").trim();
    if (message) {
      console.info("[native-notch]", message);
      if (message.split(/\r?\n/).includes("READY")) {
        notchIslandReady = true;
        flushPendingCommands();
      }
    }
  });

  notchIslandProcess.stderr.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8").trim();
    if (message) {
      console.warn("[native-notch]", message);
    }
  });

  notchIslandProcess.on("error", (error) => {
    console.error("[native-notch] process error:", error.message);
  });

  notchIslandProcess.on("exit", (code, signal) => {
    console.warn(`[native-notch] process exited: code=${code} signal=${signal}`);
    notchIslandProcess = null;
    notchIslandReady = false;
  });
}

export function mountNativeNotchIsland(): void {
  startNativeNotchIsland();
  writeCommand({ type: "mount" });
}

export function showNativeNotchIsland(): void {
  startNativeNotchIsland();
  writeCommand({ type: "show" });
}

export function hideNativeNotchIsland(): void {
  writeCommand({ type: "hide" });
}

export function setNativeNotchStatus(status: string): void {
  startNativeNotchIsland();
  writeCommand({ type: "status", text: status });
  writeCommand({ type: "show" });
}

export function setNativeNotchVoiceState(voiceState: "idle" | "listening" | "processing" | "responding"): void {
  startNativeNotchIsland();
  writeCommand({ type: "voiceState", voiceState });
  writeCommand({ type: "show" });
}

export function setNativeNotchIgnoreMouse(ignore: boolean): void {
  writeCommand({ type: "setIgnoreMouse", ignore });
}

export function stopNativeNotchIsland(): void {
  writeCommand({ type: "quit" });
  if (notchIslandProcess && !notchIslandProcess.killed) {
    notchIslandProcess.kill();
  }
  notchIslandProcess = null;
}
