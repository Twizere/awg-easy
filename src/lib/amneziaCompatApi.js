'use strict';

const crypto = require('node:crypto');
const {
  readBody,
  setHeader,
  setResponseStatus,
} = require('h3');

const ServerError = require('./ServerError');
const {
  AMNEZIA_API_ENABLED,
  AMNEZIA_API_KEY,
  AMNEZIA_API_AUTH,
  AMNEZIA_COMPAT_POST_PATH,
  AMNEZIA_COMPAT_STATUS_PATH,
} = require('../config');

function timingSafeEqualString(a, b) {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  const ba = Buffer.from(sa, 'utf8');
  const bb = Buffer.from(sb, 'utf8');
  if (ba.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function compatRespond(event, status, data, message) {
  setResponseStatus(event, status);
  setHeader(event, 'Content-Type', 'application/json');
  const out = {};
  if (data !== '' && data !== undefined && data !== null) {
    out.data = data;
  }
  if (message) {
    out.message = message;
  }
  return out;
}

function getCompatApiStatus() {
  return {
    enabled: AMNEZIA_API_ENABLED,
    auth: AMNEZIA_API_AUTH,
    endpoint: AMNEZIA_COMPAT_POST_PATH,
    statusPath: AMNEZIA_COMPAT_STATUS_PATH,
  };
}

function assertCompatApiPostAllowed(headers) {
  if (!AMNEZIA_API_ENABLED) {
    return { ok: false, status: 403, message: 'API is disabled' };
  }
  const authMethod = (AMNEZIA_API_AUTH || 'apikey').toLowerCase();
  if (authMethod === 'none') {
    return { ok: true };
  }
  if (authMethod !== 'apikey') {
    return { ok: false, status: 400, message: 'Invalid authentication method' };
  }
  const provided = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
  if (!String(provided).trim()) {
    return { ok: false, status: 401, message: 'Unauthorized: API Key is required' };
  }
  const configured = String(AMNEZIA_API_KEY || '').trim();
  if (!configured) {
    return { ok: false, status: 401, message: 'Unauthorized: API key is not configured on server' };
  }
  if (!timingSafeEqualString(String(provided).trim(), configured)) {
    return { ok: false, status: 401, message: 'Unauthorized: Invalid API Key' };
  }
  return { ok: true };
}

async function processAmneziaCompatRequest(event, WireGuard) {
  const auth = assertCompatApiPostAllowed(event.node.req.headers);
  if (!auth.ok) {
    return compatRespond(event, auth.status, '', auth.message);
  }

  let body;
  try {
    body = await readBody(event);
  } catch {
    return compatRespond(event, 400, '', 'Invalid or missing JSON input');
  }

  if (body == null || typeof body !== 'object') {
    return compatRespond(event, 400, '', 'Invalid or missing JSON input');
  }

  const { act } = body;
  if (!act || typeof act !== 'string') {
    return compatRespond(event, 400, '', 'Invalid or missing action parameter');
  }

  try {
    switch (act) {
      case 'get_peers': {
        const data = await WireGuard.getPeersCompat();
        return compatRespond(event, 200, data, data.length ? '' : 'No peers have been configured.');
      }
      case 'get_tunnels': {
        const data = await WireGuard.getTunnelSummaries();
        return compatRespond(event, 200, data, data.length ? '' : 'No tunnels have been configured.');
      }
      case 'get_connected_peers': {
        const data = await WireGuard.getConnectedPeersCompat();
        const empty = data.every((t) => !t.peers || t.peers.length === 0);
        return compatRespond(event, 200, data, empty ? 'No active tunnels or connected peers found.' : '');
      }
      case 'sync_peers': {
        const peers = body.peers ?? [];
        const tunnel = body.tunnel ?? 'all';
        if (!Array.isArray(peers)) {
          return compatRespond(event, 400, '', 'Peers must be an array');
        }
        const data = await WireGuard.syncPeersFromPublicKeys(peers, tunnel);
        return compatRespond(event, 200, data, 'Peers synced successfully');
      }
      case 'sync_peers_all': {
        const peers = body.peers ?? [];
        if (!Array.isArray(peers)) {
          return compatRespond(event, 400, '', 'Invalid or missing peers data');
        }
        const data = await WireGuard.syncPeersFromPublicKeys(peers, 'all');
        return compatRespond(event, 200, data, 'Peers synced successfully to all tunnels');
      }
      case 'sync_tunnels': {
        const tunnels = body.tunnels ?? [];
        const data = await WireGuard.syncServerTunnels(tunnels);
        return compatRespond(event, 200, data, 'Tunnels synced successfully');
      }
      case 'add_tunnel': {
        const tunnelData = body.tunnel ?? {};
        const overwrite = !!body.overwrite;
        if (!tunnelData || typeof tunnelData !== 'object' || !tunnelData.name) {
          return compatRespond(event, 400, '', 'Invalid or missing tunnel data');
        }
        const data = await WireGuard.mergeServerTunnelFromAdd(tunnelData, overwrite);
        const row = Array.isArray(data)
          ? (data.find((x) => x && x.name === tunnelData.name) || data[0])
          : data;
        return compatRespond(event, 200, row, 'Tunnel added successfully');
      }
      case 'reset_tunnel': {
        const tunnelName = body.tunnel ?? '';
        if (!tunnelName || typeof tunnelName !== 'string') {
          return compatRespond(event, 400, '', 'Invalid tunnel parameter: tunnel name is required and must be a string');
        }
        const data = await WireGuard.resetTunnelObfuscation(tunnelName);
        return compatRespond(event, 200, data, 'Tunnel configuration reset with new Amnezia parameters');
      }
      default:
        return compatRespond(event, 400, '', `Invalid action specified: ${act}`);
    }
  } catch (err) {
    const status = err instanceof ServerError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : String(err);
    return compatRespond(event, status, '', message);
  }
}

module.exports = {
  getCompatApiStatus,
  assertCompatApiPostAllowed,
  processAmneziaCompatRequest,
  compatRespond,
};
