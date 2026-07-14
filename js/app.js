// coroom 메인 애플리케이션 로직 (탭 전환 / 대시보드 / 예약 모달 / 내예약 / 회의실정보 / 관리자)
import { supabase } from './supabaseClient.js';
import { signUp, signIn, signOut, getMyProfile } from './auth.js';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------
const OPEN_HOUR = 9;
const CLOSE_HOUR = 19;
const STEP_MIN = 30;

// 09:00 ~ 19:00, 30분 단위 경계값 (21개: 09:00, 09:30, ... , 19:00)
const TIMES = [];
for (let m = OPEN_HOUR * 60; m <= CLOSE_HOUR * 60; m += STEP_MIN) {
  TIMES.push(minutesToHHMM(m));
}
// 슬롯 시작 시간 목록 (20개: 09:00 ~ 18:30)
const TIME_SLOTS = TIMES.slice(0, -1);

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------
const state = {
  session: null,
  user: null,
  profile: null,
  rooms: [],
  currentTab: 'dashboard',
  dashboardDate: formatDateLocal(new Date()),
};

let realtimeChannel = null;
let currentModalRoom = null;
let currentModalDate = null;
let toastTimer = null;

// ---------------------------------------------------------------------------
// 유틸리티
// ---------------------------------------------------------------------------
function minutesToHHMM(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDate(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return formatDateLocal(d);
}

function fmtTime(t) {
  return t ? String(t).slice(0, 5) : '';
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function timeToSlotIndex(timeStr) {
  const t = String(timeStr).slice(0, 5);
  const [h, m] = t.split(':').map(Number);
  const min = h * 60 + m;
  const idx = (min - OPEN_HOUR * 60) / STEP_MIN;
  return idx;
}

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('error-toast', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ---------------------------------------------------------------------------
// 인증 화면 전환
// ---------------------------------------------------------------------------
function toggleAuthForm(which) {
  document.getElementById('login-form').classList.toggle('hidden', which !== 'login');
  document.getElementById('signup-form').classList.toggle('hidden', which !== 'signup');
}

function showAuthView() {
  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('auth-view').classList.remove('hidden');
  teardownRealtime();
}

function showAppView() {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');

  const label = state.profile
    ? `${state.profile.name}${state.profile.department ? ' · ' + state.profile.department : ''}`
    : state.user.email;
  document.getElementById('user-name-label').textContent = label;

  const isAdmin = !!(state.profile && state.profile.role === 'admin');
  document.getElementById('admin-tab-btn').classList.toggle('hidden', !isAdmin);

  setupRealtime();
  switchTab('dashboard');
}

async function handleSession(session) {
  state.session = session;
  if (session) {
    state.user = session.user;
    const { data: profile, error } = await getMyProfile(session.user.id);
    if (error) {
      console.error('프로필 조회 실패:', error);
    }
    state.profile = profile || null;
    showAppView();
  } else {
    state.user = null;
    state.profile = null;
    showAuthView();
  }
}

// ---------------------------------------------------------------------------
// 탭 전환
// ---------------------------------------------------------------------------
function switchTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
  const panel = document.getElementById(`${tabName}-tab`);
  if (panel) panel.classList.remove('hidden');

  if (tabName === 'dashboard') {
    document.getElementById('date-input').value = state.dashboardDate;
    loadDashboard(state.dashboardDate);
  } else if (tabName === 'my-reservations') {
    loadMyReservations();
  } else if (tabName === 'room-info') {
    loadRoomInfo();
  } else if (tabName === 'admin') {
    loadAdmin();
  }
}

// ---------------------------------------------------------------------------
// 회의실 목록 캐시
// ---------------------------------------------------------------------------
async function loadRooms(force = false) {
  if (state.rooms.length && !force) return state.rooms;
  const { data, error } = await supabase
    .from('meeting_rooms')
    .select('*')
    .order('id', { ascending: true });
  if (error) {
    toast('회의실 목록을 불러오지 못했습니다: ' + error.message, true);
    return state.rooms;
  }
  state.rooms = data || [];
  return state.rooms;
}

// ---------------------------------------------------------------------------
// 대시보드 (타임테이블)
// ---------------------------------------------------------------------------
async function loadDashboard(dateStr) {
  await loadRooms();
  const { data, error } = await supabase
    .from('reservations')
    .select('*, coroom_profiles(name, department)')
    .eq('reservation_date', dateStr)
    .eq('status', 'confirmed');

  if (error) {
    toast('예약 현황을 불러오지 못했습니다: ' + error.message, true);
    return;
  }
  renderGrid(dateStr, data || []);
}

function renderGrid(dateStr, reservations) {
  const rooms = state.rooms;
  const table = document.getElementById('reservation-grid');
  table.innerHTML = '';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th class="time-label">시간</th>' +
    rooms.map((r) => `<th>${escapeHtml(r.name)}</th>`).join('');
  thead.appendChild(headRow);
  table.appendChild(thead);

  const slotCount = TIME_SLOTS.length;
  const occ = {};
  rooms.forEach((r) => { occ[r.id] = new Array(slotCount).fill(null); });

  reservations.forEach((res) => {
    const startIdx = timeToSlotIndex(res.start_time);
    const endIdx = timeToSlotIndex(res.end_time);
    const arr = occ[res.room_id];
    if (!arr) return;
    for (let i = Math.max(startIdx, 0); i < Math.min(endIdx, slotCount); i++) {
      arr[i] = { res, isStart: i === startIdx, span: endIdx - startIdx };
    }
  });

  const tbody = document.createElement('tbody');
  const skipRows = {};
  rooms.forEach((r) => { skipRows[r.id] = 0; });

  for (let rowIdx = 0; rowIdx < slotCount; rowIdx++) {
    const tr = document.createElement('tr');
    const timeTd = document.createElement('td');
    timeTd.className = 'time-label';
    timeTd.textContent = TIME_SLOTS[rowIdx];
    tr.appendChild(timeTd);

    rooms.forEach((room) => {
      if (skipRows[room.id] > 0) {
        skipRows[room.id]--;
        return;
      }
      const cellInfo = occ[room.id][rowIdx];
      if (cellInfo && cellInfo.isStart) {
        const td = document.createElement('td');
        td.rowSpan = cellInfo.span;
        const mine = state.user && cellInfo.res.user_id === state.user.id;
        td.className = 'slot-booked' + (mine ? ' mine' : '');
        const profileName = cellInfo.res.coroom_profiles?.name || '';
        td.innerHTML = `<span class="r-title">${escapeHtml(cellInfo.res.title)}</span>` +
          `<span class="r-user">${escapeHtml(profileName)}</span>`;
        tr.appendChild(td);
        skipRows[room.id] = cellInfo.span - 1;
      } else if (!cellInfo) {
        const td = document.createElement('td');
        td.className = 'slot-empty';
        td.textContent = '+';
        td.addEventListener('click', () => openReservationModal(room, dateStr, TIME_SLOTS[rowIdx]));
        tr.appendChild(td);
      }
    });

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

// ---------------------------------------------------------------------------
// 예약 모달
// ---------------------------------------------------------------------------
function populateEndOptions(startTime) {
  const endSelect = document.getElementById('modal-end-time');
  const idx = TIMES.indexOf(startTime);
  const opts = TIMES.slice(idx + 1);
  endSelect.innerHTML = opts.map((t) => `<option value="${t}">${t}</option>`).join('');
}

function openReservationModal(room, dateStr, startTime) {
  currentModalRoom = room;
  currentModalDate = dateStr;

  document.getElementById('modal-room-name').textContent = room.name;
  document.getElementById('modal-date').textContent = dateStr;

  const startSelect = document.getElementById('modal-start-time');
  startSelect.innerHTML = TIME_SLOTS.map((t) => `<option value="${t}">${t}</option>`).join('');
  startSelect.value = startTime;
  populateEndOptions(startTime);

  document.getElementById('modal-title').value = '';
  document.getElementById('modal-attendees').value = '';
  document.getElementById('modal-error').classList.add('hidden');
  document.getElementById('modal-capacity-warning').classList.add('hidden');

  document.getElementById('reservation-modal').classList.remove('hidden');
}

function closeReservationModal() {
  document.getElementById('reservation-modal').classList.add('hidden');
  currentModalRoom = null;
  currentModalDate = null;
}

function checkCapacityWarning() {
  const warningEl = document.getElementById('modal-capacity-warning');
  const attendees = Number(document.getElementById('modal-attendees').value);
  if (currentModalRoom && attendees && attendees > currentModalRoom.capacity) {
    warningEl.textContent = `참석 인원(${attendees}명)이 회의실 수용 인원(${currentModalRoom.capacity}명)을 초과합니다.`;
    warningEl.classList.remove('hidden');
  } else {
    warningEl.classList.add('hidden');
  }
}

async function submitReservation(e) {
  e.preventDefault();
  const errorEl = document.getElementById('modal-error');
  errorEl.classList.add('hidden');

  const title = document.getElementById('modal-title').value.trim();
  const startTime = document.getElementById('modal-start-time').value;
  const endTime = document.getElementById('modal-end-time').value;

  if (!title) {
    errorEl.textContent = '회의 제목을 입력해주세요.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (!currentModalRoom || !state.user) return;

  const saveBtn = document.getElementById('modal-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  const { error } = await supabase.from('reservations').insert({
    room_id: currentModalRoom.id,
    user_id: state.user.id,
    title,
    reservation_date: currentModalDate,
    start_time: startTime,
    end_time: endTime,
  });

  saveBtn.disabled = false;
  saveBtn.textContent = '예약하기';

  if (error) {
    if (error.code === '23P01') {
      errorEl.textContent = '이미 예약된 시간입니다. 다시 시도해주세요.';
      errorEl.classList.remove('hidden');
      await loadDashboard(currentModalDate);
    } else {
      errorEl.textContent = '예약에 실패했습니다: ' + error.message;
      errorEl.classList.remove('hidden');
    }
    return;
  }

  toast('예약이 완료되었습니다.');
  closeReservationModal();
  await loadDashboard(state.dashboardDate);
}

// ---------------------------------------------------------------------------
// 내 예약
// ---------------------------------------------------------------------------
async function loadMyReservations() {
  const { data, error } = await supabase
    .from('reservations')
    .select('*, meeting_rooms(name)')
    .eq('user_id', state.user.id)
    .order('reservation_date', { ascending: false })
    .order('start_time', { ascending: false });

  if (error) {
    toast('내 예약을 불러오지 못했습니다: ' + error.message, true);
    return;
  }

  const now = new Date();
  const todayStr = formatDateLocal(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const upcoming = [];
  const past = [];

  (data || []).forEach((r) => {
    const endMinutes = timeStrToMinutes(r.end_time);
    const isPast = r.reservation_date < todayStr ||
      (r.reservation_date === todayStr && endMinutes <= nowMinutes);
    if (isPast) past.push(r); else upcoming.push(r);
  });

  upcoming.sort((a, b) => (a.reservation_date + a.start_time).localeCompare(b.reservation_date + b.start_time));
  past.sort((a, b) => (b.reservation_date + b.start_time).localeCompare(a.reservation_date + a.start_time));

  renderReservationList('upcoming-reservations', upcoming, { showCancel: true, roomKey: 'meeting_rooms' });
  renderReservationList('past-reservations', past, { showCancel: false, roomKey: 'meeting_rooms' });
}

function timeStrToMinutes(t) {
  const s = String(t).slice(0, 5);
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function renderReservationList(containerId, list, opts) {
  const container = document.getElementById(containerId);
  if (!list.length) {
    container.innerHTML = '<p class="empty-msg">예약이 없습니다.</p>';
    return;
  }
  container.innerHTML = '';
  list.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'reservation-card' + (r.status === 'cancelled' ? ' cancelled' : '');

    const roomName = (opts.roomKey && r[opts.roomKey]?.name) || `회의실 ${r.room_id}`;
    const userMeta = opts.showUser
      ? ` · ${escapeHtml(r.coroom_profiles?.name || '알수없음')}${r.coroom_profiles?.department ? ' (' + escapeHtml(r.coroom_profiles.department) + ')' : ''}`
      : '';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'rc-info';
    infoDiv.innerHTML = `
      <span class="rc-title">${escapeHtml(r.title)}</span>
      <span class="rc-meta">${escapeHtml(roomName)} · ${r.reservation_date} ${fmtTime(r.start_time)}~${fmtTime(r.end_time)}${userMeta} · ${escapeHtml(r.reservation_code || '')}</span>
    `;
    card.appendChild(infoDiv);

    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.alignItems = 'center';
    actionsDiv.style.gap = '10px';

    const statusSpan = document.createElement('span');
    statusSpan.className = 'rc-status' + (r.status === 'cancelled' ? ' cancelled' : '');
    statusSpan.textContent = r.status === 'cancelled' ? '취소됨' : '확정';
    actionsDiv.appendChild(statusSpan);

    if (opts.showCancel && r.status === 'confirmed') {
      const btn = document.createElement('button');
      btn.className = 'cancel-btn';
      btn.textContent = opts.forceCancel ? '강제취소' : '취소';
      btn.addEventListener('click', () => (opts.forceCancel ? adminCancelReservation(r.id) : cancelReservation(r.id)));
      actionsDiv.appendChild(btn);
    }

    card.appendChild(actionsDiv);
    container.appendChild(card);
  });
}

async function cancelReservation(id) {
  if (!confirm('이 예약을 취소하시겠습니까?')) return;
  const { error } = await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', id);
  if (error) {
    toast('취소에 실패했습니다: ' + error.message, true);
    return;
  }
  toast('예약이 취소되었습니다.');
  await loadMyReservations();
}

// ---------------------------------------------------------------------------
// 회의실 정보
// ---------------------------------------------------------------------------
async function loadRoomInfo() {
  await loadRooms();
  const container = document.getElementById('room-cards');
  container.innerHTML = state.rooms.map((r) => `
    <div class="room-card">
      <h3>${escapeHtml(r.name)}</h3>
      <p class="room-meta">수용 인원: ${r.capacity}명</p>
      <p class="room-meta">층: ${escapeHtml(r.floor)}</p>
      <p class="room-meta">보유 장비: ${escapeHtml(r.equipment)}</p>
      ${r.note ? `<p class="room-note">${escapeHtml(r.note)}</p>` : ''}
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// 관리자
// ---------------------------------------------------------------------------
async function loadAdmin() {
  if (!state.profile || state.profile.role !== 'admin') return;
  await loadRooms(true);
  renderAdminRooms();
  const dateFilter = document.getElementById('admin-date-input').value;
  await loadAdminReservations(dateFilter || undefined);
}

function renderAdminRooms() {
  const container = document.getElementById('admin-room-list');
  container.innerHTML = state.rooms.map((r) => `
    <div class="admin-room-card" data-room-id="${r.id}">
      <div class="field name-field">${escapeHtml(r.name)}</div>
      <div class="field"><label>수용 인원</label><input type="number" class="admin-capacity" value="${r.capacity}" min="1" /></div>
      <div class="field"><label>보유 장비</label><input type="text" class="admin-equipment" value="${escapeHtml(r.equipment || '')}" /></div>
      <div class="field"><label>비고</label><input type="text" class="admin-note" value="${escapeHtml(r.note || '')}" /></div>
      <button type="button" class="save-btn">저장</button>
    </div>
  `).join('');

  container.querySelectorAll('.admin-room-card').forEach((card) => {
    card.querySelector('.save-btn').addEventListener('click', async () => {
      const roomId = Number(card.dataset.roomId);
      const capacity = Number(card.querySelector('.admin-capacity').value);
      const equipment = card.querySelector('.admin-equipment').value.trim();
      const note = card.querySelector('.admin-note').value.trim();

      const { error } = await supabase
        .from('meeting_rooms')
        .update({ capacity, equipment, note: note || null })
        .eq('id', roomId);

      if (error) {
        toast('저장에 실패했습니다: ' + error.message, true);
        return;
      }
      toast('회의실 정보가 저장되었습니다.');
      await loadRooms(true);
    });
  });
}

async function loadAdminReservations(dateFilter) {
  let query = supabase
    .from('reservations')
    .select('*, meeting_rooms(name), coroom_profiles(name, department)')
    .order('reservation_date', { ascending: false })
    .order('start_time', { ascending: false });

  if (dateFilter) {
    query = query.eq('reservation_date', dateFilter);
  }

  const { data, error } = await query;
  if (error) {
    toast('예약 목록을 불러오지 못했습니다: ' + error.message, true);
    return;
  }
  renderReservationList('admin-reservation-list', data || [], {
    showCancel: true,
    forceCancel: true,
    showUser: true,
    roomKey: 'meeting_rooms',
  });
}

async function adminCancelReservation(id) {
  if (!confirm('이 예약을 강제로 취소하시겠습니까?')) return;
  const { error } = await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', id);
  if (error) {
    toast('취소에 실패했습니다: ' + error.message, true);
    return;
  }
  toast('예약이 취소되었습니다.');
  const dateFilter = document.getElementById('admin-date-input').value;
  await loadAdminReservations(dateFilter || undefined);
}

// ---------------------------------------------------------------------------
// 실시간 구독
// ---------------------------------------------------------------------------
function setupRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supabase
    .channel('reservations-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
      if (state.currentTab === 'dashboard') {
        loadDashboard(state.dashboardDate);
      } else if (state.currentTab === 'my-reservations') {
        loadMyReservations();
      } else if (state.currentTab === 'admin') {
        loadAdmin();
      }
    })
    .subscribe();
}

function teardownRealtime() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// ---------------------------------------------------------------------------
// 이벤트 바인딩
// ---------------------------------------------------------------------------
function setupStaticListeners() {
  // 탭
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 로그인/회원가입 전환
  document.getElementById('show-signup-link').addEventListener('click', (e) => {
    e.preventDefault();
    toggleAuthForm('signup');
  });
  document.getElementById('show-login-link').addEventListener('click', (e) => {
    e.preventDefault();
    toggleAuthForm('login');
  });

  // 로그인
  document.getElementById('login-submit-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');

    if (!email || !password) {
      errorEl.textContent = '이메일과 비밀번호를 입력해주세요.';
      errorEl.classList.remove('hidden');
      return;
    }

    const { error } = await signIn(email, password);
    if (error) {
      errorEl.textContent = '로그인에 실패했습니다: ' + error.message;
      errorEl.classList.remove('hidden');
    }
  });

  // 회원가입
  document.getElementById('signup-submit-btn').addEventListener('click', async () => {
    const name = document.getElementById('signup-name').value.trim();
    const department = document.getElementById('signup-department').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const errorEl = document.getElementById('signup-error');
    const successEl = document.getElementById('signup-success');
    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    if (!name || !email || !password) {
      errorEl.textContent = '이름, 이메일, 비밀번호를 입력해주세요.';
      errorEl.classList.remove('hidden');
      return;
    }

    const { data, error } = await signUp(email, password, name, department);
    if (error) {
      errorEl.textContent = '회원가입에 실패했습니다: ' + error.message;
      errorEl.classList.remove('hidden');
      return;
    }

    if (data.session) {
      // 이메일 확인 없이 즉시 로그인되는 경우 (onAuthStateChange가 처리)
      successEl.textContent = '회원가입이 완료되었습니다.';
      successEl.classList.remove('hidden');
    } else {
      successEl.textContent = '회원가입이 완료되었습니다. 이메일 확인 후 로그인해주세요.';
      successEl.classList.remove('hidden');
      toggleAuthForm('login');
    }
  });

  // 로그아웃
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await signOut();
  });

  // 대시보드 날짜 이동
  const dateInput = document.getElementById('date-input');
  dateInput.value = state.dashboardDate;
  dateInput.addEventListener('change', (e) => {
    if (!e.target.value) return;
    state.dashboardDate = e.target.value;
    loadDashboard(state.dashboardDate);
  });
  document.getElementById('prev-date-btn').addEventListener('click', () => {
    state.dashboardDate = shiftDate(state.dashboardDate, -1);
    dateInput.value = state.dashboardDate;
    loadDashboard(state.dashboardDate);
  });
  document.getElementById('next-date-btn').addEventListener('click', () => {
    state.dashboardDate = shiftDate(state.dashboardDate, 1);
    dateInput.value = state.dashboardDate;
    loadDashboard(state.dashboardDate);
  });
  document.getElementById('today-btn').addEventListener('click', () => {
    state.dashboardDate = formatDateLocal(new Date());
    dateInput.value = state.dashboardDate;
    loadDashboard(state.dashboardDate);
  });

  // 예약 모달
  document.getElementById('modal-start-time').addEventListener('change', (e) => {
    populateEndOptions(e.target.value);
  });
  document.getElementById('modal-attendees').addEventListener('input', checkCapacityWarning);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeReservationModal);
  document.getElementById('reservation-form').addEventListener('submit', submitReservation);
  document.getElementById('reservation-modal').addEventListener('click', (e) => {
    if (e.target.id === 'reservation-modal') closeReservationModal();
  });

  // 관리자 - 예약 날짜 필터
  document.getElementById('admin-date-input').addEventListener('change', (e) => {
    loadAdminReservations(e.target.value || undefined);
  });
  document.getElementById('admin-date-clear-btn').addEventListener('click', () => {
    document.getElementById('admin-date-input').value = '';
    loadAdminReservations(undefined);
  });
}

// ---------------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------------
async function init() {
  setupStaticListeners();

  const { data } = await supabase.auth.getSession();
  await handleSession(data.session);

  supabase.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });
}

init();
