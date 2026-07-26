import type { MetadataRoute } from "next";
import {
  PWA_APP_NAME,
  PWA_BACKGROUND_COLOR,
  PWA_DESCRIPTION,
  PWA_ICON_PATHS,
  PWA_SCOPE,
  PWA_SHORT_NAME,
  PWA_START_URL,
  PWA_THEME_COLOR,
} from "@/lib/pwa/config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PWA_APP_NAME,
    short_name: PWA_SHORT_NAME,
    description: PWA_DESCRIPTION,
    start_url: PWA_START_URL,
    display: "standalone",
    orientation: "portrait-primary",
    scope: PWA_SCOPE,
    lang: "en",
    categories: ["business", "productivity", "utilities"],
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_THEME_COLOR,
    icons: [
      {
        src: PWA_ICON_PATHS.icon192,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: PWA_ICON_PATHS.icon512,
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: PWA_ICON_PATHS.maskable192,
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: PWA_ICON_PATHS.maskable512,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
