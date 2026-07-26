import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import {
  PWA_APPLE_STATUS_BAR_STYLE,
  PWA_APP_NAME,
  PWA_DESCRIPTION,
  PWA_ICON_PATHS,
  PWA_SHORT_NAME,
  PWA_THEME_COLOR,
} from "@/lib/pwa/config";

export const metadata: Metadata = {
  title: PWA_APP_NAME,
  description: PWA_DESCRIPTION,
  applicationName: PWA_APP_NAME,
  manifest: "/manifest.webmanifest",
  themeColor: PWA_THEME_COLOR,
  appleWebApp: {
    capable: true,
    statusBarStyle: PWA_APPLE_STATUS_BAR_STYLE,
    title: PWA_SHORT_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: PWA_ICON_PATHS.icon192, sizes: "192x192", type: "image/png" },
      { url: PWA_ICON_PATHS.icon512, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: PWA_ICON_PATHS.appleTouch, sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: PWA_THEME_COLOR,
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col overflow-x-hidden">
        <PwaProvider>{children}</PwaProvider>
      </body>
    </html>
  );
}
