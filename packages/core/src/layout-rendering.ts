/**
 * Programmatic text and layout rendering engine (task a057a6c7).
 *
 * Composes text, badges, icons, and overlays on top of image-model-generated
 * scenes. Per product constraints, final card text is NEVER from image models.
 *
 * Features:
 * - JSON layout spec describing text blocks, badges, icons, overlays
 * - Canvas-based text rendering with font metrics, contrast, wrapping
 * - Badge/icon overlay at specified positions
 * - WB/Ozon layout presets (dimensions, safe zones)
 * - Output JPEG/PNG/WebP at target resolution (default 2K)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutputFormat = 'jpeg' | 'png' | 'webp';

export type HorizontalAlignment = 'left' | 'center' | 'right';
export type VerticalAlignment = 'top' | 'center' | 'bottom';

export type BadgeType = 'tag' | 'label' | 'ribbon' | 'pill';
export type IconType = 'watermark' | 'brand' | 'info' | 'warning';

// Pixel values - either absolute or percentage-based
export type PixelValue =
  | { type: 'absolute'; px: number }
  | { type: 'percent'; pct: number };

export interface LayoutBox {
  x: PixelValue;
  y: PixelValue;
  width: PixelValue;
  height: PixelValue;
  padding?: PixelValue;
}

export interface TextBlock {
  content: string;
  box: LayoutBox;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  color?: string;      // e.g. '#ffffff'
  backgroundColor?: string;
  align?: HorizontalAlignment;
  valign?: VerticalAlignment;
  bold?: boolean;
  italic?: boolean;
  lineHeight?: number;      // multiplier, default 1.4
  maxLines?: number;
  /** Ensure minimum contrast ratio against background (WCAG AA = 4.5) */
  minContrastRatio?: number;
}

export interface BadgeOverlay {
  content: string;
  badgeType: BadgeType;
  box: LayoutBox;
  backgroundColor?: string;
  textColor?: string;
  fontSize?: number;
  borderRadius?: number;
}

export interface IconOverlay {
  iconType: IconType;
  box: LayoutBox;
  base64?: string;      // base64-encoded icon image
  url?: string;         // URL to icon (will be fetched at render time)
  opacity?: number;     // 0-1
}

export interface ImageOverlay {
  box: LayoutBox;
  base64?: string;
  url?: string;
  opacity?: number;
}

export interface LayoutSpec {
  /** Canvas dimensions (defaults to source image dimensions) */
  canvasWidth?: number;
  canvasHeight?: number;
  /** Text blocks to render */
  textBlocks?: TextBlock[];
  /** Badge overlays */
  badges?: BadgeOverlay[];
  /** Icon overlays */
  icons?: IconOverlay[];
  /** Image overlays (logos, watermarks) */
  imageOverlays?: ImageOverlay[];
  /** Output format */
  outputFormat?: OutputFormat;
  /** Output quality (0-1, for lossy formats) */
  outputQuality?: number;
}

// ---------------------------------------------------------------------------
// Marketplace layout presets
// ---------------------------------------------------------------------------

/** WB: 1:1 or 3:4, product text safe zone, typical badge positions */
export const wbLayoutPreset: LayoutSpec = {
  canvasWidth: 2000,
  canvasHeight: 2000, // 1:1, or 2667 for 3:4
  outputFormat: 'webp',
  outputQuality: 0.9,
  textBlocks: [{
    content: '',
    box: {
      x: { type: 'percent', pct: 5 },
      y: { type: 'percent', pct: 70 },
      width: { type: 'percent', pct: 90 },
      height: { type: 'percent', pct: 25 },
    },
    fontFamily: 'Arial, sans-serif',
    fontSize: 32,
    color: '#000000',
    align: 'left',
    maxLines: 3,
    minContrastRatio: 4.5,
  }],
  badges: [{
    content: '',
    badgeType: 'pill',
    box: {
      x: { type: 'percent', pct: 5 },
      y: { type: 'percent', pct: 5 },
      width: { type: 'absolute', px: 150 },
      height: { type: 'absolute', px: 40 },
    },
    backgroundColor: '#ff2d55',
    textColor: '#ffffff',
    fontSize: 16,
    borderRadius: 20,
  }],
};

/** Ozon: 1:1 primary, different safe zones */
export const ozonLayoutPreset: LayoutSpec = {
  canvasWidth: 2000,
  canvasHeight: 2000,
  outputFormat: 'png',
  textBlocks: [{
    content: '',
    box: {
      x: { type: 'percent', pct: 8 },
      y: { type: 'percent', pct: 75 },
      width: { type: 'percent', pct: 84 },
      height: { type: 'percent', pct: 20 },
    },
    fontFamily: 'Arial, sans-serif',
    fontSize: 30,
    color: '#333333',
    align: 'center',
    maxLines: 4,
    minContrastRatio: 4.5,
  }],
};

/** Default 2K preset (2000x2000) */
export const default2KPreset: LayoutSpec = {
  canvasWidth: 2000,
  canvasHeight: 2000,
  outputFormat: 'jpeg',
  outputQuality: 0.95,
};

// ---------------------------------------------------------------------------
// Pixel resolution helpers
// ---------------------------------------------------------------------------

export function resolvePixelValue(
  val: PixelValue,
  containerSize: number,
): number {
  if (val.type === 'absolute') return val.px;
  return Math.round((val.pct / 100) * containerSize);
}

