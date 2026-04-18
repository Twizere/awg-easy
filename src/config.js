'use strict';

const path = require('node:path');
const fs = require('node:fs');

(() => {
  const explicit = process.env.DOTENV_CONFIG_PATH;
  const candidates = [
    explicit && path.isAbsolute(explicit) ? explicit : explicit && path.join(process.cwd(), explicit),
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env'),
  ].filter(Boolean);
  for (const envPath of candidates) {
    try {
      if (fs.existsSync(envPath)) {
        // eslint-disable-next-line global-require
        require('dotenv').config({ path: envPath });
        break;
      }
    } catch {
      /* ignore optional dotenv */
    }
  }
})();

const { release: { version } } = require('./package.json');

module.exports.RELEASE = version;
module.exports.PORT = process.env.PORT || '51821';
module.exports.WEBUI_HOST = process.env.WEBUI_HOST || '0.0.0.0';
module.exports.PASSWORD_HASH = process.env.PASSWORD_HASH;
module.exports.MAX_AGE = parseInt(process.env.MAX_AGE, 10) * 1000 * 60 || 0;
module.exports.WG_PATH = process.env.WG_PATH || '/etc/wireguard/';
module.exports.WG_DEVICE = process.env.WG_DEVICE || 'eth0';
module.exports.WG_HOST = process.env.WG_HOST;
module.exports.WG_PORT = process.env.WG_PORT || '51820';
module.exports.WG_CONFIG_PORT = process.env.WG_CONFIG_PORT || process.env.WG_PORT || '51820';

/** Same semantics as Docker Compose: unset → single port `WG_PORT`; else `min-max` or one port. Used to validate tunnel listen ports. */
(function parsePublishedUdpPortRange() {
  const wgPort = parseInt(module.exports.WG_PORT, 10) || 51820;
  let min = wgPort;
  let max = wgPort;
  const raw = process.env.WG_UDP_PORT_RANGE;
  if (raw && typeof raw === 'string' && raw.trim()) {
    const t = raw.trim();
    if (t.includes('-')) {
      const idx = t.indexOf('-');
      const a = parseInt(t.slice(0, idx).trim(), 10);
      const b = parseInt(t.slice(idx + 1).trim(), 10);
      if (Number.isFinite(a) && Number.isFinite(b) && a >= 1 && b <= 65535) {
        min = Math.min(a, b);
        max = Math.max(a, b);
      }
    } else {
      const p = parseInt(t, 10);
      if (Number.isFinite(p) && p >= 1 && p <= 65535) {
        min = max = p;
      }
    }
  }
  module.exports.WG_PUBLISHED_UDP_PORT_MIN = min;
  module.exports.WG_PUBLISHED_UDP_PORT_MAX = max;
}());
/** Comma-separated tunnels: `wg0,wg1` or explicit ports `wg0:51820,wg1:51821`. Used for default ListenPort when not set in each tunnel JSON. */
module.exports.WG_TUNNELS = process.env.WG_TUNNELS || '';
module.exports.WG_MTU = process.env.WG_MTU || null;
module.exports.WG_PERSISTENT_KEEPALIVE = process.env.WG_PERSISTENT_KEEPALIVE || '0';
module.exports.WG_DEFAULT_ADDRESS = process.env.WG_DEFAULT_ADDRESS || '10.8.0.x';
module.exports.WG_DEFAULT_DNS = typeof process.env.WG_DEFAULT_DNS === 'string'
  ? process.env.WG_DEFAULT_DNS
  : '1.1.1.1';
module.exports.WG_ALLOWED_IPS = process.env.WG_ALLOWED_IPS || '0.0.0.0/0, ::/0';

module.exports.WG_PRE_UP = process.env.WG_PRE_UP || '';
module.exports.WG_POST_UP = process.env.WG_POST_UP || `
iptables -t nat -A POSTROUTING -s {SERVER_SUBNET} -o ${module.exports.WG_DEVICE} -j MASQUERADE;
iptables -A INPUT -p udp -m udp --dport {LISTEN_PORT} -j ACCEPT;
iptables -A FORWARD -i {INTERFACE} -j ACCEPT;
iptables -A FORWARD -o {INTERFACE} -j ACCEPT;
`.split('\n').join(' ');

