const AUTH_API = 'https://auth.sudohq.me';
const CLIENT_ID = '1911e05231e7401afafe836d4d39e271';

const getToken = () => localStorage.getItem('access_token');
const getUser = () => JSON.parse(localStorage.getItem('auth_user') || 'null');

function saveAuth(accessToken, refreshToken, user) {
  localStorage.setItem('access_token', accessToken);
  if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
  localStorage.setItem('auth_user', JSON.stringify(user));
  updateNav(user);
}

function clearAuth() {
  ['access_token', 'refresh_token', 'auth_user'].forEach(k => localStorage.removeItem(k));
  updateNav(null);
}

function updateNav(user) {
  const userInfo = document.getElementById('userInfo');
  const authBtn = document.getElementById('authBtn');
  
  if (user) {
    userInfo.innerHTML = `${user.name} <button id="logoutBtn" style="margin-left:10px;padding:4px 8px;cursor:pointer;background:#e74c3c;color:white;border:none;border-radius:4px">Logout</button>`;
    authBtn.style.display = 'none';
    document.getElementById('logoutBtn').addEventListener('click', logout);
  } else {
    userInfo.textContent = '';
    authBtn.style.display = 'inline-block';
    authBtn.textContent = 'Login';
  }
}

function logout() {
  clearAuth();
  location.reload();
}

function makeLetterIcon(letter, isMe = false) {
  return L.divIcon({
    className: '',
    html: `<div class="letter-marker${isMe ? ' me' : ''}">${letter.toUpperCase()}</div>`,
    iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16],
  });
}

// Handle OAuth callback
(async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    const res = await fetch('/auth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.access_token) {
      const uRes = await fetch(`${AUTH_API}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      const user = await uRes.json();
      saveAuth(data.access_token, data.refresh_token, user);
      window.history.replaceState({}, '', '/');
      location.reload();
    } else {
      window.history.replaceState({}, '', '/');
    }
  }
})();

updateNav(getUser());

// Auth button
document.getElementById('authBtn').addEventListener('click', () => {
  if (getUser()) { clearAuth(); return; }
  document.getElementById('loginSubtitle').textContent = '';
  document.getElementById('loginOverlay').classList.add('open');
});

// Modal controls
document.getElementById('loginClose').onclick = () => document.getElementById('loginOverlay').classList.remove('open');
document.getElementById('signupClose').onclick = () => document.getElementById('signupOverlay').classList.remove('open');
document.getElementById('showSignup').onclick = () => { document.getElementById('loginOverlay').classList.remove('open'); document.getElementById('signupOverlay').classList.add('open'); };
document.getElementById('showLogin').onclick = () => { document.getElementById('signupOverlay').classList.remove('open'); document.getElementById('loginOverlay').classList.add('open'); };
document.getElementById('loginOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });
document.getElementById('signupOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });

// Login
document.getElementById('loginForm').addEventListener('submit', e => {
  e.preventDefault();
  const state = crypto.randomUUID();
  sessionStorage.setItem('oauth_state', state);
  const url = new URL(`${AUTH_API}/oauth/authorize`);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', `${location.origin}/auth/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('email', document.getElementById('loginEmail').value);
  url.searchParams.set('password', document.getElementById('loginPassword').value);
  window.location.href = url.toString();
});

// Signup
document.getElementById('signupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('signupSubmit');
  const err = document.getElementById('signupError');
  btn.disabled = true; btn.textContent = 'Creating account...'; err.textContent = '';
  try {
    const res = await fetch(`${AUTH_API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('signupName').value,
        email: document.getElementById('signupEmail').value,
        password: document.getElementById('signupPassword').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error || 'Signup failed'; return; }
    saveAuth(data.accessToken, data.refreshToken, data.user);
    document.getElementById('signupOverlay').classList.remove('open');
  } catch { err.textContent = 'Network error'; }
  finally { btn.disabled = false; btn.textContent = 'Sign up'; }
});

// Map
const map = L.map('map').setView([20.5937, 78.9629], 5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const remoteMarkers = new Map();
const socket = io({ auth: { token: getToken() } });

socket.on('server:location:update', ({ id, name, latitude, longitude }) => {
  const letter = (name || id)[0];
  if (!remoteMarkers.has(id)) {
    remoteMarkers.set(id, L.marker([latitude, longitude], { icon: makeLetterIcon(letter) })
      .addTo(map).bindPopup(name || id.slice(0, 8)));
  } else {
    remoteMarkers.get(id).setLatLng([latitude, longitude]);
  }
});

socket.on('server:user:disconnected', ({ id }) => {
  if (remoteMarkers.has(id)) {
    map.removeLayer(remoteMarkers.get(id));
    remoteMarkers.delete(id);
  }
});

let myMarker = null;
let watchId = null;
let myLocation = null;

function placeMarker(lat, lng) {
  const user = getUser();
  const letter = (user?.name || 'Y')[0];
  myLocation = [lat, lng];
  socket.emit('client:location:update', { latitude: lat, longitude: lng });
  if (!myMarker) {
    myMarker = L.marker([lat, lng], { icon: makeLetterIcon(letter, true) })
      .addTo(map).bindPopup(user?.name || 'You').openPopup();
    map.setView([lat, lng], 15);
  } else {
    myMarker.setLatLng([lat, lng]);
  }
}

// Return to my location button
const returnBtn = L.control({ position: 'bottomright' });
returnBtn.onAdd = () => {
  const container = L.DomUtil.create('div', 'leaflet-control-locate');
  const btn = L.DomUtil.create('button');
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>';
  btn.onclick = () => {
    if (myLocation) map.setView(myLocation, 15);
  };
  container.appendChild(btn);
  return container;
};
returnBtn.addTo(map);

// Share button
document.getElementById('startBtn').addEventListener('click', () => {
  if (!getUser()) {
    document.getElementById('loginSubtitle').textContent = 'Sign in to start sharing your spot!';
    document.getElementById('loginOverlay').classList.add('open');
    return;
  }
  
  const btn = document.getElementById('startBtn');
  
  if (watchId) {
    // Stop sharing
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    btn.textContent = 'Share My Location';
    return;
  }
  
  btn.textContent = 'Starting...';
  
  watchId = navigator.geolocation.watchPosition(
    pos => {
      placeMarker(pos.coords.latitude, pos.coords.longitude);
      btn.textContent = 'Stop Sharing';
    },
    err => {
      console.warn('Geolocation error:', err.message);
      btn.textContent = 'Click map to share';
      map.once('click', e => {
        placeMarker(e.latlng.lat, e.latlng.lng);
        btn.textContent = 'Stop Sharing';
      });
      const info = L.control({ position: 'topright' });
      info.onAdd = () => {
        const div = L.DomUtil.create('div');
        div.style.cssText = 'background:white;padding:8px;border-radius:4px;font-size:14px;box-shadow:0 2px 4px rgba(0,0,0,0.2)';
        div.innerHTML = 'GPS unavailable - <b>click map</b> to place yourself';
        return div;
      };
      info.addTo(map);
    },
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 },
  );
});
