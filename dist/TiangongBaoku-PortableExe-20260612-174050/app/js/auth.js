/**
 * Auth UI — login/register views
 */
const AuthUI = {
    render() {
        const app = document.getElementById('app');
        app.innerHTML = `
            <div class="auth-container">
                <div class="auth-card">
                    <div class="auth-tabs">
                        <button class="auth-tab active" data-tab="login">登录</button>
                        <button class="auth-tab" data-tab="register">注册</button>
                    </div>
                    <form id="loginForm" class="auth-form">
                        <h2>👋 欢迎回来</h2>
                        <div class="form-group">
                            <label>用户名</label>
                            <input type="text" id="loginUsername" placeholder="请输入用户名" autocomplete="username">
                        </div>
                        <div class="form-group">
                            <label>密码</label>
                            <input type="password" id="loginPassword" placeholder="请输入密码" autocomplete="current-password">
                        </div>
                        <div class="form-error" id="loginError"></div>
                        <button type="submit" class="btn btn-primary btn-block">登 录</button>
                    </form>
                    <form id="registerForm" class="auth-form" style="display:none">
                        <h2>📝 创建账号</h2>
                        <div class="form-group">
                            <label>用户名</label>
                            <input type="text" id="regUsername" placeholder="2-30个字符" autocomplete="username">
                        </div>
                        <div class="form-group">
                            <label>密码</label>
                            <input type="password" id="regPassword" placeholder="至少4个字符" autocomplete="new-password">
                        </div>
                        <div class="form-error" id="regError"></div>
                        <button type="submit" class="btn btn-primary btn-block">注 册</button>
                    </form>
                </div>
            </div>
        `;

        // Tab switching
        app.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                app.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const showLogin = tab.dataset.tab === 'login';
                document.getElementById('loginForm').style.display = showLogin ? '' : 'none';
                document.getElementById('registerForm').style.display = showLogin ? 'none' : '';
                document.getElementById('loginError').textContent = '';
                document.getElementById('regError').textContent = '';
            });
        });

        // Login form
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;
            const errorEl = document.getElementById('loginError');
            errorEl.textContent = '';

            if (!username || !password) {
                errorEl.textContent = '请填写用户名和密码';
                return;
            }

            try {
                const data = await API.auth.login(username, password);
                API.setToken(data.token);
                App.showToast('登录成功 ✅');
                App.navigate('home');
                App.updateAuthState();
            } catch (err) {
                errorEl.textContent = err.message;
            }
        });

        // Register form
        document.getElementById('registerForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('regUsername').value.trim();
            const password = document.getElementById('regPassword').value;
            const errorEl = document.getElementById('regError');
            errorEl.textContent = '';

            if (username.length < 2 || username.length > 30) {
                errorEl.textContent = '用户名需要2-30个字符';
                return;
            }
            if (password.length < 4) {
                errorEl.textContent = '密码至少需要4个字符';
                return;
            }

            try {
                const data = await API.auth.register(username, password);
                API.setToken(data.token);
                App.showToast('注册成功 ✅');
                App.navigate('home');
                App.updateAuthState();
            } catch (err) {
                errorEl.textContent = err.message;
            }
        });
    },
};
