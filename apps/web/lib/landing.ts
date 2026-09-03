'use client';

import { NAV } from '@/components/nav';
import { AuthUser, can } from './api';

/**
 * The first page this user can actually open.
 *
 * Signing in always went to `/dashboard`, which needs
 * `analytics.dashboard.READ` — a permission a cashier does not hold. Nothing
 * said so while a typed URL was unguarded; now that a page the reader may not
 * open says so, landing them on one would greet every cashier with "this is
 * not part of your role" as the first thing they see after signing in.
 *
 * So the landing page is chosen the same way the menu is: the first entry the
 * reader is permitted, in the order their sidebar lists them.
 */
export function landingFor(user: AuthUser | null): string {
  if (!user) return '/login';
  for (const group of NAV) {
    for (const item of group.items) {
      if (!item.permission || can(user, item.permission)) return item.href;
    }
  }
  // Every role holds at least one nav entry; if one somehow does not, the
  // notifications page needs no permission and explains itself.
  return '/notifications';
}
