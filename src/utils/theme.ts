/**
 * Mwonekano: light, dark, or as the phone is (styles/theme.css).
 *
 * The choice belongs to the DEVICE, like the language: kept in localStorage,
 * read before anything draws (the inline script in index.html sets
 * <html data-theme> first, so there is no white flash), and works offline.
 * "system" (Kama kompyuta) is the default and follows the computer live:
 * switch Windows to dark and the app follows without a restart.
 */
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'venics_theme';
const listeners = new Set<() => void>();

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const phoneIsDark = () => {
  try { return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches; } catch { return false; }
};

/** What is on screen now: the choice, with "system" resolved. */
export function resolvedTheme(choice = getThemeChoice()): 'light' | 'dark' {
  return choice === 'system' ? (phoneIsDark() ? 'dark' : 'light') : choice;
}

export function applyTheme(): void {
  const theme = resolvedTheme();
  const root = document.documentElement;
  if (root.getAttribute('data-theme') !== theme) root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
  // The title bar of the installed app follows.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1320' : '#2563eb');
  listeners.forEach(fn => fn());
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch { /* storage blocked: lasts until the app is closed */ }
  applyTheme();
}

let watching = false;
/** Follow the phone while the choice is "system". Called once at start-up. */
export function watchSystemTheme(): void {
  if (watching) return;
  watching = true;
  try {
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (getThemeChoice() === 'system') applyTheme();
    });
  } catch { /* old WebView: the choice still applies at start-up */ }
}

/** The choice, for the Mwonekano setting; re-renders when it changes. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getThemeChoice,
    () => 'system' as ThemeChoice,
  );
}