module.exports.WG_PRE_DOWN = process.env.WG_PRE_DOWN || '';
module.exports.WG_POST_DOWN = process.env.WG_POST_DOWN || `
iptables -t nat -D POSTROUTING -s {SERVER_SUBNET} -o ${module.exports.WG_DEVICE} -j MASQUERADE;
iptables -D INPUT -p udp -m udp --dport {LISTEN_PORT} -j ACCEPT;
iptables -D FORWARD -i {INTERFACE} -j ACCEPT;
iptables -D FORWARD -o {INTERFACE} -j ACCEPT;
`.split('\n').join(' ');
module.exports.LANG = process.env.LANG || 'en';
module.exports.UI_TRAFFIC_STATS = process.env.UI_TRAFFIC_STATS || 'false';
module.exports.UI_CHART_TYPE = process.env.UI_CHART_TYPE || 0;
module.exports.WG_ENABLE_ONE_TIME_LINKS = process.env.WG_ENABLE_ONE_TIME_LINKS || 'false';
module.exports.UI_ENABLE_SORT_CLIENTS = process.env.UI_ENABLE_SORT_CLIENTS || 'false';
module.exports.WG_ENABLE_EXPIRES_TIME = process.env.WG_ENABLE_EXPIRES_TIME || 'false';
module.exports.ENABLE_PROMETHEUS_METRICS = process.env.ENABLE_PROMETHEUS_METRICS || 'false';
module.exports.PROMETHEUS_METRICS_PASSWORD = process.env.PROMETHEUS_METRICS_PASSWORD;

module.exports.DICEBEAR_TYPE = process.env.DICEBEAR_TYPE || false;
module.exports.USE_GRAVATAR = process.env.USE_GRAVATAR || false;

/** pfSense-style compat API: set to "true" to expose POST /api/compat/amnezia */
module.exports.AMNEZIA_API_ENABLED = process.env.AMNEZIA_API_ENABLED === 'true';
/** Required when AMNEZIA_API_ENABLED and AMNEZIA_API_AUTH=apikey */
module.exports.AMNEZIA_API_KEY = process.env.AMNEZIA_API_KEY || '';
/** "apikey" (default) or "none" — "none" allows requests without X-API-Key (insecure) */
module.exports.AMNEZIA_API_AUTH = process.env.AMNEZIA_API_AUTH || 'apikey';

function normalizeCompatApiBasePath(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  let s = raw.trim();
  if (!s) return '';
  if (!s.startsWith('/')) s = `/${s}`;
  s = s.replace(/\/+$/, '');
  return s || '';
}

/** Optional alternate URL prefix, e.g. `/awg/api` → POST `/awg/api` and GET `/awg/api/status` (default routes stay on `/api/compat/…`). */
module.exports.AMNEZIA_API_BASE_PATH = normalizeCompatApiBasePath(process.env.AMNEZIA_API_BASE_PATH || '');
module.exports.AMNEZIA_COMPAT_STATUS_PATH = module.exports.AMNEZIA_API_BASE_PATH
  ? `${module.exports.AMNEZIA_API_BASE_PATH}/status`
  : '/api/compat/status';
module.exports.AMNEZIA_COMPAT_POST_PATH = module.exports.AMNEZIA_API_BASE_PATH
  ? module.exports.AMNEZIA_API_BASE_PATH
  : '/api/compat/amnezia';

const getRandomInt = (min, max) => min + Math.floor(Math.random() * (max - min));
const getRandomJunkSize = () => getRandomInt(15, 150);
const getRandomHeader = () => getRandomInt(1, 2_147_483_647);

module.exports.JC = process.env.JC || getRandomInt(3, 10);
module.exports.JMIN = process.env.JMIN || 50;
module.exports.JMAX = process.env.JMAX || 1000;
module.exports.S1 = process.env.S1 || getRandomJunkSize();
module.exports.S2 = process.env.S2 || getRandomJunkSize();
module.exports.H1 = process.env.H1 || getRandomHeader();
module.exports.H2 = process.env.H2 || getRandomHeader();
module.exports.H3 = process.env.H3 || getRandomHeader();
module.exports.H4 = process.env.H4 || getRandomHeader();

(function buildWgTunnelDefaultListenPorts() {
  const raw = module.exports.WG_TUNNELS;
  const out = {};
  module.exports.WG_TUNNEL_DEFAULT_LISTEN_PORT = out;
  if (!raw || typeof raw !== 'string') return;

  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const namesNeedingPort = [];
  const base = parseInt(module.exports.WG_PORT, 10);
  const basePort = Number.isFinite(base) && base > 0 ? base : 51820;

  for (const part of parts) {
    if (part.includes(':')) {
      const [n, p] = part.split(':').map((x) => x.trim());
      if (/^[a-zA-Z0-9_-]{1,15}$/.test(n) && p) out[n] = String(p);
    } else if (/^[a-zA-Z0-9_-]{1,15}$/.test(part)) {
      namesNeedingPort.push(part);
    }
  }

  const usedPorts = new Set(
    Object.values(out).map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n)),
  );
  let next = basePort;
  for (const n of namesNeedingPort) {
    if (out[n]) continue;
    while (usedPorts.has(next)) next += 1;
    out[n] = String(next);
    usedPorts.add(next);
    next += 1;
  }
}());
