import i18next, { type InitOptions } from "i18next";
import LanguageDetector, {
  type DetectorOptions,
} from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import commonEn from "../../../locales/en-US/common.json";
import errorsEn from "../../../locales/en-US/errors.json";
import settingsEn from "../../../locales/en-US/settings.json";
import commonKo from "../../../locales/ko-KR/common.json";
import errorsKo from "../../../locales/ko-KR/errors.json";
import settingsKo from "../../../locales/ko-KR/settings.json";

export const LANGUAGE_STORAGE_KEY = "baro.language";
export const DEFAULT_LANGUAGE = "ko-KR" as const;
export const FALLBACK_LANGUAGE = "en-US" as const;
export const SUPPORTED_LANGUAGES = [
  DEFAULT_LANGUAGE,
  FALLBACK_LANGUAGE,
] as const;

const resources = {
  "en-US": {
    common: commonEn,
    errors: errorsEn,
    settings: settingsEn,
  },
  "ko-KR": {
    common: commonKo,
    errors: errorsKo,
    settings: settingsKo,
  },
} as const;

type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const detectionOptions: DetectorOptions = {
  order: ["localStorage", "navigator"],
  caches: ["localStorage"],
  lookupLocalStorage: LANGUAGE_STORAGE_KEY,
};

const initOptions: InitOptions = {
  resources,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  fallbackLng: FALLBACK_LANGUAGE,
  lng: DEFAULT_LANGUAGE,
  ns: ["common", "settings", "errors"],
  defaultNS: "common",
  keySeparator: ".",
  interpolation: {
    escapeValue: false,
  },
  detection: detectionOptions,
  returnNull: false,
};

let initializationPromise: Promise<typeof i18next> | null = null;

export const isSupportedLanguage = (
  language: string,
): language is SupportedLanguage =>
  SUPPORTED_LANGUAGES.includes(language as SupportedLanguage);

export const resolveInitialLanguage = (): SupportedLanguage => {
  if (typeof window === "undefined") {
    return DEFAULT_LANGUAGE;
  }

  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && isSupportedLanguage(stored)) {
    return stored;
  }

  return DEFAULT_LANGUAGE;
};

export const initializeI18n = async () => {
  if (i18next.isInitialized) {
    return i18next;
  }

  if (!initializationPromise) {
    initializationPromise = i18next
      .use(LanguageDetector)
      .use(initReactI18next)
      .init({
        ...initOptions,
        lng: resolveInitialLanguage(),
      })
      .then(() => i18next);
  }

  return initializationPromise;
};

export const setLanguage = async (language: SupportedLanguage) => {
  if (!isSupportedLanguage(language)) {
    return;
  }

  await i18next.changeLanguage(language);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }
};

export const i18nInstance = i18next;
