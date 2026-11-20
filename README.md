# CrossFixx piezo motor explainer

Interactive 3D explainer of a two-mode standing-wave ultrasonic piezo motor (Xeryon CrossFixx style).

```
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## Files

- `index.html`: the page and HUD markup
- `src/physics.js`: tip equation `x = A·sin(ωt)`, `y = A·sin(ωt + φ)`, resonance, net step per cycle, stick-slip contrast. Constants (166 kHz, Q, 1 µm, 1000× exaggeration) are at the top.
- `src/scene.js`: primitive geometry (piezo plate, electrodes, tip, spring, housing, strip, rod, rotor), labels, ghost ellipse, sparks
- `src/main.js`: state, animation loop, controls, keyboard
- `src/captions.js`: the sentences in the left panel
- `src/inset.js`: the real-scale tip path chart
- `src/style.css`: HUD styling

Keys: L linear, R rotary, X exploded, S stick-slip, Space pause, 1/2/3 phase −90/0/+90.
