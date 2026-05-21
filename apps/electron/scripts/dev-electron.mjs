#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererUrl = "http://127.0.0.1:5174/";
const require = createRequire(import.meta.url);
const electronBinary = require("electron");

function run(command, args, options = {}) {
  const env = { ...process.env, ...(options.env ?? {}) };
  if (options.electronApp) {
    delete env.ELECTRON_RUN_AS_NODE;
  }
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: options.stdio ?? "inherit",
    env,
    shell: process.platform === "win32"
  });
  return child;
}

function waitForRenderer() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      const request = http.get(rendererUrl, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (Date.now() - startedAt > 20000) {
          reject(new Error("Timed out waiting for Vite renderer."));
          return;
        }
        setTimeout(check, 250);
      });
    };
    check();
  });
}

const nativeBuild = run("pnpm", ["run", "build:native"]);
nativeBuild.on("exit", (nativeCode) => {
  if (nativeCode !== 0) {
    process.exit(nativeCode ?? 1);
  }

  const electronBuild = run("pnpm", ["exec", "vite", "build", "--config", "vite.electron.config.ts"]);
  electronBuild.on("exit", async (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }

  const vite = run("pnpm", ["exec", "vite", "--host", "127.0.0.1"], { stdio: "inherit" });
  try {
    await waitForRenderer();
  } catch (error) {
    console.error(error);
    vite.kill();
    process.exit(1);
  }

  const electron = run(electronBinary, ["."], {
    env: { VITE_DEV_SERVER_URL: rendererUrl },
    electronApp: true
  });

  const shutdown = () => {
    electron.kill();
    vite.kill();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  electron.on("exit", (exitCode) => {
    vite.kill();
    process.exit(exitCode ?? 0);
  });
  });
});
