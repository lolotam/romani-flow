import sharp from 'sharp';
import { crc32 } from 'node:zlib';

/**
 * Synthetic image fixtures generated with native Sharp and standard PNG specs.
 *
 * All image bytes are purely synthetic (1x1 pixels, 4MP boundaries, or crafted IHDR headers).
 * No private documents, company assets, or external image data are used.
 */

// 1. Valid 1x1 PNG and JPEG
export const VALID_PNG_BYTES = await sharp({
  create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
})
  .png()
  .toBuffer();
export const VALID_PNG_BASE64 = VALID_PNG_BYTES.toString('base64');

export const VALID_JPEG_BYTES = await sharp({
  create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 255, b: 0 } },
})
  .jpeg()
  .toBuffer();
export const VALID_JPEG_BASE64 = VALID_JPEG_BYTES.toString('base64');

// 2. Exact 4,000,000 pixel PNG (2000 x 2000) - Positive boundary control
export const EXACT_4MP_PNG_BYTES = await sharp({
  create: { width: 2000, height: 2000, channels: 3, background: { r: 0, g: 0, b: 0 } },
})
  .png({ compressionLevel: 9 })
  .toBuffer();
export const EXACT_4MP_PNG_BASE64 = EXACT_4MP_PNG_BYTES.toString('base64');

// 3. Helper to forge PNG IHDR with recalculated, valid CRC32
export function makeHeaderPng(width, height) {
  const buf = Buffer.from(VALID_PNG_BYTES);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  // IHDR chunk: 4 bytes type ('IHDR') at 12..15 + 13 bytes data at 16..28 = 17 bytes
  const crc = crc32(buf.subarray(12, 29));
  buf.writeUInt32BE(crc, 29);
  return buf;
}

// Oversized pixels with valid CRC: 3000 x 2000 = 6,000,000 pixels > 4,000,000 limit
export const OVERSIZED_PIXELS_PNG_BYTES = makeHeaderPng(3000, 2000);
export const OVERSIZED_PIXELS_PNG_BASE64 = OVERSIZED_PIXELS_PNG_BYTES.toString('base64');

// Oversized dimension with valid CRC: width 9000 > 8192 limit
export const OVERSIZED_DIMENSION_PNG_BYTES = makeHeaderPng(9000, 1);
export const OVERSIZED_DIMENSION_PNG_BASE64 = OVERSIZED_DIMENSION_PNG_BYTES.toString('base64');

// Zero dimension with valid CRC: width 0
export const ZERO_DIMENSION_PNG_BYTES = makeHeaderPng(0, 1);
export const ZERO_DIMENSION_PNG_BASE64 = ZERO_DIMENSION_PNG_BYTES.toString('base64');

// Corrupt CRC variant (for verifying CRC validation failure vs dimension failure)
const corruptCrcBuf = Buffer.from(VALID_PNG_BYTES);
corruptCrcBuf[29] ^= 0xff;
export const CORRUPT_CRC_PNG_BYTES = corruptCrcBuf;
export const CORRUPT_CRC_PNG_BASE64 = CORRUPT_CRC_PNG_BYTES.toString('base64');

// 4. Truncated variants (first bytes only, corrupting structure)
export const TRUNCATED_PNG_BYTES = VALID_PNG_BYTES.subarray(0, 12);
export const TRUNCATED_PNG_BASE64 = TRUNCATED_PNG_BYTES.toString('base64');

export const TRUNCATED_JPEG_BYTES = VALID_JPEG_BYTES.subarray(0, 8);
export const TRUNCATED_JPEG_BASE64 = TRUNCATED_JPEG_BYTES.toString('base64');

// 5. Non-canonical base64 (contains spaces or non-canonical padding that doesn't round-trip)
export const NON_CANONICAL_BASE64 = VALID_PNG_BASE64 + '  ';

// 6. Non-image bytes (plain text file)
export const TEXT_FILE_BYTES = Buffer.from('This is a plain text file, not an image format.');
export const TEXT_FILE_BASE64 = TEXT_FILE_BYTES.toString('base64');

// 7. Unsupported / animated image formats
export const WEBP_IMAGE_BYTES = await sharp({
  create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 255 } },
})
  .webp()
  .toBuffer();
