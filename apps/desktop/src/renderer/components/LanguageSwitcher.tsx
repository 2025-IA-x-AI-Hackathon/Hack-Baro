/* eslint-disable import/prefer-default-export */
import { type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_LANGUAGE,
  FALLBACK_LANGUAGE,
  SUPPORTED_LANGUAGES,
  i18nInstance,
  setLanguage,
} from "../../shared/i18n";

type LanguageOption = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGE_LABEL_KEYS = {
  "en-US": "languageSwitcher.english",
  "ko-KR": "languageSwitcher.korean",
} as const satisfies Record<
  LanguageOption,
  "languageSwitcher.english" | "languageSwitcher.korean"
>;

const getActiveLanguage = (): LanguageOption => {
  const resolved = i18nInstance.resolvedLanguage ?? i18nInstance.language;
  const resolvedLower = resolved?.toLowerCase() ?? "";
  const exactMatch = SUPPORTED_LANGUAGES.find(
    (language) => language.toLowerCase() === resolvedLower,
  );

  if (exactMatch) {
    return exactMatch;
  }

  const prefixMatch = SUPPORTED_LANGUAGES.find(
    (language) =>
      resolvedLower && language.toLowerCase().startsWith(resolvedLower),
  );

  return prefixMatch ?? FALLBACK_LANGUAGE ?? DEFAULT_LANGUAGE;
};

export function LanguageSwitcher() {
  const { t } = useTranslation("common");

  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const nextLanguage = event.target.value as LanguageOption;

    if (!SUPPORTED_LANGUAGES.includes(nextLanguage)) {
      return;
    }

    setLanguage(nextLanguage).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error("Failed to change language:", error);
    });
  };

  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur transition hover:bg-white/15">
      <span className="text-xs uppercase tracking-wide text-white/80">
        {t("languageSwitcher.label")}
      </span>
      <select
        className="min-w-[150px] rounded-lg bg-white/20 px-3 py-2 text-base font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        onChange={handleChange}
        value={getActiveLanguage()}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {t(LANGUAGE_LABEL_KEYS[language])}
          </option>
        ))}
      </select>
    </label>
  );
}
