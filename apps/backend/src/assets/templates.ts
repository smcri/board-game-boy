/**
 * SVG template functions for board game assets.
 * Each returns an SVG string with documented viewBox.
 */

/**
 * Create a board grid (square or hexagonal).
 * @param rows - Number of rows
 * @param cols - Number of columns
 * @param palette - Array of hex colors
 * @returns SVG string with viewBox="0 0 {cols * 50} {rows * 50}"
 */
export function makeBoardGrid(rows: number, cols: number, palette: string[]): string {
  const cellSize = 50;
  const width = cols * cellSize;
  const height = rows * cellSize;
  const bgColor = palette[0] || '#f0f0f0';
  const gridColor = palette[1] || '#cccccc';

  let cells = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellSize;
      const y = r * cellSize;
      cells += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${bgColor}" stroke="${gridColor}" stroke-width="1"/>`;
    }
  }

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    ${cells}
  </svg>`;
}

/**
 * Create a game piece token.
 * @param label - Text label on the piece
 * @param color - Hex color
 * @param viewbox - Optional custom viewBox (default: "0 0 100 100")
 * @returns SVG string
 */
export function makePiece(label: string, color: string, viewbox = '0 0 100 100'): string {
  const parts = viewbox.split(' ').map(Number);
  const minX = parts[0] ?? 0;
  const minY = parts[1] ?? 0;
  const width = parts[2] ?? 100;
  const height = parts[3] ?? 100;

  return `<svg viewBox="${viewbox}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${minX + width / 2}" cy="${minY + height / 2}" r="${Math.min(width, height) / 2 - 2}" fill="${color}" stroke="#333" stroke-width="2"/>
    <text x="${minX + width / 2}" y="${minY + height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="14" font-weight="bold" fill="#fff">${label}</text>
  </svg>`;
}

/**
 * Create a card template.
 * @param palette - Array of hex colors
 * @returns SVG string with viewBox="0 0 300 400"
 */
export function makeCardTemplate(palette: string[]): string {
  const bgColor = palette[0] || '#fff9e6';
  const borderColor = palette[1] || '#8B4513';
  const accentColor = palette[2] || '#FFD700';

  return `<svg viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="5" width="290" height="390" fill="${bgColor}" stroke="${borderColor}" stroke-width="3" rx="5"/>
    <rect x="10" y="10" width="280" height="100" fill="${accentColor}" opacity="0.3"/>
    <text x="150" y="65" text-anchor="middle" font-size="18" font-weight="bold" fill="${borderColor}">Card Title</text>
    <text x="150" y="120" text-anchor="middle" font-size="12" fill="${borderColor}">Subtitle</text>
    <rect x="10" y="120" width="280" height="260" fill="none" stroke="${borderColor}" stroke-width="1" stroke-dasharray="3,3"/>
    <text x="150" y="250" text-anchor="middle" font-size="11" fill="${borderColor}">Card Content</text>
  </svg>`;
}

/**
 * Create a resource token.
 * @param label - Text label (e.g., "5" for 5 points)
 * @param color - Hex color
 * @returns SVG string with viewBox="0 0 100 100"
 */
export function makeResourceToken(label: string, color: string): string {
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="tokenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${color};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${adjustBrightness(color, -30)};stop-opacity:1" />
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="45" fill="url(#tokenGrad)" stroke="#333" stroke-width="2"/>
    <text x="50" y="55" text-anchor="middle" dominant-baseline="middle" font-size="28" font-weight="bold" fill="#fff">${label}</text>
  </svg>`;
}

/**
 * Utility: adjust color brightness (hex color string).
 */
function adjustBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, (num >> 8 & 0x00FF) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
  return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}
