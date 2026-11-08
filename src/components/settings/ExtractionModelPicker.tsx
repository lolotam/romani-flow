/**
 * The model picker of the extraction settings.
 *
 * The picker is a searchable combobox over the full catalog of the chosen
 * provider. A model that the local records approve is selectable, a model that
 * only the reviewed rules accept is shown with the approval record it still
 * needs, and every other model is shown greyed out and cannot be chosen.
 *
 * The picker never chooses a model on its own and never approves one: the
 * approval record is offered for copying only, and the owner adds it to the
 * environment by hand. The saved model stays visible when the catalog does not
 * know it, because a failed listing must never drop the selection.
 */

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ModelCatalogEntry, ModelChoice } from '@/lib/api/documentExtraction';
import { useLanguage } from '@/contexts/LanguageContext';

/** The options of the picker. */
export interface ExtractionModelPickerProps {
  /** The chosen provider, or the empty string before one is chosen. */
  provider: string;
  /** The model of the editor. */
  model: string;
  /** The full catalog of the provider, approved entries first. */
  catalog: ModelCatalogEntry[];
  /** The approved candidates, used when the full catalog is not available. */
  candidates: ModelChoice[];
  /** Chooses a model. Only an approved entry reaches the callback. */
  onSelect(model: string): void;
  /** Reports whether the picker may be used at all. */
  disabled: boolean;
}

/** One row of the list, normalized from a catalog entry or a candidate. */
interface PickerRow {
  id: string;
  label: string;
  status: ModelCatalogEntry['status'];
  maxImages: number | null;
  /** The approval record an approvable model still needs. */
  approval: string | null;
}

/**
 * Builds the rows of the picker. The saved model is appended when the list
 * does not know it: it stays visible for display and can be re-selected, but
 * the extraction can never be enabled from a model the catalogue refuses.
 */
function buildRows(
  catalog: ModelCatalogEntry[],
  candidates: ModelChoice[],
  model: string,
): PickerRow[] {
  const rows: PickerRow[] =
    catalog.length > 0
      ? catalog.map((entry) => ({
          id: entry.id,
          label: entry.label,
          status: entry.status,
          maxImages: entry.maxImages,
          approval: entry.approval,
        }))
      : candidates.map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          status: 'approved' as const,
          maxImages: candidate.maxImages,
          approval: null,
        }));
  if (model !== '' && !rows.some((row) => row.id === model)) {
    rows.push({ id: model, label: model, status: 'approved', maxImages: null, approval: null });
  }
  return rows;
}

/** The badge copy of one catalog status. */
function statusCopy(status: PickerRow['status'], t: (key: string) => string): string {
  if (status === 'approved') return t('extraction.catalog.statusApproved');
  if (status === 'approvable') return t('extraction.catalog.statusApprovable');
  return t('extraction.catalog.statusUnavailable');
}

/** The picker of the extraction settings. */
export function ExtractionModelPicker({
  provider,
  model,
  catalog,
  candidates,
  onSelect,
  disabled,
}: ExtractionModelPickerProps) {
  const { t, isRTL } = useLanguage();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);

  const rows = useMemo(() => buildRows(catalog, candidates, model), [catalog, candidates, model]);
  const selected = rows.find((row) => row.id === model) ?? null;

  /** Copies one approval record. The clipboard of the page is the only target. */
  const copyApproval = (row: PickerRow): void => {
    if (!row.approval) return;
    const show = (ok: boolean): void => {
      setCopied({ id: row.id, ok });
      window.setTimeout(() => {
        setCopied((current) => (current?.id === row.id ? null : current));
      }, 2000);
    };
    navigator.clipboard?.writeText(row.approval).then(
      () => show(true),
      () => show(false),
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id="extraction-model"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          data-testid="extraction-model-select"
          data-value={model}
          disabled={disabled || provider === ''}
          className={cn('h-10 w-full justify-between font-normal', !model && 'text-muted-foreground')}
        >
          <span className="truncate">
            {selected ? selected.label : t('extraction.chooseModel')}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        dir={isRTL ? 'rtl' : 'ltr'}
        className="w-[min(28rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            data-testid="extraction-model-search"
            placeholder={t('extraction.catalog.searchPlaceholder')}
            className="h-9"
          />
          <CommandList className="max-h-72">
            <CommandEmpty>{t('extraction.catalog.noResults')}</CommandEmpty>
            <CommandGroup>
              {rows.map((row) => {
                const selectable = row.status === 'approved';
                return (
                  <CommandItem
                    key={row.id}
                    value={row.id}
                    keywords={[row.label]}
                    data-value={row.id}
                    data-testid="extraction-model-option"
                    className={cn(
                      'gap-2',
                      !selectable &&
                        'cursor-not-allowed text-muted-foreground opacity-60 data-[selected=true]:bg-transparent',
                    )}
                    onSelect={() => {
                      // A row that is not approved is never selectable: the
                      // handler refuses it, so the extraction can only ever be
                      // pointed at a model the local records approve. The row
                      // stays interactive because the approval record next to
                      // it has to stay clickable.
                      if (!selectable) return;
                      onSelect(row.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn('size-4 shrink-0', model === row.id ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="flex min-w-0 flex-1 flex-col items-start">
                      <span className="w-full truncate">{row.label}</span>
                      <span className="w-full truncate text-xs text-muted-foreground">{row.id}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-xs text-muted-foreground">
                        {row.status === 'approved' && row.maxImages !== null
                          ? t('extraction.catalog.imagesAllowed', { count: row.maxImages })
                          : statusCopy(row.status, t)}
                      </span>
                      {row.approval && (
                        <button
                          type="button"
                          data-testid="extraction-copy-approval"
                          aria-label={`${t('extraction.catalog.copyApproval')}: ${row.id}`}
                          className="inline-flex size-6 items-center justify-center rounded-sm hover:bg-accent"
                          onClick={(event) => {
                            event.stopPropagation();
                            copyApproval(row);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <Copy className="size-3.5" />
                        </button>
                      )}
                    </span>
                    {copied?.id === row.id && (
                      <span role="status" className="sr-only">
                        {copied.ok
                          ? t('extraction.catalog.copied')
                          : t('extraction.catalog.copyFailed')}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {copied !== null && (
          <p role="status" data-testid="extraction-copy-status" className="px-3 py-2 text-xs text-muted-foreground">
            {copied.ok
              ? t('extraction.catalog.copied')
              : t('extraction.catalog.copyFailed')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
