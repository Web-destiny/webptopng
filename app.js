const input = document.querySelector('#fileInput');
const dropzone = document.querySelector('#dropzone');
const queue = document.querySelector('#queue');
const list = document.querySelector('#fileList');
const summary = document.querySelector('#summary');
const count = document.querySelector('#count');
const downloadAll = document.querySelector('#downloadAll');
let items = [];
let generation = 0;
let working = false;

function render() {
  queue.hidden = items.length === 0;
  count.textContent = `(${items.length})`;
  const done = items.filter(item => item.blob).length;
  const pending = items.filter(item => item.state === 'waiting' || item.state === 'processing').length;
  summary.textContent = pending ? `Готово ${done} из ${items.length} · обрабатываем изображения` : `Готово ${done} из ${items.length}`;
  downloadAll.disabled = !done || pending > 0;
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement('li');
    const icon = document.createElement('span'); icon.className = 'file-symbol'; icon.textContent = 'PNG';
    const info = document.createElement('div'); info.className = 'file-info';
    const name = document.createElement('div'); name.className = 'file-name'; name.textContent = item.name;
    const status = document.createElement('div'); status.className = 'file-status' + (item.state === 'error' ? ' error' : '');
    status.textContent = ({waiting:'В очереди', processing:'Конвертируем…', done:'Готово', error:'Не удалось открыть изображение'})[item.state];
    info.append(name, status); row.append(icon, info);
    if (item.url) { const link = document.createElement('a'); link.className = 'file-download'; link.href = item.url; link.download = item.outputName; link.textContent = 'Скачать ↓'; row.append(link); }
    list.append(row);
  }
}
function addFiles(files) {
  for (const file of files) {
    const base = file.name.replace(/\.[^.]+$/, '') || 'image';
    items.push({file, name:file.name, outputName:`${base}.png`, state:'waiting'});
  }
  input.value = ''; render(); processQueue();
}
async function convert(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); if (!context || !canvas.width || !canvas.height) throw new Error('Invalid image');
    context.drawImage(image, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Conversion failed')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
async function processQueue() {
  if (working) return;
  working = true;
  try {
    while (true) {
      const item = items.find(entry => entry.state === 'waiting'); if (!item) break;
      const currentGeneration = generation; item.state = 'processing'; render();
      try { const blob = await convert(item.file); if (generation !== currentGeneration) continue; item.blob = blob; item.url = URL.createObjectURL(blob); item.state = 'done'; }
      catch { if (generation === currentGeneration) item.state = 'error'; }
      render();
    }
  } finally { working = false; render(); }
}
const crcTable = Array.from({length:256}, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(data) { let crc = 0xffffffff; for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function header(size, fields) { const data = new Uint8Array(size); const view = new DataView(data.buffer); for (const [offset, value, bytes] of fields) bytes === 2 ? view.setUint16(offset, value, true) : view.setUint32(offset, value, true); return data; }
async function makeZip(entries) {
  const parts = [], central = []; let offset = 0; const encoder = new TextEncoder(); const names = new Set();
  for (const item of entries) {
    let filename = item.outputName, suffix = 2; const base = filename.slice(0, -4);
    while (names.has(filename.toLowerCase())) filename = `${base} (${suffix++}).png`;
    names.add(filename.toLowerCase());
    const name = encoder.encode(filename), data = new Uint8Array(await item.blob.arrayBuffer()), crc = crc32(data);
    const local = header(30, [[0,0x04034b50,4],[4,20,2],[6,0x800,2],[14,crc,4],[18,data.length,4],[22,data.length,4],[26,name.length,2]]);
    const directory = header(46, [[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[16,crc,4],[20,data.length,4],[24,data.length,4],[28,name.length,2],[42,offset,4]]);
    parts.push(local, name, data); central.push(directory, name); offset += local.length + name.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = header(22, [[0,0x06054b50,4],[8,entries.length,2],[10,entries.length,2],[12,centralSize,4],[16,offset,4]]);
  return new Blob([...parts, ...central, end], {type:'application/zip'});
}
dropzone.addEventListener('click', () => input.click());
dropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
input.addEventListener('change', () => addFiles(input.files));
document.querySelector('#addMore').addEventListener('click', () => input.click());
for (const name of ['dragenter', 'dragover']) dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove('dragging'); });
dropzone.addEventListener('drop', event => addFiles(event.dataTransfer.files));
document.querySelector('#clear').addEventListener('click', () => { generation++; for (const item of items) if (item.url) URL.revokeObjectURL(item.url); items = []; render(); });
downloadAll.addEventListener('click', async () => {
  const entries = items.filter(item => item.blob); if (!entries.length) return;
  downloadAll.disabled = true; downloadAll.textContent = 'Собираем архив…';
  try { const zip = await makeZip(entries); const url = URL.createObjectURL(zip); const link = document.createElement('a'); link.href = url; link.download = 'kartinki-png.zip'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  catch { summary.textContent = 'Не удалось собрать архив. Попробуйте скачать файлы по одному.'; }
  finally { downloadAll.innerHTML = 'Скачать всё в ZIP <span>↓</span>'; render(); }
});
