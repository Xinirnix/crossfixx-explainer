// Scrolling chart of position error (actual − commanded) over the last command period.
// A flat line means the payload follows the command; a step at each reversal is lost motion.
export function createChart(canvas, { unit, range, color }) {
  const ctx = canvas.getContext('2d');
  let pts = []; // { t, v, on }

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  return {
    clear() { pts = []; },
    push(t, v, on) {
      pts.push({ t, v, on });
      if (pts.length > 2000) pts.splice(0, pts.length - 2000);
    },
    draw(now, windowS) {
      const { w, h } = fit();
      ctx.clearRect(0, 0, w, h);
      const R = range();
      const padL = 46;
      const mid = h / 2;
      const sy = (h / 2 - 14) / R;
      const sx = (w - padL - 4) / windowS;

      // Axes and scale
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillStyle = '#8b94a3';
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (const g of [-R, 0, R]) {
        const y = mid - g * sy;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.fillText(`${g > 0 ? '+' : ''}${Math.round(g)}`, 4, y + 3);
      }
      ctx.textAlign = 'right';
      ctx.fillText(`position error, ${unit} · last ${windowS} s`, w - 4, 10);
      ctx.textAlign = 'left';

      // Trace
      const from = now - windowS;
      ctx.lineWidth = 1.8;
      let prev = null;
      for (const p of pts) {
        if (p.t < from) continue;
        const x = padL + (p.t - from) * sx;
        const clipped = Math.max(-R * 1.05, Math.min(R * 1.05, p.v));
        const y = mid - clipped * sy;
        if (prev) {
          ctx.strokeStyle = p.on ? color : '#ff6b8a';
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(x, y); ctx.stroke();
        }
        prev = { x, y };
      }
      if (prev && Math.abs(pts[pts.length - 1].v) > R) {
        ctx.fillStyle = '#ff6b8a';
        ctx.fillText(`off scale: ${Math.round(pts[pts.length - 1].v)} ${unit}`, padL + 6, pts[pts.length - 1].v < 0 ? h - 4 : 12);
      }
    },
  };
}
