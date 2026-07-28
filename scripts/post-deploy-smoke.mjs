#!/usr/bin/env node

const baseUrl = process.env.SMOKE_BASE_URL ?? process.argv[2];

if (!baseUrl) {
  console.warn("[smoke] SMOKE_BASE_URL is not set. Skipping post-deploy smoke test.");
  process.exit(0);
}

let normalizedBase;
try {
  normalizedBase = new URL(baseUrl);
} catch {
  console.error("[smoke] Invalid URL:", baseUrl);
  process.exit(1);
}

const targets = ["/", "/login", "/dashboard"];

const isFailureStatus = (status) => status >= 500;

const run = async () => {
  console.log(`[smoke] Starting post-deploy smoke test for ${normalizedBase.origin}`);

  let failed = false;

  for (const path of targets) {
    const url = new URL(path, normalizedBase).toString();

    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
      });

      const status = response.status;
      const result = isFailureStatus(status) ? "FAIL" : "PASS";
      console.log(`[smoke] ${result} ${path} -> HTTP ${status}`);

      if (isFailureStatus(status)) {
        failed = true;
      }
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : "Request failed";
      console.log(`[smoke] FAIL ${path} -> ${message}`);
    }
  }

  if (failed) {
    console.error("[smoke] Smoke test failed. At least one endpoint returned HTTP 5xx or was unreachable.");
    process.exit(1);
  }

  console.log("[smoke] Smoke test passed. No HTTP 5xx responses detected on required endpoints.");
};

void run();
