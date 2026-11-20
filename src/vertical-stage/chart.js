// Net load on the friction contact versus payload, for the current compensation.
// Green band: in spec (|F| ≤ ½ drive force). Amber: motor still holds, little margin left.
// Red: beyond the 3 N drive/holding force, the contact slips.
import { DRIVE_N, SPEC_FRACTION, STROKE, XERYON_RANGES, netLoad } from './physics.js';

const P_MAX = 700;  // g on the x axis
const F_MAX = 5;    // ± N on the y axis

export function createChart(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  function fit() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (r.width * dpr !== canvas.width || r.height * dpr !== canvas.height) {
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    w = r.width;
    h = r.height;
  }
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();

  return function draw({ payload, compG, type, z, F, range }) {
    fit();
    const L = 30; const R = 14; const T = 8; const B = 32;
    const X = (p) => L + (p / P_MAX) * (w - L - R);
    const Y = (f) => T + ((F_MAX - f) / (2 * F_MAX)) * (h - T - B);
    ctx.clearRect(0, 0, w, h);

    // Zones
    const zone = (a, b, c) => { ctx.fillStyle = c; ctx.fillRect(L, Y(b), w - L - R, Y(a) - Y(b)); };
    const spec = SPEC_FRACTION * DRIVE_N;
    zone(DRIVE_N, F_MAX, 'rgba(255,107,138,0.12)');
    zone(-F_MAX, -DRIVE_N, 'rgba(255,107,138,0.12)');
    zone(spec, DRIVE_N, 'rgba(255,179,92,0.10)');
    zone(-DRIVE_N, -spec, 'rgba(255,179,92,0.10)');
    zone(-spec, spec, 'rgba(110,231,160,0.10)');

    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(w - R, Y(0)); ctx.stroke();
    ctx.font = `10px ${col('--mono')}`;
    ctx.fillStyle = col('--muted');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const f of [-DRIVE_N, 0, DRIVE_N]) ctx.fillText(`${f > 0 ? '+' : ''}${f}`, L - 4, Y(f));
    ctx.save();
    ctx.translate(8, Y(0));
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('N ↓', 0, 0);
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let p = 0; p <= P_MAX; p += 100) ctx.fillText(p, X(p), h - B + 2);

    // Xeryon's printed ranges (reference) under the axis labels
    XERYON_RANGES.forEach((r, i) => {
      const y = h - B + 16 + (i % 2) * 7;
      ctx.strokeStyle = 'rgba(232,235,240,0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(X(r.lo), y); ctx.lineTo(X(r.hi), y); ctx.stroke();
    });

    // In-spec range for this compensation
    if (range) {
      ctx.strokeStyle = 'rgba(110,231,160,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(X(range.lo), h - B - 2); ctx.lineTo(X(range.hi), h - B - 2); ctx.stroke();
    }

    // Net load line. For a spring, shade the spread between bottom and top of stroke.
    const line = (zz, style, width) => {
      ctx.strokeStyle = style; ctx.lineWidth = width;
      ctx.beginPath();
      for (let p = 0; p <= P_MAX; p += 5) {
        const f = Math.max(-F_MAX, Math.min(F_MAX, netLoad(p, compG, type, zz)));
        if (p === 0) ctx.moveTo(X(p), Y(f)); else ctx.lineTo(X(p), Y(f));
      }
      ctx.stroke();
    };
    if (compG > 0 && type === 'spring') {
      line(0, 'rgba(95,211,255,0.35)', 1);
      line(STROKE, 'rgba(95,211,255,0.35)', 1);
    }
    line(z, col('--cool'), 1.8);

    // Current point
    const fy = Math.max(-F_MAX, Math.min(F_MAX, F));
    ctx.fillStyle = Math.abs(F) > DRIVE_N ? col('--warn') : col('--hot');
    ctx.beginPath(); ctx.arc(X(payload), Y(fy), 4, 0, Math.PI * 2); ctx.fill();
  };
}
