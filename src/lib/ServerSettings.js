'use strict';

/**
 * Runtime overrides for WG_HOST, WG_DEFAULT_DNS, AMNEZIA_VPN_ENABLED, and AMNEZIA_API_ENABLED.
 * Persisted to `{WG_PATH}/wg-easy-server-settings.json` so the Web UI can change them without editing .env.
 * Omitted keys fall back to environment (see config.js).
 */

const fs = require('fs');
const path = require('path');

const {
  WG_PATH,
  WG_HOST,
  WG_DEFAULT_DNS,
  AMNEZIA_VPN_ENABLED,
  AMNEZIA_API_ENABLED,
} = require('../config');

const SETTINGS_FILENAME = 'wg-easy-server-settings.json';

let cache = null;

function settingsFilePath() {
  return path.join(WG_PATH, SETTINGS_FILENAME);
}

function loadSync() {
  try {
    const raw = fs.readFileSync(settingsFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    cache = {};
  }
}

function getRaw() {
  if (cache === null) loadSync();
  return cache;
}

function saveSync(next) {
  const dir = WG_PATH.endsWith(path.sep) ? WG_PATH : `${WG_PATH}${path.sep}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsFilePath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  cache = next;
}

function getEffectiveWgHost() {
  const s = getRaw();
  if (s.wgHost != null && String(s.wgHost).trim() !== '') {
    return String(s.wgHost).trim();
  }
  return WG_HOST;
}

function getEffectiveWgDefaultDns() {
  const s = getRaw();
  if (s.wgDefaultDns != null && String(s.wgDefaultDns).trim() !== '') {
    return String(s.wgDefaultDns).trim();
  }
  return WG_DEFAULT_DNS;
}

function getEffectiveCompatApiEnabled() {
  const s = getRaw();
  if (Object.prototype.hasOwnProperty.call(s, 'compatApiEnabled')) {
    return !!s.compatApiEnabled;
  }
  return AMNEZIA_API_ENABLED;
}

function getEffectiveVpnEnabled() {
  const s = getRaw();
  if (Object.prototype.hasOwnProperty.call(s, 'vpnEnabled')) {
    return !!s.vpnEnabled;
  }
  return AMNEZIA_VPN_ENABLED;
}

function hasCompatApiOverride() {
  return Object.prototype.hasOwnProperty.call(getRaw(), 'compatApiEnabled');
}

function hasWgHostOverride() {
  const s = getRaw();
  return s.wgHost != null && String(s.wgHost).trim() !== '';
}

function hasWgDefaultDnsOverride() {
  const s = getRaw();
  return s.wgDefaultDns != null && String(s.wgDefaultDns).trim() !== '';
}

function hasVpnEnabledOverride() {
  return Object.prototype.hasOwnProperty.call(getRaw(), 'vpnEnabled');
}

/** Public snapshot for GET /api/server-settings */
function getPublicPayload() {
  return {
    env: {
      wgHost: WG_HOST || '',
      wgDefaultDns: WG_DEFAULT_DNS || '',
      vpnEnabled: AMNEZIA_VPN_ENABLED,
      compatApiEnabled: AMNEZIA_API_ENABLED,
    },
    overrides: {
      wgHost: hasWgHostOverride() ? String(getRaw().wgHost).trim() : null,
      wgDefaultDns: hasWgDefaultDnsOverride() ? String(getRaw().wgDefaultDns).trim() : null,
      vpnEnabled: hasVpnEnabledOverride() ? !!getRaw().vpnEnabled : null,
      compatApiEnabled: hasCompatApiOverride() ? !!getRaw().compatApiEnabled : null,
    },
    effective: {
      wgHost: getEffectiveWgHost() || '',
      wgDefaultDns: getEffectiveWgDefaultDns() || '',
      vpnEnabled: getEffectiveVpnEnabled(),
      compatApiEnabled: getEffectiveCompatApiEnabled(),
    },
  };
}

function assertValidWgHost(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (v.length > 253) {
    throw new Error('Server host is too long (max 253 characters)');
  }
  return v;
}

/** Comma-separated IPv4/hostnames for WireGuard DNS= line */
function assertValidDnsList(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  const parts = v.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length > 8) {
    throw new Error('Too many DNS servers (max 8)');
  }
  for (const p of parts) {
    if (p.length > 253) {
      throw new Error('Invalid DNS entry (too long)');
    }
  }
  return parts.join(', ');
}

/**
 * @param {{ compatApiEnabled?: boolean|null, vpnEnabled?: boolean|null, wgHost?: string|null, wgDefaultDns?: string|null }} body
 */
function applyUpdates(body) {
  const cur = { ...getRaw() };

  if (Object.prototype.hasOwnProperty.call(body, 'vpnEnabled')) {
    if (body.vpnEnabled === null) {
      delete cur.vpnEnabled;
    } else if (typeof body.vpnEnabled === 'boolean') {
      cur.vpnEnabled = body.vpnEnabled;
    } else {
      throw new Error('vpnEnabled must be boolean or null');
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'compatApiEnabled')) {
    if (body.compatApiEnabled === null) {
      delete cur.compatApiEnabled;
    } else if (typeof body.compatApiEnabled === 'boolean') {
      cur.compatApiEnabled = body.compatApiEnabled;
    } else {
      throw new Error('compatApiEnabled must be boolean or null');
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'wgHost')) {
    if (body.wgHost === null || body.wgHost === '') {
      delete cur.wgHost;
    } else {
      cur.wgHost = assertValidWgHost(body.wgHost);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'wgDefaultDns')) {
    if (body.wgDefaultDns === null || body.wgDefaultDns === '') {
      delete cur.wgDefaultDns;
    } else {
      cur.wgDefaultDns = assertValidDnsList(body.wgDefaultDns);
    }
  }

  const effHost = cur.wgHost != null && String(cur.wgHost).trim() !== ''
    ? String(cur.wgHost).trim()
    : WG_HOST;
  if (!effHost || !String(effHost).trim()) {
    throw new Error('Server host is required: set WG_HOST in the environment or override it here');
  }

  saveSync(cur);
}

module.exports = {
  getEffectiveWgHost,
  getEffectiveWgDefaultDns,
  getEffectiveVpnEnabled,
  getEffectiveCompatApiEnabled,
  getPublicPayload,
  applyUpdates,
  hasCompatApiOverride,
};
