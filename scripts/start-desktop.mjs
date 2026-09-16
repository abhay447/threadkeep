import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status) process.exit(result.status);
}

if (!existsSync(path.join(root, "dist", "index.html"))) {
  process.stdout.write("Preparing the app for first use. This only happens once…\n");
  run("npx", ["vite", "build"]);
}

mkdirSync(path.join(root, "build"), { recursive: true });
run("npx", [
  "esbuild",
  "electron/main.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--outfile=build/electron-main.cjs",
  "--packages=bundle",
  "--external:electron",
  "--external:vite",
  "--external:esbuild",
  "--banner:js=const import_meta_url = require('url').pathToFileURL(__filename).href;",
  "--define:import.meta.url=import_meta_url",
]);

const electron = spawnSync("npx", ["electron", "."], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, THREADKEEP_NO_OPEN: "1" },
});
process.exit(electron.status ?? 0);
