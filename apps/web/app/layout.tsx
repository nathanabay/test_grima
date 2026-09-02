import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';

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
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
