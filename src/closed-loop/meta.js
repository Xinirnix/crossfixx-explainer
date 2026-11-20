// Card on the landing page. Every src/<slug>/meta.js is picked up automatically.
import thumb from './thumb.jpg';

export default {
  title: 'How the controller lands a piezo stage',
  summary: 'The closed loop turns encoder error into amplitude and phase, slows near the target and switches off inside PTOL. Tune PROP, FREQ, zones and tolerances and watch overshoot, hunting or stalling appear.',
  tags: ['Closed loop', 'Tuning', 'Encoder'],
  order: 20,
  thumb,
};
