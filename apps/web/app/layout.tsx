import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { FeedbackProvider } from '@/components/Feedback';

export const viewport = {
  themeColor: '#0d7d6c',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'PharmaCore', statusBarStyle: 'default' },
  title: 'PharmaCore — Pharmacy Inventory & Management',
  description: 'Enterprise pharmaceutical inventory, dispensing and compliance system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Both providers sit above every page, so a page component can call
            useI18n or useFeedback in its own body rather than only in the
            subtree Shell renders. */}
        <I18nProvider>
          <FeedbackProvider>{children}</FeedbackProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
