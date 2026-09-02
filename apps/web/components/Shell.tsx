'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthUser, api, can, logout, tokenStore } from '@/lib/api';
import { LanguagePicker, useI18n } from '@/lib/i18n';
import { OfflineBar } from '@/components/OfflineBar';

interface NavItem {
  href: string;
  /** Message id, so navigation is translated like everything else (§66). */
  labelKey: string;
  permission?: string;
}

const NAV: Array<{ groupKey: string; items: NavItem[] }> = [
  {
    groupKey: 'nav.group.overview',
    items: [
      { href: '/dashboard', labelKey: 'nav.dashboard', permission: 'analytics.dashboard.READ' },
      { href: '/command-center', labelKey: 'nav.commandCenter', permission: 'analytics.dashboard.READ' },
    ],
  },
  {
    groupKey: 'nav.group.catalogue',
    items: [
      { href: '/products', labelKey: 'nav.products', permission: 'catalog.product.READ' },
      { href: '/suppliers', labelKey: 'nav.suppliers', permission: 'procurement.supplier.READ' },
    ],
  },
  {
    groupKey: 'nav.group.inventory',
    items: [
      { href: '/inventory', labelKey: 'nav.inventory', permission: 'inventory.balance.READ' },
      { href: '/scan', labelKey: 'nav.scan', permission: 'inventory.balance.READ' },
      { href: '/inventory/expiry', labelKey: 'nav.expiry', permission: 'inventory.expiry.READ' },
      { href: '/batches', labelKey: 'nav.batches', permission: 'inventory.batch.READ' },
      { href: '/counts', labelKey: 'nav.counts', permission: 'inventory.count.READ' },
      { href: '/adjustments', labelKey: 'nav.adjustments', permission: 'inventory.adjustment.CREATE' },
    ],
  },
  {
    groupKey: 'nav.group.operations',
    items: [
      { href: '/pos', labelKey: 'nav.pos', permission: 'sales.sale.CREATE' },
      { href: '/dispensing', labelKey: 'nav.dispensing', permission: 'dispensing.prescription.READ' },
      { href: '/procurement', labelKey: 'nav.procurement', permission: 'procurement.purchase_order.READ' },
      { href: '/receiving', labelKey: 'nav.receiving', permission: 'inventory.goods_receipt.CREATE' },
      { href: '/invoices', labelKey: 'nav.invoices', permission: 'finance.invoice.READ' },
    ],
  },
  {
    groupKey: 'nav.group.compliance',
    items: [
      { href: '/recalls', labelKey: 'nav.recalls', permission: 'quality.recall.READ' },
      { href: '/cold-chain', labelKey: 'nav.coldChain', permission: 'quality.cold_chain.READ' },
    ],
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const stored = tokenStore.user;
    if (!stored || !tokenStore.access) {
      router.replace('/login');
      return;
    }
    setUser(stored);
    setReady(true);
    // Refresh from the server so permission changes take effect without a re-login.
    api<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => undefined);
    api<any[]>('/notifications?unreadOnly=true')
      .then((n) => setUnread(n.length))
      .catch(() => undefined);
  }, [router]);

  useEffect(() => setOpen(false), [pathname]);

  if (!ready || !user) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-ink-muted">
        {t('auth.checkingSession')}
      </div>
    );
  }

  const visible = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || can(user, i.permission)),
  })).filter((g) => g.items.length);

  return (
    <div className="min-h-screen lg:flex">
      {/* Mobile header */}
      <div className="lg:hidden flex items-center justify-between border-b border-surface-border bg-white px-4 py-3">
        <span className="font-semibold text-brand-dark">{t('app.name')}</span>
        <button className="btn-ghost" onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation">
          Menu
        </button>
      </div>

      <aside
        className={`${open ? 'block' : 'hidden'} lg:block lg:w-64 shrink-0 border-r border-surface-border bg-white`}
      >
        <div className="hidden lg:block px-4 py-4 border-b border-surface-border">
          <div className="font-semibold text-brand-dark">{t('app.name')}</div>
          <div className="text-xs text-ink-subtle">{t('app.tagline')}</div>
        </div>

        <nav className="p-3 space-y-4">
          {visible.map((group) => (
            <div key={t(group.groupKey)}>
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                {t(group.groupKey)}
              </div>
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-md px-2 py-1.5 text-sm ${
                      active ? 'bg-brand-light font-medium text-brand-dark' : 'text-ink-muted hover:bg-surface-sunken'
                    }`}
                  >
                    {t(item.labelKey)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-surface-border p-3 text-xs">
          <div className="font-medium text-ink">{user.fullName}</div>
          <div className="text-ink-subtle">{user.roles.join(', ')}</div>
          <div className="mt-1 text-ink-subtle">
            {user.branchIds.length
              ? t('auth.branchScope', { count: user.branchIds.length })
              : t('auth.organizationWide')}
            {unread > 0 && <> &middot; {t('auth.unreadAlerts', { count: unread })}</>}
          </div>
          <button
            className="btn-ghost mt-2 w-full"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            {t('auth.signOut')}
          </button>
          <LanguagePicker />
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-4 lg:p-6">
        <OfflineBar />
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
