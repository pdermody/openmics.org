import sharp from 'sharp';

// The pure half of the rendition pipeline, split from the SQS/S3 wiring in index.ts so
// unit tests can run it without AWS. Variant name → target size of the SHORT side in
// pixels (decisions.md → "Media quotas": thumb 400, grid 800, lightbox 2048). All
// renditions are written as webp regardless of source format; sources are never upscaled.
export const RENDITION_VARIANTS = [
  { name: 'thumb', shortSide: 400 },
  { name: 'grid', shortSide: 800 },
  { name: 'lightbox', shortSide: 2048 },
] as const;

export type RenderedRendition = {
  name: string;
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: 'image/webp';
  sizeBytes: number;
};

export async function renderRenditions(sourceBytes: Buffer): Promise<{ width: number; height: number; renditions: RenderedRendition[] }> {
  const metadata = await sharp(sourceBytes, { failOn: 'error' }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions');
  }
  const { width: sourceWidth, height: sourceHeight } = metadata;

  const renditions: RenderedRendition[] = [];
  for (const variant of RENDITION_VARIANTS) {
    // Short side pinned to the variant size; never upscale small sources.
    const resize = sourceWidth <= sourceHeight
      ? { width: Math.min(variant.shortSide, sourceWidth) }
      : { height: Math.min(variant.shortSide, sourceHeight) };
    const rendered = await sharp(sourceBytes).resize(resize).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    renditions.push({
      name: variant.name,
      buffer: rendered.data,
      width: rendered.info.width,
      height: rendered.info.height,
      mimeType: 'image/webp',
      sizeBytes: rendered.info.size,
    });
  }
  return { width: sourceWidth, height: sourceHeight, renditions };
}
