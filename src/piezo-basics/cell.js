// One perovskite (ABO3) unit cell, side view, schematic and not to scale [CTS: PZT is a perovskite,
// cubic above the Curie point, tetragonal below]. Below the Curie point the cell is stretched along c and
// the B ion (Zr/Ti) sits off-centre, so the cell carries a dipole. The field stretches c and shrinks a
// (d33, d31), drawn hugely exaggerated, and pulls the B ion further along.

export function createCell(canvas) {
  const ctx = canvas.getContext('2d');
  return function draw({ sign, S3, S1 }) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (canvas.width !== r.width * dpr || canvas.height !== r.height * dpr) { canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width; const h = r.height;
    ctx.clearRect(0, 0, w, h);

    const K = 160; // strain exaggeration for this sketch
    const s = sign || 1;
    // S3, S1 are the plate strains (signed by the net polarization), which this cell shares.
    const a = 62 * (1 + S1 * K);
    const c = 74 * (1 + S3 * K);
    const cx = w * 0.32; const cy = h / 2;
    const x0 = cx - a / 2; const y0 = cy - c / 2;

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, a, c);

    const ion = (x, y, rad, fill) => { ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
    // O at edge midpoints (face centres seen edge-on)
    [[cx, y0], [cx, y0 + c], [x0, cy], [x0 + a, cy]].forEach(([x, y]) => ion(x, y, 5, '#ff6b8a'));
    // A at corners
    [[x0, y0], [x0 + a, y0], [x0, y0 + c], [x0 + a, y0 + c]].forEach(([x, y]) => ion(x, y, 8, '#9aa3ad'));
    // B off-centre along the polarization; the field (S3 > 0 means along it) pushes it further
    const shift = -s * 7 * (1 + 2 * S3 * K); // canvas y points down
    ion(cx, cy + shift, 6.5, '#ffb35c');
    // Dipole arrow
    const col = s > 0 ? '#ffb35c' : '#5fd3ff';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
    const ax = x0 + a + 22; const ay0 = cy + s * 22; const ay1 = cy - s * 22;
    ctx.beginPath(); ctx.moveTo(ax, ay0); ctx.lineTo(ax, ay1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax, ay1); ctx.lineTo(ax - 5, ay1 + s * 8); ctx.lineTo(ax + 5, ay1 + s * 8); ctx.fill();

    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#8b94a3';
    const tx = w * 0.64;
    ctx.fillText('● A  Pb', tx, cy - 26);
    ctx.fillText('● B  Zr/Ti', tx, cy - 10);
    ctx.fillText('● O', tx, cy + 6);
    ctx.fillText('P  dipole', tx, cy + 22);
    ctx.fillStyle = '#9aa3ad'; ctx.fillText('●', tx, cy - 26);
    ctx.fillStyle = '#ffb35c'; ctx.fillText('●', tx, cy - 10);
    ctx.fillStyle = '#ff6b8a'; ctx.fillText('●', tx, cy + 6);
    ctx.fillStyle = col; ctx.fillText('P', tx, cy + 22);
    ctx.fillStyle = '#8b94a3';
    ctx.fillText('c', x0 - 14, cy + 4);
    ctx.fillText('a', cx - 3, y0 + c + 16);
  };
}
