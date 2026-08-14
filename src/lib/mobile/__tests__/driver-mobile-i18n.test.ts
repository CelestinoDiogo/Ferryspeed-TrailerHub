// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  getDriverMobileLanguageKey,
  readDriverMobileLanguage,
  translateDriverMobile,
  writeDriverMobileLanguage,
} from "@/lib/mobile/driver-mobile-i18n";

describe("driver mobile localization", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to English and falls back to English for missing keys", () => {
    expect(readDriverMobileLanguage("driver-a")).toBe("en");
    expect(translateDriverMobile("pt", "myJobs")).toBe("Os meus serviços");
    expect(translateDriverMobile("pt", "missing.key" as never)).toBe("");
  });

  it("persists language independently per Driver", () => {
    writeDriverMobileLanguage("driver-a", "pt");
    writeDriverMobileLanguage("driver-b", "ru");

    expect(window.localStorage.getItem(getDriverMobileLanguageKey("driver-a"))).toBe("pt");
    expect(readDriverMobileLanguage("driver-a")).toBe("pt");
    expect(readDriverMobileLanguage("driver-b")).toBe("ru");
    expect(readDriverMobileLanguage("driver-c")).toBe("en");
  });

  it("translates response labels without changing backend values", () => {
    expect(translateDriverMobile("lv", "completed")).toBe("Pabeigts");
    expect(translateDriverMobile("ru", "callMe")).toBe("ПОЗВОНИТЕ МНЕ");
    expect(translateDriverMobile("pt", "critical")).toBe("CRÍTICO");
  });
});
