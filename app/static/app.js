const $ = (selector) => document.querySelector(selector);
const form = $('#upload-form');
const input = $('#image-input');
const button = $('#analyze-button');
const message = $('#message');
const empty = $('#empty-state');
const canvasWrap = $('#canvas-wrap');
const canvas = $('#result-canvas');
const summary = $('#summary');
const dropZone = $('#drop-zone');
const selectionPreview = $('#selection-preview');
const editCrop = $('#edit-crop');
const cropDialog = $('#crop-dialog');
const cropImage = $('#crop-image');
const cropBox = $('#crop-box');

let sourceFile = null;
let selectedFile = null;
let sourceUrl = null;
let previewUrl = null;
let aspectRatio = null;
let crop = { x: 0, y: 0, width: 0, height: 0 };
let pointerState = null;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function normalizeCrop(candidate) {
  const imageWidth = cropImage.naturalWidth;
  const imageHeight = cropImage.naturalHeight;
  const width = clamp(candidate.width, 1, imageWidth);
  const height = clamp(candidate.height, 1, imageHeight);
  return {
    x: clamp(candidate.x, 0, imageWidth - width),
    y: clamp(candidate.y, 0, imageHeight - height),
    width,
    height,
  };
}

function renderCrop() {
  crop = normalizeCrop(crop);
  const width = cropImage.naturalWidth;
  const height = cropImage.naturalHeight;
  cropBox.style.left = `${crop.x / width * 100}%`;
  cropBox.style.top = `${crop.y / height * 100}%`;
  cropBox.style.width = `${crop.width / width * 100}%`;
  cropBox.style.height = `${crop.height / height * 100}%`;
}

function resetCrop(ratio = aspectRatio) {
  const imageWidth = cropImage.naturalWidth;
  const imageHeight = cropImage.naturalHeight;
  if (!ratio) {
    crop = { x: 0, y: 0, width: imageWidth, height: imageHeight };
  } else {
    let width = imageWidth * 0.9;
    let height = width / ratio;
    if (height > imageHeight * 0.9) {
      height = imageHeight * 0.9;
      width = height * ratio;
    }
    crop = { x: (imageWidth - width) / 2, y: (imageHeight - height) / 2, width, height };
  }
  renderCrop();
}

function openCropper(file) {
  sourceFile = file;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  cropImage.onload = () => {
    aspectRatio = null;
    document.querySelectorAll('.ratio').forEach((item) => item.classList.toggle('active', item.dataset.ratio === 'free'));
    resetCrop();
    cropDialog.showModal();
    requestAnimationFrame(() => cropDialog.classList.add('visible'));
  };
  cropImage.src = sourceUrl;
}

function closeCropper() {
  cropDialog.classList.remove('visible');
  setTimeout(() => { if (cropDialog.open) cropDialog.close(); }, 180);
}

function chooseFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    message.textContent = 'Выберите файл изображения.';
    message.className = 'message error';
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    message.textContent = 'Размер изображения превышает 8 МБ.';
    message.className = 'message error';
    return;
  }
  message.textContent = '';
  openCropper(file);
}

cropBox.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  const rect = cropImage.getBoundingClientRect();
  pointerState = {
    id: event.pointerId,
    action: event.target.dataset.handle || 'move',
    startX: event.clientX,
    startY: event.clientY,
    scaleX: cropImage.naturalWidth / rect.width,
    scaleY: cropImage.naturalHeight / rect.height,
    crop: { ...crop },
  };
  cropBox.setPointerCapture(event.pointerId);
});

cropBox.addEventListener('pointermove', (event) => {
  if (!pointerState || event.pointerId !== pointerState.id) return;
  const state = pointerState;
  const dx = (event.clientX - state.startX) * state.scaleX;
  const dy = (event.clientY - state.startY) * state.scaleY;
  const imageWidth = cropImage.naturalWidth;
  const imageHeight = cropImage.naturalHeight;

  if (state.action === 'move') {
    crop = normalizeCrop({ ...state.crop, x: state.crop.x + dx, y: state.crop.y + dy });
    renderCrop();
    return;
  }

  const fromLeft = state.action.includes('w');
  const fromTop = state.action.includes('n');
  const anchorX = fromLeft ? state.crop.x + state.crop.width : state.crop.x;
  const anchorY = fromTop ? state.crop.y + state.crop.height : state.crop.y;
  const pointerX = clamp((fromLeft ? state.crop.x : state.crop.x + state.crop.width) + dx, 0, imageWidth);
  const pointerY = clamp((fromTop ? state.crop.y : state.crop.y + state.crop.height) + dy, 0, imageHeight);

  if (aspectRatio) {
    const availableWidth = fromLeft ? anchorX : imageWidth - anchorX;
    const availableHeight = fromTop ? anchorY : imageHeight - anchorY;
    let width = Math.max(1, Math.abs(pointerX - anchorX));
    let height = Math.max(1, Math.abs(pointerY - anchorY));
    if (width / height > aspectRatio) height = width / aspectRatio;
    else width = height * aspectRatio;
    const fit = Math.min(1, availableWidth / width, availableHeight / height);
    width = Math.max(1, width * fit);
    height = Math.max(1, height * fit);
    crop = {
      x: fromLeft ? anchorX - width : anchorX,
      y: fromTop ? anchorY - height : anchorY,
      width,
      height,
    };
  } else {
    const minSize = Math.min(32, imageWidth, imageHeight);
    const edgeX = fromLeft ? clamp(pointerX, 0, anchorX - minSize) : clamp(pointerX, anchorX + minSize, imageWidth);
    const edgeY = fromTop ? clamp(pointerY, 0, anchorY - minSize) : clamp(pointerY, anchorY + minSize, imageHeight);
    crop = {
      x: Math.min(edgeX, anchorX),
      y: Math.min(edgeY, anchorY),
      width: Math.abs(edgeX - anchorX),
      height: Math.abs(edgeY - anchorY),
    };
  }
  renderCrop();
});

