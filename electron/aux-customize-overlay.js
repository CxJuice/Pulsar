const api = window.auxCustomization;
const list = document.querySelector('ol');
const closeButton = document.querySelector('.close');
const dockOverlay = document.querySelector('.dock-overlay');
let draggedId = '';
let overlayState = { mode: 'customize', draggedPanel: null, groupId: null };

api.onState(state => {
  overlayState = state;
  const mode = state.mode === 'dock' ? 'dock' : 'customize';
  document.body.dataset.mode = mode;
  dockOverlay.hidden = mode !== 'dock';
  for (const [name, value] of Object.entries(state.theme || {})) document.documentElement.style.setProperty(`--${name}`, value);
  list.replaceChildren();
  if (mode === 'dock') return;
  for (const item of state.items || []) {
    const row = document.createElement('li');
    row.draggable = true;
    row.dataset.id = item.id;
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.textContent = '⠿';
    grip.setAttribute('aria-hidden', 'true');
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.checked;
    checkbox.disabled = item.disabled;
    checkbox.addEventListener('change', () => api.send({ type: 'toggle', id: item.id }));
    const labelText = document.createElement('span');
    labelText.textContent = item.label;
    label.append(checkbox, labelText);
    const up = document.createElement('button');
    up.className = 'move';
    up.type = 'button';
    up.textContent = '⌃';
    up.title = `将${item.label}移到上方`;
    up.setAttribute('aria-label', up.title);
    up.disabled = item.first;
    up.addEventListener('click', () => api.send({ type: 'move', id: item.id, direction: -1 }));
    const down = document.createElement('button');
    down.className = 'move';
    down.type = 'button';
    down.textContent = '⌄';
    down.title = `将${item.label}移到下方`;
    down.setAttribute('aria-label', down.title);
    down.disabled = item.last;
    down.addEventListener('click', () => api.send({ type: 'move', id: item.id, direction: 1 }));
    row.addEventListener('dragstart', event => {
      draggedId = item.id;
      event.dataTransfer?.setData('text/plain', item.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', event => {
      event.preventDefault();
      row.classList.add('drop-target');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('dragleave', event => {
      if (!row.contains(event.relatedTarget)) row.classList.remove('drop-target');
    });
    row.addEventListener('drop', event => {
      event.preventDefault();
      const sourceId = draggedId || event.dataTransfer?.getData('text/plain') || '';
      if (sourceId && sourceId !== item.id) api.send({ type: 'reorder', id: sourceId, targetId: item.id });
      draggedId = '';
    });
    row.addEventListener('dragend', () => {
      draggedId = '';
      document.querySelectorAll('.drop-target').forEach(element => element.classList.remove('drop-target'));
    });
    row.append(grip, label, up, down);
    list.append(row);
  }
});

closeButton.addEventListener('click', () => api.send({ type: 'close' }));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') api.send({ type: 'close' });
});

function allowDockDrop(event) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}
function dropOnDockZone(event, zone) {
  event.preventDefault();
  event.stopPropagation();
  const panel = overlayState.draggedPanel || event.dataTransfer?.getData('text/plain') || '';
  const groupId = overlayState.groupId || '';
  if (panel && groupId) api.send({ type: 'dock', panel, groupId, zone });
  dockOverlay.querySelectorAll('.drag-over').forEach(element => element.classList.remove('drag-over'));
}
dockOverlay.addEventListener('dragover', allowDockDrop);
dockOverlay.addEventListener('drop', event => dropOnDockZone(event, 'center'));
dockOverlay.addEventListener('dragend', () => dockOverlay.querySelectorAll('.drag-over').forEach(element => element.classList.remove('drag-over')));
for (const button of dockOverlay.querySelectorAll('[data-zone]')) {
  button.addEventListener('dragenter', event => { allowDockDrop(event); button.classList.add('drag-over'); });
  button.addEventListener('dragleave', event => { if (!button.contains(event.relatedTarget)) button.classList.remove('drag-over'); });
  button.addEventListener('dragover', allowDockDrop);
  button.addEventListener('drop', event => dropOnDockZone(event, button.dataset.zone));
}
