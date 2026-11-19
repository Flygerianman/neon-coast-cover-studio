// grades.js — colour grades for Neon Coast Cover Studio.
//
// A grade is a luminance-to-colour ramp: every pixel of a photo is mapped
// through a 256-entry lookup table built from colour stops, so a photo takes
// on the warm sunset, neon night, golden hour or noir look of the cover.
// An optional contrast value steepens the luminance curve first.

/** One colour stop: [position 0..1, [red, green, blue]]. */
function ramp(stops) {
  const table = { r: new Uint8Array(256), g: new Uint8Array(256), b: new Uint8Array(256) };
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        a = stops[s];
        b = stops[s + 1];
        break;
      }
    }
    const span = b[0] - a[0] || 1;
    const f = Math.min(1, Math.max(0, (t - a[0]) / span));
    table.r[i] = Math.round(a[1][0] + (b[1][0] - a[1][0]) * f);
    table.g[i] = Math.round(a[1][1] + (b[1][1] - a[1][1]) * f);
    table.b[i] = Math.round(a[1][2] + (b[1][2] - a[1][2]) * f);
  }
  return table;
}

export const GRADES = [
  {
    id: 'sunset',
    name: 'Vice Sunset',
    hint: 'Warm orange-to-pink gradient map',
    stops: [
      [0.0, [20, 8, 43]],
      [0.25, [91, 42, 110]],
      [0.5, [201, 58, 107]],
      [0.7, [255, 107, 53]],
      [0.85, [255, 158, 125]],
      [1.0, [255, 243, 214]],
    ],
  },
  {
    id: 'neon',
    name: 'Neon Nights',
    hint: 'Pink and teal after dark',
    stops: [
      [0.0, [5, 5, 20]],
      [0.3, [26, 11, 74]],
      [0.55, [123, 47, 190]],
      [0.75, [214, 51, 132]],
      [0.9, [0, 194, 209]],
      [1.0, [232, 251, 255]],
    ],
  },
  {
    id: 'golden',
    name: 'Golden Hour',
    hint: 'Warm gold light',
    stops: [
      [0.0, [18, 10, 0]],
      [0.3, [74, 44, 0]],
      [0.55, [178, 106, 0]],
      [0.75, [255, 158, 44]],
      [0.9, [255, 201, 94]],
      [1.0, [255, 237, 184]],
    ],
  },
  {
    id: 'noir',
    name: 'Noir',
    hint: 'High-contrast black and white',
    contrast: 1.7,
    stops: [
      [0.0, [0, 0, 0]],
      [0.5, [128, 128, 128]],
      [1.0, [255, 255, 255]],
    ],
  },
];

const tables = new Map();

/** The 256-entry lookup table for a grade, built once and cached. */
export function gradeTable(grade) {
  let table = tables.get(grade.id);
  if (!table) {
    table = ramp(grade.stops);
    tables.set(grade.id, table);
  }
  return table;
}

/** A grade by id, or the first grade when the id is unknown. */
export function gradeById(id) {
  return GRADES.find((g) => g.id === id) || GRADES[0];
}

/**
 * Run a grade over an ImageData's pixels in place. Luminance is the
 * Rec. 601 luma; a contrast value steepens it around the middle first.
 */
export function applyGradeToImageData(imageData, grade) {
  const table = gradeTable(grade);
  const data = imageData.data;
  const contrast = grade.contrast || 1;
  for (let i = 0; i < data.length; i += 4) {
    let lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (contrast !== 1) {
      lum = ((lum / 255 - 0.5) * contrast + 0.5) * 255;
      lum = lum < 0 ? 0 : lum > 255 ? 255 : lum;
    }
    const idx = Math.round(lum);
    data[i] = table.r[idx];
    data[i + 1] = table.g[idx];
    data[i + 2] = table.b[idx];
  }
  return imageData;
}
