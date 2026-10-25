// ===== SHIFT MAPPING =====
const shiftMap = {
  '07.00': '07:00-19:00',
  '08.00': '08:00-20:00',
  '19.00': '19:00-07:00',
  '20.00': '20:00-08:00',
  '8x5': '8x5',
};

// ===== WEBHOOK URL =====
const WEBHOOK_URL = "https://default45be8033beb74d4bab77608ee11e64.49.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/28/workflows/da2daa5e8450486590aea098d3bde28e/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=_Z3x_KwTSNo5_1jOD10WT89QLGHWnbjdEg21Qz4G184";

// ===== STATE =====
const state = {
  name: '',
  shift: '',
  role: 'NOC Engineer',
  project: 'Cloud Operation Support',
  status: 'On-site',
  photoDataUrl: null,
  photoFile: null,
  history: JSON.parse(localStorage.getItem('checkin_history') || '[]'),
  cameraActive: false,
  workers: [],
  rosterData: null,
  cameraStream: null,
  camFacing: 'environment',
  lastRecord: null,
};

// ===== ELEMENTS =====
const screens = {
  dashboard: document.getElementById('screen-dashboard'),
  form: document.getElementById('screen-form'),
  camera: document.getElementById('screen-camera'),
  confirm: document.getElementById('screen-confirm'),
  success: document.getElementById('screen-success'),
};

const selectName = document.getElementById('selectName');
const selectShift = document.getElementById('selectShift');
const selectStatus = document.getElementById('selectStatus');
const btnCheckin = document.getElementById('btnCheckin');
const btnToCamera = document.getElementById('btnToCamera');
const btnCapture = document.getElementById('btnCapture');
const btnRetake = document.getElementById('btnRetake');
const btnSubmit = document.getElementById('btnSubmit');
const btnHome = document.getElementById('btnHome');
const btnGallery = document.getElementById('btnGallery');
const cameraVideo = document.getElementById('cameraVideo');
const cameraPlaceholder = document.getElementById('cameraPlaceholder');
const cameraTimestamp = document.getElementById('cameraTimestamp');
const cameraViewfinder = document.getElementById('cameraViewfinder');
const galleryInput = document.getElementById('fileInput');
const galleryPreview = document.getElementById('galleryPreview');
const historyList = document.getElementById('historyList');

let stream = null;
let cameraInterval = null;

// ===== INIT =====
async function init() {
  updateDashboard();
  showScreen('dashboard');

  // Load roster data
  try {
    const resp = await fetch('roster.json');
    state.rosterData = await resp.json();
    populateWorkerSelect();
  } catch (err) {
    console.error('Failed to load roster:', err);
  }

  // Start camera
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    cameraVideo.srcObject = stream;
    state.cameraActive = true;
    cameraPlaceholder.style.display = 'none';
    await cameraVideo.play();
  } catch (err) {
    state.cameraActive = false;
    console.warn('Camera not available:', err);
  }
}

// ===== NAVIGATION =====
function showScreen(name) {
  if (name !== 'camera' && state.cameraActive && cameraVideo.srcObject) {
    cameraVideo.pause();
  }

  Object.keys(screens).forEach(k => screens[k].classList.remove('active'));
  screens[name].classList.add('active');

  if (name === 'camera') {
    updateCameraTimestamp();
    if (cameraInterval) clearInterval(cameraInterval);
    cameraInterval = setInterval(updateCameraTimestamp, 1000);

    if (state.cameraActive && stream) {
      if (cameraVideo.srcObject !== stream) {
        cameraVideo.srcObject = stream;
      }
      cameraVideo.play().catch(() => {});
      cameraPlaceholder.style.display = 'none';
    } else if (!state.cameraActive) {
      startCamera();
    }
  }
}

