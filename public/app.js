const API = window.location.origin; // http://localhost:4000
let socket;

// helpers
function setAuthMessage(msg, isError = false) {
    const d = document.getElementById('authMessage');
    d.textContent = msg;
    d.style.color = isError ? 'red' : 'green';
}

// Show “email verified” notice if we were redirected here after verification
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('verified') === '1') {
    // Reuse your existing helper to display messages
    setAuthMessage('✅ Your email has been verified! Please log in.', false);
}

// Registration (only if registerForm is on this page)
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.onsubmit = async e => {
        e.preventDefault();
        const email = document.getElementById('regEmail').value;
        const password = document.getElementById('regPassword').value;
        try {
            const res = await fetch(`${API}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (res.status === 400) {
                const errText = await res.text();
                setAuthMessage(`❌ Registration failed: ${errText}`, true);
                return;
            }
            if (!res.ok) {
                const errText = await res.text();
                setAuthMessage(`❌ Server error: ${errText}`, true);
                return;
            }
            setAuthMessage('✅ Registration successful! Please check your email and verify your account before logging in.');
        } catch (err) {
            setAuthMessage(`❌ Network error: ${err.message}`, true);
        }
    };
}


// Login (only if loginForm is on this page)
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.onsubmit = async e => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        try {
            const res = await fetch(`${API}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            if (res.status === 403) {
                setAuthMessage('❌ Please check your email and click the verification link.', true);
                return;
            }

            if (res.status === 401) {
                setAuthMessage('❌ Invalid email or password.', true);
                return;
            }
            if (res.status === 400) {
                setAuthMessage('❌ Login failed: bad request.', true);
                return;
            }
            if (!res.ok) {
                const errText = await res.text().catch(() => res.statusText);
                setAuthMessage(`❌ Server error: ${errText}`, true);
                return;
            }
            const { token } = await res.json();
            localStorage.setItem('jwt', token);
            setAuthMessage('✅ Logged in successfully!');
            window.location.href = '/dashboard.html';
        } catch (err) {
            setAuthMessage(`❌ Network error: ${err.message}`, true);
        }
    };
}

// show the main UI
function enterMain(email, token) {
    document.getElementById('auth').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    document.getElementById('userEmail').textContent = email;
    // set default header for future fetches
    window.authToken = token;
}

document.getElementById('whoamiBtn').onclick = async () => {
    try {
        const res = await fetch(`${API}/me`, {
            headers: { Authorization: 'Bearer ' + window.authToken }
        });
        if (!res.ok) throw new Error(await res.text());
        const body = await res.json();
        document.getElementById('whoamiResult').textContent =
            `You are ${body.user.email} (ID ${body.user.userId})`;
    } catch (err) {
        document.getElementById('whoamiResult').textContent =
            'Error: ' + err.message;
    }
};

// connect to websocket
document.getElementById('connectWsBtn').onclick = () => {
    if (socket && socket.connected) return;
    socket = io(API, { auth: { token: window.authToken } });
    socket.on('connect', () => {
        appendMsg('🔗 Socket connected, id=' + socket.id);
    });
    socket.on('priceUpdate', tick => {
        appendMsg(`📈 ${tick.symbol}: ${tick.price}`);
    });
    socket.on('disconnect', () => {
        appendMsg('⚠️ Socket disconnected');
    });
};

function appendMsg(msg) {
    const d = document.getElementById('messages');
    const p = document.createElement('p');
    p.textContent = msg;
    d.prepend(p);
}

// log out
document.getElementById('logoutBtn').onclick = () => {
    localStorage.removeItem('jwt');
    window.authToken = null;
    document.getElementById('main').style.display = 'none';
    document.getElementById('auth').style.display = 'block';
    setAuthMessage('✅ Logged out successfully.');
    document.getElementById('messages').innerHTML = '';
    document.getElementById('whoamiResult').textContent = '';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
};


window.addEventListener('load', async () => {
    const token = localStorage.getItem('jwt');
    if (!token) return;
    try {
        const res = await fetch(`${API}/me`, {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error();
        const { user } = await res.json();
        enterMain(user.email, token);
    } catch {
        localStorage.removeItem('jwt');
    }
});
