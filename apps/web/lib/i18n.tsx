'use client';

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * Localization (§66).
 *
 * Message catalogues keyed by dotted id, with `{placeholder}` interpolation.
 * A missing translation falls back to English rather than rendering the raw
 * key, so an untranslated string is still readable to a user. In development
 * the missing key is logged once so gaps surface during work rather than in
 * production.
 *
 * Number, currency and date formatting go through Intl with the active locale,
 * so a language change also changes digit grouping and date order.
 */

export const LOCALES = [
  { code: 'en', label: 'English', native: 'English', dir: 'ltr' },
  { code: 'am', label: 'Amharic', native: 'አማርኛ', dir: 'ltr' },
  { code: 'om', label: 'Afaan Oromo', native: 'Afaan Oromoo', dir: 'ltr' },
] as const;

export type LocaleCode = (typeof LOCALES)[number]['code'];

type Catalogue = Record<string, string>;

const en: Catalogue = {
  'app.name': 'PharmaCore',
  'app.tagline': 'Pharmacy Management',
  'app.subtitle': 'Enterprise Pharmacy Inventory & Management',

  'nav.group.overview': 'Overview',
  'nav.group.catalogue': 'Catalogue',
  'nav.group.inventory': 'Inventory',
  'nav.group.operations': 'Operations',
  'nav.group.compliance': 'Compliance',
  'nav.group.administration': 'Administration',

  'nav.dashboard': 'Dashboard',
  'nav.commandCenter': 'Command Center',
  'nav.products': 'Drug Master',
  'nav.suppliers': 'Suppliers',
  'nav.inventory': 'Stock Balances',
  'nav.scan': 'Scan Station',
  'nav.expiry': 'Expiry Management',
  'nav.batches': 'Batches & Quarantine',
  'nav.counts': 'Stock Counts',
  'nav.adjustments': 'Adjustments',
  'nav.transfers': 'Stock Transfers',
  'nav.pos': 'Point of Sale',
  'nav.dispensing': 'Prescriptions',
  'nav.procurement': 'Procurement',
  'nav.receiving': 'Goods Receiving',
  'nav.invoices': 'Supplier Invoices',
  'nav.returns': 'Returns',
  'nav.recalls': 'Recalls',
  'nav.coldChain': 'Cold Chain',
  'nav.quality': 'Quality Incidents',
  'nav.disposal': 'Waste & Disposal',
  'nav.approvals': 'My Approvals',
  'nav.reports': 'Reports',
  'nav.admin': 'Administration',
  'nav.backups': 'Backups',
  'nav.import': 'Data Import',
  'nav.patients': 'Patients',
  'nav.damage': 'Damaged Stock',
  'nav.controlled': 'Controlled Register',
  'nav.forecast': 'Forecasting',
  'nav.notifications': 'Notifications',
  'nav.pricing': 'Pricing',
  'nav.warehouse': 'Warehouse Operations',
  'nav.accounting': 'Accounting',
  'nav.automation': 'Automation Rules',
  'nav.reportBuilder': 'Report Builder',
  'nav.settings': 'System Configuration',
  'nav.jobs': 'System Health & Jobs',
  'nav.integrations': 'Integrations',

  'auth.signIn': 'Sign in',
  'auth.signingIn': 'Signing in...',
  'auth.signOut': 'Sign out',
  'auth.identifier': 'Email, username or phone',
  'auth.password': 'Password',
  'auth.mfaCode': 'Authentication code',
  'auth.demoAccounts': 'Demo accounts',
  'auth.demoHint': 'All use the password {password}. Each role sees a different subset of the system.',
  'auth.checkingSession': 'Checking your session...',
  'auth.organizationWide': 'Organization-wide',
  'auth.branchScope': '{count} branch scope',
  'auth.unreadAlerts': '{count} unread alerts',

  'common.search': 'Search',
  'common.clear': 'Clear',
  'common.loading': 'Loading',
  'common.refresh': 'Refresh',
  'common.previous': 'Previous',
  'common.next': 'Next',
  'common.page': 'Page {page}',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.print': 'Print',
  'common.export': 'Export',
  'common.noResults': 'Nothing matches these filters.',
  'common.language': 'Language',
};

