const form = document.getElementById('loginForm');
const msg = document.getElementById('msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value; // ✅ no trim

  if (!username || !password) {
    msg.textContent = 'Ingrese usuario y contraseña';
    return;
  }

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      msg.textContent = data.message || 'Credenciales inválidas';
      return;
    }

    // ✅ Guardar sesión completa (para roles)
    localStorage.setItem('token', data.token);
    localStorage.setItem('role', data.role || '');
    localStorage.setItem('name', data.name || '');
    localStorage.setItem('zone', data.zone ?? '');
    localStorage.setItem('username', data.username || username); // ✅ NUEVO

    // ✅ Redirigir
    window.location.href = '/dashboard.html';

  } catch (err) {
    console.error(err);
    msg.textContent = 'No se pudo conectar al servidor';
  }
});
