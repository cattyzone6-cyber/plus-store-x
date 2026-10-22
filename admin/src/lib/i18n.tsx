import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Panel chrome uses the keyed dictionary below (t('save')); page text uses tx(en, ar)
// so every page keeps its English and Arabic side by side.
const DICT = {
  en: {
    dashboard: 'Dashboard', providers: 'Providers', catalog: 'Catalog', categories: 'Categories', products: 'Products',
    orders: 'Orders', manual: 'Manual queue', deposits: 'Deposits', users: 'Users', tickets: 'Tickets',
    marketing: 'Marketing', promos: 'Promo codes', redeem: 'Redeem codes', giveaways: 'Giveaways', freebies: 'Freebies',
    broadcasts: 'Broadcast', emojis: 'Emojis', settings: 'Settings', admins: 'Admins', system: 'System', audit: 'Audit log',
    sales: 'Sales', customers: 'Customers', store: 'Store', signout: 'Sign out', save: 'Save', cancel: 'Cancel',
    create: 'Create', edit: 'Edit', delete: 'Delete', search: 'Search…', refresh: 'Refresh', saved: 'Saved',
    confirm_delete: 'Delete this item?', loading: 'Loading…', empty: 'Nothing here yet', actions: 'Actions',
    signin: 'Sign in', email: 'Email', password: 'Password', language: 'العربية',
  },
  ar: {
    dashboard: 'لوحة التحكم', providers: 'المزودون', catalog: 'الكتالوج', categories: 'الأقسام', products: 'المنتجات',
    orders: 'الطلبات', manual: 'طلبات يدوية', deposits: 'الإيداعات', users: 'المستخدمون', tickets: 'التذاكر',
    marketing: 'التسويق', promos: 'أكواد الخصم', redeem: 'أكواد الشحن', giveaways: 'السحوبات', freebies: 'المجانيات',
    broadcasts: 'الإذاعة', emojis: 'الإيموجي', settings: 'الإعدادات', admins: 'المشرفون', system: 'النظام', audit: 'سجل العمليات',
    sales: 'المبيعات', customers: 'العملاء', store: 'المتجر', signout: 'تسجيل الخروج', save: 'حفظ', cancel: 'إلغاء',
    create: 'إنشاء', edit: 'تعديل', delete: 'حذف', search: 'بحث…', refresh: 'تحديث', saved: 'تم الحفظ',
    confirm_delete: 'حذف هذا العنصر؟', loading: 'جارٍ التحميل…', empty: 'لا يوجد شيء بعد', actions: 'إجراءات',
    signin: 'تسجيل الدخول', email: 'البريد الإلكتروني', password: 'كلمة المرور', language: 'English',
  },
} as const;

export type UiLang = keyof typeof DICT;
export type UiKey = keyof (typeof DICT)['en'];

interface Ctx {
  lang: UiLang;
  setLang: (l: UiLang) => void;
  t: (k: UiKey) => string;
  /** inline bilingual text: tx('Save', 'حفظ') */
  tx: (en: string, ar: string) => string;
}

const I18n = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (k) => DICT.en[k], tx: (en) => en });

function initialLang(): UiLang {
  try {
    const v = localStorage.getItem('admin-lang');
    if (v === 'ar' || v === 'en') return v;
  } catch { /* ignore */ }
  // first visit: follow the browser (Arabic browsers get the Arabic panel)
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const setLang = (l: UiLang) => {
    setLangState(l);
    try { localStorage.setItem('admin-lang', l); } catch { /* ignore */ }
  };
  return (
    <I18n.Provider value={{ lang, setLang, t: (k) => DICT[lang][k] ?? DICT.en[k], tx: (en, ar) => (lang === 'ar' ? ar || en : en) }}>
      {children}
    </I18n.Provider>
  );
}

export function useT() {
  return useContext(I18n);
}

/** Shorthand for page text: const tx = useTx(); tx('Save', 'حفظ') */
export function useTx(): (en: string, ar: string) => string {
  return useContext(I18n).tx;
}
