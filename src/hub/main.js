// Landing page: one card per explainer, read from every src/<slug>/meta.js.
import './style.css';

const metas = import.meta.glob('../*/meta.js', { eager: true, import: 'default' });

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const pages = Object.entries(metas)
  .map(([path, meta]) => ({ slug: path.split('/')[1], ...meta }))
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));

document.getElementById('cards').innerHTML = pages.map((p) => `
  <li class="card">
    <a href="${esc(p.slug)}/">
      <div class="thumb">${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy" />` : ''}</div>
      <div class="body">
        <h2>${esc(p.title)}</h2>
        <p>${esc(p.summary ?? '')}</p>
        ${p.tags?.length ? `<ul class="tags">${p.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      </div>
    </a>
  </li>`).join('');
