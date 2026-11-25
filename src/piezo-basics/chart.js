// Strain vs field. Faint lines: the ideal fully poled-up sample (S3 = d33·E, S1 = d31·E).
// Trails: the path the plate actually took, so sweeping past the coercive field draws the "butterfly".
import { D33, D31, E_C, E_C_SPREAD, V_MIN, V_MAX, fieldKVmm, E_MAX_REC } from './physics.js';

const E_LO = fieldKVmm(V_MIN);
const E_HI = fieldKVmm(V_MAX);
const S_LO = -1.0; // strain ×10⁻³ (‰)
const S_HI = 1.7;
const TRAIL = 400;

export function createChart(canvas) {
  const ctx = canvas.getContext('2d');
  const trail = [];
  return {
    push(E, S3, S1) { trail.push([E, S3 * 1e3, S1 * 1e3]); if (trail.length > TRAIL) trail.shift(); },
    clear() { trail.length = 0; },
    draw(E, S3, S1) {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      if (canvas.width !== r.width * dpr || canvas.height !== r.height * dpr) { canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = r.width; const h = r.height;
      const L = 30; const R = 8; const T = 8; const B = 26;
      const X = (e) => L + ((e - E_LO) / (E_HI - E_LO)) * (w - L - R);
      const Y = (s) => T + ((S_HI - s) / (S_HI - S_LO)) * (h - T - B);
      ctx.clearRect(0, 0, w, h);

      // Coercive bands and the recommended limit
      ctx.fillStyle = 'rgba(255,107,138,0.10)';
      const e0 = E_C * (1 - E_C_SPREAD / 2); const e1 = E_C * (1 + E_C_SPREAD / 2);
      ctx.fillRect(X(-e1), T, X(-e0) - X(-e1), h - T - B);
      ctx.fillRect(X(e0), T, X(e1) - X(e0), h - T - B);
      ctx.fillStyle = 'rgba(255,179,92,0.08)';
      ctx.fillRect(X(E_MAX_REC), T, X(E_HI) - X(E_MAX_REC), h - T - B);

      // Axes
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(w - R, Y(0)); ctx.moveTo(X(0), T); ctx.lineTo(X(0), h - B); ctx.stroke();
      ctx.font = '9.5px "IBM Plex Mono", monospace'; ctx.fillStyle = '#8b94a3';
      for (let e = -1; e <= 4; e++) ctx.fillText(String(e), X(e) - 3, h - B + 12);
      ctx.fillText('E, kV/mm', w - R - 52, h - 3);
      for (const s of [-0.5, 0.5, 1, 1.5]) ctx.fillText(s.toFixed(1), 2, Y(s) + 3);
      ctx.fillText('‰', L + 4, T + 8);
      ctx.fillText('±Ec', X(e1) + 2, T + 9);

      // Ideal poled-up lines
      const line = (k, color, dash) => {
        ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(E_LO), Y(k * E_LO * 1e3)); ctx.lineTo(X(E_HI), Y(k * E_HI * 1e3)); ctx.stroke();
        ctx.setLineDash([]);
      };
      line(D33 * 1e6, 'rgba(255,179,92,0.35)', [3, 3]);
      line(D31 * 1e6, 'rgba(95,211,255,0.35)', [3, 3]);

      // Trails
      const path = (idx, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = 1.6;
        ctx.beginPath();
        trail.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[idx])) : ctx.moveTo(X(p[0]), Y(p[idx]))));
        ctx.stroke();
      };
      path(1, '#ffb35c');
      path(2, '#5fd3ff');
      const dot = (s, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(X(E), Y(s * 1e3), 3.5, 0, Math.PI * 2); ctx.fill(); };
      dot(S3, '#ffb35c');
      dot(S1, '#5fd3ff');
    },
  };
}