// ===== DASHBOARD =====
function updateDashboard() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const todayEntry = state.history.find(h => h.date === today);

  const statusIcon = document.getElementById('statusIcon');
  const statusTitle = document.getElementById('statusTitle');
  const statusDesc = document.getElementById('statusDesc');
  const statusCard = document.getElementById('todayStatus');

  if (todayEntry) {
    statusIcon.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    statusTitle.textContent = 'Check-in สำเร็จแลว';
    statusDesc.textContent = `${todayEntry.name} — ${todayEntry.shift} (${todayEntry.status})`;
    statusCard.classList.add('checked-in');
  } else {
    statusIcon.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    statusTitle.textContent = 'ยังไม Check-in';
    statusDesc.textContent = 'วันนี้ยังไมมมีรายงานตอ';
    statusCard.classList.remove('checked-in');
  }

  renderHistory();
}

function renderHistory() {
  if (!historyList) return;
  if (state.history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">ไมมมีประวัติการรายงาน</div>';
    return;
  }
  const items = state.history.slice().reverse().slice(0, 20);
  historyList.innerHTML = items.map(h => {
    const badgeClass = h.status === 'On-site' ? 'onsite' : 'remote';
    return `<div class="history-item">
      <span class="history-date">${h.date}</span>
      <span class="history-details">${h.name} · ${h.shift}</span>
      <span class="history-badge ${badgeClass}">${h.status}</span>
    </div>`;
  }).join('');
}

btnCheckin.addEventListener('click', () => {
  state.photoDataUrl = null;
  state.name = '';
  state.shift = '';
  selectName.value = '';
  galleryPreview.style.display = 'none';
  galleryPreview.src = '';
  cameraViewfinder.classList.remove('has-image');
  showScreen('form');
});

// ===== FORM =====
function populateWorkerSelect() {
  if (!state.rosterData) return;

  const now = new Date();
  const todayDay = String(now.getDate()).padStart(2, '0');
  const roster = state.rosterData;

  const todayWorkers = [];
  roster.workers.forEach(w => {
    if (w.days && w.days[todayDay]) {
      const shiftRaw = w.days[todayDay];
      const shift = shiftMap[shiftRaw] || shiftRaw;
      todayWorkers.push({
        name: w.name,
        shift: shift,
        shiftRaw: shiftRaw,
      });
    }
  });

  state.workers = todayWorkers;

  selectName.innerHTML = '<option value="">— เลือกรายชื่อ —</option>';
  todayWorkers.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.name;
    // Show only full name, NO nickname
    opt.textContent = w.name;
    selectName.appendChild(opt);
  });
}

// ===== NAME CHANGE → Auto-fill shift =====
selectName.addEventListener('change', (e) => {
  const worker = state.workers.find(w => w.name === e.target.value);
  if (worker) {
    selectShift.value = worker.shift;
  }
});

// ===== TO CAMERA =====
btnToCamera.addEventListener('click', () => {
  state.name = selectName.value;
  state.shift = selectShift.value;

  if (!state.name) { shake(selectName); return; }
  if (!state.shift) { shake(selectShift); return; }

  showScreen('camera');
});

// ===== SHAKE VALIDATION =====
function shake(el) {
  el.style.borderColor = 'var(--red)';
  el.parentElement.style.animation = 'none';
  void el.parentElement.offsetHeight;
  el.parentElement.style.animation = 'shakeAnim 0.4s ease';
  setTimeout(() => { el.style.borderColor = ''; }, 1500);
}

// ===== CAMERA =====
async function startCamera() {
  if (state.cameraActive) return;
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    cameraVideo.srcObject = state.cameraStream;
    await cameraVideo.play();
    cameraPlaceholder.style.display = 'none';
    state.cameraActive = true;
  } catch (err) {
    state.cameraActive = false;
  }
}

function updateCameraTimestamp() {
  const now = new Date();
  cameraTimestamp.textContent = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

selectStatus.addEventListener('change', (e) => {
  state.status = e.target.value;
  const badge = document.getElementById('cameraStatusBadge');
  badge.textContent = state.status;
  badge.style.background = state.status === 'On-site'
    ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)';
  badge.style.color = state.status === 'On-site'
    ? 'var(--green)' : 'var(--yellow)';
});

// ===== CAPTURE =====
btnCapture.addEventListener('click', () => {
  if (cameraVideo.readyState >= 2) {
    const canvas = document.createElement('canvas');
    canvas.width = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    canvas.getContext('2d').drawImage(cameraVideo, 0, 0);
    state.photoDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    cameraViewfinder.classList.add('has-image');
    galleryPreview.style.display = 'none';
    showScreen('confirm');
  }
});

