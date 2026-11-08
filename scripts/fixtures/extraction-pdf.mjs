import sharp from 'sharp';
/**
 * Synthetic PDF and image generator for AI document extraction tests.
 *
 * Produces byte-accurate minimal PDF/1.4 binaries with correct xref tables,
 * valid page trees, text content streams, and embedded image XObjects,
 * as well as byte-accurate synthetic PNG and JPEG buffers.
 *
 * Excludes any real document data, external binary dependencies, or CDNs.
 */

import zlib from 'node:zlib';

/**
 * @typedef {Object} SyntheticPageSpec
 * @property {string} [text] - Text to render on this page.
 * @property {boolean} [blank] - If true, emits an empty content stream.
 */

/**
 * @typedef {Object} SyntheticPdfOptions
 * @property {boolean} [largeImage=false] - If true, embeds an oversized Image XObject (>4 MP) with valid deflated pixels.
 * @property {boolean} [validImage=false] - If true, embeds a valid bounded Image XObject (64x64) with valid deflated pixels.
 * @property {boolean} [malformedImage=false] - If true, embeds an image XObject with corrupted/invalid stream bytes.
 * @property {boolean} [encrypted=false] - If true, includes an /Encrypt dictionary in trailer.
 * @property {boolean} [broken=false] - If true, produces malformed/corrupted PDF bytes.
 * @property {boolean} [blank=false] - If true, emits empty content stream.
 * @property {boolean} [conflictingText=false] - If true, emits conflicting text.
 */

/**
 * Generates an in-memory synthetic PDF buffer.
 *
 * @param {number | Array<SyntheticPageSpec | string>} pages - Page count or page descriptors.
 * @param {SyntheticPdfOptions} [options={}]
 * @returns {Buffer}
 */
