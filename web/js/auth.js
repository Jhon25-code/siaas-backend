const form = document.getElementById('loginForm');
const msg = document.getElementById('msg');

// ✅ Limpieza segura: borrar solo claves del sistema (no todo el localStorage)
const SIAAS_KEYS = ['token', 'role', 'name', 'zone', 'username'];
SIAAS_KEYS.forEach((k) => localStorage.removeItem(k));

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Limpiar mensajes y preparar UI
    if (msg) msg.textContent = '';
    const btn = form.querySelector('button');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Verificando...';
    }

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value; // no trim en contraseñas

    if (!username || !password) {
      if (msg) msg.textContent = 'Ingrese usuario y contraseña';
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Ingresar';
      }
      return;
    }

    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      // ✅ A prueba de respuestas no-JSON (HTML por 500, etc.)
      const rawText = await res.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch (_) {
        data = {};
      }

      if (!res.ok) {
        // Si vino JSON con message, úsalo. Si no, muestra texto genérico.
        if (msg) msg.textContent = data.message || 'Credenciales inválidas';
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Ingresar';
        }
        return;
      }

      // ✅ ÉXITO: Guardar sesión completa
      console.log('Login correcto. Guardando token...');
      localStorage.setItem('token', data.token);
      localStorage.setItem('role', data.role || '');
      localStorage.setItem('name', data.name || '');
      // Si el backend no envía zone, guardamos vacío para no romper dashboard
      localStorage.setItem('zone', data.zone ?? '');
      // Guardar username (si el backend no lo manda, usamos el ingresado)
      localStorage.setItem('username', data.username || username);

      // Redirigir usando 'replace' para evitar volver con Atrás
      window.location.replace('/dashboard.html');
    } catch (err) {
      console.error('Error de conexión:', err);
      if (msg) msg.textContent = 'No se pudo conectar al servidor';
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Ingresar';
      }
    }
  });
}
