'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact' | 'dense';

const THEME_KEY = 'pharmacore.theme';
const DENSITY_KEY = 'pharmacore.density';

interface Prefs {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  density: Density;
  setDensity: (d: Density) => void;
  /** What the page is actually showing right now, once "system" is resolved. */
  resolved: 'light' | 'dark';
}

const PrefsContext = createContext<Prefs | null>(null);

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside PreferencesProvider');
  return ctx;
}

function read<T extends string>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    return (localStorage.getItem(key) as T) ?? fallback;
  } catch {
    // Storage can be unavailable (private window, blocked cookies). The
    // interface still has to render, so the default is used silently.
    return fallback;
  }
}

/**
 * Theme and density, applied to the document root so CSS variables resolve
 * without a re-render of the tree (§17, §26).
 *
 * "system" writes no attribute at all, which lets the prefers-color-scheme
 * media query in globals.css decide. An explicit choice stamps the attribute
 * and wins over the media query in both directions.
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [density, setDensityState] = useState<Density>('compact');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  // Read stored preferences after mount: the server cannot know them, and
  // reading during render would make the markup differ from the server's.
  useEffect(() => {
    setThemeState(read<ThemeChoice>(THEME_KEY, 'system'));
    setDensityState(read<Density>(DENSITY_KEY, 'compact'));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const resolve = () => setResolved(theme === 'system' ? (media.matches ? 'dark' : 'light') : theme);
    resolve();
    // Follow the system while the choice is "system", so a laptop switching to
    // dark at sunset takes the interface with it.
    media.addEventListener('change', resolve);
    return () => media.removeEventListener('change', resolve);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* not fatal */ }
  }, []);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    try { localStorage.setItem(DENSITY_KEY, d); } catch { /* not fatal */ }
  }, []);

  return (
    <PrefsContext.Provider value={{ theme, setTheme, density, setDensity, resolved }}>
      {children}
    </PrefsContext.Provider>
  );
}

/**
 * Applied before paint so a dark-mode user does not get a white flash on every
 * navigation. It runs from the document head, before React hydrates.
 */
export const THEME_BOOTSTRAP = `
(function(){try{
  var t=localStorage.getItem('${THEME_KEY}');
  if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);
  var d=localStorage.getItem('${DENSITY_KEY}');
  document.documentElement.setAttribute('data-density',d||'compact');
}catch(e){document.documentElement.setAttribute('data-density','compact');}})();
`;
