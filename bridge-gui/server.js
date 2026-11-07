const express = require('express');
const { exec } = require('child_process');
const core = require('./bridgeCore');
const PAGE_HTML = require('./ui');

const PORT = 4578;
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.type('html').send(PAGE_HTML);
});

const logs = [];
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  logs.push(line);
  if (logs.length > 300) logs.shift();
}

core.ensureConfigFile();
log('Interfaz lista. config.json en: ' + core.CONFIG_PATH);

app.get('/api/config', (req, res) => {
  try {
    res.json(core.readConfigForUI());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const saved = core.writeEditableConfig(req.body || {});
    log('Configuración guardada.');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/start', (req, res) => {
  core.startBridge(log);
  res.json({ ok: true, running: core.isRunning() });
});

app.post('/api/stop', (req, res) => {
  core.stopBridge(log);
  res.json({ ok: true, running: core.isRunning() });
});

app.get('/api/status', (req, res) => {
  res.json({ running: core.isRunning(), logs });
});

app.listen(PORT, () => {
  log(`Servidor local iniciado en http://localhost:${PORT}`);
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, () => {});
});
