import en from './locales/en.json';
import de from './locales/de.json';

/**
 * English is the reference: every other locale must have exactly the same keys. The
 * messages are grouped (by the panel's sections), sorted within each level.
 */
export type Messages = typeof en;
/** Every message's path through the groups, dot-separated (e.g. 'people.apply'), at any depth. */
type Paths<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}` }[keyof T & string];
export type MessageKey = Paths<Messages>;

export const locales = { en, de } satisfies Record<string, Messages>;
export type Lang = keyof typeof locales;

const STORAGE_KEY = 'train-picker:lang';

const isLang = (v: string | null | undefined): v is Lang => !!v && v in locales;

/** ?lang= beats a saved choice, which beats the browser's preferred languages. */
function detectLang(): Lang {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (isLang(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

let current: Lang = detectLang();

export const getLang = () => current;

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
}

/** Look up a message by its dotted path and fill in {placeholders}. */
export function t(key: MessageKey, vars: Record<string, string> = {}): string {
  let node: unknown = locales[current];
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part];
  return (node as string).replace(/\{(\w+)\}/g, (m, name: string) => vars[name] ?? m);
}

/**
 * Translate the static page: elements with data-i18n get their text replaced,
 * data-i18n-placeholder sets the placeholder attribute.
 */
export function translatePage(): void {
  document.documentElement.lang = current;
  document.title = t('app.title');
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder as MessageKey));
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel as MessageKey));
  }
  // The hint mixes text with a <kbd>, so build it by hand.
  const hint = document.getElementById('hint');
  if (hint) {
    const [before, after = ''] = t('pick.hint').split('{key}');
    const kbd = document.createElement('kbd');
    kbd.textContent = t('pick.spaceKey');
    hint.replaceChildren(before, kbd, after);
  }
}

/**
 * A language picker: fills the select with every locale (in its own language), shows
 * the current one, and on a change switches to it, re-translates the page and calls
 * onChange for whatever else needs redrawing.
 */
export function langPicker(select: HTMLSelectElement, onChange: () => void = () => {}): void {
  select.replaceChildren(); // (after a hot reload it may still hold the old options)
  for (const [code, messages] of Object.entries(locales)) select.add(new Option(messages.app.languageName, code));
  select.value = current;
  select.addEventListener('change', () => {
    setLang(select.value as Lang);
    translatePage();
    onChange();
  });
}
