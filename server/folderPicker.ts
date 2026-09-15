import { spawn } from "node:child_process";
import { isWsl, toLocalFilesystemPath } from "./paths.js";

export class FolderPickCancelled extends Error {
  constructor() {
    super("Folder selection cancelled");
    this.name = "FolderPickCancelled";
  }
}

export async function pickFolder(): Promise<string> {
  if (process.platform === "win32" || isWsl()) {
    const selected = await pickWindowsFolder();
    return toLocalFilesystemPath(selected);
  }
  if (process.platform === "darwin") {
    return pickMacFolder();
  }
  return pickLinuxFolder();
}

function run(command: string, args: string[], options?: { input?: string }): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    if (options?.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function pickWindowsFolder(): Promise<string> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select the folder that contains your exported WhatsApp chat ZIP files'
$dialog.ShowNewFolderButton = $false
$dialog.RootFolder = [Environment+SpecialFolder]::Desktop
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
`;
  const command = isWsl() ? "powershell.exe" : "powershell";
  const result = await run(command, [
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
  const selected = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
  if (!selected) throw new FolderPickCancelled();
  return selected;
}

async function pickMacFolder(): Promise<string> {
  const result = await run("osascript", [
    "-e",
    'POSIX path of (choose folder with prompt "Select the folder that contains your exported WhatsApp chat ZIP files")',
  ]);
  if (result.code !== 0) throw new FolderPickCancelled();
  const selected = result.stdout.trim();
  if (!selected) throw new FolderPickCancelled();
  return selected.replace(/\/$/, "");
}

async function pickLinuxFolder(): Promise<string> {
  try {
    const zenity = await run("zenity", [
      "--file-selection",
      "--directory",
      "--title=Select WhatsApp Archive Folder",
    ]);
    if (zenity.code === 0 && zenity.stdout.trim()) return zenity.stdout.trim();
    if (zenity.code === 1) throw new FolderPickCancelled();
  } catch (error) {
    if (error instanceof FolderPickCancelled) throw error;
  }
  try {
    const kdialog = await run("kdialog", ["--getexistingdirectory", ".", "Select WhatsApp Archive Folder"]);
    if (kdialog.code === 0 && kdialog.stdout.trim()) return kdialog.stdout.trim();
    throw new FolderPickCancelled();
  } catch (error) {
    if (error instanceof FolderPickCancelled) throw error;
    throw new Error(
      "Could not open a folder picker. Install zenity (or kdialog), or run this app on Windows/macOS.",
    );
  }
}