export function syntheticPdf(
  pages,
  {
    largeImage = false,
    validImage = false,
    malformedImage = false,
    encrypted = false,
    broken = false,
    blank = false,
    conflictingText = false,
  } = {}
) {
  if (broken) {
    return Buffer.from(
      '%PDF-1.4\n%malformed-synthetic-pdf\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' +
      'xref\n0 2\n0000000000 65535 f \n0000000015 00000 n \n' +
      'trailer\n<< /Size 2 /Root 99 0 R >>\nstartxref\n999999\n%%EOF\n',
      'binary'
    );
  }

  /** @type {Array<SyntheticPageSpec>} */
  const pageSpecs = typeof pages === 'number'
    ? Array.from({ length: pages }, (_, i) => ({
        text: conflictingText
          ? `Conflicting Document Text Variant ${i + 1} document_number: ${100000 + i}`
          : `Synthetic Document Page ${i + 1} of ${pages}`,
        blank: Boolean(blank),
      }))
    : pages.map((spec, i) => {
        if (typeof spec === 'string') {
          return { text: spec, blank: false };
        }
        return {
          text: spec.text ?? `Synthetic Document Page ${i + 1} of ${pages.length}`,
          blank: Boolean(spec.blank),
        };
      });

  const pageCount = pageSpecs.length;

  const chunks = [];
  const offsets = [];
  let currentOffset = 0;

  function write(chunk) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'binary') : chunk;
    chunks.push(buf);
    currentOffset += buf.length;
  }

  // Header: %PDF-1.4 plus binary comment line to ensure 8-bit clean transport
  write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');

  // Object IDs allocation
  // 1: Catalog
  // 2: Pages tree
  // 3: Font (Helvetica)
  let nextId = 4;

  const hasImage = largeImage || validImage || malformedImage;
  let imageObjId = null;
  if (hasImage) {
    imageObjId = nextId++;
  }

  let encryptObjId = null;
  if (encrypted) {
    encryptObjId = nextId++;
  }

  const pageEntries = [];
  for (let i = 0; i < pageCount; i++) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageEntries.push({ pageObjId, contentObjId, spec: pageSpecs[i], index: i + 1 });
  }

  const totalObjs = nextId - 1;

  // Obj 1: Catalog
  offsets[1] = currentOffset;
  write(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  // Obj 2: Pages root
  offsets[2] = currentOffset;
  const kidsStr = pageEntries.map(p => `${p.pageObjId} 0 R`).join(' ');
  write(`2 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageCount} >>\nendobj\n`);

  // Obj 3: Font
  offsets[3] = currentOffset;
  write(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);

  // Embedded Image XObject
  if (hasImage && imageObjId) {
    offsets[imageObjId] = currentOffset;

    if (largeImage) {
      // Oversized image: 2500 x 2000 = 5,000,000 pixels (>4,000,000 pixel limit).
      // DeviceGray (1 byte per pixel), deflated into valid compressed stream bytes.
      const rawPixels = Buffer.alloc(2500 * 2000, 128);
      const deflated = zlib.deflateSync(rawPixels);
      write(
        `${imageObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width 2500 /Height 2000 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${deflated.length} >>\n` +
        `stream\n`
      );
      write(deflated);
      write(`\nendstream\nendobj\n`);
    } else if (validImage) {
      // Positive boundary image: 64 x 64 = 4,096 pixels (<=4,000,000 limit).
      // DeviceRGB (3 bytes per pixel), valid deflated stream.
      const rawPixels = Buffer.alloc(64 * 64 * 3, 200);
      const deflated = zlib.deflateSync(rawPixels);
      write(
        `${imageObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${deflated.length} >>\n` +
        `stream\n`
      );
      write(deflated);
      write(`\nendstream\nendobj\n`);
    } else if (malformedImage) {
      // Deliberately malformed image stream for negative tests
      const corruptData = Buffer.from('NOT_VALID_DEFLATE_OR_IMAGE_BYTES');
      write(
        `${imageObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width 100 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${corruptData.length} >>\n` +
        `stream\n`
      );
      write(corruptData);
      write(`\nendstream\nendobj\n`);
    }
  }

  // Optional Encrypt Object
  if (encrypted && encryptObjId) {
    offsets[encryptObjId] = currentOffset;
    write(
      `${encryptObjId} 0 obj\n` +
      `<< /Filter /Standard /V 2 /R 3 ` +
      `/O <0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef> ` +
      `/U <0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef> ` +
      `/P -4 /Length 128 >>\nendobj\n`
    );
  }

  // Page and Content objects
  for (const entry of pageEntries) {
    // Page Object
    offsets[entry.pageObjId] = currentOffset;

    let resourceDict = `<< /Font << /F1 3 0 R >>`;
    if (hasImage && imageObjId) {
      resourceDict += ` /XObject << /Im1 ${imageObjId} 0 R >>`;
    }
    resourceDict += ` >>`;

    write(
      `${entry.pageObjId} 0 obj\n` +
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${entry.contentObjId} 0 R /Resources ${resourceDict} >>\n` +
      `endobj\n`
    );

    // Contents Stream Object
    offsets[entry.contentObjId] = currentOffset;
    let streamBody = '';
    if (!entry.spec.blank) {
      const sanitizedText = (entry.spec.text || `Page ${entry.index}`)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
      streamBody = `BT\n/F1 12 Tf\n72 720 Td\n(${sanitizedText}) Tj\nET\n`;
      if (hasImage && imageObjId) {
        streamBody += `q 100 0 0 100 72 600 cm /Im1 Do Q\n`;
      }
    }

    const streamLen = Buffer.byteLength(streamBody, 'binary');
    write(
      `${entry.contentObjId} 0 obj\n` +
      `<< /Length ${streamLen} >>\n` +
      `stream\n${streamBody}\nendstream\nendobj\n`
    );
  }

  // Byte-accurate xref table
  const xrefOffset = currentOffset;
  write(`xref\n0 ${totalObjs + 1}\n`);
  write('0000000000 65535 f \n');
  for (let id = 1; id <= totalObjs; id++) {
    const padOffset = String(offsets[id]).padStart(10, '0');
    write(`${padOffset} 00000 n \n`);
  }

  // Trailer
  let trailerDict = `<< /Size ${totalObjs + 1} /Root 1 0 R`;
  if (encrypted && encryptObjId) {
    trailerDict += ` /Encrypt ${encryptObjId} 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>]`;
  }
  trailerDict += ` >>`;

  write(`trailer\n${trailerDict}\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Generates an in-memory synthetic PNG buffer with customizable dimensions and header.
 *
 * @param {Object} [options]
 * @param {number} [options.width=64]
 * @param {number} [options.height=64]
 * @param {boolean} [options.corrupted=false]
 * @returns {Buffer}
 */
export function syntheticPng({ width = 64, height = 64, corrupted = false } = {}) {
  if (corrupted) {
    return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per sample
  ihdrData[9] = 2; // Color type 2 (RGB)
  ihdrData[10] = 0; // Deflate compression
  ihdrData[11] = 0; // Filter method 0
  ihdrData[12] = 0; // No interlace

  const ihdrChunk = Buffer.concat([Buffer.from('IHDR'), ihdrData]);
  const ihdrCrc = Buffer.alloc(4);
  ihdrCrc.writeUInt32BE(crc32(ihdrChunk), 0);
  const ihdr = Buffer.concat([Buffer.from([0, 0, 0, 13]), ihdrChunk, ihdrCrc]);

  // height scanlines of (1 filter byte + width * 3 RGB bytes)
  const rawScanlines = Buffer.alloc(height * (1 + width * 3), 0);
  const idatData = zlib.deflateSync(rawScanlines);
  const idatChunk = Buffer.concat([Buffer.from('IDAT'), idatData]);
  const idatCrc = Buffer.alloc(4);
  idatCrc.writeUInt32BE(crc32(idatChunk), 0);
  const idatLen = Buffer.alloc(4);
  idatLen.writeUInt32BE(idatData.length, 0);
  const idat = Buffer.concat([idatLen, idatChunk, idatCrc]);

  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([sig, ihdr, idat, iend]);
}

/** Generates real synthetic JPEG bytes; oversized cases retain valid headers and pixels; supports EXIF orientation. */
export async function syntheticJpeg({ width = 64, height = 64, corrupted = false, orientation = undefined } = {}) {
  if (corrupted) return Buffer.from([0xff, 0xd8, 0, 0, 0]);
  let pipeline = sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } });
  if (orientation !== undefined) {
    pipeline = pipeline.withMetadata({ orientation });
  }
  return pipeline.jpeg().toBuffer();
}
