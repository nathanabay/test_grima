'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AuthUser, api, can, logout, tokenStore } from '@/lib/api';
import { LanguagePicker, useI18n } from '@/lib/i18n';
import { usePrefs } from '@/lib/theme';
import { ScopeProvider, useScope } from '@/lib/scope';
import { OfflineBar } from '@/components/OfflineBar';
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { NAV, ALL_COMMANDS } from '@/components/nav';

export { PageHeader } from '@/components/primitives';

/**
 * The application shell (§19–§22).
 *
 * Sidebar, header, global search, command palette, notifications, context
 * selector and the user menu. Everything a reader may not use is absent rather
 * than disabled: a section with no visible pages does not render its heading.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const stored = tokenStore.user;
    if (!stored || !tokenStore.access) {
      router.replace('/login');
      return;
    }
    setUser(stored);
    setReady(true);
    // Refresh from the server so a permission change takes effect without a
    // re-login, and a revoked session is noticed on the next page.
    api<AuthUser>('/auth/me').then(setUser).catch(() => undefined);
  }, [router]);

  if (!ready || !user) return <SessionCheck />;

  return (
    <ScopeProvider user={user}>
      <ShellChrome user={user}>{children}</ShellChrome>
    </ScopeProvider>
  );
}

function SessionCheck() {
  const { t } = useI18n();
  return (
    <div className="flex h-screen items-center justify-center text-body text-ink-muted">
      {t('auth.checkingSession')}
    </div>
  );
}

function ShellChrome({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const palette = useCommandPalette();
  const [navOpen, setNavOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api<any[]>('/notifications?unreadOnly=true')
      .then((n) => setUnread(n.length))
      .catch(() => undefined);
  }, [pathname]);

  // Close the mobile drawer on navigation, or it covers the page just opened.
  useEffect(() => setNavOpen(false), [pathname]);

  const groups = useMemo(
    () =>
      NAV.map((g) => ({
        ...g,
        items: g.items.filter((i) => !i.permission || can(user, i.permission)),
      })).filter((g) => g.items.length > 0),
    [user],
  );

  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50
                   focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-body focus:shadow-panel"
      >
        Skip to content
      </a>

      {/* Mobile bar */}
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2 lg:hidden">
        <button
          className="btn-quiet btn-sm"
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
          aria-label="Toggle navigation"
        >
          <MenuIcon /> Menu
        </button>
        <span className="text-section text-ink">{t('app.name')}</span>
        <button className="btn-quiet btn-sm" onClick={() => palette.setOpen(true)} aria-label="Search">
          <SearchIcon />
        </button>
      </div>

      <Sidebar groups={groups} pathname={pathname} open={navOpen} user={user} unread={unread} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} onOpenPalette={() => palette.setOpen(true)} unread={unread} />
        <main id="main" className="min-w-0 flex-1 p-3 sm:p-4 lg:p-6">
          <OfflineBar />
          {children}
        </main>
      </div>

      <CommandPalette
        open={palette.open}
        onClose={() => palette.setOpen(false)}
        user={user}
        commands={ALL_COMMANDS}
      />
    </div>
  );
}

