// Apply the preference before the app and its stylesheet load; permitted by the same-origin CSP.
(() => {
  let theme = 'system';

  try {
    const saved = localStorage.getItem('nodarium-theme');

    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {
    /* Storage is optional. */
  }

  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();