/**
 * Amharic. Pharmaceutical and regulatory terms are widely used in English in
 * Ethiopian pharmacy practice, so those are deliberately left in English rather
 * than coined here — a wrong clinical term is worse than a familiar English one.
 */
const am: Catalogue = {
  'app.tagline': 'የፋርማሲ አስተዳደር',
  'app.subtitle': 'የፋርማሲ ክምችት እና አስተዳደር ሥርዓት',

  'nav.group.overview': 'አጠቃላይ እይታ',
  'nav.group.catalogue': 'ካታሎግ',
  'nav.group.inventory': 'ክምችት',
  'nav.group.operations': 'ሥራዎች',
  'nav.group.compliance': 'ተገዢነት',
  'nav.group.administration': 'አስተዳደር',

  'nav.dashboard': 'ዳሽቦርድ',
  'nav.commandCenter': 'የቁጥጥር ማዕከል',
  'nav.products': 'የመድኃኒት ዝርዝር',
  'nav.suppliers': 'አቅራቢዎች',
  'nav.inventory': 'የክምችት ሚዛን',
  'nav.scan': 'የስካን ጣቢያ',
  'nav.expiry': 'የአገልግሎት ማብቂያ አስተዳደር',
  'nav.batches': 'ባች እና ለይቶ ማቆያ',
  'nav.counts': 'የክምችት ቆጠራ',
  'nav.adjustments': 'ማስተካከያዎች',
  'nav.transfers': 'የክምችት ዝውውር',
  'nav.pos': 'የሽያጭ ነጥብ',
  'nav.dispensing': 'የሐኪም ትዕዛዞች',
  'nav.procurement': 'ግዥ',
  'nav.receiving': 'ዕቃ መረከቢያ',
  'nav.invoices': 'የአቅራቢ ደረሰኞች',
  'nav.returns': 'ተመላሽ ዕቃዎች',
  'nav.recalls': 'ሪኮል',
  'nav.coldChain': 'የቀዝቃዛ ሰንሰለት',
  'nav.quality': 'የጥራት ጉዳዮች',
  'nav.disposal': 'ቆሻሻ እና ማስወገድ',
  'nav.approvals': 'የእኔ ማጽደቆች',
  'nav.reports': 'ሪፖርቶች',
  'nav.admin': 'አስተዳደር',
  'nav.backups': 'ምትኬዎች',
  'nav.import': 'ውሂብ ማስመጣት',
  'nav.patients': 'ታካሚዎች',
  'nav.damage': 'የተበላሸ ክምችት',
  'nav.controlled': 'የቁጥጥር መዝገብ',
  'nav.forecast': 'ትንበያ',
  'nav.notifications': 'ማሳወቂያዎች',
  'nav.pricing': 'የዋጋ አወሳሰን',
  'nav.warehouse': 'የመጋዘን ሥራዎች',
  'nav.accounting': 'ሒሳብ አያያዝ',
  'nav.automation': 'የራስ-ሰር ደንቦች',
  'nav.reportBuilder': 'ሪፖርት ገንቢ',
  'nav.settings': 'የሥርዓት ውቅር',
  'nav.jobs': 'የሥርዓት ጤና እና ተግባራት',
  'nav.integrations': 'ውህደቶች',

  'auth.signIn': 'ግባ',
  'auth.signingIn': 'በመግባት ላይ...',
  'auth.signOut': 'ውጣ',
  'auth.identifier': 'ኢሜይል፣ የተጠቃሚ ስም ወይም ስልክ',
  'auth.password': 'የይለፍ ቃል',
  'auth.mfaCode': 'የማረጋገጫ ኮድ',
  'auth.demoAccounts': 'የሙከራ መለያዎች',
  'auth.checkingSession': 'ክፍለ ጊዜዎን በማረጋገጥ ላይ...',
  'auth.organizationWide': 'ድርጅት አቀፍ',

  'common.search': 'ፈልግ',
  'common.clear': 'አጽዳ',
  'common.loading': 'በመጫን ላይ',
  'common.refresh': 'አድስ',
  'common.previous': 'ቀዳሚ',
  'common.next': 'ቀጣይ',
  'common.save': 'አስቀምጥ',
  'common.cancel': 'ሰርዝ',
  'common.print': 'አትም',
  'common.export': 'ላክ',
  'common.noResults': 'ከእነዚህ ማጣሪያዎች ጋር የሚዛመድ ምንም የለም።',
  'common.language': 'ቋንቋ',
};

