import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './auth';
import { ThemeProvider, initializeTheme } from './theme';
import { initializeLanguage } from './i18n';
import { queryClient } from './state';
import './style.css';

initializeTheme();
initializeLanguage();
createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
