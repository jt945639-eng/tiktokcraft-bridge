const { exec, spawn } = require('child_process');

// Al abrir el .exe por doble clic, Windows crea una ventana de consola negra.
// Para que no se vea: si todavía no somos la copia "oculta", nos relanzamos
// a nosotros mismos en segundo plano (sin ventana) y esta primera ventana
// se cierra de inmediato.
if (process.platform === 'win32' && !process.env.TIKTOKCRAFT_BRIDGE_HIDDEN) {
  const child = spawn(process.execPath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, TIKTOKCRAFT_BRIDGE_HIDDEN: '1' },
  });
  child.unref();
  process.exit(0);
}

const express = require('express');
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

// Red de seguridad: que ningún error deje de cerrar el programa de golpe.
process.on('unhandledRejection', (e) => log('Error no controlado: ' + (e?.message || e)));
process.on('uncaughtException', (e) => log('Error no controlado: ' + (e?.message || e)));

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
  Promise.resolve(core.startBridge(log)).catch((e) => {
    log('Error inesperado al iniciar: ' + (e?.message || e));
  });
  res.json({ ok: true, running: core.isRunning() });
});

app.post('/api/stop', (req, res) => {
  core.stopBridge(log);
  res.json({ ok: true, running: core.isRunning() });
});

app.get('/api/status', (req, res) => {
  res.json({ running: core.isRunning(), logs });
});

app.post('/api/quit', (req, res) => {
  res.json({ ok: true });
  core.stopBridge(log);
  setTimeout(() => process.exit(0), 300);
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
  }
  // En Linux no se abre ningún navegador: normalmente corre en un servidor
  // sin escritorio. La interfaz sigue disponible en http://localhost:4578
  // por si se quiere abrir manualmente (por ejemplo con un túnel SSH).
}

app.listen(PORT, () => {
  log(`Servidor local iniciado en http://localhost:${PORT}`);
  if (process.platform !== 'linux') {
    openAppWindow(`http://localhost:${PORT}`);
  }
});
