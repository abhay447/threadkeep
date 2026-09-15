import fs from "node:fs";
import path from "node:path";
import { frontendDir, isPackaged, projectRoot } from "./paths.js";

export async function ensureFrontend(): Promise<void> {
  if (isPackaged() || process.env.WA_SKIP_BUILD === "1") return;
  const dist = path.join(frontendDir(), "index.html");
  if (fs.existsSync(dist)) return;
  process.stdout.write("Preparing the app for first use. This only happens once…\n");
  const { build } = await import("vite");
  await build({
    root: projectRoot(),
    logLevel: "error",
  });
}
