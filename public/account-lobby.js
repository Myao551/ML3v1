/* Account cookies stay HTTP-only; this controller keeps only the public profile. */
window.AccountLobby = class AccountLobby {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.user = null;
    this.page = 1;
    this.version = 0;
    this.$ = id => document.getElementById(id);
    this.$('login-form').addEventListener('submit', event => this.submitAuth(event, 'login'));
    this.$('register-form').addEventListener('submit', event => this.submitAuth(event, 'register'));
    this.$('show-register-btn').addEventListener('click', () => this.showAuth('register'));
    this.$('show-login-btn').addEventListener('click', () => this.showAuth('login'));
    this.$('logout-btn').addEventListener('click', () => this.logout());
    this.$('auth-retry-btn').addEventListener('click', () => this.start());
    this.$('open-create-btn').addEventListener('click', () => {
      const open = this.$('create-room-panel').classList.toggle('hidden');
      this.$('open-create-btn').setAttribute('aria-expanded', String(!open));
      if (!open) this.$('base-score-input').focus();
    });
    this.$('room-search').addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.page = 1;
      this.searchTimer = setTimeout(() => this.loadRooms(), 250);
    });
    this.$('available-rooms').addEventListener('change', () => { this.page = 1; this.loadRooms(); });
    this.$('refresh-rooms-btn').addEventListener('click', () => this.loadRooms());
    this.$('rooms-prev-btn').addEventListener('click', () => { this.page--; this.loadRooms(); });
    this.$('rooms-next-btn').addEventListener('click', () => { this.page++; this.loadRooms(); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.pollTimer) this.loadRooms();
    });
    window.addEventListener('storage', event => {
      if (event.key !== 'sanda1-auth-change') return;
      this.user = null;
      this.stop();
      this.callbacks.onAuthLost();
      this.start();
    });
  }

  async api(url, body) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store',
      ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || '请求失败，请稍后重试'); error.status = response.status; throw error; }
    return data;
  }

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.id === id));
  }

  showAuth(mode = 'login') {
    this.stop();
    this.showScreen(`${mode}-screen`);
    this.$(`${mode}-error`).textContent = '';
    this.$(`${mode}-username`).focus();
  }

  async start() {
    this.showScreen('loading-screen');
    this.$('auth-retry-btn').classList.add('hidden');
    this.$('startup-status').textContent = '正在连接…';
    try {
      const { user } = await this.api('/api/auth/me');
      if (user) this.authenticated(user);
      else this.showAuth();
    } catch {
      this.$('startup-status').textContent = '暂时无法连接服务器';
      this.$('auth-retry-btn').classList.remove('hidden');
    }
  }

  async submitAuth(event, mode) {
    event.preventDefault();
    const button = this.$(`${mode}-submit-btn`);
    if (button.disabled) return;
    const body = { username: this.$(`${mode}-username`).value.trim(), password: this.$(`${mode}-password`).value };
    const errorBox = this.$(`${mode}-error`);
    errorBox.textContent = '';
    if (mode === 'register') {
      body.displayName = this.$('register-name').value.trim();
      if (body.password !== this.$('register-confirm').value) { errorBox.textContent = '两次输入的密码不一致'; return; }
    }
    button.disabled = true;
    try {
      const { user } = await this.api(`/api/auth/${mode}`, body);
      this.$(`${mode}-form`).reset();
      this.broadcastAuthChange();
      this.authenticated(user);
    } catch (error) { errorBox.textContent = error.status ? error.message : '连接失败，请稍后重试'; }
    finally { button.disabled = false; }
  }

  authenticated(user) {
    this.user = user;
    this.$('account-name').textContent = user.displayName;
    this.$('account-username').textContent = `@${user.username}`;
    this.$('account-name').title = user.displayName;
    this.$('account-username').title = `@${user.username}`;
    this.showLobby();
    this.callbacks.onAuthenticated(user);
  }

  broadcastAuthChange() {
    try { localStorage.setItem('sanda1-auth-change', crypto.randomUUID()); } catch { /* Storage can be disabled. */ }
  }

  showLobby() {
    if (!this.user) return;
    this.stop();
    this.showScreen('home-screen');
    this.loadRooms();
    this.pollTimer = setInterval(() => { if (!document.hidden) this.loadRooms(); }, 5000);
  }

  stop() {
    clearInterval(this.pollTimer);
    clearTimeout(this.searchTimer);
    this.pollTimer = null;
    this.version++;
  }

  expire() {
    this.user = null;
    this.stop();
    this.callbacks.onAuthLost();
    this.showAuth();
    this.$('login-error').textContent = '登录已失效，请重新登录';
  }

  async logout() {
    const button = this.$('logout-btn');
    button.disabled = true;
    try {
      await this.api('/api/auth/logout', {});
      this.broadcastAuthChange();
      this.user = null;
      this.stop();
      this.callbacks.onAuthLost();
      this.showAuth();
    } catch { this.$('lobby-status').textContent = '退出登录失败，请重试'; }
    finally { button.disabled = false; }
  }

  async loadRooms() {
    if (!this.user || !this.$('home-screen').classList.contains('active')) return;
    const version = ++this.version;
    const status = this.$('lobby-status');
    const params = new URLSearchParams({ q: this.$('room-search').value.trim(), available: String(this.$('available-rooms').checked), page: String(this.page) });
    this.$('refresh-rooms-btn').disabled = true;
    try {
      const data = await this.api(`/api/rooms?${params}`);
      if (version !== this.version) return;
      if (this.page > 1 && !data.rooms.length) { this.page = Math.max(1, Math.ceil(data.total / data.pageSize)); this.loadRooms(); return; }
      this.renderRooms(data.rooms);
      status.textContent = data.total ? `共 ${data.total} 个房间` : this.$('room-search').value || this.$('available-rooms').checked ? '没有符合条件的房间' : '暂无房间';
      this.$('rooms-page').textContent = `${this.page} / ${Math.max(1, Math.ceil(data.total / data.pageSize))}`;
      this.$('rooms-prev-btn').disabled = this.page <= 1;
      this.$('rooms-next-btn').disabled = this.page * data.pageSize >= data.total;
    } catch (error) {
      if (version !== this.version) return;
      if (error.status === 401) { this.expire(); return; }
      status.textContent = '房间列表更新失败，请刷新重试';
    } finally { if (version === this.version) this.$('refresh-rooms-btn').disabled = false; }
  }

  renderRooms(rooms) {
    const list = this.$('room-list');
    list.replaceChildren();
    const states = { waiting: '等待开局', bidding: '叫分中', exchanging: '埋牌中', 'choosing-trump': '选主中', playing: '对局中', ended: '结算中' };
    for (const room of rooms) {
      const row = document.createElement('li'); row.className = 'lobby-room';
      const identity = document.createElement('div'); identity.className = 'lobby-room-identity';
      const id = document.createElement('strong'); id.textContent = room.id;
      const host = document.createElement('span'); host.textContent = `房主 ${room.host}`;
      identity.append(id, host);
      const count = document.createElement('span'); count.className = 'lobby-room-count'; count.textContent = `${room.playerCount} / ${room.capacity} 人`;
      const stakes = document.createElement('span'); stakes.className = 'lobby-room-stakes'; stakes.textContent = `底分 ${room.baseScore} · 加分 ${room.levelScore}`;
      const state = document.createElement('span'); state.className = `room-state ${room.state === 'waiting' ? 'waiting' : ''}`; state.textContent = states[room.state] || '对局中';
      const button = document.createElement('button'); button.className = 'btn btn-small btn-secondary';
      const icon = document.createElement('img'); icon.className = 'icon'; icon.src = 'assets/icons/log-in.svg'; icon.alt = '';
      const label = document.createElement('span'); label.textContent = room.rejoinable ? '返回牌局' : room.joinable ? '加入' : room.state === 'waiting' ? '已满' : '进行中';
      button.append(icon, label); button.disabled = !room.joinable;
      button.setAttribute('aria-label', `${label.textContent} ${room.id}`);
      button.addEventListener('click', () => this.callbacks.onJoin(room.id));
      row.append(identity, count, stakes, state, button); list.append(row);
    }
  }
};
