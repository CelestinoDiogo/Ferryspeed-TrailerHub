export const PWA_APP_NAME = "Ferryspeed TrailerHub";
export const PWA_SHORT_NAME = "TrailerHub";
export const PWA_DESCRIPTION = "Ferryspeed trailer and vessel operations management";
export const PWA_START_URL = "/dashboard/mobile";
export const PWA_SCOPE = "/";
export const PWA_THEME_COLOR = "#0b1220";
export const PWA_BACKGROUND_COLOR = "#041512";
export const PWA_APPLE_STATUS_BAR_STYLE = "black-translucent" as const;
export const PWA_ICON_SOURCE = "/branding/ferryspeed logo.png";

export const PWA_ICON_PATHS = {
  icon192: "/pwa/icon-192.png",
  icon512: "/pwa/icon-512.png",
  maskable192: "/pwa/icon-maskable-192.png",
  maskable512: "/pwa/icon-maskable-512.png",
  appleTouch: "/pwa/apple-touch-icon.png",
  favicon: "/pwa/favicon-32x32.png",
} as const;

export const PWA_CACHE_VERSION = "trailerhub-pwa-v1";
export const PWA_SHELL_CACHE = `${PWA_CACHE_VERSION}-shell`;
export const PWA_RUNTIME_CACHE = `${PWA_CACHE_VERSION}-runtime`;
export const PWA_OFFLINE_URL = "/offline";

export const PWA_PRECACHE_PATHS = [
  PWA_OFFLINE_URL,
  "/manifest.webmanifest",
  PWA_ICON_PATHS.icon192,
  PWA_ICON_PATHS.icon512,
  PWA_ICON_PATHS.maskable192,
  PWA_ICON_PATHS.maskable512,
  PWA_ICON_PATHS.appleTouch,
  PWA_ICON_PATHS.favicon,
  "/branding/ferryspeed logo.png",
] as const;

export const PWA_INSTALL_DISMISS_KEY = "trailerhub.pwa.install-dismissed-until.v1";
export const PWA_INSTALL_DISMISS_MS = 1000 * 60 * 60 * 24 * 7;
