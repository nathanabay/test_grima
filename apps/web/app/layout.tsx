import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { FeedbackProvider } from "@/components/Feedback";
import { PreferencesProvider, THEME_BOOTSTRAP } from "@/lib/theme";

export const viewport = {
  themeColor: "#0d7d6c",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PharmaCore",
    statusBarStyle: "default",
  },
  title: "PharmaCore — Pharmacy Inventory & Management",
  description:
    "Enterprise pharmaceutical inventory, dispensing and compliance system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Applied before the first paint, so a dark-mode user never gets a white
          flash on navigation and the table density is right on the first frame.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        {/* Both providers sit above every page, so a page component can call
            useI18n or useFeedback in its own body rather than only in the
            subtree Shell renders. */}
        <PreferencesProvider>
          <I18nProvider>
            <FeedbackProvider>{children}</FeedbackProvider>
          </I18nProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
