import { resolveRoleAwareEntryPath } from "@/lib/auth/app-entry-path";

export type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export const isStandaloneDisplay = (input: { matchMediaStandalone: boolean; navigatorStandalone?: boolean }) => {
  return input.matchMediaStandalone || input.navigatorStandalone === true;
};

export const isIosInstallEligible = (input: {
  userAgent: string;
  matchMediaStandalone: boolean;
  navigatorStandalone?: boolean;
}) => {
  if (isStandaloneDisplay(input)) {
    return false;
  }

  const userAgent = input.userAgent;
  const isAppleMobile = /iPhone|iPad|iPod/i.test(userAgent);
  const isSafari = /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS/i.test(userAgent);

  return isAppleMobile && isSafari;
};

export const readInstallDismissedUntil = (rawValue: string | null) => {
  if (!rawValue) {
    return null;
  }

  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : null;
};

export const createInstallDismissedUntil = (nowMs: number, dismissMs: number) => nowMs + dismissMs;

export const isInstallDismissed = (dismissedUntil: number | null, nowMs: number) => {
  return dismissedUntil !== null && dismissedUntil > nowMs;
};

export const resolvePostLoginPath = (input: {
  returnTo: string | null;
  standalone: boolean;
  roleKey?: string | null;
  isActive?: boolean | null;
}) => {
  return resolveRoleAwareEntryPath({
    roleKey: input.roleKey,
    isActive: input.isActive,
    returnTo: input.returnTo,
    standalone: input.standalone,
  });
};
