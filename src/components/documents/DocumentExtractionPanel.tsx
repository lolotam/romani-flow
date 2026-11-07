/**
 * The review panel of the document extraction.
 *
 * The panel shows what the machine proposed and never hides what it did not
 * understand. Every value is shown as plain text, every candidate carries
 * the reason it was not applied, and no percentage of any kind is shown: a
 * suggestion is a suggestion of a model, not a measurement.
 *
 * The panel never writes a value on its own. It only shows the candidates of
 * the running attempt and offers the administrator the explicit actions of
 * cancelling, retrying and accepting a single candidate.
 *
 * Every text of the panel comes from the translation dictionary of the
 * application, so the panel is bilingual and follows the direction of the
 * language without a special case. The keys are the approved keys of the
 * extraction: `extraction.<phase>` for the phase of the attempt,
 * `extraction.fields.<field>` for the label of a field,
 * `extraction.reason.<reason>` for the reason a candidate was not applied and
 * `extraction.errors.<code>` for the reason of a failure.
 */

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DocumentExtractionState } from '@/hooks/useDocumentExtraction';
import { fieldNames, type ExtractionResult, type Field } from '../../../server/contracts/documentExtraction';
import { acceptedCandidateValue } from '@/lib/extraction/session';

/** The props of the panel. */
export interface DocumentExtractionPanelProps {
  state: DocumentExtractionState;
  disabled: boolean;
}

/**
 * Renders the state of one extraction.
 *
 * The status region is polite, so a change of the state never interrupts the
 * administrator. A failure is announced separately, because it asks for an
 * action.
 */
export function DocumentExtractionPanel({ state, disabled }: DocumentExtractionPanelProps) {
  const { t } = useLanguage();
  const { phase, fields, errorCode, retryAfterSeconds } = state;

  const busy = phase === 'preparing' || phase === 'extracting';
  const showCandidates = phase === 'review' && fields !== null;
  const failure = phase === 'failed' || phase === 'cooldown';
  const refusal = phase === 'unavailable' && errorCode !== null;

  return (
    <div className="min-w-0 space-y-2">
      <div
        role="status"
        aria-live="polite"
        className="min-w-0 break-words space-y-2 rounded-lg border p-3 text-sm"
      >
        <p className="min-w-0 break-words font-medium">
          {t(`extraction.${phase}`, { seconds: retryAfterSeconds })}
        </p>

        {showCandidates && (
          <ul className="min-w-0 space-y-2">
            {fieldNames.map((field) => {
              const candidate = fields?.[field];
              if (!candidate) return null;
              return (
                <li key={field} className="min-w-0 break-words">
                  <span className="font-medium">{t(`extraction.fields.${field}`)}</span>
                  {field === 'title' && (
                    <p className="min-w-0 break-words text-muted-foreground">
                      {t('extraction.titleHint')}
                    </p>
                  )}
                  <CandidateValues
                    candidate={candidate}
                    field={field}
                    disabled={disabled}
                    onAccept={state.accept}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {busy && (
            <Button type="button" variant="outline" onClick={state.cancel} disabled={disabled}>
              {t('extraction.cancel')}
            </Button>
          )}
          {failure && (
            <Button
              type="button"
              variant="outline"
              onClick={state.retry}
              disabled={disabled || phase === 'cooldown'}
            >
              {t('extraction.retry')}
            </Button>
          )}
        </div>
      </div>

      {(failure || refusal) && errorCode && (
        <Alert variant="destructive">
          <AlertTitle>
            {refusal ? t('extraction.unavailable') : t('extraction.failed')}
          </AlertTitle>
          <AlertDescription className="min-w-0 break-words">
            {t(`extraction.errors.${errorCode}`)}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** The props of the values of one candidate. */
interface CandidateValuesProps {
  candidate: ExtractionResult['fields'][Field];
  field: Field;
  disabled: boolean;
  onAccept: (field: Field, value: string) => boolean;
}

/**
 * Renders the values of one candidate.
 *
 * A value the server was sure about is shown with the button that writes it.
 * A value the server was not sure about is shown with its alternatives and
 * the reason it was not applied, so the administrator can judge it. A value
 * that may not be written at all is shown as plain text with the reason of
 * the refusal, so no button ever promises a write that cannot happen.
 */
function CandidateValues({ candidate, field, disabled, onAccept }: CandidateValuesProps) {
  const { t } = useLanguage();

  const values = candidate.value !== null ? [candidate.value] : candidate.alternatives;

  return (
    <div className="min-w-0 space-y-1">
      {candidate.reason !== 'none' && (
        <p className="min-w-0 break-words text-muted-foreground">
          {t(`extraction.reason.${candidate.reason}`)}
        </p>
      )}
      {values.length > 0 && (
        <ul className="min-w-0 space-y-1">
          {values.map((value, index) => {
            const acceptable = acceptedCandidateValue(field, value, candidate) !== null;
            return (
              <li key={`${value}-${index}`} className="min-w-0 break-words">
                <span>{value}</span>
                {acceptable ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ms-2"
                    disabled={disabled}
                    onClick={() => {
                      onAccept(field, value);
                    }}
                  >
                    {t('extraction.accept')}
                  </Button>
                ) : (
                  <span className="ms-2 text-muted-foreground">
                    {t('extraction.reason.invalid')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
