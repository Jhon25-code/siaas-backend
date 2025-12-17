const express = require('express');
const cors = require('cors');

const app = express();

/**
 *  CLAVE PARA RENDER
 * Render asigna el puerto dinámicamente
 * Localmente usará 3000
 */
const PORT = process.env.PORT || 3000;

//  Middleware
app.use(cors());
app.use(express.json());

//  Memoria temporal (luego DB real)
const incidents = [];

//  Endpoint de sincronización (Flutter)
app.post('/sync', (req, res) => {
  const incident = {
    tipo: req.body.tipo,
    descripcion: req.body.descripcion || '',
    severidad: req.body.severidad || 'leve',
    smart_score: req.body.smart_score || 0,
    latitude: req.body.latitude ?? null,
    longitude: req.body.longitude ?? null,
    timestamp: req.body.timestamp,
    received_at: new Date().toISOString(),
  };

  incidents.push(incident);

  console.log(' Incidente recibido:', incident);

  res.status(200).json({
    success: true,
    message: 'Incidente sincronizado correctamente',
    data: incident,
  });
});

//  API para el dashboard
app.get('/incidents', (req, res) => {
  res.json(incidents);
});

//  Dashboard Web
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>SIAAS Dashboard</title>
<style>
  body { font-family: Arial; background: #f4f6f8; padding: 20px; }
  h1 { color: #1976d2; }
  table { width: 100%; border-collapse: collapse; background: white; }
  th, td { padding: 10px; border-bottom: 1px solid #ddd; }
  th { background: #1976d2; color: white; }

  .leve-row { background: #e8f5e9; }
  .medio-row { background: #fff3e0; }
  .grave-row { background: #ffebee; }

  .badge {
    padding: 4px 10px;
    border-radius: 10px;
    color: white;
    font-weight: bold;
    font-size: 12px;
  }
  .leve { background: #2e7d32; }
  .medio { background: #ef6c00; }
  .grave { background: #c62828; }
</style>
</head>

<body>
<h1> SIAAS – Incidentes Recibidos</h1>

<table>
<thead>
<tr>
  <th>Tipo</th>
  <th>Descripción</th>
  <th>Score</th>
  <th>Lat</th>
  <th>Lng</th>
  <th>Hora</th>
  <th>Severidad</th>
</tr>
</thead>
<tbody id="tbody"></tbody>
</table>

<script>
function severityClass(sev) {
  if (sev === 'grave') return { row: 'grave-row', badge: 'grave' };
  if (sev === 'medio') return { row: 'medio-row', badge: 'medio' };
  return { row: 'leve-row', badge: 'leve' };
}

function loadIncidents() {
  fetch('/incidents')
    .then(res => res.json())
    .then(data => {
      const tbody = document.getElementById('tbody');
      tbody.innerHTML = '';

      data.forEach(i => {
        const s = severityClass(i.severidad);
        const tr = document.createElement('tr');
        tr.className = s.row;

        tr.innerHTML =
          '<td>' + i.tipo + '</td>' +
          '<td>' + (i.descripcion || '-') + '</td>' +
          '<td>' + i.smart_score + '</td>' +
          '<td>' + (i.latitude ?? '-') + '</td>' +
          '<td>' + (i.longitude ?? '-') + '</td>' +
          '<td>' + i.received_at + '</td>' +
          '<td><span class="badge ' + s.badge + '">' + i.severidad + '</span></td>';

        tbody.appendChild(tr);
      });
    });
}

loadIncidents();
setInterval(loadIncidents, 3000);
</script>

</body>
</html>
  `);
});

/**
 *  CLAVE
 * - 0.0.0.0 → Render + red
 * - process.env.PORT → Render
 */
app.listen(PORT, '0.0.0.0', () => {
  console.log(` Servidor SIAAS escuchando en:
  → http://localhost:${PORT}
  → http://127.0.0.1:${PORT}
  → http://10.0.2.2:${PORT} (emulador Android)
  `);
});
