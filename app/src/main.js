// main.js — wires the Neon Coast Cover Studio editor UI to the cover engine.
//
// The editor keeps a state (layout, grade, caption, size, photos and one
// panel record per panel) and a history of snapshots for undo and redo.
// Every change re-renders the preview canvas; exports re-render the same
// drawing at full pixel size and download it as a PNG.

import {
  SIZES, LAYOUTS, TITLE_COLOURS, sizeById, layoutById, titleColourById,
  makeDefaultState, panelsForLayout, layoutPanels, renderCover, renderExport,
  hitPanel, clampPan, blankPanel,
} from './cover.js';
import { GRADES } from './grades.js';

const $ = (id) => document.getElementById(id);
const preview = $('preview');
const SAMPLES = [
  { name: 'Boulevard', src: 'samples/boulevard.jpg' },
  { name: 'Pier', src: 'samples/pier.jpg' },
];

const state = makeDefaultState();
let selectedPanel = 0;
let currentPhoto = 0;
let history = [];
let historyIndex = -1;
let fontsReady = false;

// ---------------------------------------------------------------- history

/** The serialisable part of the state, for undo and redo. */
function snapshot() {
  return JSON.stringify({
    layoutId: state.layoutId,
    gradeId: state.gradeId,
    title: state.title,
    subtitle: state.subtitle,
    titleColourId: state.titleColourId,
    sizeId: state.sizeId,
    panels: state.panels,
  });
}

function restore(text) {
  const s = JSON.parse(text);
  state.layoutId = s.layoutId;
  state.gradeId = s.gradeId;
  state.title = s.title;
  state.subtitle = s.subtitle;
  state.titleColourId = s.titleColourId;
  state.sizeId = s.sizeId;
  state.panels = s.panels;
  if (selectedPanel >= state.panels.length) selectedPanel = 0;
}

function commit() {
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot());
  if (history.length > 60) history.shift();
  historyIndex = history.length - 1;
  syncUndoRedo();
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  restore(history[historyIndex]);
  syncInputs();
  render();
  syncUndoRedo();
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  restore(history[historyIndex]);
  syncInputs();
  render();
  syncUndoRedo();
}

function syncUndoRedo() {
  $('undo').disabled = historyIndex <= 0;
  $('redo').disabled = historyIndex >= history.length - 1;
}

// ---------------------------------------------------------------- rendering

/** Size the preview canvas to the chosen export aspect, capped for speed. */
function sizePreview() {
  const size = sizeById(state.sizeId);
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  preview.width = Math.round(size.width * scale);
  preview.height = Math.round(size.height * scale);
}

function render() {
  sizePreview();
  renderCover(preview, state);
  markSelectedPanel();
}

/** Highlight the selected panel's frame in the preview. */
function markSelectedPanel() {
  // The engine draws the frames; selection is shown in the side panel text.
  $('panel-info').textContent = state.panels.length > 1
    ? `Panel ${selectedPanel + 1} of ${state.panels.length} selected — drag it to pan, use the zoom slider to scale.`
    : 'One panel — drag it to pan, use the zoom slider to scale.';
}

// ---------------------------------------------------------------- photos

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

function addPhoto(img, name) {
  const photo = { img, name };
  state.photos.push(photo);
  currentPhoto = state.photos.length - 1;
  // The new photo goes into the selected panel.
  state.panels[selectedPanel].photo = currentPhoto;
  clampPanel(selectedPanel);
  syncPhotoList();
  commit();
  render();
}

async function loadSample(sample) {
  try {
    const img = await loadImage(sample.src);
    addPhoto(img, sample.name);
  } catch (err) {
    $('photo-status').textContent = `Could not load the ${sample.name} sample photo.`;
  }
}

