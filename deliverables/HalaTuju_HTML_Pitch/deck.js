(() => {
  const BASE_W = 1440, BASE_H = 810;
  const slides = [...document.querySelectorAll('.slide')];
  const mainCount = slides.filter(s => !s.hasAttribute('data-appendix')).length;
  const stage = document.getElementById('stage');
  const counter = document.getElementById('counter');
  const progress = document.querySelector('#progress i');
  const notesPanel = document.getElementById('notes-panel');
  const menuPanel = document.getElementById('menu-panel');
  const notesContent = document.getElementById('notes-content');
  const menuList = document.getElementById('menu-list');
  const revealed = new Map();
  let current = 0;

  function fit() {
    const scale = Math.min(window.innerWidth / BASE_W, (window.innerHeight - 56) / BASE_H);
    stage.style.transform = `scale(${Math.max(.1, scale)})`;
  }
  function fragments(slide) {
    return [...new Set([...slide.querySelectorAll('[data-fragment]')].map(el => Number(el.dataset.fragment)))].sort((a,b) => a-b);
  }
  function applyFragments(slide) {
    const count = revealed.get(slide) || 0;
    const steps = fragments(slide);
    slide.querySelectorAll('[data-fragment]').forEach(el => el.classList.toggle('is-visible', steps.indexOf(Number(el.dataset.fragment)) < count));
  }
  function label(index) {
    return index < mainCount ? `${index + 1} / ${mainCount}` : `A${index - mainCount + 1} / ${slides.length - mainCount}`;
  }
  function updatePanels() {
    notesContent.textContent = slides[current].querySelector('.speaker-notes')?.textContent.trim() || 'No notes for this slide.';
    [...menuList.children].forEach((el,i) => el.setAttribute('aria-current', i === current ? 'true' : 'false'));
  }
  function show(index) {
    current = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide,i) => {
      const on = i === current;
      slide.classList.toggle('active', on);
      slide.setAttribute('aria-hidden', String(!on));
      if (on) applyFragments(slide);
    });
    counter.textContent = label(current);
    progress.style.width = `${current < mainCount ? (current + 1) / mainCount * 100 : 100}%`;
    document.getElementById('prev').disabled = current === 0;
    document.getElementById('next').disabled = current === slides.length - 1 || (current === mainCount - 1 && (revealed.get(slides[current]) || 0) >= fragments(slides[current]).length);
    document.getElementById('appendix-toggle').textContent = current < mainCount ? 'Q&A' : 'Main';
    history.replaceState(null, '', `#${current < mainCount ? `slide-${current + 1}` : `appendix-${current - mainCount + 1}`}`);
    updatePanels();
  }
  function next() {
    const slide = slides[current], steps = fragments(slide), count = revealed.get(slide) || 0;
    if (count < steps.length) { revealed.set(slide, count + 1); applyFragments(slide); return; }
    if (current === mainCount - 1) return;
    show(current + 1);
  }
  function prev() {
    const slide = slides[current], count = revealed.get(slide) || 0;
    if (count > 0) { revealed.set(slide, count - 1); applyFragments(slide); return; }
    if (current > 0) show(current - 1);
  }
  function togglePanel(panel) {
    const open = panel.hidden;
    notesPanel.hidden = true;
    menuPanel.hidden = true;
    panel.hidden = !open;
  }
  function markInteracted() { document.body.classList.add('has-interacted'); }

  slides.forEach((slide,i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${i < mainCount ? String(i + 1).padStart(2,'0') : `A${i - mainCount + 1}`}  ${slide.dataset.title}`;
    button.addEventListener('click', () => { show(i); menuPanel.hidden = true; markInteracted(); });
    menuList.appendChild(button);
  });
  document.getElementById('prev').addEventListener('click', () => { prev(); markInteracted(); });
  document.getElementById('next').addEventListener('click', () => { next(); markInteracted(); });
  document.getElementById('notes-toggle').addEventListener('click', () => { togglePanel(notesPanel); markInteracted(); });
  document.getElementById('notes-close').addEventListener('click', () => notesPanel.hidden = true);
  document.getElementById('menu-toggle').addEventListener('click', () => { togglePanel(menuPanel); markInteracted(); });
  document.getElementById('menu-close').addEventListener('click', () => menuPanel.hidden = true);
  document.getElementById('appendix-toggle').addEventListener('click', () => { show(current < mainCount ? mainCount : mainCount - 1); markInteracted(); });
  document.getElementById('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { /* Fullscreen is optional in file and embedded browser contexts. */ }
    markInteracted();
  });
  window.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || ['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const key = e.key.toLowerCase();
    if (['arrowright','pagedown',' '].includes(key)) { e.preventDefault(); next(); }
    else if (['arrowleft','pageup','backspace'].includes(key)) { e.preventDefault(); prev(); }
    else if (key === 'home') { e.preventDefault(); show(0); }
    else if (key === 'end') { e.preventDefault(); show(mainCount - 1); }
    else if (key === 'n') togglePanel(notesPanel);
    else if (key === 'm') togglePanel(menuPanel);
    else if (key === 'q') show(current < mainCount ? mainCount : mainCount - 1);
    else if (key === 'f') document.getElementById('fullscreen').click();
    else if (key === 'escape') { notesPanel.hidden = true; menuPanel.hidden = true; }
    else return;
    markInteracted();
  });
  let touchX = null;
  stage.addEventListener('touchstart', e => { touchX = e.changedTouches[0]?.clientX ?? null; }, {passive:true});
  stage.addEventListener('touchend', e => {
    if (touchX == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
    if (Math.abs(dx) > 60) { dx < 0 ? next() : prev(); markInteracted(); }
    touchX = null;
  }, {passive:true});
  window.addEventListener('resize', fit);
  window.addEventListener('hashchange', () => {
    const h = location.hash.match(/^#(slide|appendix)-(\d+)$/);
    if (h) show(h[1] === 'appendix' ? mainCount + Number(h[2]) - 1 : Number(h[2]) - 1);
  });
  const match = location.hash.match(/^#(?:slide|appendix)-(\d+)$/);
  if (match) show(location.hash.startsWith('#appendix') ? mainCount + Number(match[1]) - 1 : Number(match[1]) - 1);
  else show(0);
  fit();
  setTimeout(markInteracted, 5000);
})();
