import { observable, runInAction } from "mobx";
import { request } from "../api/request";
import { messages, type Language, type Message } from "./messages";

export const locale = observable({
  language: "en" as Language,
  saving: false,
  failed: false,
  async choose(language: Language) {
    if (this.saving) return;
    runInAction(() => {
      this.saving = true;
      this.failed = false;
    });
    try {
      await request(`language/${language}`, "POST");
      applyLanguage(language);
    } catch {
      runInAction(() => {
        this.failed = true;
      });
    } finally {
      runInAction(() => {
        this.saving = false;
      });
    }
  },
});

export function t(key: Message) {
  return messages[locale.language][key];
}

function applyLanguage(language: Language) {
  runInAction(() => {
    locale.language = language;
  });
  document.documentElement.lang = language;
  document.title = t("brand");
}

export async function initializeLanguage() {
  const language = await request<Language>("language").catch(() => "en");
  applyLanguage(language === "ru" ? "ru" : "en");
}
