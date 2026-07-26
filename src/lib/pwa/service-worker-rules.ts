import {
  PWA_ICON_PATHS,
  PWA_OFFLINE_URL,
  PWA_PRECACHE_PATHS,
} from "@/lib/pwa/config";

const SAFE_STATIC_PATHS = new Set<string>([
  ...PWA_PRECACHE_PATHS,
  "/sw.js",
  PWA_ICON_PATHS.favicon,
]);

export const shouldBypassServiceWorkerRequest = (input: {
  method: string;
  url: URL;
  currentOrigin: string;
}) => {
  if (input.method !== "GET") {
    return true;
  }

  const { url, currentOrigin } = input;

  if (url.origin !== currentOrigin) {
    return true;
  }

  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/rest/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/storage/") ||
    url.pathname.startsWith("/_next/data/")
  ) {
    return true;
  }

  return false;
};

export const shouldHandleAsStaticShellAsset = (pathname: string) => {
  return pathname.startsWith("/_next/static/") || SAFE_STATIC_PATHS.has(pathname);
};

export const shouldServeOfflineFallback = (requestMode: string) => {
  return requestMode === "navigate";
};

export const getOfflineFallbackPath = () => PWA_OFFLINE_URL;
