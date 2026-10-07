import { createContext } from 'react';
import { getMessage, Locale, MessageKey } from './i18n';

export interface LocaleContextValue {
  locale: Locale;
  toggleLocale: () => void;
  t: (key: MessageKey) => string;
}

export const LocaleContext = createContext<LocaleContextValue>({
  locale: 'zh',
  toggleLocale: () => {},
  t: (key) => getMessage('zh', key),
});
