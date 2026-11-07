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
  // Sin consola visible, escribir en stdout puede fallar; lo ignoramos
  // porque el registro ya se ve en la ventana web.
  try {
    console.log(line);
  } catch (e) {
    /* sin consola, no pasa nada */
  }
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

function openAppWindow(url) {
  if (process.platform === 'win32') {
    // Abre como "ventana de aplicación" (sin pestañas ni barra de direcciones)
    // usando Edge, que viene instalado por defecto en Windows.
    const edgeCmd = `start "" msedge --app="${url}" --window-size=700,840`;
    exec(edgeCmd, (err) => {
      if (err) {
        const chromeCmd = `start "" chrome --app="${url}" --window-size=700,840`;
        exec(chromeCmd, (err2) => {
          if (err2) exec(`start "" "${url}"`, () => {});
        });
      }
    });
  } else if (process.platform === 'darwin') {
    exec(`open -na "Google Chrome" --args --app="${url}" --window-size=700,840`, (err) => {
      if (err) exec(`open "${url}"`, () => {});
    });
  } else {
    exec(`google-chrome --app="${url}" --window-size=700,840 || xdg-open "${url}"`, () => {});
  }
}

app.listen(PORT, () => {
  log(`Servidor local iniciado en http://localhost:${PORT}`);
  openAppWindow(`http://localhost:${PORT}`);
});