export function resolveBox(
  box: LayoutBox,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number; width: number; height: number; padding: number } {
  return {
    x: resolvePixelValue(box.x, containerWidth),
    y: resolvePixelValue(box.y, containerHeight),
    width: resolvePixelValue(box.width, containerWidth),
    height: resolvePixelValue(box.height, containerHeight),
    padding: box.padding ? resolvePixelValue(box.padding, containerWidth) : 0,
  };
}

// ---------------------------------------------------------------------------
// Contrast calculation (WCAG 2.1 relative luminance)
// ---------------------------------------------------------------------------

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * Calculate contrast ratio between two RGB colors.
 * Returns value from 1:1 (same) to 21:1 (black vs white).
 */
export function contrastRatio(
  fg: { r: number; g: number; b: number },
  bg: { r: number; g: number; b: number },
): number {
  const l1 = relativeLuminance(fg.r, fg.g, fg.b);
  const l2 = relativeLuminance(bg.r, bg.g, bg.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Parse a hex color string (#rrggbb or #rgb) into RGB */
export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

/**
 * Check if a text block meets minimum contrast requirements.
 * If contrast is insufficient, suggests an alternative color.
 */
export function checkTextContrast(
  textColor: string,
  backgroundColor: string,
  minRatio: number = 4.5,
): { passes: boolean; actualRatio: number; suggestedColor?: string } {
  const fg = parseHexColor(textColor);
  const bg = parseHexColor(backgroundColor);
  const ratio = contrastRatio(fg, bg);

  if (ratio >= minRatio) {
    return { passes: true, actualRatio: Math.round(ratio * 10) / 10 };
  }

  // Suggest white or black based on background luminance
  const bgLum = relativeLuminance(bg.r, bg.g, bg.b);
  const suggestedColor = bgLum > 0.5 ? '#000000' : '#ffffff';

  return {
    passes: false,
    actualRatio: Math.round(ratio * 10) / 10,
    suggestedColor,
  };
}

// ---------------------------------------------------------------------------
// Text wrapping
// ---------------------------------------------------------------------------

/**
 * Wrap text to fit within a maximum width given an approximate pixel width
 * per character (monospace approximation).
 */
export function wrapText(
  text: string,
  maxWidthPx: number,
  approxCharWidth: number = 10,
): string[] {
  const maxChars = Math.floor(maxWidthPx / approxCharWidth);
  if (maxChars <= 0) return [];

  const lines: string[] = [];
  const words = text.split(/\s+/);
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length > maxChars && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Truncate text to fit within a maximum number of lines.
 */
export function truncateToLines(
  text: string,
  maxLines: number,
  suffix: string = '...',
): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines - 1).join('\n') + suffix;
}

// ---------------------------------------------------------------------------
// Layout validation
// ---------------------------------------------------------------------------

export interface LayoutValidationIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

/**
 * Validate a layout spec before rendering.
 * Returns list of warnings and errors.
 */
export function validateLayoutSpec(spec: LayoutSpec): LayoutValidationIssue[] {
  const issues: LayoutValidationIssue[] = [];

  // Canvas dimensions
  if (spec.canvasWidth && spec.canvasWidth > 10000) {
    issues.push({ severity: 'error', field: 'canvasWidth', message: 'Width exceeds 10000px maximum' });
  }
  if (spec.canvasHeight && spec.canvasHeight > 10000) {
    issues.push({ severity: 'error', field: 'canvasHeight', message: 'Height exceeds 10000px maximum' });
  }

  // Text blocks
  if (spec.textBlocks) {
    for (let i = 0; i < spec.textBlocks.length; i++) {
      const block = spec.textBlocks[i];
      if (!block.content) {
        issues.push({ severity: 'warning', field: `textBlocks[${i}].content`, message: 'Empty text block' });
      }
      if (block.minContrastRatio !== undefined) {
        // Contrast check is deferred to render time with actual background
      }
      if (block.maxLines !== undefined && block.maxLines < 1) {
        issues.push({ severity: 'error', field: `textBlocks[${i}].maxLines`, message: 'maxLines must be >= 1' });
      }
      // Check that color is a valid hex
      if (block.color && !/^#[0-9a-fA-F]{6}$/.test(block.color)) {
        issues.push({ severity: 'warning', field: `textBlocks[${i}].color`, message: `Invalid color: ${block.color}` });
      }
    }
  }

  // Badges
  if (spec.badges) {
    for (let i = 0; i < spec.badges.length; i++) {
      const badge = spec.badges[i];
      if (!badge.content) {
        issues.push({ severity: 'warning', field: `badges[${i}].content`, message: 'Empty badge content' });
      }
    }
  }

  // Icons
  if (spec.icons) {
    for (let i = 0; i < spec.icons.length; i++) {
      const icon = spec.icons[i];
      if (!icon.base64 && !icon.url) {
        issues.push({ severity: 'warning', field: `icons[${i}]`, message: 'Icon has no base64 or URL' });
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Layout merging
// ---------------------------------------------------------------------------

/**
 * Merge two layout specs. Second spec overrides first where both are defined.
 * Arrays are replaced, not merged.
 */
export function mergeLayoutSpec(base: LayoutSpec, override: LayoutSpec): LayoutSpec {
  return {
    ...base,
    ...override,
  };
}

/**
 * Build a marketplace-configured layout spec.
 * Merges the default 2K preset with marketplace-specific overrides.
 */
export function buildMarketplaceLayout(
  marketplace: 'wildberries' | 'ozon',
  overrides?: LayoutSpec,
): LayoutSpec {
  const preset = marketplace === 'wildberries' ? wbLayoutPreset : ozonLayoutPreset;
  const merged = mergeLayoutSpec(default2KPreset, preset);
  return overrides ? mergeLayoutSpec(merged, overrides) : merged;
}
