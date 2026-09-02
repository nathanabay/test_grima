'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthUser, api, can, logout, tokenStore } from '@/lib/api';

interface NavItem {
  href: string;
  label: string;
  permission?: string;
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', permission: 'analytics.dashboard.READ' },
      { href: '/command-center', label: 'Command Center', permission: 'analytics.dashboard.READ' },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { href: '/inventory', label: 'Stock Balances', permission: 'inventory.balance.READ' },
      { href: '/inventory/expiry', label: 'Expiry Management', permission: 'inventory.expiry.READ' },
      { href: '/batches', label: 'Batches & Quarantine', permission: 'inventory.batch.READ' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { href: '/pos', label: 'Point of Sale', permission: 'sales.sale.CREATE' },
      { href: '/dispensing', label: 'Prescriptions', permission: 'dispensing.prescription.READ' },
      { href: '/procurement', label: 'Procurement', permission: 'procurement.purchase_order.READ' },
    ],
  },
  {
    group: 'Compliance',
    items: [
      { href: '/recalls', label: 'Recalls', permission: 'quality.recall.READ' },
      { href: '/cold-chain', label: 'Cold Chain', permission: 'quality.cold_chain.READ' },
    ],
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
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
        Checking your session...
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
        <span className="font-semibold text-brand-dark">PharmaCore</span>
        <button className="btn-ghost" onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation">
          Menu
        </button>
      </div>

      <aside
        className={`${open ? 'block' : 'hidden'} lg:block lg:w-64 shrink-0 border-r border-surface-border bg-white`}
      >
        <div className="hidden lg:block px-4 py-4 border-b border-surface-border">
          <div className="font-semibold text-brand-dark">PharmaCore</div>
          <div className="text-xs text-ink-subtle">Pharmacy Management</div>
        </div>

        <nav className="p-3 space-y-4">
          {visible.map((group) => (
            <div key={group.group}>
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                {group.group}
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
                    {item.label}
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
            {user.branchIds.length ? `${user.branchIds.length} branch scope` : 'Organization-wide'}
            {unread > 0 && <> &middot; {unread} unread alerts</>}
          </div>
          <button
            className="btn-ghost mt-2 w-full"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-4 lg:p-6">{children}</main>
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
