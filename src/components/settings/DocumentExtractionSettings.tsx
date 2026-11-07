/**
 * The settings of the AI document extraction.
 *
 * The card is the only place where an administrator chooses the provider and
 * the model of the extraction. It is admin-only, it starts with the extraction
 * switched off and it never chooses a model on its own: the provider and the
 * model are always an explicit act of the administrator.
 *
 * The list of models comes from the offline catalogue of the server. The
 * catalogue is a local approval, not a proof that a provider still serves the
 * model, so the card says so instead of pretending the availability is known.
 *
 * The card never shows a key, never offers a free text model, never tests a
 * provider and never links to a billing page.
 */

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import type { ExtractionStatus, ModelChoice } from '@/lib/api/documentExtraction';
import {
  EXTRACTION_ERROR_CODES,
  useExtractionSettings,
  type ExtractionProvider,
} from '@/hooks/useExtractionSettings';

/** The props of the settings card. */
export interface DocumentExtractionSettingsProps {
  refreshKey?: number;
}

/**
 * Renders the settings of the extraction for an administrator.
 *
 * The role is read from the session, so a viewer never sees the card at all.
 * The backend checks the same authority again when the settings are written.
 */
export function DocumentExtractionSettings({ refreshKey = 0 }: DocumentExtractionSettingsProps) {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const admin = user?.role === 'admin';
  const state = useExtractionSettings(admin ? (user?.id ?? null) : null, refreshKey);

  const modelOptions = useMemo(
    () => buildModelOptions(state.candidates, state.status, state.editor.provider, t),
    [state.candidates, state.status, state.editor.provider, t],
  );

  /**
   * The saved model is kept for display only when the current catalogue does
   * not offer it. It is never chosen on its own and never erased.
   */
  const savedModelOnly = useMemo(
    () =>
      state.editor.model !== '' &&
      state.candidateReason !== null &&
      !state.candidates.some(
        (candidate) =>
          candidate.id === state.editor.model && candidate.provider === state.editor.provider,
      ),
    [state.candidates, state.candidateReason, state.editor.model, state.editor.provider],
  );

  if (!admin) return null;

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-4 text-start">
      <Card data-testid="extraction-settings-card">
        <CardHeader>
          <CardTitle className="text-lg">{t('extraction.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status && !state.status.processingAuthorized && (
            <p
              data-testid="extraction-auth-warning"
              role="status"
              className="text-sm text-destructive"
            >
              {t('extraction.authorizationRequired')}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Switch
              id="extraction-enabled"
              data-testid="extraction-enabled-switch"
              checked={state.editor.enabled}
              // Switching off stays possible even when the catalogue cannot be
              // used: stopping the extraction never needs a provider.
              disabled={!state.canEnable && !state.editor.enabled}
              onCheckedChange={(checked) => state.setEnabled(checked)}
            />
            <Label htmlFor="extraction-enabled">{t('extraction.enabled')}</Label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="extraction-provider">{t('extraction.provider')}</Label>
            <select
              id="extraction-provider"
              data-testid="extraction-provider-select"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={state.editor.provider}
              onChange={(event) => state.setProvider(event.target.value as ExtractionProvider | '')}
            >
              <option value="">{t('extraction.chooseProvider')}</option>
              <option value="groq">{t('extraction.providers.groq')}</option>
              <option value="openrouter">{t('extraction.providers.openrouter')}</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="extraction-model">{t('extraction.model')}</Label>
            <select
              id="extraction-model"
              data-testid="extraction-model-select"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={state.editor.model}
              onChange={(event) => state.setModel(event.target.value)}
            >
              <option value="">{t('extraction.chooseModel')}</option>
              {modelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {state.status && (
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                {t('extraction.providers.groq')}:{' '}
                {state.status.configured.groq
                  ? t('extraction.configured')
                  : t('extraction.notConfigured')}
              </li>
              <li>
                {t('extraction.providers.openrouter')}:{' '}
                {state.status.configured.openrouter
                  ? t('extraction.configured')
                  : t('extraction.notConfigured')}
              </li>
            </ul>
          )}

          {state.candidateReason !== null && (
            <p
              data-testid="extraction-offline-notice"
              role="status"
              className="text-sm text-muted-foreground"
            >
              {t('extraction.catalog.offlineNotice')}
            </p>
          )}

          {state.candidateReason !== null && state.candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('extraction.catalog.noCandidates')}</p>
          )}

          {savedModelOnly && (
            <p
              data-testid="extraction-saved-model-notice"
              role="status"
              className="text-sm text-muted-foreground"
            >
              {t('extraction.catalog.savedSelectionUnavailable')}
            </p>
          )}

          {state.error && (
            <p data-testid="extraction-error" role="alert" className="text-sm text-destructive">
              {describeError(state.error, t)}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              data-testid="extraction-refresh-button"
              disabled={state.saving}
              onClick={state.refresh}
            >
              {t('extraction.refresh')}
            </Button>
            <Button
              type="button"
              data-testid="extraction-save-button"
              // The settings are only written when the authoritative status is
              // known. A write before it would send empty defaults.
              disabled={state.saving || !state.statusLoaded}
              onClick={state.save}
            >
              {t('extraction.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The models the administrator may choose.
 *
 * The list is the catalogue of the server. The saved model stays visible when
 * the catalogue does not know it, because a failed refresh must never drop the
 * selection of the administrator.
 */
function buildModelOptions(
  candidates: ModelChoice[],
  status: ExtractionStatus | null,
  provider: ExtractionProvider | '',
  t: (key: string) => string,
): { id: string; label: string }[] {
  const options: { id: string; label: string }[] = candidates.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
  }));
  const saved = status && status.provider === provider ? status.model : '';
  if (saved && !options.some((option) => option.id === saved)) {
    options.push({ id: saved, label: `${saved} (${t('extraction.catalog.savedSelection')})` });
  }
  return options;
}

/**
 * Describes a failure with the copy of the dictionary.
 *
 * A known code has its own copy and every other failure keeps the generic
 * copy, so no text of the server and no text of an exception is ever shown.
 */
function describeError(error: Error, t: (key: string) => string): string {
  const code = (error as Error & { code?: string }).code;
  if (code && (EXTRACTION_ERROR_CODES as readonly string[]).includes(code)) {
    return t(`extraction.errors.${code}`);
  }
  return t('extraction.failed');
}
