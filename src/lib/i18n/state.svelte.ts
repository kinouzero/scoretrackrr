import { bindMessages } from './bindings';
import { defaultLocale, resolveLocale, supportedLocale, translate } from './catalog';
export { locales } from './catalog';
function deviceLanguage(): string {
  return typeof window === 'undefined' ? defaultLocale : navigator.language;
}
let preference = $state('system');
let systemLanguage = $state(deviceLanguage());
const locale = $derived(resolveLocale(preference, systemLanguage));
export function getLocale(): string {
  return locale;
}
export function getLanguagePreference(): string {
  return preference;
}
export function refreshSystemLanguage(): void {
  systemLanguage = deviceLanguage();
}
export function setLocale(input: unknown): void {
  preference = input === 'system' ? 'system' : supportedLocale(input);
}
export const messages = bindMessages((key, values) => translate(locale, key, values));
