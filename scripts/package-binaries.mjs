import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
const releaseDir = path.join(root, "release");

function run(command) {
  execSync(command, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    },
  });
}

mkdirSync(buildDir, { recursive: true });
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

process.stdout.write("Building the web app…\n");
run("npx vite build");

process.stdout.write("Bundling the desktop app…\n");
run(
  [
    "npx esbuild electron/main.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--outfile=build/electron-main.cjs",
    "--packages=bundle",
    "--external:electron",
    "--external:vite",
    "--external:esbuild",
    `--banner:js=${JSON.stringify("const import_meta_url = require('url').pathToFileURL(__filename).href;")}`,
    "--define:import.meta.url=import_meta_url",
  ].join(" "),
);

const builderArgs = process.argv.slice(2);
const electronBuilder = [
  "npx electron-builder",
  ...(builderArgs.length ? builderArgs : ["--linux", "AppImage", "tar.gz", "--win", "zip"]),
];
if (!electronBuilder.includes("--x64") && !electronBuilder.includes("--arm64")) {
  electronBuilder.push("--x64");
}
if (!electronBuilder.includes("--publish")) {
  electronBuilder.push("--publish", "never");
}

process.stdout.write("Packaging desktop apps…\n");
run(electronBuilder.join(" "));

const readme = `WhatsApp Archive Viewer

Read WhatsApp chats you exported from Android. Nothing is uploaded.

If Move to iOS does not migrate chats correctly, export important chats on Android
(chat -> More -> Export chat), copy the ZIP files to this computer, and open them here.
This app is a local failsafe reader. It does not restore chats onto an iPhone.

Which file to use
  Windows 64-bit:     whatsapp-archive-viewer-win-x64.zip
  Linux 64-bit:       .AppImage or whatsapp-archive-viewer-linux-x64.tar.gz
  Mac Apple Silicon:  whatsapp-archive-viewer-mac-arm64.zip
  Not for Intel Macs, 32-bit PCs, or phones.

Windows:
  Unzip the zip into a folder, then double-click "WhatsApp Archive Viewer.exe"
  Keep the unzipped files together; the .exe will not work if you move it out alone.

Linux:
  chmod +x the AppImage, then run it
  or extract the tar.gz and run WhatsApp Archive Viewer

macOS (Apple Silicon: M1, M2, M3, M4):
  Unzip whatsapp-archive-viewer-mac-arm64.zip
  Open "WhatsApp Archive Viewer.app"
  If macOS blocks it, Control-click the app, choose Open, then Open again
  The app is unsigned, so that warning is expected the first time.

A window opens. Click "Select WhatsApp Archive Folder" and choose the folder of
exported WhatsApp ZIP files (not a single ZIP).

Your chats stay on this computer.
`;
writeFileSync(path.join(releaseDir, "README.txt"), readme);

if (!existsSync(releaseDir)) {
  process.exit(1);
}

process.stdout.write("\nDone. Desktop apps are in the release/ folder.\n");
