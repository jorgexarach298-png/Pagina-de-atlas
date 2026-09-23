'use strict';

async function request(method, url, body) {
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await response.json().catch(() => ({})) : {};
  if (!response.ok) {
    const error = new Error(payload.error || `Error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const api = {
  me: () => request('GET', '/api/auth/me'),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  changePassword: (currentPassword, newPassword) =>
    request('POST', '/api/auth/password', { currentPassword, newPassword }),

  roster: () => request('GET', '/api/roster'),
  updateMe: (patch) => request('PATCH', '/api/players/me', patch),
  createPlayer: (player) => request('POST', '/api/players', player),
  updatePlayer: (id, patch) => request('PATCH', `/api/players/${id}`, patch),
  deletePlayer: (id) => request('DELETE', `/api/players/${id}`),

  lineup: (date) =>
    request('GET', `/api/lineup${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  saveLineup: (lineup) => request('PUT', '/api/lineup', lineup),

  checkin: (date) => request('GET', `/api/checkin?date=${encodeURIComponent(date)}`),
  checkinMe: (payload) => request('POST', '/api/checkin/me', payload),
  checkinAdmin: (payload) => request('POST', '/api/checkin/admin', payload),

  history: () => request('GET', '/api/history'),
  createHistory: (entry) => request('POST', '/api/history', entry),
  updateHistory: (id, patch) => request('PATCH', `/api/history/${id}`, patch),
  deleteHistory: (id) => request('DELETE', `/api/history/${id}`),

  updateClub: (patch) => request('PATCH', '/api/club', patch),
};
