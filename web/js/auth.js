const form = document.getElementById('loginForm');
const msg = document.getElementById('msg');

// 1. LIMPIEZA PREVENTIVA: Borrar cualquier token viejo al cargar el script
localStorage.clear();

if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Limpiar mensajes y preparar UI
        if (msg) msg.textContent = '';
        const btn = form.querySelector('button');
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Verificando...";
        }

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value; // No trim en contraseñas

        if (!username || !password) {
            if (msg) msg.textContent = 'Ingrese usuario y contraseña';
            if (btn) { btn.disabled = false; btn.textContent = "Ingresar"; }
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
                if (msg) msg.textContent = data.message || 'Credenciales inválidas';
                // Restaurar botón si falló
                if (btn) { btn.disabled = false; btn.textContent = "Ingresar"; }
                return;
            }

            // ✅ ÉXITO: Guardar sesión completa
            console.log("Login correcto. Guardando token...");
            localStorage.setItem('token', data.token);
            localStorage.setItem('role', data.role || '');
            localStorage.setItem('name', data.name || '');
            localStorage.setItem('zone', data.zone ?? '');
            localStorage.setItem('username', data.username || username);

            // Redirigir usando 'replace' para que no puedan volver atrás con el botón 'Atrás'
            window.location.replace('/dashboard.html');

        } catch (err) {
            console.error("Error de conexión:", err);
            if (msg) msg.textContent = 'No se pudo conectar al servidor';
            if (btn) { btn.disabled = false; btn.textContent = "Ingresar"; }
        }
    });
}