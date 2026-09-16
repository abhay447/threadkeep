import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDataDir, getDataDir, projectRoot } from "../server/paths.js";

const previousDataDir = process.env.THREADKEEP_DATA_DIR;

afterEach(() => {
  if (previousDataDir) process.env.THREADKEEP_DATA_DIR = previousDataDir;
  else delete process.env.THREADKEEP_DATA_DIR;
});

describe("data directory", () => {
  it("never stores index data next to the source code", () => {
    delete process.env.THREADKEEP_DATA_DIR;
    const dir = getDataDir();
    expect(dir).toBe(defaultDataDir());
    expect(path.resolve(dir).startsWith(path.resolve(projectRoot()) + path.sep)).toBe(false);
    expect(path.resolve(dir)).not.toBe(path.resolve(projectRoot()));
  });

  it("ignores THREADKEEP_DATA_DIR when it points inside the repo", () => {
    process.env.THREADKEEP_DATA_DIR = path.join(projectRoot(), ".localdata");
    expect(getDataDir()).toBe(defaultDataDir());
  });

  it("still allows an override outside the repo", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "tk-data-ok-"));
    process.env.THREADKEEP_DATA_DIR = outside;
    expect(getDataDir()).toBe(path.resolve(outside));
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
