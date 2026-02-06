const API = {
  async request(path, { method = 'GET', body, headers: extraHeaders } = {}) {
    const token = localStorage.getItem('token');

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(extraHeaders || {})
    };

    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers };

    // Solo enviamos body si viene definido y el método lo permite
    if (body !== undefined && body !== null && method.toUpperCase() !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(path, options);

    // ✅ A prueba de respuestas no JSON (HTML por errores)
    const rawText = await res.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      data = {};
    }

    // ✅ Manejo claro de auth
    if (res.status === 401 || res.status === 403) {
      console.warn('🔒 Sesión inválida o sin permisos. Redirigiendo a login...');
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      localStorage.removeItem('name');
      localStorage.removeItem('zone');
      localStorage.removeItem('username');
      // si estás en login.html ya, no redirigimos
      if (!window.location.pathname.includes('login')) {
        window.location.replace('/login.html');
      }
      throw new Error((data && (data.message || data.error)) || 'No autorizado');
    }

    if (!res.ok) {
      throw new Error((data && (data.message || data.error)) || 'Error');
    }

    return data;
  },

  // Helpers (opcionales, no rompen nada si no los usas)
  get(path) {
    return this.request(path, { method: 'GET' });
  },
  post(path, body) {
    return this.request(path, { method: 'POST', body });
  },
  patch(path, body) {
    return this.request(path, { method: 'PATCH', body });
  },
  del(path) {
    return this.request(path, { method: 'DELETE' });
  }
};
