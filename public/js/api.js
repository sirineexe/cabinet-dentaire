/**
 * API & Real-time WebSocket Client for Cabinet Dentaire
 */
const API = {
  // Global App State
  state: {
    currentDate: new Date().toISOString().split('T')[0],
    currentOperator: localStorage.getItem('cabinet_operator') || 'Secrétariat',
    settings: {},
    dentists: [],
    reasons: [],
    listeners: {}
  },

  // Event bus for WebSocket and state updates
  on(event, callback) {
    if (!this.state.listeners[event]) {
      this.state.listeners[event] = [];
    }
    this.state.listeners[event].push(callback);
  },

  emit(event, data) {
    if (this.state.listeners[event]) {
      this.state.listeners[event].forEach(cb => cb(data));
    }
  },

  // Show Toast Notification
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'danger') toast.style.borderLeftColor = 'var(--danger)';
    if (type === 'success') toast.style.borderLeftColor = 'var(--success)';
    if (type === 'warning') toast.style.borderLeftColor = 'var(--warning)';

    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  // Fetch wrapper
  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `/api${endpoint}`;
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    options.headers = { ...defaultHeaders, ...options.headers };

    try {
      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Erreur serveur (${response.status})`);
      }
      return data;
    } catch (err) {
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
  },

  get(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = queryString ? `${endpoint}?${queryString}` : endpoint;
    return this.request(url, { method: 'GET' });
  },

  post(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify({ ...body, operator: this.state.currentOperator })
    });
  },

  put(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify({ ...body, operator: this.state.currentOperator })
    });
  },

  patch(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify({ ...body, operator: this.state.currentOperator })
    });
  },

  delete(endpoint) {
    const url = `${endpoint}?operator=${encodeURIComponent(this.state.currentOperator)}`;
    return this.request(url, { method: 'DELETE' });
  },

  // Load Initial Metadata (Settings, Dentists, Reasons)
  async loadMetadata() {
    try {
      const [resSettings, resDentists, resReasons] = await Promise.all([
        this.get('/settings'),
        this.get('/dentists'),
        this.get('/reasons')
      ]);

      this.state.settings = resSettings.settings || {};
      this.state.dentists = resDentists.dentists || [];
      this.state.reasons = resReasons.reasons || [];
      this.emit('METADATA_LOADED');
    } catch (err) {
      this.showToast('Erreur de chargement des paramètres', 'danger');
    }
  },

  // WebSocket Connection Handler
  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    let socket = null;

    const connect = () => {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        const liveIndicator = document.getElementById('live-indicator');
        if (liveIndicator) {
          liveIndicator.innerHTML = '<span class="live-dot"></span><span>En direct</span>';
          liveIndicator.style.background = '#f0fdf4';
          liveIndicator.style.color = '#166534';
        }
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.emit(msg.type, msg.payload);

          // If another operator made changes, inform the user with a discreet toast
          if (msg.type === 'APPOINTMENTS_UPDATED') {
            const op = msg.payload.operator;
            if (op && op !== this.state.currentOperator) {
              this.showToast(`Mise à jour en direct par ${op}`, 'info');
            }
          }
        } catch (e) {
          console.error('WS Parse Error:', e);
        }
      };

      socket.onclose = () => {
        const liveIndicator = document.getElementById('live-indicator');
        if (liveIndicator) {
          liveIndicator.innerHTML = '<span style="color:#dc2626">●</span><span>Déconnecté (reconnexion...)</span>';
          liveIndicator.style.background = '#fef2f2';
          liveIndicator.style.color = '#991b1b';
        }
        // Auto-reconnect after 2 seconds
        setTimeout(connect, 2000);
      };

      socket.onerror = (err) => {
        console.warn('WebSocket encountered error:', err);
        socket.close();
      };
    };

    connect();
  }
};
