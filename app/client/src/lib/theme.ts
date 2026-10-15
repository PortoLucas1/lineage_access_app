import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

// Must match the pre-paint script in index.html.
const STORAGE_KEY = 'lineage-theme';

function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable (private mode); the toggle still works per session.
    }
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((value) => (value === 'dark' ? 'light' : 'dark')),
    [],
  );
  return { theme, toggle };
}