function finishPointer(event) {
  if (pointerState?.id === event.pointerId) pointerState = null;
}
cropBox.addEventListener('pointerup', finishPointer);
cropBox.addEventListener('pointercancel', finishPointer);

document.querySelectorAll('.ratio').forEach((item) => item.addEventListener('click', () => {
  aspectRatio = item.dataset.ratio === 'free' ? null : Number(item.dataset.ratio);
  document.querySelectorAll('.ratio').forEach((buttonItem) => buttonItem.classList.toggle('active', buttonItem === item));
  resetCrop();
}));

$('#crop-apply').addEventListener('click', () => {
  crop = normalizeCrop(crop);
  const sx = clamp(Math.round(crop.x), 0, cropImage.naturalWidth - 1);
  const sy = clamp(Math.round(crop.y), 0, cropImage.naturalHeight - 1);
  const sw = Math.max(1, Math.min(Math.round(crop.width), cropImage.naturalWidth - sx));
  const sh = Math.max(1, Math.min(Math.round(crop.height), cropImage.naturalHeight - sy));
  const output = document.createElement('canvas');
  output.width = sw;
  output.height = sh;
  output.getContext('2d').drawImage(cropImage, sx, sy, sw, sh, 0, 0, sw, sh);
  const outputType = sourceFile.type === 'image/png' ? 'image/png' : 'image/jpeg';
  output.toBlob((blob) => {
    if (!blob) {
      message.textContent = 'Не удалось подготовить изображение.';
      message.className = 'message error';
      return;
    }
    const extension = outputType === 'image/png' ? 'png' : 'jpg';
    const baseName = sourceFile.name.replace(/\.[^.]+$/, '');
    selectedFile = new File([blob], `${baseName}-crop.${extension}`, { type: outputType });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(selectedFile);
    selectionPreview.src = previewUrl;
    selectionPreview.hidden = false;
    dropZone.classList.add('has-preview');
    dropZone.querySelector('strong').textContent = selectedFile.name;
    dropZone.querySelector('small').textContent = `${sw}×${sh} · ${(selectedFile.size / 1024 / 1024).toFixed(2)} МБ`;
    button.disabled = false;
    editCrop.hidden = false;
    closeCropper();
  }, outputType, 0.92);
});

$('#crop-close').addEventListener('click', closeCropper);
$('#crop-cancel').addEventListener('click', closeCropper);
cropDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeCropper(); });
editCrop.addEventListener('click', () => sourceFile && openCropper(sourceFile));
input.addEventListener('change', () => chooseFile(input.files[0]));
['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
}));
dropZone.addEventListener('drop', (event) => chooseFile(event.dataTransfer.files[0]));

function drawResult(file, result) {
  const image = new Image();
  image.onload = () => {
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, result.width, result.height);
    const lineWidth = Math.max(2, result.width / 350);
    const fontSize = Math.max(16, result.width / 45);
    ctx.lineWidth = lineWidth;
    ctx.font = `700 ${fontSize}px system-ui`;
    ctx.textBaseline = 'top';
    result.detections.forEach(({ label, confidence, xyxy }) => {
      const [x1, y1, x2, y2] = xyxy;
      const text = `${label} ${Math.round(confidence * 100)}%`;
      const padding = fontSize * 0.35;
      const textWidth = ctx.measureText(text).width;
      const labelY = Math.max(0, y1 - fontSize - padding * 2);
      ctx.strokeStyle = '#78f4d8';
      ctx.fillStyle = '#78f4d8';
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.fillRect(x1, labelY, textWidth + padding * 2, fontSize + padding * 2);
      ctx.fillStyle = '#04251e';
      ctx.fillText(text, x1 + padding, labelY + padding);
    });
    URL.revokeObjectURL(image.src);
    empty.hidden = true;
    canvasWrap.hidden = false;
    summary.hidden = false;
    canvasWrap.classList.remove('reveal');
    summary.classList.remove('reveal');
    void canvasWrap.offsetWidth;
    canvasWrap.classList.add('reveal');
    summary.classList.add('reveal');
    const count = result.detections.length;
    const title = count ? `Найдено объектов: ${count}` : 'Объекты не найдены';
    summary.innerHTML = `<strong>${title}</strong><span>${result.latency_ms.toFixed(0)} мс · ${result.width}×${result.height}</span>`;
  };
  image.src = URL.createObjectURL(file);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedFile) return;
  button.disabled = true;
  button.classList.add('loading');
  button.textContent = 'Анализируем…';
  message.textContent = 'Подготавливаем результат.';
  message.className = 'message';
  const data = new FormData();
  data.append('image', selectedFile, selectedFile.name);
  try {
    const response = await fetch('/v1/detect', { method: 'POST', body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Не удалось обработать изображение');
    drawResult(selectedFile, result);
    message.textContent = 'Готово';
    message.className = 'message success';
  } catch (error) {
    message.textContent = error.message;
    message.className = 'message error';
  } finally {
    button.disabled = false;
    button.classList.remove('loading');
    button.textContent = 'Распознать снова';
  }
});
