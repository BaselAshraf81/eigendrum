/**
 * The simulated Erae, docked in the page. Loaded only when the URL has ?sim.
 *
 * The simulator used to be a second tab, and browsers pause requestAnimationFrame
 * in a hidden tab, so looking at the simulator stopped the LED frames that
 * Eigendrum sends from its frame loop. Side by side in one page, both stay
 * visible and the frames keep coming. The iframe is same origin, so it shares
 * the 'erae-sim' BroadcastChannel with midi-shim.js and no protocol changes.
 */
const SIM_PATH = 'tools/erae-sim/sim.html';
// Below this width the dock would cover the controls, so it starts collapsed.
const NARROW_PX = 900;
function button(label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip chip-tiny';
  b.textContent = label;
  return b;
}
export function mountDock() {
  const dock = document.createElement('section');
  dock.className = 'sim-dock';
  dock.setAttribute('aria-label', 'Simulated Erae');
  const bar = document.createElement('div');
  bar.className = 'sim-dock-bar';
  const title = document.createElement('span');
  title.className = 'sim-dock-title';
  title.textContent = 'simulated erae';
  const toggle = button('hide');
  const popOut = document.createElement('a');
  popOut.className = 'chip chip-tiny';
  popOut.href = SIM_PATH;
  popOut.target = '_blank';
  popOut.rel = 'noopener';
  popOut.textContent = 'open in own window';
  bar.append(title, toggle, popOut);
  const frame = document.createElement('iframe');
  frame.className = 'sim-dock-frame';
  frame.title = 'Simulated Erae 2';
  frame.src = `${SIM_PATH}?docked`;
  dock.append(bar, frame);
  function collapse(collapsed) {
    dock.classList.toggle('is-collapsed', collapsed);
    toggle.textContent = collapsed ? 'show' : 'hide';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }
  toggle.addEventListener('click', () => collapse(!dock.classList.contains('is-collapsed')));
  // Two simulators would both answer the host, so the dock goes before the window opens.
  popOut.addEventListener('click', () => dock.remove());
  collapse(window.innerWidth < NARROW_PX);
  document.body.appendChild(dock);
}
