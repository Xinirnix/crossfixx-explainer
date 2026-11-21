// Card on the landing page. Every src/<slug>/meta.js is picked up automatically.
import thumb from './thumb.jpg';

export default {
  title: 'How an optical encoder reads nanometres from a 20 µm grating',
  summary: 'Sine and cosine from the read head trace a circle; the angle around it splits each grating period into thousands of counts. Add offset, gain or phase error and the circle turns into an ellipse, with a position error that repeats every period.',
  tags: ['Encoder', 'Interpolation', 'Accuracy'],
  order: 25,
  thumb,
};
