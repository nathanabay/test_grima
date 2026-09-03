"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { tokenStore } from "@/lib/api";
import { landingFor } from "@/lib/landing";

/**
 * The root, which is a signpost rather than a page.
 *
 * It used to render `null` while deciding, so the first thing anyone saw on
 * opening the product was a blank white screen. The redirect is immediate, but
 * "immediate" is not instant on a slow connection, and a blank page reads as a
 * broken one.
 */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    // The first page this user may open, not `/dashboard` — which needs a
    // permission a cashier does not hold.
    router.replace(tokenStore.access ? landingFor(tokenStore.user) : "/login");
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-small text-ink-muted" role="status">
        Taking you to PharmaCore&hellip;
      </p>
    </main>
  );
}
