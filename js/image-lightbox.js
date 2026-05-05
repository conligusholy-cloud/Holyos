// =============================================================================
// HolyOS — Image Lightbox
// =============================================================================
// Globální helper window.openImageLightbox(url, title?) zobrazí fotku ve floating
// "okně" přes obsah stránky. Zavírá se klikem na backdrop, X tlačítkem nebo ESC.
// Stačí na stránce načíst <script src="/js/image-lightbox.js"></script>.
// =============================================================================
(function () {
  if (window.__holyosLightboxInstalled) return;
  window.__holyosLightboxInstalled = true;

  // Lightbox markup — vytvoříme jednou a recyklujeme.
  const overlay = document.createElement('div');
  overlay.id = 'holyos-image-lightbox';
  overlay.style.cssText = [
    'position:fixed', 'inset:0',
    'background:rgba(0,0,0,0.78)',
    'backdrop-filter:blur(2px)',
    'display:none', 'align-items:center', 'justify-content:center',
    'z-index:99999',
    'cursor:zoom-out',
    'user-select:none',
  ].join(';');

  const frame = document.createElement('div');
  frame.style.cssText = [
    'position:relative',
    'max-width:92vw', 'max-height:92vh',
    'background:#0f172a',
    'border:1px solid rgba(255,255,255,0.15)',
    'border-radius:12px',
    'box-shadow:0 24px 64px rgba(0,0,0,0.6)',
    'overflow:hidden',
    'cursor:default',
    'display:flex', 'flex-direction:column',
  ].join(';');
  // Klik dovnitř rámečku se nepropaguje na overlay (nezavírá to)
  frame.addEventListener('click', e => e.stopPropagation());

  const titleBar = document.createElement('div');
  titleBar.style.cssText = [
    'display:flex', 'align-items:center', 'justify-content:space-between',
    'gap:12px',
    'padding:10px 14px',
    'background:rgba(255,255,255,0.04)',
    'border-bottom:1px solid rgba(255,255,255,0.08)',
    'color:#e2e8f0',
    'font:600 14px system-ui, sans-serif',
  ].join(';');

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.title = 'Zavřít (ESC)';
  closeBtn.style.cssText = [
    'background:transparent', 'border:0',
    'color:#e2e8f0',
    'font-size:24px', 'line-height:1',
    'cursor:pointer',
    'padding:2px 10px',
    'border-radius:6px',
    'transition:background 0.15s',
  ].join(';');
  closeBtn.addEventListener('mouseenter', () => closeBtn.style.background = 'rgba(255,255,255,0.1)');
  closeBtn.addEventListener('mouseleave', () => closeBtn.style.background = 'transparent');
  closeBtn.addEventListener('click', closeLightbox);

  titleBar.appendChild(titleEl);
  titleBar.appendChild(closeBtn);

  const imgWrap = document.createElement('div');
  imgWrap.style.cssText = [
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:#020617',
    'min-width:240px', 'min-height:160px',
    'flex:1', 'overflow:auto',
  ].join(';');

  const img = document.createElement('img');
  img.alt = '';
  img.style.cssText = [
    'max-width:88vw', 'max-height:80vh',
    'object-fit:contain',
    'display:block',
  ].join(';');
  imgWrap.appendChild(img);

  frame.appendChild(titleBar);
  frame.appendChild(imgWrap);
  overlay.appendChild(frame);

  // Klik na backdrop zavírá
  overlay.addEventListener('click', closeLightbox);

  // ESC zavírá
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display === 'flex') closeLightbox();
  });

  function openLightbox(url, title) {
    if (!url) return;
    img.src = url;
    titleEl.textContent = title || '';
    overlay.style.display = 'flex';
  }

  function closeLightbox() {
    overlay.style.display = 'none';
    img.src = '';
  }

  // Připoj overlay až je <body> hotové
  if (document.body) {
    document.body.appendChild(overlay);
  } else {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(overlay));
  }

  window.openImageLightbox = openLightbox;
  window.closeImageLightbox = closeLightbox;
})();