const om: Catalogue = {
  'app.tagline': 'Bulchiinsa Faarmaasii',
  'app.subtitle': 'Sirna Kuusaa fi Bulchiinsa Faarmaasii',

  'nav.group.overview': 'Ilaalcha Waliigalaa',
  'nav.group.catalogue': 'Kataloogii',
  'nav.group.inventory': 'Kuusaa',
  'nav.group.operations': 'Hojiiwwan',
  'nav.group.compliance': 'Ulaagaa Eeguu',
  'nav.group.administration': 'Bulchiinsa',

  'nav.dashboard': 'Daashboordii',
  'nav.commandCenter': 'Giddugala To’annoo',
  'nav.products': 'Galmee Qorichaa',
  'nav.suppliers': 'Dhiyeessitoota',
  'nav.inventory': 'Madaalli Kuusaa',
  'nav.scan': 'Buufata Iskaanii',
  'nav.expiry': 'Bulchiinsa Yeroo Dhumaa',
  'nav.batches': 'Baachii fi Adda Baasuu',
  'nav.counts': 'Lakkoofsa Kuusaa',
  'nav.adjustments': 'Sirreeffama',
  'nav.transfers': 'Dabarsa Kuusaa',
  'nav.pos': 'Bakka Gurgurtaa',
  'nav.dispensing': 'Ajaja Ogeessaa',
  'nav.procurement': 'Bittaa',
  'nav.receiving': 'Meeshaa Fudhachuu',
  'nav.invoices': 'Nagahee Dhiyeessitootaa',
  'nav.returns': 'Deebi’anii',
  'nav.recalls': 'Rikaalii',
  'nav.coldChain': 'Sakaandaa Qorraa',
  'nav.quality': 'Dhimmoota Qulqullinaa',
  'nav.disposal': 'Balfa fi Gatuu',
  'nav.approvals': 'Mirkaneessa Koo',
  'nav.reports': 'Gabaasota',
  'nav.admin': 'Bulchiinsa',
  'nav.backups': 'Kuusaa Deebii',
  'nav.import': 'Daataa Galchuu',
  'nav.patients': 'Dhukkubsattoota',
  'nav.damage': 'Kuusaa Miidhame',
  'nav.controlled': 'Galmee To’annoo',
  'nav.forecast': 'Tilmaama',
  'nav.notifications': 'Beeksisoota',
  'nav.pricing': 'Gatii Murteessuu',
  'nav.warehouse': 'Hojiiwwan Mankuusaa',
  'nav.accounting': 'Herregaa',
  'nav.automation': 'Seerota Ofumaan Hojjetan',
  'nav.reportBuilder': 'Ijaaraa Gabaasaa',
  'nav.settings': 'Qindaa’ina Sirnaa',
  'nav.jobs': 'Fayyaa Sirnaa fi Hojiiwwan',
  'nav.integrations': 'Walitti Makamuu',

  'auth.signIn': 'Seeni',
  'auth.signingIn': 'Seenaa jira...',
  'auth.signOut': 'Ba’i',
  'auth.identifier': 'Imeelii, maqaa fayyadamaa yookaan bilbila',
  'auth.password': 'Jecha darbii',
  'auth.mfaCode': 'Koodii mirkaneessaa',
  'auth.demoAccounts': 'Herrega agarsiisaa',
  'auth.checkingSession': 'Seensa kee mirkaneessaa jira...',
  'auth.organizationWide': 'Dhaabbata guutuu',

  'common.search': 'Barbaadi',
  'common.clear': 'Haqi',
  'common.loading': 'Fe’aa jira',
  'common.refresh': 'Haaromsi',
  'common.previous': 'Duraa',
  'common.next': 'Itti aanu',
  'common.save': 'Olkaa’i',
  'common.cancel': 'Dhiisi',
  'common.print': 'Maxxansi',
  'common.export': 'Baasi',
  'common.noResults': 'Wanti gaaffii kanaan walsimu hin jiru.',
  'common.language': 'Afaan',
};

