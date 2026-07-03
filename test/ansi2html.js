'use strict';
/* Minimal ANSI (SGR) → HTML converter for preview/cover assets. */

const C256 = {
  238: '#4e4e4e', 245: '#8a8a8a', 252: '#d0d0d0', 255: '#eeeeee',
  173: '#d7875f', 117: '#87d7ff', 114: '#87d787', 179: '#d7af5f',
  174: '#d78787', 237: '#3a3a3a', 109: "#87afaf", 137: "#af875f", 251: "#c6c6c6", 114: "#87d787",
};

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function ansiToHtml(text) {
  let html = '', color = null, bold = false, open = false;
  const flushOpen = () => {
    if (open) html += '</span>';
    const style = (color ? `color:${color};` : '') + (bold ? 'font-weight:600;' : '');
    html += `<span style="${style}">`;
    open = true;
  };
  const parts = text.split(/(\x1b\[[0-9;]*m)/);
  for (const p of parts) {
    const m = p.match(/^\x1b\[([0-9;]*)m$/);
    if (!m) { if (p) { if (!open) flushOpen(); html += esc(p); } continue; }
    const codes = m[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) { color = null; bold = false; }
      else if (c === 1) bold = true;
      else if (c === 38 && codes[i + 1] === 5) { color = C256[codes[i + 2]] || '#d0d0d0'; i += 2; }
      else if (c === 38 && codes[i + 1] === 2) { color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4; }
    }
    flushOpen();
  }
  if (open) html += '</span>';
  return html;
}

module.exports = { ansiToHtml, esc };
