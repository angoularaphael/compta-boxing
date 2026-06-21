/**
 * Extrait la plus grande image JPEG embarquée dans un PDF scanné (ex. CamScanner).
 */
export function extractEmbeddedJpegFromPdf(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const images = [];
  let start = 0;

  while (start < buf.length - 3) {
    const idx = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), start);
    if (idx === -1) break;
    const end = buf.indexOf(Buffer.from([0xff, 0xd9]), idx + 3);
    if (end === -1) break;
    const slice = buf.subarray(idx, end + 2);
    if (slice.length >= 8000) images.push(slice);
    start = end + 2;
  }

  if (!images.length) return null;
  images.sort((a, b) => b.length - a.length);
  return images[0];
}
