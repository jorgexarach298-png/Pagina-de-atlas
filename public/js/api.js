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
    // El acceso fallido es cosa del formulario, no una sesión caducada.
    if (response.status === 401 && !url.startsWith('/api/auth/login')) {
      window.dispatchEvent(new CustomEvent('atlas:unauthorized'));
    }
    const error = new Error(payload.error || `Error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const api = {
  me: () => request('GET', '/api/auth/me'),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  register: (payload) => request('POST', '/api/auth/register', payload),
  pendingAccounts: () => request('GET', '/api/auth/available'),
  logout: () => request('POST', '/api/auth/logout'),
  changePassword: (currentPassword, newPassword) =>
    request('POST', '/api/auth/password', { currentPassword, newPassword }),

  roster: () => request('GET', '/api/roster'),
  updateMe: (patch) => request('PATCH', '/api/players/me', patch),
  createPlayer: (player) => request('POST', '/api/players', player),
  updatePlayer: (id, patch) => request('PATCH', `/api/players/${id}`, patch),
  deletePlayer: (id) => request('DELETE', `/api/players/${id}`),
  resetAccount: (id) => request('POST', `/api/players/${id}/reset-account`),

  lineup: (date) =>
    request('GET', `/api/lineup${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  saveLineup: (lineup) => request('PUT', '/api/lineup', lineup),

  publishMatch: (date, payload) => request('POST', `/api/matches/${date}/publish`, payload),
  unpublishMatch: (date) => request('DELETE', `/api/matches/${date}`),
  matches: () => request('GET', '/api/matches'),
  setMatchStats: (date, playerId, stats) =>
    request('PATCH', `/api/matches/${date}/stats/${playerId}`, stats),
  setCleanSheet: (date, cleanSheet) =>
    request('PATCH', `/api/matches/${date}/clean-sheet`, { cleanSheet }),
  saveRatings: (date, scores) => request('POST', `/api/matches/${date}/ratings`, { scores }),

  checkin: (date) => request('GET', `/api/checkin?date=${encodeURIComponent(date)}`),
  checkinMe: (payload) => request('POST', '/api/checkin/me', payload),
  checkinAdmin: (payload) => request('POST', '/api/checkin/admin', payload),

  history: () => request('GET', '/api/history'),
  createHistory: (entry) => request('POST', '/api/history', entry),
  updateHistory: (id, patch) => request('PATCH', `/api/history/${id}`, patch),
  deleteHistory: (id) => request('DELETE', `/api/history/${id}`),

  updateClub: (patch) => request('PATCH', '/api/club', patch),
};
