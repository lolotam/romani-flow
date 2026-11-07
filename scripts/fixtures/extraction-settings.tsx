/**
 * Dedicated Browser Settings Fixture for Task 10 / Task 15.
 *
 * Statically imports actual production DocumentExtractionSettings.
 * Free of external font imports (no remote Google fonts / index.css).
 * Wrapped in actual AuthProvider and LanguageProvider.
 * Exposes window controls for remounting, switching auth/role, language, and refresh keys.
 * Single owner for controls, exposing committed mount/account/language identity.
 *
 * Contract requirements:
 * - Named export only: export { DocumentExtractionSettings } from 'src/components/settings/DocumentExtractionSettings'
 * - Single owner for controls and committed mount/account/language identity
 * - No stubs, no fake fallback, no default export import
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../src/hooks/useAuth';
import { LanguageProvider, useLanguage, type Language } from '../../src/contexts/LanguageContext';
import { DocumentExtractionSettings } from '../../src/components/settings/DocumentExtractionSettings';

export interface SettingsMountProps {
  initialRefreshKey?: number;
}

export interface RenderInfo {
  rendered: boolean;
  isLoading: boolean;
  mountEpoch: number;
  accountId: string | null;
  accountRole: string | null;
  language: Language;
  direction: 'rtl' | 'ltr';
}

export interface SettingsControls {
  remount: (props?: SettingsMountProps) => void;
  setRefreshKey: (key: number) => void;
  setLanguage: (lang: Language) => void;
  getRenderInfo: () => RenderInfo;
}

declare global {
  interface Window {
    __settingsControls?: SettingsControls;
  }
}

interface InnerProps {
  mountEpoch: number;
  refreshKey: number;
  remount: (props?: SettingsMountProps) => void;
  setRefreshKey: (key: number) => void;
}

export function ExtractionSettingsFixtureInner({
  mountEpoch,
  refreshKey,
  remount,
  setRefreshKey,
}: InnerProps) {
  const { user, isLoading } = useAuth();
  const { language, setLanguage, isRTL } = useLanguage();

  // Single owner registers window.__settingsControls
  useEffect(() => {
    window.__settingsControls = {
      remount,
      setRefreshKey,
      setLanguage,
      getRenderInfo: () => ({
        rendered: !isLoading,
        isLoading,
        mountEpoch,
        accountId: user?.id ?? null,
        accountRole: user?.role ?? null,
        language,
        direction: isRTL ? 'rtl' : 'ltr',
      }),
    };
  }, [mountEpoch, refreshKey, remount, setRefreshKey, setLanguage, user, isLoading, language, isRTL]);

  return (
    <div
      id="settings-fixture-root"
      data-testid="settings-fixture-root"
      data-mount-epoch={mountEpoch}
      data-auth-loading={String(isLoading)}
      data-account-id={user?.id ?? 'none'}
      data-account-role={user?.role ?? 'none'}
      data-language={language}
      data-direction={isRTL ? 'rtl' : 'ltr'}
      dir={isRTL ? 'rtl' : 'ltr'}
      className="p-6 max-w-4xl mx-auto space-y-6"
    >
      <DocumentExtractionSettings refreshKey={refreshKey} />
    </div>
  );
}

export function SettingsApp() {
  const [mountEpoch, setMountEpoch] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const remount = useCallback((props?: SettingsMountProps) => {
    if (props?.initialRefreshKey !== undefined) {
      setRefreshKey(props.initialRefreshKey);
    }
    setMountEpoch((epoch) => epoch + 1);
  }, []);

  return (
    <AuthProvider key={mountEpoch}>
      <LanguageProvider>
        <ExtractionSettingsFixtureInner
          mountEpoch={mountEpoch}
          refreshKey={refreshKey}
          remount={remount}
          setRefreshKey={setRefreshKey}
        />
      </LanguageProvider>
    </AuthProvider>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<SettingsApp />);
}
