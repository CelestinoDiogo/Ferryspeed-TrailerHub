"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  createInstallDismissedUntil,
  isInstallDismissed,
  isIosInstallEligible,
  isStandaloneDisplay,
  readInstallDismissedUntil,
  type BeforeInstallPromptEventLike,
} from "@/lib/pwa/install-state";
import { PWA_INSTALL_DISMISS_KEY, PWA_INSTALL_DISMISS_MS } from "@/lib/pwa/config";

type PwaContextValue = {
  isInstalled: boolean;
  isInstallSupported: boolean;
  showInstallAction: boolean;
  showIosInstallGuide: boolean;
  installDismissed: boolean;
  updateAvailable: boolean;
  canApplyUpdate: boolean;
  dismissInstall: () => void;
  promptInstall: () => Promise<void>;
  applyUpdate: () => void;
  setOperationallyBusy: (value: boolean) => void;
};

const PwaContext = createContext<PwaContextValue | null>(null);

const getStandaloneMatch = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(display-mode: standalone)").matches;
};

export function PwaProvider({ children }: { children: ReactNode }) {
  const [beforeInstallPromptEvent, setBeforeInstallPromptEvent] = useState<BeforeInstallPromptEventLike | null>(null);
  const [isInstalled, setIsInstalled] = useState(() =>
    typeof window === "undefined"
      ? false
      : isStandaloneDisplay({
          matchMediaStandalone: getStandaloneMatch(),
          navigatorStandalone: (window.navigator as Navigator & { standalone?: boolean }).standalone,
        }),
  );
  const [installDismissedUntil, setInstallDismissedUntil] = useState<number | null>(() =>
    typeof window === "undefined" ? null : readInstallDismissedUntil(window.localStorage.getItem(PWA_INSTALL_DISMISS_KEY)),
  );
  const [nowMs, setNowMs] = useState(() => (typeof window === "undefined" ? 0 : Date.now()));
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isOperationallyBusy, setIsOperationallyBusy] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const updateInstalledState = () => {
      setIsInstalled(
        isStandaloneDisplay({
          matchMediaStandalone: mediaQuery.matches,
          navigatorStandalone: (window.navigator as Navigator & { standalone?: boolean }).standalone,
        }),
      );
    };

    updateInstalledState();
    mediaQuery.addEventListener("change", updateInstalledState);

    return () => mediaQuery.removeEventListener("change", updateInstalledState);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let active = true;
    const attachWaitingWorker = (worker: ServiceWorker | null) => {
      waitingWorkerRef.current = worker;
      if (worker && active) {
        setUpdateAvailable(true);
      }
    };

    const register = async () => {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });

      attachWaitingWorker(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) {
          return;
        }

        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            attachWaitingWorker(registration.waiting ?? installing);
          }
        });
      });
    };

    void register();

    const handleControllerChange = () => {
      if (busyRef.current) {
        return;
      }

      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || installDismissedUntil === null) {
      return;
    }

    const delayMs = Math.max(0, installDismissedUntil - Date.now());
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, delayMs + 20);

    return () => {
      window.clearTimeout(timer);
    };
  }, [installDismissedUntil]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setBeforeInstallPromptEvent(event as BeforeInstallPromptEventLike);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setBeforeInstallPromptEvent(null);
      setUpdateAvailable(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const showIosInstallGuide = (() => {
    if (typeof window === "undefined" || isInstalled) {
      return false;
    }

    return isIosInstallEligible({
      userAgent: window.navigator.userAgent,
      matchMediaStandalone: getStandaloneMatch(),
      navigatorStandalone: (window.navigator as Navigator & { standalone?: boolean }).standalone,
    });
  })();

  const installDismissed = isInstallDismissed(installDismissedUntil, nowMs);
  const showInstallAction = !isInstalled && !installDismissed && (Boolean(beforeInstallPromptEvent) || showIosInstallGuide);

  const dismissInstall = () => {
    const now = Date.now();
    const dismissedUntil = createInstallDismissedUntil(now, PWA_INSTALL_DISMISS_MS);
    setNowMs(now);
    setInstallDismissedUntil(dismissedUntil);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PWA_INSTALL_DISMISS_KEY, String(dismissedUntil));
    }
  };

  const promptInstall = async () => {
    if (!beforeInstallPromptEvent) {
      return;
    }

    await beforeInstallPromptEvent.prompt();
    const choice = await beforeInstallPromptEvent.userChoice;
    if (choice.outcome !== "accepted") {
      dismissInstall();
    }
    setBeforeInstallPromptEvent(null);
  };

  const applyUpdate = () => {
    if (!waitingWorkerRef.current || busyRef.current) {
      return;
    }

    waitingWorkerRef.current.postMessage({ type: "SKIP_WAITING" });
  };

  const value: PwaContextValue = {
    isInstalled,
    isInstallSupported: Boolean(beforeInstallPromptEvent),
    showInstallAction,
    showIosInstallGuide,
    installDismissed,
    updateAvailable,
    canApplyUpdate: !isOperationallyBusy,
    dismissInstall,
    promptInstall,
    applyUpdate,
    setOperationallyBusy: (value) => {
      busyRef.current = value;
      setIsOperationallyBusy(value);
    },
  };

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export const usePwa = () => {
  const context = useContext(PwaContext);
  if (!context) {
    throw new Error("usePwa must be used within PwaProvider.");
  }

  return context;
};
