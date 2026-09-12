(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let busy = false, customId = false, objectUrl = '';
  const query = new URLSearchParams(location.search);
  const status = message => { $('file-status').textContent = message; };
  function theme(value) { document.documentElement.dataset.theme = value; try { localStorage.setItem('hiraethDmTheme', value); } catch (_) {} }
  try { theme(localStorage.getItem('hiraethDmTheme') === 'dark' ? 'dark' : 'light'); } catch (_) {}
  $('file-theme').addEventListener('click', () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  async function request(url) {
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || 'The request could not be completed.');
    return data;
  }
  async function openEditor() {

    if (query.has('help')) { $('file-help').hidden = false; status(''); return; }
    if (!query.has('new-map')) { location.replace('/studio/editor'); return; }
    const data = await request('/api/studio/map-options');
    for (const parent of data.parents || []) {
      const option = document.createElement('option'); option.value = parent.id; option.textContent = parent.name || parent.id; $('map-parent').append(option);
    }
    $('file-create').hidden = false; status(''); $('map-name').focus();
  }
  $('map-id').addEventListener('input', () => { customId = true; });
  $('map-name').addEventListener('input', () => {
    if (!customId) $('map-id').value = $('map-name').value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  });
  $('map-artwork').addEventListener('change', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const file = $('map-artwork').files[0]; $('artwork-preview').hidden = !file;
    if (file) { objectUrl = URL.createObjectURL(file); $('artwork-preview').src = objectUrl; }
  });
  $('create-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const artwork = $('map-artwork').files[0]; if (!artwork) return;
    busy = true; const button = event.submitter; button.disabled = true; status('Preparing your download…');
    let bitmap;
    try {
      const id = $('map-id').value, name = $('map-name').value, parentId = $('map-parent').value;
      const manifest = await request('/maps/maps.json');
      const entries = Array.isArray(manifest) ? manifest : manifest.maps;
      if (entries.some(entry => entry.id === id)) throw new Error('That file name is already used. Choose another name.');
      bitmap = await createImageBitmap(artwork);
      const render = async maximum => {
        const factor = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * factor); canvas.height = Math.round(bitmap.height * factor);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .92));
        if (!blob || blob.type !== 'image/webp') throw new Error('This browser cannot prepare WebP artwork. Use a browser with WebP export support.');
        return blob;
      };
      const mapDocument = { id, name, width:bitmap.width, height:bitmap.height, imageUrl:`maps/${id}.webp`, pointsOfInterest:[], regions:[], lines:[] };
      const siblings = entries.filter(entry => (entry.parentId || '') === parentId);
      entries.push({id,name,dataUrl:`maps/${id}.json`,order:Math.max(-1,...siblings.map(entry=>Number(entry.order)||0))+1,...(parentId ? {parentId} : {})});
      const files = [{name:`maps/${id}.json`,data:MapFileDownload.json(mapDocument)}, {name:'maps/maps.json',data:MapFileDownload.json(manifest)},
        {name:`maps/${id}.webp`,data:artwork.type==='image/webp'?artwork:await render(Infinity)}, {name:`maps/${id}.mini.webp`,data:await render(512)}];
      MapFileDownload.download(`${id}-map.zip`,await MapFileDownload.archive(files));
      status('Download requested. Add these files to the maps folder yourself, then refresh the editor. Nothing was uploaded.');
    } catch (error) { status(error.message); } finally { bitmap?.close(); busy = false; button.disabled = false; }
  });
  openEditor().catch(error => status(error.message));
}());