function Sidebar({
  groups,
  pathname,
  open,
  user,
  unread,
}: {
  groups: typeof NAV;
  pathname: string;
  open: boolean;
  user: AuthUser;
  unread: number;
}) {
  const { t, tf } = useI18n();
  const router = useRouter();

  return (
    <aside
      className={`${open ? 'block' : 'hidden'} shrink-0 border-r border-border bg-surface
                  lg:block lg:w-60 xl:w-64`}
    >
      <div className="hidden items-center gap-2 border-b border-border px-4 py-3 lg:flex">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-brand text-brand-fg">
          <LogoIcon />
        </span>
        <div className="min-w-0">
          <div className="truncate text-section text-ink">{t('app.name')}</div>
          <div className="truncate text-caption text-ink-subtle">{t('app.tagline')}</div>
        </div>
      </div>

      <nav className="space-y-4 p-2.5 lg:max-h-[calc(100vh-8.5rem)] lg:overflow-y-auto" aria-label="Main">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="px-2 pb-1 text-caption uppercase text-ink-subtle">
              {tf(group.labelKey, group.label)}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                // An exact match, or a child route under this section, so
                // /reports/builder does not also light up /reports.
                const active =
                  pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(`${item.href}/`) &&
                    !group.items.some((o) => o !== item && pathname.startsWith(o.href)));
                const label = tf(item.labelKey, item.label);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-body
                                  transition-colors duration-state
                                  ${active
                                    ? 'bg-brand/12 font-medium text-brand-dark'
                                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'}`}
                    >
                      <span className="truncate">{label}</span>
                      {item.href === '/notifications' && unread > 0 && (
                        <span className="rounded-pill bg-danger px-1.5 text-caption text-white">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="truncate text-body font-medium text-ink">{user.fullName}</div>
        <div className="truncate text-caption text-ink-subtle">{user.roles.join(', ')}</div>
        <button
          className="btn-ghost btn-sm mt-2 w-full"
          onClick={async () => {
            await logout();
            router.replace('/login');
          }}
        >
          {t('auth.signOut')}
        </button>
      </div>
    </aside>
  );
}

function TopBar({
  user,
  onOpenPalette,
  unread,
}: {
  user: AuthUser;
  onOpenPalette: () => void;
  unread: number;
}) {
  const { t } = useI18n();
  const { theme, setTheme, density, setDensity } = usePrefs();
  const scope = useScope();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 hidden items-center gap-3 border-b border-border bg-surface/95 px-4 py-2 backdrop-blur lg:flex">
      {/* The palette is the search box: one surface for pages, actions and records. */}
      <button
        onClick={onOpenPalette}
        className="flex min-w-0 flex-1 max-w-md items-center gap-2 rounded border border-border-strong
                   bg-surface-sunken px-3 py-1.5 text-left text-body text-ink-subtle
                   transition-colors duration-state hover:border-brand/50 hover:text-ink-muted"
      >
        <SearchIcon />
        <span className="flex-1 truncate">{t('common.search')} products, batches, patients…</span>
        <kbd className="rounded border border-border px-1.5 font-mono text-caption text-ink-subtle">⌘K</kbd>
      </button>

      <ContextSelector />

      <div className="ml-auto flex items-center gap-1">
        <Link href="/notifications" className="btn-quiet btn-sm relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <BellIcon />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-danger px-1 text-[10px] font-medium text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>

        <div className="relative">
          <button
            className="btn-quiet btn-sm"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-pill bg-brand/15 text-caption text-brand-dark">
              {initials(user.fullName)}
            </span>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
              <div
                role="menu"
                className="absolute right-0 z-20 mt-1 w-64 rounded-card border border-border bg-surface-raised p-2 shadow-overlay"
              >
                <div className="border-b border-border px-2 pb-2">
                  <div className="truncate text-body font-medium text-ink">{user.fullName}</div>
                  <div className="truncate text-small text-ink-subtle">{user.email}</div>
                  <div className="mt-1 text-caption text-ink-subtle">
                    {scope.organizationWide
                      ? t('auth.organizationWide')
                      : t('auth.branchScope', { count: user.branchIds.length })}
                  </div>
                </div>

                <div className="px-2 pt-2">
                  <span className="label">Appearance</span>
                  <div className="flex gap-1" role="radiogroup" aria-label="Theme">
                    {(['light', 'dark', 'system'] as const).map((t2) => (
                      <button
                        key={t2}
                        role="radio"
                        aria-checked={theme === t2}
                        onClick={() => setTheme(t2)}
                        className={`btn btn-sm flex-1 ${theme === t2 ? 'bg-brand text-brand-fg' : 'border border-border text-ink-muted'}`}
                      >
                        {t2 === 'system' ? 'Auto' : t2[0].toUpperCase() + t2.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="px-2 pt-2">
                  <span className="label">Table density</span>
                  <div className="flex gap-1" role="radiogroup" aria-label="Density">
                    {(['comfortable', 'compact', 'dense'] as const).map((d) => (
                      <button
                        key={d}
                        role="radio"
                        aria-checked={density === d}
                        onClick={() => setDensity(d)}
                        className={`btn btn-sm flex-1 ${density === d ? 'bg-brand text-brand-fg' : 'border border-border text-ink-muted'}`}
                      >
                        {d === 'comfortable' ? 'Roomy' : d[0].toUpperCase() + d.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="px-2 pt-2">
                  <LanguagePicker compact />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Company / branch / warehouse (§19). Absent when the reader has only one
 * branch and one warehouse, because a selector with one option is furniture.
 */
function ContextSelector() {
  const { branches, branchId, warehouseId, setBranch, setWarehouse, branch } = useScope();
  if (branches.length === 0) return null;

  const showBranch = branches.length > 1;
  const warehouses = branch?.warehouses ?? [];
  const showWarehouse = warehouses.length > 1;
  if (!showBranch && !showWarehouse) return null;

  return (
    <div className="flex items-center gap-1.5">
      {showBranch && (
        <select
          aria-label="Branch"
          className="input w-auto max-w-[13rem] py-1 text-small"
          value={branchId ?? ''}
          onChange={(e) => setBranch(e.target.value || null)}
        >
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      )}
      {showWarehouse && (
        <select
          aria-label="Warehouse"
          className="input w-auto max-w-[13rem] py-1 text-small"
          value={warehouseId ?? ''}
          onChange={(e) => setWarehouse(e.target.value || null)}
        >
          <option value="">All warehouses</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

/* Inline icons: a few strokes each, so the shell carries no icon dependency. */
const MenuIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
  </svg>
);
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
  </svg>
);
const BellIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" strokeLinejoin="round" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" />
  </svg>
);
const LogoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
);
