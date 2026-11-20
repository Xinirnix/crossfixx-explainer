// 2D inset, real scale in µm: left, the tip error seen from above (lateral) over one turn,
// with the radial run-out as a reference circle; right, the vertical error against angle.
export function createInset(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fit();
  window.addEventListener('resize', fit);

  const niceStep = (v) => { const e = Math.pow(10, Math.floor(Math.log10(v))); const m = v / e; return (m < 2 ? 1 : m < 5 ? 2 : 5) * e; };

  return function draw({ path, now, theta, radial, hasRotary }) {
    if (!W || H < 40) fit();
    if (!W || H < 40) return; // hidden (phone layout)
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    let max = Math.max(radial, 0.2);
    for (const d of path) max = Math.max(max, Math.hypot(d[0], d[2]), Math.abs(d[1]));
    const half = (H - 30) / 2;
    const s = half / (max * 1.1); // px per µm
    const step = niceStep(max / 2);

    // Left: top view
    const cx = W * 0.27, cy = 14 + half;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let k = -3; k <= 3; k++) {
      if (Math.abs(k * step * s) > half) continue;
      ctx.beginPath(); ctx.moveTo(cx + k * step * s, cy - half); ctx.lineTo(cx + k * step * s, cy + half); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - half, cy + k * step * s); ctx.lineTo(cx + half, cy + k * step * s); ctx.stroke();
    }
    if (hasRotary && radial > 0) {
      ctx.strokeStyle = '#5fd3ff'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(cx, cy, radial * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#ffb35c'; ctx.lineWidth = 2;
    ctx.beginPath();
    path.forEach((d, i) => { const x = cx + d[0] * s, y = cy + d[2] * s; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx + now[0] * s, cy + now[2] * s, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('top view', 4, 10);
    ctx.fillText(`grid ${fmt(step)}`, 4, H - 4);

    // Right: vertical error against rotation angle
    const x0 = W * 0.56, x1 = W - 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();
    ctx.strokeStyle = '#ffb35c'; ctx.lineWidth = 2;
    ctx.beginPath();
    path.forEach((d, i) => { const x = x0 + (i / (path.length - 1)) * (x1 - x0), y = cy - d[1] * s; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.lineWidth = 1;
    const tx = x0 + (((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * (x1 - x0);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(tx, cy - now[1] * s, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(hasRotary ? 'height vs angle' : 'height', x0, 10);
  };
}

export const fmt = (um) => (um >= 10 ? `${um.toFixed(0)} µm` : um >= 1 ? `${um.toFixed(1)} µm` : `${(um * 1000).toFixed(0)} nm`);
