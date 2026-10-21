import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Small dictionary for the panel chrome. Page content falls back to English.
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
}

const I18n = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (k) => DICT.en[k] });

function initialLang(): UiLang {
  try {
    const v = localStorage.getItem('admin-lang');
    if (v === 'ar' || v === 'en') return v;
  } catch { /* ignore */ }
  return 'en';
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
  return <I18n.Provider value={{ lang, setLang, t: (k) => DICT[lang][k] ?? DICT.en[k] }}>{children}</I18n.Provider>;
}

export function useT() {
  return useContext(I18n);
}