const CATALOGUES: Record<LocaleCode, Catalogue> = { en, am, om };
const STORAGE_KEY = 'pharmacore.locale';
const reported = new Set<string>();

interface I18nValue {
  locale: LocaleCode;
  setLocale: (l: LocaleCode) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatMoney: (value: unknown, currency?: string) => string;
  formatDate: (value: unknown) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>('en');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as LocaleCode | null;
      if (stored && CATALOGUES[stored]) {
        setLocaleState(stored);
        return;
      }
      // Fall back to the browser's preference when it is one we ship.
      const preferred = navigator.languages
        ?.map((l) => l.split('-')[0])
        .find((l): l is LocaleCode => l in CATALOGUES);
      if (preferred) setLocaleState(preferred);
    } catch {
      // Private browsing can refuse storage; English is a fine default.
    }
  }, []);

  const setLocale = useCallback((next: LocaleCode) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is survivable.
    }
    document.documentElement.lang = next;
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const catalogue = CATALOGUES[locale];
      let text = catalogue[key] ?? en[key];

      if (text === undefined) {
        if (process.env.NODE_ENV !== 'production' && !reported.has(key)) {
          reported.add(key);
          console.warn(`[i18n] no message for "${key}"`);
        }
        // Last resort: the trailing segment reads better than the whole key.
        text = key.split('.').pop() ?? key;
      }

      return vars
        ? text.replace(/\{(\w+)\}/g, (m, name) => String(vars[name] ?? m))
        : text;
    },
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t,
      formatNumber: (v, options) => new Intl.NumberFormat(locale, options).format(v),
      formatMoney: (v, currency = 'ETB') =>
        `${currency} ${new Intl.NumberFormat(locale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(Number(v ?? 0))}`,
      formatDate: (v) => {
        if (!v) return '-';
        const d = new Date(v as string);
        return Number.isNaN(d.getTime())
          ? '-'
          : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
      },
    }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Rendering outside the provider should degrade, not crash the screen.
    return {
      locale: 'en',
      setLocale: () => undefined,
      t: (key) => en[key] ?? key.split('.').pop() ?? key,
      formatNumber: (v) => String(v),
      formatMoney: (v, c = 'ETB') => `${c} ${Number(v ?? 0).toFixed(2)}`,
      formatDate: (v) => (v ? String(v).slice(0, 10) : '-'),
    };
  }
  return ctx;
}

/** Coverage of each catalogue against English, for the admin screen. */
export function translationCoverage(): Array<{ locale: LocaleCode; translated: number; total: number; pct: number }> {
  const keys = Object.keys(en);
  return LOCALES.map(({ code }) => {
    const translated = keys.filter((k) => CATALOGUES[code][k] !== undefined).length;
    return {
      locale: code,
      translated,
      total: keys.length,
      pct: Math.round((translated / keys.length) * 100),
    };
  });
}

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={compact ? 'block' : 'block mt-2'}>
      <span className="sr-only">{t('common.language')}</span>
      <select
        className="input text-xs"
        value={locale}
        onChange={(e) => setLocale(e.target.value as LocaleCode)}
        aria-label={t('common.language')}
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native}
          </option>
        ))}
      </select>
    </label>
  );
}
