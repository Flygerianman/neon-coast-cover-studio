// cover.js — the cover-drawing engine of Neon Coast Cover Studio.
//
// A cover is drawn on a 2D canvas: panels of photos (each cropped, panned
// and zoomed, then colour-graded), a title block with halftone dots and
// bold Anton lettering, a Pacifico subtitle, grain, a vignette and a
// "NEON COAST" badge ribbon. The same renderCover runs for the on-screen
// preview and for an export at full pixel size.

import { gradeById, applyGradeToImageData } from './grades.js';

/** The export sizes, in pixels. */
export const SIZES = [
  { id: 'square', name: 'Square', label: '1080 × 1080', width: 1080, height: 1080 },
  { id: 'portrait', name: 'Portrait', label: '1080 × 1350', width: 1080, height: 1350 },
  { id: 'landscape', name: 'Landscape', label: '1920 × 1080', width: 1920, height: 1080 },
];

/** The layouts a cover can take. */
export const LAYOUTS = [
  { id: 'hero-three', name: 'Hero & Three', panels: 4 },
  { id: 'four-grid', name: 'Four-Panel Grid', panels: 4 },
  { id: 'full-bleed', name: 'Full-Bleed', panels: 1 },
  { id: 'tilted', name: 'Tilted Snapshots', panels: 3 },
  { id: 'nine-grid', name: 'Nine-Panel Grid', panels: 9 },
];

/** The title colours the caption can wear. */
export const TITLE_COLOURS = [
  { id: 'white', name: 'White', value: '#ffffff' },
  { id: 'yellow', name: 'Yellow', value: '#ffd60a' },
  { id: 'pink', name: 'Pink', value: '#ff5da2' },
  { id: 'cyan', name: 'Cyan', value: '#22d3ee' },
];

/** The subtitle accent colour. */
export const ACCENT = '#ff5da2';

export function sizeById(id) {
  return SIZES.find((s) => s.id === id) || SIZES[0];
}

export function layoutById(id) {
  return LAYOUTS.find((l) => l.id === id) || LAYOUTS[0];
}

export function titleColourById(id) {
  return TITLE_COLOURS.find((c) => c.id === id) || TITLE_COLOURS[0];
}

/** A fresh, empty panel: photo index, pan as a fraction of panel size, zoom. */
export function blankPanel() {
  return { photo: 0, panX: 0, panY: 0, zoom: 1 };
}

/** A fresh state: hero layout, sunset grade, the default caption, no photos yet. */
export function makeDefaultState() {
  return {
    layoutId: 'hero-three',
    gradeId: 'sunset',
    title: 'VICE CITY',
    subtitle: 'Neon Coast',
    titleColourId: 'white',
    sizeId: 'square',
    photos: [],
    panels: [blankPanel(), blankPanel(), blankPanel(), blankPanel()],
  };
}

/**
 * Resize a state's panels to a layout, keeping each panel's photo, pan and
 * zoom where a panel survives and filling new panels with the first photo.
 */
export function panelsForLayout(state, layoutId) {
  const count = layoutById(layoutId).panels;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(state.panels[i] ? { ...state.panels[i] } : blankPanel());
  }
  return out;
}

// ---------------------------------------------------------------- geometry

/** The title block's height, as a share of the cover height. */
const TITLE_SHARE = 0.16;

/**
 * A layout's panel rectangles in the region above the title block.
 * Each rect: {x, y, w, h, rot} in pixels, rot in degrees.
 */
export function layoutPanels(layoutId, W, H, titleH) {
  const PH = H - titleH; // the panels region height
  const g = Math.max(2, Math.round(W * 0.008)); // gutter between panels
  const third = W / 3;
  const half = W / 2;
  switch (layoutId) {
    case 'hero-three': {
      const heroH = PH * 0.6;
      return [
        { x: 0, y: 0, w: W, h: heroH - g / 2, rot: 0 },
        { x: 0, y: heroH + g / 2, w: third - g / 2, h: PH - heroH - g / 2, rot: 0 },
        { x: third + g / 2, y: heroH + g / 2, w: third - g, h: PH - heroH - g / 2, rot: 0 },
        { x: 2 * third + g / 2, y: heroH + g / 2, w: third - g / 2, h: PH - heroH - g / 2, rot: 0 },
      ];
    }
    case 'four-grid': {
      return [
        { x: 0, y: 0, w: half - g / 2, h: PH / 2 - g / 2, rot: 0 },
        { x: half + g / 2, y: 0, w: half - g / 2, h: PH / 2 - g / 2, rot: 0 },
        { x: 0, y: PH / 2 + g / 2, w: half - g / 2, h: PH / 2 - g / 2, rot: 0 },
        { x: half + g / 2, y: PH / 2 + g / 2, w: half - g / 2, h: PH / 2 - g / 2, rot: 0 },
      ];
    }
    case 'full-bleed':
      return [{ x: 0, y: 0, w: W, h: PH, rot: 0 }];
    case 'tilted': {
      return [
        { x: W * 0.03, y: PH * 0.04, w: W * 0.56, h: PH * 0.56, rot: -5 },
        { x: W * 0.42, y: PH * 0.1, w: W * 0.56, h: PH * 0.56, rot: 4 },
        { x: W * 0.2, y: PH * 0.44, w: W * 0.58, h: PH * 0.5, rot: -2 },
      ];
    }
    case 'nine-grid': {
      const out = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          out.push({
            x: c * third + (c === 0 ? 0 : g / 2),
            y: (r * PH) / 3 + (r === 0 ? 0 : g / 2),
            w: third - (c === 2 ? g / 2 : g),
            h: PH / 3 - (r === 2 ? g / 2 : g),
            rot: 0,
          });
        }
      }
      return out;
    }
    default:
      return layoutPanels('hero-three', W, H, titleH);
  }
}

