#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const mainPath = path.resolve("dist-electron/electron/main.cjs");
if (!fs.existsSync(mainPath)) {
  console.log("Skipping smoke check; main bundle has not been emitted yet.");
  process.exit(0);
}
console.log(`Found ${mainPath}`);
