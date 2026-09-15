import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { FolderPickCancelled, setFolderPicker } from "../server/folderPicker.js";
import { startServer, listenUrl } from "../server/index.js";

process.env.WA_NO_OPEN = "1";
if (app.isPackaged) process.env.WA_PACKAGED = "1";

try {
  const wsl =
    Boolean(process.env.WSL_DISTRO_NAME) ||
    fs.readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  if (wsl) {
    app.commandLine.appendSwitch("no-sandbox");
    app.commandLine.appendSwitch("disable-dev-shm-usage");
    app.commandLine.appendSwitch("disable-gpu");
  }
} catch {
  // ignore
}

let window: BrowserWindow | null = null;

function frontendPath(): string {
  return path.join(app.getAppPath(), "dist");
}

setFolderPicker(async () => {
  const options = {
    title: "Select WhatsApp Archive Folder",
    buttonLabel: "Select Folder",
    properties: ["openDirectory" as const],
  };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) throw new FolderPickCancelled();
  return result.filePaths[0];
});

function createWindow(url: string): BrowserWindow {
  const next = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: "WhatsApp Archive",
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#0b141a",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  next.on("ready-to-show", () => next.show());
  next.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(target).catch(() => undefined);
    return { action: "deny" };
  });
  next.webContents.on("will-navigate", (event, target) => {
    const allowed = target.startsWith("http://127.0.0.1");
    if (!allowed) event.preventDefault();
  });
  next.loadURL(url).catch((error) => {
    dialog.showErrorBox("WhatsApp Archive Viewer", error instanceof Error ? error.message : String(error));
  });
  return next;
}

Menu.setApplicationMenu(null);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(async () => {
    process.env.WA_FRONTEND_DIR = frontendPath();
    try {
      const { url } = await startServer();
      window = createWindow(url);
    } catch (error) {
      const message =
        error instanceof Error && (error as NodeJS.ErrnoException).code === "EADDRINUSE"
          ? `Another copy is already using ${listenUrl()}. Close it and try again.`
          : error instanceof Error
            ? error.message
            : String(error);
      dialog.showErrorBox("WhatsApp Archive Viewer", message);
      app.quit();
    }
  });
}

app.on("window-all-closed", () => {
  app.quit();
});
