import { Alert, Snackbar, type AlertColor } from '@mui/material';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Notify = (message: string, severity?: AlertColor) => void;

const NotifyContext = createContext<Notify>(() => undefined);

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; severity: AlertColor; key: number } | null>(null);
  const notify = useCallback<Notify>((message, severity = 'success') => {
    setToast({ message, severity, key: Date.now() });
  }, []);

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <Snackbar
        key={toast?.key}
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={toast?.severity ?? 'info'} variant="filled" onClose={() => setToast(null)} sx={{ minWidth: 320 }}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </NotifyContext.Provider>
  );
}

export const useNotify = () => useContext(NotifyContext);
