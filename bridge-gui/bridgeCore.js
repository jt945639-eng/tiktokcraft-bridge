// Núcleo del puente TikTok LIVE -> Minecraft (RCON), controlable desde la interfaz web.
const fs = require('fs');
const path = require('path');
const { Rcon } = require('rcon-client');
// tiktok-live-connector es un paquete ESM puro; desde CommonJS hay que
// cargarlo con import() dinámico en vez de require().
let _tiktokLib = null;
async function getTikTokLib() {
  if (!_tiktokLib) {
    _tiktokLib = await import('tiktok-live-connector');
  }
  return _tiktokLib;
}

const isPkg = typeof process.pkg !== 'undefined';
const BASE_DIR = isPkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(BASE_DIR, 'config.json');

const DEFAULT_CONFIG = {
  tiktokUsername: 'tu_usuario_sin_arroba',
  signApiKey: 'pega-aqui-tu-api-key-gratuita-de-eulerstream.com',
  rcon: {
    host: 'IP_O_DOMINIO_DE_TU_SERVIDOR',
    port: 25575,
    password: 'la-clave-de-rcon.password-en-server.properties',
  },
};

function ensureConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  }
}

function readConfig() {
  ensureConfigFile();
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    throw new Error('config.json inválido: ' + e.message);
  }
}

// Guarda solo los campos editables desde la interfaz. signApiKey nunca se toca aquí,
// así que se conserva el que ya esté en el archivo.
function writeEditableConfig(fields) {
  const current = readConfig();
  const next = {
    ...current,
    tiktokUsername: fields.tiktokUsername ?? current.tiktokUsername,
    rcon: {
      ...current.rcon,
      host: fields.rconHost ?? current.rcon.host,
      port: fields.rconPort !== undefined && fields.rconPort !== '' ? Number(fields.rconPort) : current.rcon.port,
      password: fields.rconPassword ?? current.rcon.password,
    },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// Config "segura" para mostrar en la interfaz: signApiKey viene enmascarado.
function readConfigForUI() {
  const cfg = readConfig();
  const key = cfg.signApiKey || '';
  const masked = key.length > 6 ? key.slice(0, 3) + '•'.repeat(Math.max(0, key.length - 6)) + key.slice(-3) : '••••••';
  return {
    tiktokUsername: cfg.tiktokUsername || '',
    signApiKeyMasked: masked,
    rcon: {
      host: cfg.rcon?.host || '',
      port: cfg.rcon?.port ?? 25575,
      password: cfg.rcon?.password || '',
    },
  };
}

let state = {
  running: false,
  connection: null,
  rcon: null,
  reconnectingTikTok: false,
  reconnectTimer: null,
};

function slug(text) {
  return String(text || 'Alguien')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\-]/g, '')
    .slice(0, 32) || 'Alguien';
}

function getUserName(d) {
  return d?.user?.uniqueId || d?.user?.nickname || d?.uniqueId || d?.nickname || 'Alguien';
}

async function getRcon(cfg, log) {
  if (state.rcon) return state.rcon;
  state.rcon = await Rcon.connect({
    host: cfg.rcon.host,
    port: Number(cfg.rcon.port),
    password: cfg.rcon.password,
  });
  state.rcon.on('end', () => {
    log('RCON desconectado.');
    state.rcon = null;
  });
  log('Conectado por RCON al servidor de Minecraft.');
  return state.rcon;
}

async function send(cfg, log, command) {
  try {
    const r = await getRcon(cfg, log);
    await r.send(command);
  } catch (e) {
    log('No se pudo enviar por RCON: ' + e.message);
    state.rcon = null;
  }
}

