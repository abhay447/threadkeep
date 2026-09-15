import { spawnSync } from "node:child_process";
import { startServer } from "./index.js";

function keepWindowOpenOnWindows() {
  if (process.platform !== "win32") return;
  try {
    spawnSync("cmd.exe", ["/c", "pause"], { stdio: "inherit" });
  } catch {
    // ignore
  }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.stderr.write("The app could not start.\n");
  keepWindowOpenOnWindows();
  process.exit(1);
}

process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

startServer().catch(fail);
