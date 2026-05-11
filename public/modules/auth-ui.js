// @ts-check

/**
 * @typedef {{ id: string; username: string; createdAt: string }} AuthUser
 * @typedef {{
 *   loginScreen: HTMLElement;
 *   registerScreen: HTMLElement;
 *   homeScreen: HTMLElement;
 *   gameScreen: HTMLElement;
 *   authStatus: HTMLElement;
 *   loginUsername: HTMLInputElement;
 *   loginPassword: HTMLInputElement;
 *   loginSubmitBtn: HTMLButtonElement;
 *   showRegisterBtn: HTMLButtonElement;
 *   registerUsername: HTMLInputElement;
 *   registerPassword: HTMLInputElement;
 *   registerConfirmPassword: HTMLInputElement;
 *   registerSubmitBtn: HTMLButtonElement;
 *   showLoginBtn: HTMLButtonElement;
 *   logoutBtn: HTMLButtonElement;
 *   playerNameInput: HTMLInputElement;
 *   createRoomBtn: HTMLButtonElement;
 *   joinRoomBtn: HTMLButtonElement;
 *   confirmJoinBtn: HTMLButtonElement;
 * }} AuthElements
 * @typedef {{
 *   getUser(): AuthUser | null;
 *   setUser(user: AuthUser | null): void;
 *   getJoiningRoom(): boolean;
 *   setPlayerName(name: string): void;
 *   disconnectSocket(): void;
 * }} AuthStateAdapter
 */

/**
 * @param {AuthElements} elements
 * @param {AuthStateAdapter} state
 */
export function createAuthUi(elements, state) {
  /**
   * @param {HTMLElement} screen
   */
  function showScreen(screen) {
    [elements.loginScreen, elements.registerScreen, elements.homeScreen, elements.gameScreen].forEach(item => {
      item.classList.toggle('active', item === screen);
    });
  }

  function showLoginScreen() {
    showScreen(elements.loginScreen);
    elements.loginPassword.value = '';
    elements.loginUsername.focus();
  }

  function showRegisterScreen() {
    showScreen(elements.registerScreen);
    elements.registerPassword.value = '';
    elements.registerConfirmPassword.value = '';
    elements.registerUsername.focus();
  }

  function renderAuthState() {
    const user = state.getUser();
    const isSignedIn = Boolean(user);

    elements.createRoomBtn.disabled = !isSignedIn || state.getJoiningRoom();
    elements.joinRoomBtn.disabled = !isSignedIn || state.getJoiningRoom();
    elements.confirmJoinBtn.disabled = !isSignedIn || state.getJoiningRoom();
    elements.playerNameInput.readOnly = true;

    if (user) {
      elements.authStatus.textContent = `已登录：${user.username}`;
      elements.playerNameInput.value = user.username;
      state.setPlayerName(user.username);
      if (!elements.gameScreen.classList.contains('active')) {
        showScreen(elements.homeScreen);
      }
      return;
    }

    elements.authStatus.textContent = '请登录后进入游戏';
    elements.playerNameInput.value = '';
    state.setPlayerName('');
    if (!elements.registerScreen.classList.contains('active')) {
      showScreen(elements.loginScreen);
    }
  }

  /**
   * @param {boolean} isBusy
   */
  function setAuthBusy(isBusy) {
    elements.loginSubmitBtn.disabled = isBusy;
    elements.registerSubmitBtn.disabled = isBusy;
    elements.logoutBtn.disabled = isBusy;
  }

  /**
   * @param {string} path
   * @param {Record<string, string>} body
   * @returns {Promise<{ success: boolean; user?: AuthUser | null; error?: string }>}
   */
  async function requestAuth(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({ success: false, error: '请求失败' }));

    if (!response.ok || !data.success) {
      throw new Error(data.error || '请求失败');
    }

    return data;
  }

  async function loadCurrentUser() {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const data = await response.json();
      state.setUser(data.user || null);
    } catch (error) {
      state.setUser(null);
    }
    renderAuthState();
  }

  /**
   * @param {'login' | 'register'} mode
   * @param {string} username
   * @param {string} password
   */
  async function completeAuthRequest(mode, username, password) {
    setAuthBusy(true);
    try {
      const data = await requestAuth(`/api/auth/${mode}`, { username, password });
      state.setUser(data.user || null);
      elements.loginPassword.value = '';
      elements.registerPassword.value = '';
      elements.registerConfirmPassword.value = '';
      renderAuthState();
    } catch (error) {
      alert(error instanceof Error ? error.message : '请求失败');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogin() {
    const username = elements.loginUsername.value.trim();
    const password = elements.loginPassword.value;

    if (!username || !password) {
      alert('请输入用户名和密码');
      return;
    }

    await completeAuthRequest('login', username, password);
  }

  async function handleRegister() {
    const username = elements.registerUsername.value.trim();
    const password = elements.registerPassword.value;
    const confirmPassword = elements.registerConfirmPassword.value;

    if (!username || !password || !confirmPassword) {
      alert('请输入用户名和密码');
      return;
    }

    if (password !== confirmPassword) {
      alert('两次输入的密码不一致');
      return;
    }

    await completeAuthRequest('register', username, password);
  }

  async function logout() {
    setAuthBusy(true);
    try {
      await requestAuth('/api/auth/logout', {});
      state.disconnectSocket();
      state.setUser(null);
      renderAuthState();
    } catch (error) {
      alert(error instanceof Error ? error.message : '请求失败');
    } finally {
      setAuthBusy(false);
    }
  }

  function bindEvents() {
    elements.loginSubmitBtn.addEventListener('click', handleLogin);
    elements.registerSubmitBtn.addEventListener('click', handleRegister);
    elements.showRegisterBtn.addEventListener('click', showRegisterScreen);
    elements.showLoginBtn.addEventListener('click', showLoginScreen);
    elements.logoutBtn.addEventListener('click', logout);
    elements.loginPassword.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') handleLogin();
    });
    elements.registerConfirmPassword.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') handleRegister();
    });
  }

  return {
    bindEvents,
    loadCurrentUser,
    renderAuthState,
    showScreen
  };
}
