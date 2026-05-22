#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const nativeRoot = path.join(projectRoot, "electron", "native");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    timeout: options.timeout ?? 300000,
    cwd: options.cwd ?? projectRoot
  });
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(details || `${command} ${args.join(" ")} failed`);
  }
  return result;
}

async function buildMacHelpers() {
  if (process.platform !== "darwin") {
    console.log("[build-native-helpers] Skipping macOS Swift helper: host is not macOS.");
    return;
  }

  run("swiftc", ["--version"]);
  const targets = [
    { archTag: "darwin-arm64", swiftTarget: "arm64-apple-macos14.0" },
    { archTag: "darwin-x64", swiftTarget: "x86_64-apple-macos14.0" }
  ];

  for (const target of targets) {
    const outputDir = path.join(nativeRoot, "bin", target.archTag);
    mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "glide-native-helper");
    run("swiftc", [
      "-O",
      "-target",
      target.swiftTarget,
      path.join(nativeRoot, "macos", "GlideNativeHelper.swift"),
      "-framework",
      "AVFoundation",
      "-framework",
      "AppKit",
      "-framework",
      "ScreenCaptureKit",
      "-o",
      outputPath
    ]);
    await chmod(outputPath, 0o755);
    console.log(`[build-native-helpers] Built ${outputPath}`);
  }
}

function findCmake() {
  const candidates = ["cmake"];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) {
      return candidate;
    }
  }
  return null;
}

function buildWindowsHelper(helperDir, outputName) {
  if (process.platform !== "win32") {
    console.log(`[build-native-helpers] Skipping ${outputName}: host is not Windows.`);
    return;
  }

  const cmake = findCmake();
  if (!cmake) {
    throw new Error("CMake is required to build Windows native helpers.");
  }

  const sourceDir = path.join(nativeRoot, "windows", helperDir);
  const buildDir = path.join(sourceDir, "build");
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  run(cmake, ["..", "-G", "Visual Studio 17 2022", "-A", "x64"], { cwd: buildDir, stdio: "inherit" });
  run(cmake, ["--build", ".", "--config", "Release"], { cwd: buildDir, stdio: "inherit" });

  const builtExe = path.join(buildDir, "Release", outputName);
  if (!existsSync(builtExe)) {
    throw new Error(`Expected helper was not produced: ${builtExe}`);
  }

  const bundledDir = path.join(nativeRoot, "bin", "win32-x64");
  mkdirSync(bundledDir, { recursive: true });
  copyFileSync(builtExe, path.join(bundledDir, outputName));
  console.log(`[build-native-helpers] Built ${path.join(bundledDir, outputName)}`);
}

await buildMacHelpers();
buildWindowsHelper("keyboard-hook", "glide-keyboard-hook.exe");
buildWindowsHelper("screen-capture", "glide-screen-capture.exe");
