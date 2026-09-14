import '@fontsource-variable/inter';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './hooks/useAuth';
import { NotifyProvider } from './hooks/useNotify';
import { theme } from './theme';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <NotifyProvider>
          <App />
        </NotifyProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