async function startBridge(log) {
  if (state.running) {
    log('Ya está en marcha.');
    return;
  }
  const cfg = readConfig();

  if (!cfg.tiktokUsername || cfg.tiktokUsername.startsWith('tu_usuario')) {
    log('⚠ Falta configurar el usuario de TikTok.');
    return;
  }
  if (!cfg.signApiKey || cfg.signApiKey.startsWith('pega-aqui')) {
    log('⚠ Falta el signApiKey en config.json (edítalo manualmente, no se cambia desde esta ventana).');
    return;
  }

  state.running = true;
  state.reconnectingTikTok = false;

  try {
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await getTikTokLib();

    const connection = new TikTokLiveConnection(cfg.tiktokUsername, {
      signApiKey: cfg.signApiKey,
    });
    state.connection = connection;

    function connectTikTok() {
      if (!state.running) return;
      state.reconnectingTikTok = false;
      connection
        .connect()
        .then((info) => log(`Conectado al LIVE de @${cfg.tiktokUsername} (sala ${info.roomId})`))
        .catch((err) => {
          log('No se pudo conectar (¿estás en LIVE? ¿signApiKey correcto?): ' + (err?.message || err));
          scheduleReconnect(10000);
        });
    }

    function scheduleReconnect(ms) {
      if (!state.running || state.reconnectingTikTok) return;
      state.reconnectingTikTok = true;
      state.reconnectTimer = setTimeout(connectTikTok, ms);
    }

    connection.on(WebcastEvent.GIFT, (d) => {
      try {
        const giftType = d.giftDetails?.giftType;
        const giftName = d.giftDetails?.giftName || 'Regalo';
        if (giftType === 1 && !d.repeatEnd) return;
        const count = d.repeatCount || 1;
        const user = getUserName(d);
        log(`🎁 ${user}: ${giftName} x${count}`);
        send(cfg, log, `tiktokcraft gift ${slug(giftName)} ${count} ${slug(user)}`);
      } catch (e) {
        log('Error procesando regalo: ' + e.message);
      }
    });

    connection.on(WebcastEvent.LIKE, (d) => {
      try {
        send(cfg, log, `tiktokcraft like ${d?.likeCount || 1}`);
      } catch (e) {
        log('Error procesando like: ' + e.message);
      }
    });

    connection.on(WebcastEvent.CHAT, (d) => {
      try {
        const prefix = '!';
        const texto = d.comment || '';
        if (!texto.startsWith(prefix)) return;
        const palabra = texto.slice(prefix.length).trim().split(/\s+/)[0];
        if (!palabra) return;
        const user = getUserName(d);
        log(`💬 ${user}: ${texto}`);
        send(cfg, log, `tiktokcraft chat ${palabra} ${slug(user)}`);
      } catch (e) {
        log('Error procesando chat: ' + e.message);
      }
    });

    connection.on(WebcastEvent.FOLLOW, (d) => {
      try {
        const user = getUserName(d);
        log(`➕ ${user} te sigue`);
        send(cfg, log, `tiktokcraft follow ${slug(user)}`);
      } catch (e) {
        log('Error procesando follow: ' + e.message);
      }
    });

    connection.on(WebcastEvent.SHARE, (d) => {
      try {
        const user = getUserName(d);
        log(`🔁 ${user} compartió el LIVE`);
        send(cfg, log, `tiktokcraft share ${slug(user)}`);
      } catch (e) {
        log('Error procesando share: ' + e.message);
      }
    });

    connection.on(ControlEvent.DISCONNECTED, () => {
      if (!state.running) return;
      log('Desconectado de TikTok, reintentando en 5 s...');
      scheduleReconnect(5000);
    });

    connection.on(WebcastEvent.STREAM_END, () => log('El LIVE terminó.'));

    log('Iniciando...');
    connectTikTok();
  } catch (e) {
    log('No se pudo iniciar: ' + (e?.message || e));
    state.running = false;
  }
}

function stopBridge(log) {
  if (!state.running) {
    log('Ya está detenido.');
    return;
  }
  state.running = false;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  try {
    state.connection?.disconnect?.();
  } catch (e) {
    /* ignore */
  }
  state.connection = null;
  try {
    state.rcon?.end?.();
  } catch (e) {
    /* ignore */
  }
  state.rcon = null;
  log('Detenido.');
}

function isRunning() {
  return state.running;
}

module.exports = {
  CONFIG_PATH,
  ensureConfigFile,
  readConfigForUI,
  writeEditableConfig,
  startBridge,
  stopBridge,
  isRunning,
};
