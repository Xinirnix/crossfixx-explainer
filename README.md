# Xeryon piezo explainers

**[Open the live site](https://xinirnix.github.io/crossfixx-explainer/)**

Interactive explainers of how Xeryon piezo motors and stages work. Each page is a live model (Vite + Three.js or plain canvas) whose controls drive the underlying equations, not a baked video. The landing page lists every explainer with a card.

```
npm install
npm run dev      # http://localhost:5173 (landing page), /crossfixx/ etc.
npm run build    # static multi-page site in dist/
```

Every push to `main` builds and deploys the site to GitHub Pages (`.github/workflows/pages.yml`).

## Layout

```
index.html                 landing page (cards are generated, do not edit per explainer)
src/hub/                   landing page script and style
src/shared/base.css        shared colour tokens, fonts, buttons, .hub-link
<slug>/index.html          one explainer page per top-level folder
src/<slug>/                that explainer's code: main.js, style.css, meta.js, ...
vite.config.js             auto-registers every <slug>/index.html as a build input
```

## Adding an explainer

Pick a short kebab-case slug (for example `vertical-stage`). Then:

1. **Page:** create `<slug>/index.html` at the repo root. Load its script with an absolute path: `<script type="module" src="/src/<slug>/main.js"></script>`. Put a link back to the hub in the header: `<a class="hub-link" href="../">← All</a>`. Copy the fonts `<link>` tags from `crossfixx/index.html`.
2. **Code:** put everything for the page in `src/<slug>/`. Start `src/<slug>/style.css` with `@import '../shared/base.css';` to get the shared colours (`--bg`, `--panel`, `--line`, `--text`, `--muted`, `--hot`, `--cool`, `--warn`), fonts (`--sans`, `--mono`) and button styles.
3. **Card:** add `src/<slug>/meta.js`:
   ```js
   import thumb from './thumb.jpg'; // optional, ~16:9, keep it under ~100 kB
   export default {
     title: 'How mass compensation works on vertical stages',
     summary: 'One or two sentences on what the reader will understand.',
     tags: ['Vertical', 'Load'],
     order: 20,   // lower comes first; CrossFixx is 10
     thumb,       // optional
   };
   ```

That is all. You do **not** need to edit `vite.config.js` (any top-level folder with an `index.html` becomes a build input) or the landing page (it reads every `src/*/meta.js`). Because no shared file changes, explainers can be built in parallel without merge conflicts.

Use relative links between pages (`../`, `../crossfixx/`), never `/...`, because the site is served under `/crossfixx-explainer/` on GitHub Pages.

## Explainers

### CrossFixx standing-wave motor (`crossfixx/`)

**[Open it](https://xinirnix.github.io/crossfixx-explainer/crossfixx/)**

![The tip traces an ellipse; at +90° the rod moves right, at 0° it stops, at −90° it reverses; the rotary version turns the same way; in exploded view the tip keeps vibrating but nothing is driven.](docs/demo.gif)

The phase between the two vibration modes sets the direction: +90° drives the rod right, 0° gives no net motion, −90° reverses it. The rotary version is the same motor driving a rotor. In exploded view the tip still vibrates, but with no contact nothing moves.

Files:

- `crossfixx/index.html`: the page and HUD markup
- `src/crossfixx/physics.js`: tip equation `x = A·sin(ωt)`, `y = A·sin(ωt + φ)`, resonance, net step per cycle, stick-slip contrast. Constants (166 kHz example resonance from Xeryon's 80–180 kHz range, Q, 1 µm, 1000× exaggeration) are at the top.
- `src/crossfixx/scene.js`: primitive geometry (piezo plate, electrodes, tip, spring, housing, strip, rod, rotor), labels, ghost ellipse, sparks
- `src/crossfixx/main.js`: state, animation loop, controls, keyboard
- `src/crossfixx/captions.js`: the sentences in the left panel
- `src/crossfixx/inset.js`: the real-scale tip path chart
- `src/crossfixx/style.css`: HUD styling
- `src/crossfixx/meta.js`, `thumb.jpg`: the landing-page card

The **Nodal mount** toggle zooms to the plate, marks the centre-hole node shared by both modes, traces how every other point moves, and shows the front electrode pattern (A and B in phase → expansion mode, 180° → bending mode, 90° → both, the ellipse).

Keys: L linear, R rotary, X exploded, N nodal mount, S stick-slip, Space pause, 1/2/3 phase −90/0/+90.

### Stick-slip vs walking vs ultrasonic (`piezo-drives/`)

**[Open it](https://xinirnix.github.io/crossfixx-explainer/piezo-drives/)**

One rod in two bearings, pressed onto the drive by a preload roller, driven three ways: a stick-slip shear stack (sawtooth), two walking legs (quasi-static loops, half a cycle apart), and a CrossFixx-style ultrasonic tip (two modes, ~90° apart, at resonance). Every number on the page comes from one friction model solved in the time domain: `m·dv/dt = Σ μ·N_i(t)·sat((v_i − v)/v_ε) − F_load`. From its steady-state cycle the page derives rod speed, the force fed back into the frame (its harmonics, run through three frame modes, give the frame vibration and an A-weighted audible level) and the friction work per mm of travel (what wears the contact). Sweep the drive frequency to see stick-slip stall when the flyback is too slow, ring when it nears the stack resonance, and stay in the audible band; the ultrasonic drive only works near its resonance and everything it emits is above 20 kHz. **Listen** plays the audible part of the simulated frame vibration.

Files:

- `piezo-drives/index.html`: the page and HUD markup
- `src/piezo-drives/model.js`: the friction model, the three drives' contact waveforms, frame spectrum, A-weighting, wear. All constants (rod mass, preload, μ, stack resonance, frame modes) are in `P` at the top; the ultrasonic tip reuses `src/crossfixx/physics.js`.
- `src/piezo-drives/scene.js`: rod, bearings, preload roller, frame, shear stack, walking legs, resonator and tip
- `src/piezo-drives/plots.js`: drive waveform and frame spectrum charts
- `src/piezo-drives/captions.js`: the sentences in the left panel, including the ones that react to the model
- `src/piezo-drives/sound.js`: Web Audio playback of the audible harmonics
- `src/piezo-drives/main.js`: state, sliders, animation loop, comparison table
- `src/piezo-drives/meta.js`, `thumb.jpg`: the landing-page card

Keys: 1/2/3 drive, Z zoom to the contact, M listen, Space pause.

Source: [Xeryon, Ultrasonic piezo motors](https://xeryon.com/technology/ultrasonic-piezo-motors-the-worlds-smallest-high-performance-motion-technology/). Rod, contact and frame values are illustrative orders of magnitude, not Xeryon data; Xeryon gives ~100 kHz as typical; this page reuses the CrossFixx page's 166 kHz example.
