import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { renderRenditions, RENDITION_VARIANTS } from './renditions';

// The rendition pipeline's pure half (apps/api has the SQS/S3 wiring covered by contract).
// Fixtures are generated in-test with sharp itself — no binary fixtures in the repo.
describe('renderRenditions', () => {
  it('renders thumb/grid/lightbox webp variants with pinned short sides', async () => {
    // 4200×2100 landscape fixture — large enough that even the 2048px variant fits.
    const source = await sharp({ create: { width: 4200, height: 2100, channels: 3, background: { r: 180, g: 60, b: 40 } } })
      .jpeg()
      .toBuffer();
    const result = await renderRenditions(source);

    expect(result.width).toBe(4200);
    expect(result.height).toBe(2100);
    expect(result.renditions.map((variant) => variant.name)).toEqual(RENDITION_VARIANTS.map((variant) => variant.name));

    for (const variant of result.renditions) {
      expect(variant.mimeType).toBe('image/webp');
      expect(Math.min(variant.width, variant.height)).toBe(RENDITION_VARIANTS.find((v) => v.name === variant.name)!.shortSide);
      // Aspect ratio preserved.
      expect(variant.width / variant.height).toBeCloseTo(2, 1);
      expect(variant.sizeBytes).toBe(variant.buffer.length);
      const renderedMeta = await sharp(variant.buffer).metadata();
      expect(renderedMeta.format).toBe('webp');
    }
  });

  it('never upscales a small source', async () => {
    const tiny = await sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 20, g: 120, b: 90 } } })
      .png()
      .toBuffer();
    const result = await renderRenditions(tiny);
    for (const variant of result.renditions) {
      expect(variant.width).toBeLessThanOrEqual(100);
      expect(variant.height).toBeLessThanOrEqual(50);
    }
  });

  it('pins portrait short side to the width', async () => {
    const portrait = await sharp({ create: { width: 900, height: 1600, channels: 3, background: { r: 10, g: 20, b: 200 } } })
      .jpeg()
      .toBuffer();
    const result = await renderRenditions(portrait);
    const thumb = result.renditions.find((variant) => variant.name === 'thumb')!;
    expect(thumb.width).toBe(400);
    expect(thumb.height).toBe(Math.round(400 * (1600 / 900)));
  });
});
