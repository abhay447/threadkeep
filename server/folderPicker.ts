import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { isWsl, toLocalFilesystemPath } from "./paths.js";

export class FolderPickCancelled extends Error {
  constructor() {
    super("Folder selection cancelled");
    this.name = "FolderPickCancelled";
  }
}

let activePicker: ChildProcess | null = null;

export function cancelFolderPick(): void {
  const child = activePicker;
  if (!child) return;
  activePicker = null;
  try {
    child.kill();
  } catch {
    // ignore
  }
}

let customPicker: (() => Promise<string>) | null = null;

export function setFolderPicker(fn: (() => Promise<string>) | null): void {
  customPicker = fn;
}

export async function pickFolder(): Promise<string> {
  if (customPicker) {
    const selected = await customPicker();
    return toLocalFilesystemPath(selected);
  }
  process.stdout.write(
    "Opening folder picker. If you do not see it, look behind other windows or paste the folder path in the app.\n",
  );
  if (process.platform === "win32" || isWsl()) {
    const selected = await pickWindowsFolder();
    return toLocalFilesystemPath(selected);
  }
  if (process.platform === "darwin") {
    return pickMacFolder();
  }
  return pickLinuxFolder();
}

function powershellExecutable(): string {
  if (isWsl()) return "powershell.exe";
  const root = process.env.SystemRoot || "C:\\Windows";
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    cancelFolderPick();
    const child = spawn(command, args, {
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activePicker = child;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (activePicker === child) activePicker = null;
      reject(error);
    });
    child.on("close", (code) => {
      if (activePicker === child) activePicker = null;
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

function encodedPowerShell(script: string): string {
  return Buffer.from(script.replace(/^\uFEFF/, ""), "utf16le").toString("base64");
}

async function pickWindowsFolder(): Promise<string> {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WaFolderFocus {
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@

[void][WaFolderFocus]::AllowSetForegroundWindow(-1)

$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'WhatsApp Archive'
$owner.TopMost = $true
$owner.ShowInTaskbar = $true
$owner.StartPosition = 'CenterScreen'
$owner.FormBorderStyle = 'FixedToolWindow'
$owner.MinimizeBox = $false
$owner.MaximizeBox = $false
$owner.Width = 420
$owner.Height = 90
$owner.TopLevel = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Choose your WhatsApp export folder in the window that opens.'
$label.Dock = 'Fill'
$label.TextAlign = 'MiddleCenter'
$owner.Controls.Add($label)
$owner.Show()
$owner.Activate()
[void][WaFolderFocus]::ShowWindow($owner.Handle, 5)
[void][WaFolderFocus]::BringWindowToTop($owner.Handle)
[void][WaFolderFocus]::SetForegroundWindow($owner.Handle)

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select the folder that contains your exported WhatsApp chat ZIP files'
$dialog.ShowNewFolderButton = $false
try { $dialog.UseDescriptionForTitle = $true } catch {}
try { $dialog.SelectedPath = [Environment]::GetFolderPath('MyDocuments') } catch {}

$result = $dialog.ShowDialog($owner)
$selected = $dialog.SelectedPath
$owner.Close()
$owner.Dispose()
$dialog.Dispose()

if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $selected) {
  [Console]::Out.WriteLine($selected)
  exit 0
}
exit 1
`;
  const result = await run(powershellExecutable(), [
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodedPowerShell(script),
  ]);
  const selected =
    result.stdout
      .replace(/^\uFEFF/, "")
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("Windows PowerShell") && !line.includes("Copyright (C)"))
      .pop() || "";
  if (selected) return selected;
  if (result.stderr.trim() && result.code !== 0 && result.code !== 1) {
    throw new Error(result.stderr.trim().split(/\r?\n/)[0]);
  }
  throw new FolderPickCancelled();
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
      "Could not open a folder picker. Paste the folder path in the app, or install zenity.",
    );
  }
}