// ---------------------------------------------------------------- grading

const gradedCache = new WeakMap();

/**
 * A photo graded once per grade and cached on the photo object, so the
 * preview stays fast while panning and zooming. The grade runs at the
 * photo's own size, capped on the long side for speed.
 */
function gradedImage(photo, grade) {
  const cached = gradedCache.get(photo);
  if (cached && cached.gradeId === grade.id) return cached.canvas;
  const cap = 1400;
  const scale = Math.min(1, cap / Math.max(photo.img.naturalWidth, photo.img.naturalHeight));
  const w = Math.max(1, Math.round(photo.img.naturalWidth * scale));
  const h = Math.max(1, Math.round(photo.img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(photo.img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  applyGradeToImageData(data, grade);
  ctx.putImageData(data, 0, 0);
  gradedCache.set(photo, { gradeId: grade.id, canvas });
  return canvas;
}

// ---------------------------------------------------------------- grain

let grainCanvas = null;

/** A small tile of monochrome noise, made once and reused as a pattern. */
function grainTile() {
  if (grainCanvas) return grainCanvas;
  const size = 140;
  grainCanvas = document.createElement('canvas');
  grainCanvas.width = size;
  grainCanvas.height = size;
  const ctx = grainCanvas.getContext('2d');
  const data = ctx.createImageData(size, size);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = Math.floor(Math.random() * 256);
    data.data[i] = v;
    data.data[i + 1] = v;
    data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return grainCanvas;
}

// ---------------------------------------------------------------- drawing

/** Clamp a panel's pan so the photo still covers the panel. */
export function clampPan(panel, rect, photo) {
  if (!photo) return;
  const s0 = Math.max(rect.w / photo.img.naturalWidth, rect.h / photo.img.naturalHeight);
  const s = s0 * panel.zoom;
  const dw = photo.img.naturalWidth * s;
  const dh = photo.img.naturalHeight * s;
  const maxX = Math.max(0, (dw - rect.w) / 2 / rect.w);
  const maxY = Math.max(0, (dh - rect.h) / 2 / rect.h);
  panel.panX = Math.min(maxX, Math.max(-maxX, panel.panX));
  panel.panY = Math.min(maxY, Math.max(-maxY, panel.panY));
}

/** Draw one photo into its panel, graded, cropped, panned and zoomed. */
function drawPanel(ctx, rect, panel, photo, grade) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (rect.rot) ctx.rotate((rect.rot * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  if (photo) {
    const graded = gradedImage(photo, grade);
    const iw = photo.img.naturalWidth;
    const ih = photo.img.naturalHeight;
    const s0 = Math.max(rect.w / iw, rect.h / ih);
    const s = s0 * panel.zoom;
    const dw = iw * s;
    const dh = ih * s;
    const dx = rect.x + (rect.w - dw) / 2 + panel.panX * rect.w;
    const dy = rect.y + (rect.h - dh) / 2 + panel.panY * rect.h;
    ctx.drawImage(graded, dx, dy, dw, dh);
  } else {
    // An empty panel: a dark placeholder with a thin frame.
    ctx.fillStyle = '#171226';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(1, rect.w * 0.004);
    ctx.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
  }
  ctx.restore();
  // A thin frame around the panel, following its rotation.
  ctx.save();
  ctx.translate(cx, cy);
  if (rect.rot) ctx.rotate((rect.rot * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, rect.w * 0.005);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/** Halftone dots across the title band, fading toward the text. */
function drawHalftone(ctx, W, titleY, titleH) {
  const step = Math.max(10, W * 0.014);
  const maxR = Math.max(1.5, W * 0.0035);
  ctx.save();
  for (let y = titleY + step / 2; y < titleY + titleH; y += step) {
    const row = Math.round((y - titleY) / step);
    for (let x = step / 2 + (row % 2 ? step / 2 : 0); x < W; x += step) {
      const fade = 0.5 + 0.5 * Math.sin((x / W) * Math.PI * 2 + row);
      ctx.fillStyle = `rgba(255,255,255,${(0.05 + 0.09 * fade).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, maxR * (0.5 + 0.5 * fade), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** The title block: a dark band, halftone, the Anton title and Pacifico subtitle. */
function drawTitleBlock(ctx, W, H, titleH, state) {
  const titleY = H - titleH;
  const band = ctx.createLinearGradient(0, titleY, 0, H);
  band.addColorStop(0, 'rgba(12,7,26,0.94)');
  band.addColorStop(1, 'rgba(8,4,18,0.99)');
  ctx.fillStyle = band;
  ctx.fillRect(0, titleY, W, titleH);
  // A pink-to-cyan rule above the band.
  const rule = ctx.createLinearGradient(0, 0, W, 0);
  rule.addColorStop(0, '#ff2d78');
  rule.addColorStop(0.5, '#ff9e2c');
  rule.addColorStop(1, '#22d3ee');
  ctx.fillStyle = rule;
  ctx.fillRect(0, titleY, W, Math.max(2, titleH * 0.02));
  drawHalftone(ctx, W, titleY, titleH);

  const colour = titleColourById(state.titleColourId).value;
  const titleSize = titleH * 0.5;
  const subSize = titleH * 0.26;
  const cx = W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // The main title, Anton, uppercase, outlined and shadowed.
  ctx.font = `${titleSize}px Anton, "Arial Black", sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = titleSize * 0.08;
  ctx.shadowOffsetY = titleSize * 0.04;
  ctx.lineWidth = Math.max(2, titleSize * 0.055);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(10,4,20,0.9)';
  const titleText = (state.title || 'VICE CITY').toUpperCase();
  const titleYc = titleY + titleH * 0.42;
  ctx.strokeText(titleText, cx, titleYc);
  ctx.fillStyle = colour;
  ctx.fillText(titleText, cx, titleYc);
  // The subtitle, Pacifico script in the accent colour.
  ctx.shadowBlur = subSize * 0.06;
  ctx.shadowOffsetY = subSize * 0.03;
  ctx.font = `${subSize}px Pacifico, cursive`;
  ctx.fillStyle = ACCENT;
  const subText = state.subtitle || '';
  if (subText) ctx.fillText(subText, cx, titleY + titleH * 0.8);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** The "NEON COAST" badge ribbon in the top-right corner. */
function drawBadge(ctx, W, H) {
  const bw = W * 0.22;
  const bh = Math.max(18, H * 0.032);
  const size = bh * 0.52;
  ctx.save();
  ctx.translate(W - bw / 2 - W * 0.02, bh * 0.9);
  ctx.rotate(-0.06);
  ctx.fillStyle = '#ff2d78';
  ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(-bw / 2, -bh / 2, bw, Math.max(1, bh * 0.12));
  ctx.fillStyle = '#ffffff';
  ctx.font = `${size}px Anton, "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('NEON COAST', 0, 1);
  ctx.restore();
}

/** Fine grain over the whole cover, then a vignette darkening the corners. */
function drawFinish(ctx, W, H) {
  const tile = grainTile();
  const pattern = ctx.createPattern(tile, 'repeat');
  ctx.save();
  ctx.globalAlpha = 0.09;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const vig = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.42,
    W / 2, H / 2, Math.max(W, H) * 0.75,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

/**
 * Draw the whole cover into a canvas at the canvas's own pixel size.
 * The state holds the layout, grade, caption, photos and per-panel pan/zoom.
 */
export function renderCover(canvas, state) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  const grade = gradeById(state.gradeId);
  const titleH = Math.round(H * TITLE_SHARE);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b0716';
  ctx.fillRect(0, 0, W, H);
  const rects = layoutPanels(state.layoutId, W, H, titleH);
  for (let i = 0; i < rects.length; i++) {
    const panel = state.panels[i] || blankPanel();
    const photo = state.photos[panel.photo] || null;
    drawPanel(ctx, rects[i], panel, photo, grade);
  }
  drawTitleBlock(ctx, W, H, titleH, state);
  drawBadge(ctx, W, H);
  drawFinish(ctx, W, H);
  return canvas;
}

/**
 * Which panel, if any, a point on the canvas (in canvas pixels) falls in.
 * Panels are tested topmost first so a tilted panel on top wins the click.
 */
export function hitPanel(state, x, y, W, H) {
  const titleH = Math.round(H * TITLE_SHARE);
  const rects = layoutPanels(state.layoutId, W, H, titleH);
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    let px = x - cx;
    let py = y - cy;
    if (r.rot) {
      const a = (-r.rot * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const nx = px * cos - py * sin;
      const ny = px * sin + py * cos;
      px = nx;
      py = ny;
    }
    if (Math.abs(px) <= r.w / 2 && Math.abs(py) <= r.h / 2) return i;
  }
  return -1;
}

/** Render the cover to a fresh canvas at an export size and return it. */
export function renderExport(state, sizeId) {
  const size = sizeById(sizeId);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  renderCover(canvas, state);
  return canvas;
}
