/**
 * The copy of the AI document extraction in English.
 *
 * The dictionary is the single source of the copy of the extraction. The panel
 * of a form and the settings of an administrator read the same keys, so the
 * two never drift apart and the application never falls back to a hardcoded
 * text.
 *
 * The keys `fields`, `reason` and `errors` are maps: a field name, a reason of
 * the contract and a code of the server are never written in the interface,
 * only the copy behind the key is.
 */

export const extraction = {
  title: 'Document extraction',
  documentNumber: 'Document number (optional)',
  numberTooLong: 'Document number must be at most 128 characters.',
  enabled: 'Enable extraction',
  provider: 'Provider',
  model: 'Model',
  chooseProvider: 'Choose a provider',
  chooseModel: 'Choose an approved model',
  configured: 'Configured',
  notConfigured: 'Not configured',
  authorizationRequired: 'Document processing has not been authorized for this environment.',
  refresh: 'Refresh models',
  save: 'Save settings',
  idle: 'Select a PDF, JPG or PNG.',
  preparing: 'Preparing all pages locally…',
  extracting: 'Reading document metadata…',
  review: 'Machine suggestions: review every value and the attachment before saving.',
  failed: 'Extraction failed. You can continue entering details manually.',
  unavailable: 'Extraction is unavailable. Manual entry remains available.',
  cancelled: 'Extraction cancelled. A request already sent cannot be recalled.',
  cooldown: 'Try again in {{seconds}} seconds.',
  cancel: 'Cancel extraction',
  retry: 'Retry extraction',
  accept: 'Use this suggestion',
  titleHint: 'The filename title is preserved until you choose a suggestion.',
  uncertain: 'Requires review',
  fields: {
    title: 'Title',
    document_number: 'Document number',
    document_type_id: 'Document type',
    ministry_id: 'Ministry',
    issue_date: 'Issue date',
    expiry_date: 'Expiry date',
  },
  reason: {
    none: '',
    uncertain: 'Uncertain reading',
    invalid: 'Invalid value',
    conflict: 'Conflicting pages',
    catalog: 'No unique catalog match',
  },
  errors: {
    processing_not_authorized: 'Processing is not authorized.',
    extraction_disabled: 'Extraction is disabled.',
    unconfigured: 'Provider is not configured.',
    policy_unavailable: 'Free pricing or privacy policy could not be verified.',
    provider_auth: 'Provider authentication failed.',
    provider_balance: 'Provider balance or free allowance is unavailable.',
    provider_policy: 'Provider access or privacy policy refused this request.',
    provider_rate_limit: 'Provider rate limit reached.',
    provider_unavailable: 'Provider is temporarily unavailable.',
  provider_request_rejected: 'The provider refused the request. Check the model and the settings.',
    extraction_timeout: 'Extraction timed out.',
    invalid_image: 'Image is invalid or exceeds the size limit.',
    preparation_limit:
      'File exceeds 10 pages, 4 megapixels per image, or the 10 MiB request limit.',
    preparation_unavailable:
      'This file cannot be prepared in this browser. Enter details manually.',
    unsupported_file: 'Choose a PDF, JPG or PNG within the upload limit.',
    incomplete_pages: 'Some pages could not be read. No incomplete result was applied.',
    invalid_result: 'The provider returned an invalid result.',
    extraction_conflict:
      'Account, form, settings or catalog changed. Review the form before retrying.',
    busy: 'Another extraction is running. Try again shortly.',
    network_error: 'Connection failed. Enter details manually or retry.',
    unauthenticated: 'Sign in again.',
    forbidden: 'Administrator access is required.',
    origin_forbidden: 'This request origin is not allowed.',
    invalid_request: 'The extraction request is invalid.',
    request_too_large: 'The encoded request exceeds 10 MiB.',
    unsupported_encoding: 'Compressed extraction requests are not supported.',
    invalid_settings: 'The settings were not saved because the extraction selection is not valid.',
    invalid_provider: 'The provider is not known.',
    catalog_unavailable:
      'The list of approved models is unavailable. The saved selection is kept, but its live availability is unverified.',
    status_unavailable: 'The status of the extraction could not be read.',
    invalid_response: 'The answer of the server could not be read.',
    internal_error: 'The extraction failed on the server. Try again.',
  },
  providers: {
    groq: 'Groq',
    openrouter: 'OpenRouter',
  },
  catalog: {
    offlineNotice:
      'These models are locally approved. Their live availability is unverified until the server checks them when the extraction is enabled.',
    noCandidates: 'No locally approved model is available for this provider.',
    savedSelection: 'Saved selection',
    savedSelectionUnavailable:
      'The saved model is not part of the current approved list. It is kept for display only and cannot be enabled.',
    searchPlaceholder: 'Search models…',
    noResults: 'No model matches the search.',
    statusApproved: 'Approved',
    statusApprovable: 'Needs approval',
    statusUnavailable: 'Not eligible',
    imagesAllowed: '{{count}} image(s) per request',
    copyApproval: 'Copy approval record',
    copied: 'Approval record copied.',
    copyFailed: 'Copying failed. Copy the approval record manually.',
  },
};