async function loadFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      addPhoto(img, file.name);
    } catch (err) {
      $('photo-status').textContent = `Could not read ${file.name}.`;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function clampPanel(i) {
  const rects = panelRects();
  const panel = state.panels[i];
  const photo = state.photos[panel.photo];
  if (rects[i] && photo) clampPan(panel, rects[i], photo);
}

/** The panel rectangles for the preview canvas's current pixel size. */
function panelRects() {
  const titleH = Math.round(preview.height * 0.16);
  return layoutPanels(state.layoutId, preview.width, preview.height, titleH);
}

function syncPhotoList() {
  const list = $('photo-list');
  list.innerHTML = '';
  state.photos.forEach((photo, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'photo-chip' + (i === currentPhoto ? ' active' : '');
    chip.textContent = photo.name;
    chip.addEventListener('click', () => {
      currentPhoto = i;
      state.panels[selectedPanel].photo = i;
      clampPanel(selectedPanel);
      syncPhotoList();
      commit();
      render();
    });
    list.appendChild(chip);
  });
  $('photo-status').textContent = state.photos.length === 0
    ? 'No photo yet — pick a file, drop one in, or load a sample.'
    : `${state.photos.length} photo${state.photos.length === 1 ? '' : 's'} loaded.`;
}

// ---------------------------------------------------------------- panel interaction

let drag = null;

function canvasPoint(event) {
  const rect = preview.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * preview.width;
  const y = ((event.clientY - rect.top) / rect.height) * preview.height;
  return { x, y };
}

preview.addEventListener('pointerdown', (event) => {
  const { x, y } = canvasPoint(event);
  const hit = hitPanel(state, x, y, preview.width, preview.height);
  if (hit < 0) return;
  selectedPanel = hit;
  currentPhoto = state.panels[hit].photo;
  const panel = state.panels[hit];
  drag = { startX: x, startY: y, panX: panel.panX, panY: panel.panY, moved: false };
  preview.setPointerCapture(event.pointerId);
  syncPhotoList();
  render();
});

preview.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const { x, y } = canvasPoint(event);
  const rects = panelRects();
  const rect = rects[selectedPanel];
  const panel = state.panels[selectedPanel];
  if (!rect) return;
  const dx = (x - drag.startX) / rect.w;
  const dy = (y - drag.startY) / rect.h;
  if (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002) drag.moved = true;
  panel.panX = drag.panX + dx;
  panel.panY = drag.panY + dy;
  clampPanel(selectedPanel);
  render();
});

preview.addEventListener('pointerup', () => {
  if (drag && drag.moved) commit();
  drag = null;
});

preview.addEventListener('pointercancel', () => {
  drag = null;
});

// ---------------------------------------------------------------- controls

function buildToolbar() {
  const layoutBar = $('layout-bar');
  LAYOUTS.forEach((layout) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tool-btn';
    button.dataset.layout = layout.id;
    button.textContent = layout.name;
    button.addEventListener('click', () => {
      state.layoutId = layout.id;
      state.panels = panelsForLayout(state, layout.id);
      if (selectedPanel >= state.panels.length) selectedPanel = 0;
      commit();
      syncToolbar();
      render();
    });
    layoutBar.appendChild(button);
  });

  const gradeBar = $('grade-bar');
  GRADES.forEach((grade) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tool-btn';
    button.dataset.grade = grade.id;
    button.textContent = grade.name;
    button.title = grade.hint;
    button.addEventListener('click', () => {
      state.gradeId = grade.id;
      commit();
      syncToolbar();
      render();
    });
    gradeBar.appendChild(button);
  });

  const sizeSelect = $('size-select');
  SIZES.forEach((size) => {
    const option = document.createElement('option');
    option.value = size.id;
    option.textContent = `${size.name} — ${size.label}`;
    sizeSelect.appendChild(option);
  });
  sizeSelect.addEventListener('change', () => {
    state.sizeId = sizeSelect.value;
    commit();
    render();
  });

  const colourBar = $('colour-bar');
  TITLE_COLOURS.forEach((colour) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.dataset.colour = colour.id;
    swatch.title = colour.name;
    swatch.style.background = colour.value;
    swatch.setAttribute('aria-label', `${colour.name} title`);
    swatch.addEventListener('click', () => {
      state.titleColourId = colour.id;
      commit();
      syncToolbar();
      render();
    });
    colourBar.appendChild(swatch);
  });
}

function syncToolbar() {
  document.querySelectorAll('[data-layout]').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === state.layoutId);
  });
  document.querySelectorAll('[data-grade]').forEach((b) => {
    b.classList.toggle('active', b.dataset.grade === state.gradeId);
  });
  document.querySelectorAll('[data-colour]').forEach((b) => {
    b.classList.toggle('active', b.dataset.colour === state.titleColourId);
  });
  $('size-select').value = state.sizeId;
}

function syncInputs() {
  $('title-input').value = state.title;
  $('subtitle-input').value = state.subtitle;
  $('zoom-slider').value = String(Math.round(state.panels[selectedPanel].zoom * 100));
  syncToolbar();
}

