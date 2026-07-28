#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const nextDir = path.join(repoRoot, ".next");
const openNextDir = path.join(repoRoot, ".open-next");
const nodeModulesCacheDir = path.join(repoRoot, "node_modules", ".cache");

const removePath = (targetPath, label, required = true) => {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const level = required ? "error" : "warn";
    console[level](`[clean] Failed to remove ${label}: ${message}`);
    if (required) {
      throw error;
    }
    return false;
  }
};

removePath(nextDir, ".next", true);
removePath(openNextDir, ".open-next", false);
removePath(nodeModulesCacheDir, "node_modules/.cache", false);