export const WEBP_IMAGE_BASE64 = WEBP_IMAGE_BYTES.toString('base64');

export const ANIMATED_GIF_BYTES = await sharp({
  create: { width: 1, height: 1, channels: 3, background: { r: 128, g: 128, b: 128 } },
})
  .gif()
  .toBuffer();
export const ANIMATED_GIF_BASE64 = ANIMATED_GIF_BYTES.toString('base64');

// ---------------------------------------------------------------------------
// Synthetic Raw Pages & Batches
// ---------------------------------------------------------------------------
export function makeRawPage(pageNumber, overrides = {}) {
  return {
    page: pageNumber,
    title: { value: 'Civil ID Card', certainty: 'clear' },
    document_number: { value: '290010112345', certainty: 'clear' },
    document_type_label: { value: 'Civil ID', certainty: 'clear' },
    ministry_label: { value: 'Ministry of Interior', certainty: 'clear' },
    issue_date: { value: '2024-01-15', certainty: 'clear', source: '2024-01-15', calendar: 'gregorian' },
    expiry_date: { value: '2026-01-15', certainty: 'clear', source: '2026-01-15', calendar: 'gregorian' },
    ...overrides,
  };
}

export function makeRawPages(count) {
  return Array.from({ length: count }, (_, i) => makeRawPage(i + 1));
}

// ---------------------------------------------------------------------------
// Model, Endpoint, ZDR, BYOK & Approval Mock Records
// ---------------------------------------------------------------------------
export const MOCK_MODEL_ID = 'meta-llama/llama-3.2-11b-vision-instruct:free';
export const MOCK_ENDPOINT_TAG = 'openrouter/free-node';
export const MOCK_GROQ_MODEL_ID = 'qwen/qwen3.8-27b';
export const MOCK_GROQ_ENDPOINT = 'api.groq.com/openai/v1';
export const VALID_POLICY_VERSION = '2026-11-07-v1';

export function makeMockModel(overrides = {}) {
  return {
    id: MOCK_MODEL_ID,
    name: 'Llama 3.2 11B Vision Instruct (free)',
    architecture: {
      modality: 'text+image->text',
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
    },
    pricing: {
      prompt: '0',
      completion: '0',
      image: '0',
      request: '0',
    },
    context_length: 128000,
    supported_parameters: ['max_tokens', 'response_format'],
    ...overrides,
  };
}

export function makeMockEndpoint(overrides = {}) {
  return {
    id: 'ep-llama-32-free',
    model: MOCK_MODEL_ID,
    tag: MOCK_ENDPOINT_TAG,
    status: 0,
    pricing: {
      prompt: '0',
      completion: '0',
      image: '0',
      request: '0',
    },
    ...overrides,
  };
}

export function makeMockZdr(overrides = {}) {
  return {
    model: MOCK_MODEL_ID,
    tag: MOCK_ENDPOINT_TAG,
    safety_retention: false,
    ...overrides,
  };
}

export function makeMockByok(overrides = {}) {
  return {
    data: [],
    total_count: 0,
    ...overrides,
  };
}

export function makeMockApproval(overrides = {}) {
  return {
    provider: 'openrouter',
    model: MOCK_MODEL_ID,
    endpoint: MOCK_ENDPOINT_TAG,
    maxImages: 1,
    expiresAt: '2026-12-31T23:59:59.000Z',
    policyVersion: VALID_POLICY_VERSION,
    ...overrides,
  };
}

export function makeMockGroqApproval(overrides = {}) {
  return {
    provider: 'groq',
    model: MOCK_GROQ_MODEL_ID,
    endpoint: MOCK_GROQ_ENDPOINT,
    maxImages: 3,
    expiresAt: '2026-12-31T23:59:59.000Z',
    policyVersion: VALID_POLICY_VERSION,
    ...overrides,
  };
}

export function makeMockGroqModels(overrides = {}) {
  return {
    data: [{ id: MOCK_GROQ_MODEL_ID, object: 'model', owned_by: 'groq' }],
    ...overrides,
  };
}

export function makeMockChatResponse(pages, model = MOCK_MODEL_ID) {
  return {
    id: 'chatcmpl-mock-id',
    model,
    choices: [
      {
        message: { content: JSON.stringify({ pages }) },
        finish_reason: 'stop',
      },
    ],
  };
}