// ===== GALLERY =====
btnGallery.addEventListener('click', () => galleryInput.click());

galleryInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    state.photoDataUrl = evt.target.result;
    galleryPreview.src = state.photoDataUrl;
    galleryPreview.style.display = 'block';
    cameraVideo.style.display = 'none';
    cameraViewfinder.classList.add('has-image');
    cameraPlaceholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
});

// ===== RETAKE =====
btnRetake.addEventListener('click', () => {
  state.photoDataUrl = null;
  galleryPreview.style.display = 'none';
  galleryPreview.src = '';
  galleryInput.value = '';
  cameraViewfinder.classList.remove('has-image');
  cameraVideo.style.display = 'block';
  showScreen('camera');
});

// ===== CONFIRMATION =====
function showConfirmation() {
  const now = new Date();
  const thTime = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  document.getElementById('cfName').textContent = state.name;
  document.getElementById('cfShift').textContent = state.shift;
  document.getElementById('cfStatus').textContent = state.status;
  document.getElementById('cfTime').textContent = thTime;
  document.getElementById('confirmPhoto').src = state.photoDataUrl;

  showScreen('confirm');
}

// Override showScreen to populate confirm data
const origShowScreen = showScreen;
showScreen = function(name) {
  origShowScreen(name);
  if (name === 'confirm') {
    showConfirmation();
  }
};

// ===== SUBMIT =====
btnSubmit.addEventListener('click', async () => {
  const btn = btnSubmit;
  btn.disabled = true;
  btn.textContent = 'กําลังสง...';

  const now = new Date();
  const thDateTime = now.toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' +
                     now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const record = {
    id: Date.now(),
    date: now.toISOString().slice(0, 10),
    name: state.name,
    shift: state.shift,
    role: state.role,
    project: state.project,
    status: state.status,
    timestamp: thDateTime,
    photo: state.photoDataUrl,
  };

  state.history.push(record);
  localStorage.setItem('checkin_history', JSON.stringify(state.history));

  // Build payload
  const shiftFormatted = state.shift;
  const statusText = state.status === 'On-site' ? 'On site' : 'Remote Work';
  const message = `Name : ${state.name}\nRole : ${state.role}\nShift : ${shiftFormatted}\nProject : ${state.project}\nStatus : ${statusText}\nTime : ${thDateTime}`;

  record.message = message;
  state.lastRecord = record;

  // Send to webhook
  const result = await sendToWebhook(record);

  btn.disabled = false;
  btn.textContent = 'ยืนยัน / Submit';

  showScreen('success');
});

// ===== WEBHOOK SENDER =====
async function sendToWebhook(record) {
  const result = { success: false };

  // Try with photo first
  if (record.photo) {
    try {
      // Send as multipart/form-data with photo attachment
      const resp = await fetch(record.photo);
      const blob = await resp.blob();

      const formData = new FormData();
      formData.append('photo', blob, 'checkin.jpg');
      formData.append('name', record.name);
      formData.append('shift', record.shift);
      formData.append('role', record.role);
      formData.append('project', record.project);
      formData.append('status', record.status);
      formData.append('timestamp', record.timestamp);
      formData.append('type', 'checkin');

      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        body: formData
      });
      result.success = response.ok || response.status === 202;
      return result;
    } catch (err) {
      console.warn('Multipart upload failed, trying text-only:', err);
    }
  }

  // Text only fallback
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "type": "application/json",
        "content": record.message || ''
      })
    });
    result.success = response.ok || response.status === 202;
    return result;
  } catch (err) {
    console.error('Webhook failed:', err);
    return result;
  }
}

// ===== SUCCESS SCREEN =====
btnHome.addEventListener('click', () => {
  updateDashboard();
  showScreen('dashboard');
});

// ===== INIT =====
populateWorkerSelect();
init();

console.log('✅ NOC Check-in Test initialized');
console.log(`👥 Workers loaded: ${state.workers.length}`);
