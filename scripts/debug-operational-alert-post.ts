import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runOperationalAlertDetection } from "../src/lib/operational-alerts";
import type { Database } from "../src/lib/database.types";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^['\"]|['\"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".dev.vars"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRole) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env files.");
}

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET")).toUpperCase();

  const isOperationalAlertsRest = url.includes("/rest/v1/operational_alerts");
  const isPost = method === "POST";

  const response = await originalFetch(input, init);

  if (isOperationalAlertsRest && isPost) {
    const requestBody = typeof init?.body === "string" ? init.body : init?.body ? "<non-string body>" : "<empty>";
    const responseText = await response.clone().text();

    console.log("\\n[debug] POST operational_alerts request");
    console.log("url:", url);
    console.log("method:", method);
    console.log("request body:", requestBody);
    console.log("status:", response.status);
    console.log("response:", responseText);
  }

  return response;
};

const client = createClient<Database>(supabaseUrl, serviceRole, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

(async () => {
  const result = await runOperationalAlertDetection(client);
  console.log("\\n[debug] runOperationalAlertDetection result:", JSON.stringify(result, null, 2));
})();
