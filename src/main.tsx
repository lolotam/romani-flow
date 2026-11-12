import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App, { type RuntimeAuthConfig } from './App.tsx';
import { request } from '@/lib/api/http';
import './index.css';

function Bootstrap() {
  const [config, setConfig] = useState<RuntimeAuthConfig | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void request<RuntimeAuthConfig>('/api/auth/config').then(({ data, error }) => {
      if (!active) return;
      if (error || !data || (data.provider === 'clerk' && !data.publishableKey)) {
        setFailed(true);
        return;
      }
      setConfig(data);
    });
    return () => { active = false; };
  }, []);

  if (failed) {
    return <main className="flex min-h-screen items-center justify-center bg-background p-4" role="alert">
      Authentication configuration could not be loaded. Reload the page to try again.
    </main>;
  }
  if (!config) {
    return <main className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary" />
    </main>;
  }
  return <App authConfig={config} />;
}

createRoot(document.getElementById('root')!).render(<Bootstrap />);
