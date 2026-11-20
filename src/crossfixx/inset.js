// 2D inset: the real-scale tip path in µm, with the strip line and the push half.
import { tipPosition } from './physics.js';

export function createInset(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  return function draw({ Aum, phase, theta, mode, ss }) {
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2 - 4;
    const s = (Math.min(W, H) * 0.36) / 1.0; // px per µm (1 µm full scale)

    // Grid + axes
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath(); ctx.moveTo(cx + k * s * 0.5, 8); ctx.lineTo(cx + k * s * 0.5, H - 18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10, cy + k * s * 0.5); ctx.lineTo(W - 10, cy + k * s * 0.5); ctx.stroke();
    }
    // Strip surface: contact when the tip is below this line (normal displacement > 0)
    ctx.strokeStyle = 'rgba(233,236,239,0.55)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(10, cy); ctx.lineTo(W - 10, cy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(233,236,239,0.06)';
    ctx.fillRect(10, cy, W - 20, H - 18 - cy);

    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('strip', 12, cy + 12);
    ctx.fillText('0.5 µm', cx + s * 0.5 + 3, H - 21);

    if (mode === 'stickslip') {
      ctx.strokeStyle = '#ff6b8a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - Aum * s, cy); ctx.lineTo(cx + Aum * s, cy); ctx.stroke();
      ctx.fillStyle = ss.sticking ? '#ffb35c' : '#ff6b8a';
      ctx.beginPath(); ctx.arc(cx + ss.x * s, cy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(ss.sticking ? 'stick: slow extend' : 'slip: fast retract', 12, 18);
      return;
    }

    // Ellipse, coloured by contact (push half) vs free return
    const N = 180;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const b = ((i + 1) / N) * Math.PI * 2;
      const p = tipPosition(a, Aum, phase);
      const q = tipPosition(b, Aum, phase);
      ctx.strokeStyle = p.y > 0 ? '#ffb35c' : '#5fd3ff';
      ctx.lineWidth = p.y > 0 ? 2.4 : 1.6;
      ctx.beginPath();
      ctx.moveTo(cx + p.x * s, cy + p.y * s);
      ctx.lineTo(cx + q.x * s, cy + q.y * s);
      ctx.stroke();
    }
    const t = tipPosition(theta, Aum, phase);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx + t.x * s, cy + t.y * s, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(t.y > 0 ? 'in contact: pushing' : 'lifted: returning', 12, 18);
  };
}