function bindControls() {
  $('title-input').addEventListener('input', (event) => {
    state.title = event.target.value;
    render();
  });
  $('title-input').addEventListener('change', () => commit());
  $('subtitle-input').addEventListener('input', (event) => {
    state.subtitle = event.target.value;
    render();
  });
  $('subtitle-input').addEventListener('change', () => commit());

  $('zoom-slider').addEventListener('input', (event) => {
    const panel = state.panels[selectedPanel];
    panel.zoom = Number(event.target.value) / 100;
    clampPanel(selectedPanel);
    render();
  });
  $('zoom-slider').addEventListener('change', () => commit());

  $('fill-all').addEventListener('click', () => {
    state.panels.forEach((panel) => { panel.photo = currentPhoto; });
    commit();
    render();
  });

  $('file-input').addEventListener('change', (event) => {
    loadFiles([...event.target.files]);
    event.target.value = '';
  });

  const drop = $('drop-zone');
  drop.addEventListener('click', () => $('file-input').click());
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('over');
    loadFiles([...event.dataTransfer.files]);
  });

  document.querySelectorAll('[data-sample]').forEach((button) => {
    button.addEventListener('click', () => {
      const sample = SAMPLES.find((s) => s.name === button.dataset.sample);
      if (sample) loadSample(sample);
    });
  });

  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('export').addEventListener('click', exportCover);
}

// ---------------------------------------------------------------- export

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) {
      $('export-status').textContent = 'Export failed — the browser could not make a PNG.';
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    $('export-status').textContent = `Exported ${filename} (${canvas.width} × ${canvas.height}).`;
  }, 'image/png');
}

function exportCover() {
  const size = sizeById(state.sizeId);
  const canvas = renderExport(state, state.sizeId);
  downloadCanvas(canvas, `neon-coast-cover-${size.id}-${size.width}x${size.height}.png`);
}

// ---------------------------------------------------------------- scenes

/** The ?shot= scenes: deterministic renders for screenshots and sharing. */
async function applyShotScene() {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (!shot) return;
  // Every shot scene loads a sample photo and the default caption.
  const img = await loadImage('samples/boulevard.jpg');
  state.photos = [{ img, name: 'Boulevard' }];
  state.panels.forEach((panel) => { panel.photo = 0; });
  state.title = 'VICE CITY';
  state.subtitle = 'Neon Coast';
  if (shot === 'cover') {
    state.layoutId = 'hero-three';
    state.gradeId = 'sunset';
    state.sizeId = 'square';
    document.body.classList.add('shot-mode');
  } else if (shot === 'grid') {
    state.layoutId = 'four-grid';
    state.gradeId = 'neon';
    state.sizeId = 'square';
    state.panels = panelsForLayout(state, 'four-grid');
    document.body.classList.add('shot-mode');
  } else if (shot === 'story') {
    state.layoutId = 'tilted';
    state.gradeId = 'golden';
    state.sizeId = 'portrait';
    state.panels = panelsForLayout(state, 'tilted');
    document.body.classList.add('shot-mode');
  } else if (shot === 'editor') {
    state.layoutId = 'hero-three';
    state.gradeId = 'sunset';
    state.sizeId = 'square';
  }
  state.panels = panelsForLayout(state, state.layoutId);
  if (shot === 'cover' && state.panels[0]) {
    // The sample photo is portrait and the hero panel is wide: shift the
    // photo down so the subject's face stays in the hero frame.
    state.panels[0].panY = 0.18;
  }
  syncInputs();
  syncPhotoList();
}

/** A self-test (?test=export): render every size, read the PNG header, report. */
async function runExportTest() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('test') !== 'export') return;
  const results = [];
  for (const size of SIZES) {
    const canvas = renderExport(state, size.id);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const w = view.getUint32(16, false);
    const h = view.getUint32(20, false);
    const ok = w === size.width && h === size.height && bytes[0] === 0x89 && bytes[1] === 0x50;
    results.push(`${size.id}: ${w}x${h} ${ok ? 'OK' : 'MISMATCH'} (${blob.size} bytes)`);
  }
  const div = $('test-results');
  div.textContent = `export-test: ${results.join(' | ')}`;
  div.style.display = 'block';
}

// ---------------------------------------------------------------- boot

async function boot() {
  buildToolbar();
  bindControls();
  syncInputs();
  // The cover lettering needs Anton and Pacifico; wait for them, then draw.
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('100px Anton'),
        document.fonts.load('60px Pacifico'),
        document.fonts.ready,
      ]),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
    fontsReady = true;
  } catch (err) {
    fontsReady = false;
  }
  await applyShotScene();
  commit();
  render();
  await runExportTest();
  if (fontsReady) render();
  // Signal the screenshot driver that the scene is drawn.
  window.__shotReady = true;
}

boot();
