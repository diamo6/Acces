// ===== SHIFT MAPPING =====
const shiftMap = {
  '07.00': '07:00-19:00',
  '08.00': '08:00-20:00',
  '19.00': '19:00-07:00',
  '20.00': '20:00-08:00',
  '8x5': '8x5',
};

// ===== STATE =====
const state = {
  name: '',
  shift: '',
  role: 'NOC Operation',
  project: 'Cloud Operation Support',
  status: 'On-site',
  photoDataUrl: null,
  history: JSON.parse(localStorage.getItem('checkin_history') || '[]'),
  cameraActive: false,
  workers: [],
  rosterData: null,
};

// ===== ELEMENTS =====
const screens = {
  dashboard: document.getElementById('screen-dashboard'),
  form: document.getElementById('screen-form'),
  camera: document.getElementById('screen-camera'),
  confirm: document.getElementById('screen-confirm'),
  success: document.getElementById('screen-success'),
};
const headerTitle = document.getElementById('headerTitle');
const btnBack = document.getElementById('btnBack');
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
const galleryInput = document.getElementById('galleryInput');
const galleryPreview = document.getElementById('galleryPreview');

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
  }
}

// ===== NAVIGATION =====
function showScreen(name) {
  if (name !== 'camera' && state.cameraActive) {
    cameraVideo.pause();
  }

  Object.keys(screens).forEach(k => screens[k].classList.remove('active'));
  screens[name].classList.add('active');

  const titles = {
    dashboard: 'Dashboard',
    form: 'Check-in',
    camera: 'ถายภาพ',
    confirm: 'ยอนันรายงาน',
    success: 'สำเร็จ',
  };
  headerTitle.textContent = titles[name] || '';
  btnBack.style.display = name === 'dashboard' ? 'none' : 'flex';

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

btnBack.addEventListener('click', () => {
  showScreen('dashboard');
});

// ===== DASHBOARD =====
function updateDashboard() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const todayEntry = state.history.find(h => h.date === today);

  const statusIcon = document.getElementById('todayStatusIcon');
  const statusTitle = document.getElementById('todayStatusTitle');
  const statusDesc = document.getElementById('todayStatusDesc');
  const statusCard = document.querySelector('.status-card');

  if (todayEntry) {
    statusIcon.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    statusTitle.textContent = 'เช็กอแลว';
    statusDesc.textContent = `${todayEntry.name} — ${todayEntry.shift} (${todayEntry.status})`;
    statusCard.classList.add('checked-in');
  } else {
    statusIcon.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>';
    statusTitle.textContent = 'ยงไมเช็กอ';
    statusDesc.textContent = 'วันนึ่ยงมมมีรายงานตว';
    statusCard.classList.remove('checked-in');
  }

  const svgBtn = todayEntry
    ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/><polyline points="12 5 9 2 3 8"/></svg>'
    : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>';
  btnCheckin.innerHTML = `${svgBtn} ${todayEntry ? 'รายงานเพิ่' : 'Check-in Now'}`;

  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('historyList');
  if (state.history.length === 0) {
    list.innerHTML = '<div class="history-empty">ไมมมีประวตการรายงาน</div>';
    return;
  }
  const items = state.history.slice().reverse().slice(0, 20);
  list.innerHTML = items.map(h => {
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
  
  // Find workers who have shift today
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
    opt.textContent = w.name;
    selectName.appendChild(opt);
  });
  
  // Update shift field label
  document.querySelector('#selectShift').parentElement.previousElementSibling.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
    กะ / Shift (จาก roster)
  `;
}

selectName.addEventListener('change', (e) => {
  const worker = state.workers.find(w => w.name === e.target.value);
  if (worker) {
    selectShift.value = worker.shift;
  }
});

btnToCamera.addEventListener('click', () => {
  state.name = selectName.value;
  state.shift = selectShift.value;

  if (!state.name) { shake(selectName); return; }
  if (!state.shift) { shake(selectShift); return; }

  showScreen('camera');
});

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
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    cameraVideo.srcObject = stream;
    await cameraVideo.play();
    cameraPlaceholder.style.display = 'none';
    state.cameraActive = true;
  } catch (err) {
    let errorMsg = 'ไมสามารถเปด กลองได';
    if (err.name === 'NotAllowedError') {
      errorMsg = 'กรุณาอนุญาตการเข้้าถ่ง กลองในต้งค่าเบราว์เซอร์';
    } else if (err.name === 'NotFoundError') {
      errorMsg = 'ไม่พบกล้องในเคร่อง';
    } else if (err.name === 'AbortError') {
      errorMsg = 'กล้องถูกใช้งานโดยอืนหรือถูกบล็อก';
    } else if (err.name === 'SecurityError') {
      errorMsg = 'กล้องถูกบล็อกเนื่องจาก HTTPS';
    }
    cameraPlaceholder.innerHTML = `<p>${errorMsg}</p>`;
    cameraPlaceholder.style.display = 'flex';
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

// ===== CONFIRMATION =====
btnRetake.addEventListener('click', () => {
  state.photoDataUrl = null;
  cameraViewfinder.classList.remove('has-image');
  galleryPreview.style.display = 'none';
  galleryPreview.src = '';
  galleryInput.value = '';
  if (cameraVideo.style.display !== 'none') {
    cameraVideo.style.display = '';
  }
  showScreen('camera');
});

btnSubmit.addEventListener('click', () => {
  const now = new Date();
  const record = {
    id: Date.now(),
    date: now.toISOString().slice(0, 10),
    name: state.name,
    shift: state.shift,
    role: state.role,
    project: state.project,
    status: state.status,
    timestamp: now.toLocaleString('th-TH'),
    photo: state.photoDataUrl,
  };

  state.history.push(record);
  localStorage.setItem('checkin_history', JSON.stringify(state.history));

  sendToDiscord(record);
  showScreen('success');
});

// ===== SEND TO DISCORD =====
async function sendToDiscord(record) {
  const webhookUrl = 'https://discord.com/api/webhooks/1549379114459340882/6YJ89tL_jhobHBz2aHQjHEq6TtGYJ6JhoP1Dt_Tw-Qu7c0EDEVYc20khyYY8t0E_ccvS';

  const fields = [
    { name: 'Name', value: record.name || '—', inline: true },
    { name: 'Role', value: record.role || '—', inline: true },
    { name: 'Shift', value: record.shift || '—', inline: true },
    { name: 'Project', value: record.project || '—', inline: true },
    { name: 'Status', value: record.status || '—', inline: true },
    { name: 'Time', value: record.timestamp || '—', inline: true }
  ];

  let photoBlob = null;
  if (record.photo) {
    try {
      const resp = await fetch(record.photo);
      photoBlob = await resp.blob();
    } catch (_) {
      try {
        const parts = record.photo.split(',');
        const mime = parts[0].match(/:(.*?);/)[1];
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        photoBlob = new Blob([u8arr], { type: mime });
      } catch (err) {
        console.warn('Blob conversion failed:', err);
      }
    }
  }

  if (photoBlob) {
    const formData = new FormData();
    formData.append('files[0]', photoBlob, 'checkin.jpg');
    const payload = {
      embeds: [{
        title: '📋 รายงานตัวประจำกะ (Check-in Report)',
        color: 15844367,
        fields: fields,
        image: { url: 'attachment://checkin.jpg' },
        footer: { text: 'NOC Check-in System' },
        timestamp: new Date().toISOString()
      }]
    };
    formData.append('payload_json', JSON.stringify(payload));
    fetch(webhookUrl, {
      method: 'POST',
      body: formData
    }).catch(err => console.warn('Webhook failed:', err));
  } else {
    const msg = `📋 *Check-in Report*

Name : ${record.name}
Role : ${record.role}
Shift : ${record.shift}
Project : ${record.project}
Status : ${record.status}
Time : ${record.timestamp}`;

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msg }),
    }).catch(err => console.warn('Webhook failed:', err));
  }
}

// ===== HOME =====
btnHome.addEventListener('click', () => {
  updateDashboard();
  showScreen('dashboard');
});

// ===== INIT =====
populateWorkerSelect();
init();
