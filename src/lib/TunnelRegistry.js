'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const debug = require('debug')('TunnelRegistry');

const WireGuardTunnel = require('./WireGuardTunnel');
const Util = require('./Util');
const ServerError = require('./ServerError');
const {
  WG_PATH,
  WG_DEFAULT_ADDRESS,
  WG_TUNNEL_DEFAULT_LISTEN_PORT,
  WG_PUBLISHED_UDP_PORT_MIN,
  WG_PUBLISHED_UDP_PORT_MAX,
} = require('../config');

module.exports = class TunnelRegistry {

  constructor() {
    this.tunnels = new Map();
    this.orderedTunnelNames = [];
    this.__initPromise = null;
  }

  async __readTunnelNamesOnDisk() {
    let dirents;
    try {
      dirents = await fs.readdir(WG_PATH, { withFileTypes: true });
    } catch {
      return [];
    }
    const names = [];
    for (const d of dirents) {
      if (!d.isFile() || !d.name.endsWith('.json')) continue;
      const base = d.name.slice(0, -5);
      if (!Util.isValidTunnelInterfaceName(base)) continue;
      names.push(base);
    }
    return names;
  }

  __tunnelNamesFromEnv() {
    const raw = process.env.WG_TUNNELS || '';
    if (!raw.trim()) return [];
    const out = [];
    for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      const n = part.includes(':') ? part.split(':')[0].trim() : part;
      if (Util.isValidTunnelInterfaceName(n)) out.push(n);
    }
    return out;
  }

  sortTunnelNames(names) {
    const u = [...new Set(names)];
    return u.sort((a, b) => {
      if (a === 'wg0') return -1;
      if (b === 'wg0') return 1;
      return a.localeCompare(b);
    });
  }

  async refreshOrderedTunnelNames() {
    const onDisk = await this.__readTunnelNamesOnDisk();
    const fromEnv = this.__tunnelNamesFromEnv();
    let merged = [...new Set([...onDisk, ...fromEnv])];
    if (merged.length === 0) merged = ['wg0'];
    const sorted = this.sortTunnelNames(merged);
    const ok = [];
    /** @type {{ extraThirds: Set<number>, extraPorts: Set<number> }} */
    const sim = { extraThirds: new Set(), extraPorts: new Set() };
    for (const name of sorted) {
      try {
        await fs.access(path.join(WG_PATH, `${name}.json`));
        ok.push(name);
      } catch {
        try {
          const def = await this.__defaultsForNewTunnelFile(name, null, sim);
          sim.extraPorts.add(def.listenPort);
          const parts = String(def.address || '').split('.');
          if (parts.length === 4) {
            const t = parseInt(parts[2], 10);
            if (Number.isFinite(t)) sim.extraThirds.add(t);
          }
          ok.push(name);
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          debug(
            'Omitting tunnel %s from startup list (no JSON yet; cannot allocate defaults): %s',
            name,
            msg,
          );
        }
      }
    }
    if (ok.length === 0) {
      ok.push('wg0');
    }
    this.orderedTunnelNames = this.sortTunnelNames(ok);
    debug('Tunnels: %s', this.orderedTunnelNames.join(', '));
  }

  async __snapshotUsedAddressThirdOctetsAndPorts() {
    const names = await this.__readTunnelNamesOnDisk();
    const thirds = new Set();
    const ports = new Set();
    for (const n of names) {
      try {
        const raw = await fs.readFile(path.join(WG_PATH, `${n}.json`), 'utf8');
        const j = JSON.parse(raw);
        const addr = j.server && j.server.address;
        if (addr && typeof addr === 'string') {
          const p = addr.split('.');
          if (p.length === 4) {
            const t = parseInt(p[2], 10);
            if (Number.isFinite(t)) thirds.add(t);
          }
        }
        const lp = j.server && j.server.listenPort;
        if (lp != null && String(lp).trim() !== '') {
          const pn = parseInt(String(lp), 10);
          if (pn >= 1 && pn <= 65535) ports.add(pn);
        }
      } catch {
        /* ignore corrupt */
      }
    }
    for (const p of Object.values(WG_TUNNEL_DEFAULT_LISTEN_PORT)) {
      const pn = parseInt(String(p), 10);
      if (Number.isFinite(pn)) ports.add(pn);
    }
    // Do not pre-mark WG_PUBLISHED_UDP_PORT_MIN here (same reason as legacy WG_PORT pre-mark: would skip the first free port).
    return { thirds, ports };
  }

  /**
   * @param {string} ifName
   * @param {{ listenPort?: number } | null | undefined} hints When creating a tunnel from sync_tunnels/add_tunnel,
   *   use this listen port before falling back to env defaults (avoids defaulting to WG_PORT outside WG_UDP_PORT_RANGE).
   * @param {{ extraThirds?: Set<number>, extraPorts?: Set<number> } | null} simulationState When set (startup dry-run),
   *   merge these into snapshot so multiple planned tunnels reserve distinct ports/subnets.
   */
  async __defaultsForNewTunnelFile(ifName, hints, simulationState) {
    const { thirds, ports } = await this.__snapshotUsedAddressThirdOctetsAndPorts();
    const thirdsView = new Set(thirds);
    const portsView = new Set(ports);
    if (simulationState && simulationState.extraThirds) {
      for (const t of simulationState.extraThirds) thirdsView.add(t);
    }
    if (simulationState && simulationState.extraPorts) {
      for (const p of simulationState.extraPorts) portsView.add(p);
    }
    const oct = WG_DEFAULT_ADDRESS.split('.');
    if (oct.length !== 4) {
      let port = WG_PUBLISHED_UDP_PORT_MIN;
      if (hints && hints.listenPort != null) {
        const hp = parseInt(String(hints.listenPort), 10);
        if (Number.isFinite(hp)) port = hp;
      }
      const occupied = new Set(portsView);
      while (occupied.has(port)) {
        port += 1;
        if (port > WG_PUBLISHED_UDP_PORT_MAX) {
          throw new ServerError(
            `No free UDP port in published range ${WG_PUBLISHED_UDP_PORT_MIN}-${WG_PUBLISHED_UDP_PORT_MAX}. `
            + 'Each tunnel needs a distinct UDP port: widen WG_UDP_PORT_RANGE (and publish the same range in Docker '
            + '`-p …/udp`) or remove extra tunnel names from WG_TUNNELS.',
            400,
          );
        }
      }
      Util.assertListenPortInPublishedUdpRange(port);
      return { address: '10.8.0.1', listenPort: port };
    }
    let third = parseInt(oct[2], 10);
    if (!Number.isFinite(third)) third = 0;
    while (thirdsView.has(third)) third += 1;
    if (third > 254) third = 254;
    const address = `${oct[0]}.${oct[1]}.${third}.1`;

    let port = WG_PUBLISHED_UDP_PORT_MIN;
    const mapped = WG_TUNNEL_DEFAULT_LISTEN_PORT[ifName];
    if (mapped != null && String(mapped).trim() !== '') {
      port = parseInt(String(mapped), 10) || port;
    }
    if (hints && hints.listenPort != null) {
      const hp = parseInt(String(hints.listenPort), 10);
      if (Number.isFinite(hp)) port = hp;
    }
    const occupied = new Set(portsView);
    // Env-assigned port for this interface is ours, not a collision with another tunnel.
    if (mapped != null && String(mapped).trim() !== '') {
      const own = parseInt(String(mapped), 10);
      if (Number.isFinite(own)) occupied.delete(own);
    }
    while (true) {
      Util.assertListenPortInPublishedUdpRange(port);
      if (!occupied.has(port)) break;
      port += 1;
      if (port > WG_PUBLISHED_UDP_PORT_MAX) {
        throw new ServerError(
          `No free UDP port in published range ${WG_PUBLISHED_UDP_PORT_MIN}-${WG_PUBLISHED_UDP_PORT_MAX}. `
          + 'Each tunnel needs a distinct UDP port: widen WG_UDP_PORT_RANGE (and publish the same range in Docker '
          + '`-p …/udp`) or remove extra tunnel names from WG_TUNNELS.',
          400,
        );
      }
    }
    return { address, listenPort: port };
  }

  /**
   * @param {{ newTunnelHints?: { listenPort?: number }, provisionMissing?: boolean }} [options] Used when the tunnel JSON does not exist yet
   *   (e.g. sync_tunnels / add_tunnel include listen_port so defaults stay inside WG_UDP_PORT_RANGE).
   *   Set `provisionMissing: true` when the API intentionally creates a tunnel (session sync/add). Otherwise only
   *   tunnels listed after refresh (or existing JSON on disk) may be opened — avoids auto-creating interfaces for bad URLs
   *   (e.g. stale UI tunnel name) which exhausts the published UDP port range.
   */
  async getTunnel(ifName, options = {}) {
    if (!Util.isValidTunnelInterfaceName(ifName)) {
      throw new ServerError(`Invalid tunnel name: ${ifName}`, 400);
    }
    if (!this.orderedTunnelNames.length) {
      await this.refreshOrderedTunnelNames();
    }
    if (!this.tunnels.has(ifName)) {
      let defaults = null;
      try {
        await fs.access(path.join(WG_PATH, `${ifName}.json`));
      } catch {
        const mayProvision = options.provisionMissing === true
          || (Array.isArray(this.orderedTunnelNames) && this.orderedTunnelNames.includes(ifName));
        if (!mayProvision) {
          throw new ServerError(`Tunnel '${ifName}' not found`, 404);
        }
        defaults = await this.__defaultsForNewTunnelFile(ifName, options.newTunnelHints || null);
      }
      this.tunnels.set(ifName, new WireGuardTunnel(ifName, { newTunnelDefaults: defaults }));
    }
    return this.tunnels.get(ifName);
  }

  async ensureInitialized() {
    if (this.__initPromise) return this.__initPromise;
    this.__initPromise = (async () => {
      await this.refreshOrderedTunnelNames();
      for (const name of this.orderedTunnelNames) {
        await (await this.getTunnel(name)).getConfig();
      }
    })();
    return this.__initPromise;
  }

  async getConfig() {
    await this.ensureInitialized();
    return (await this.getTunnel('wg0')).getConfig();
  }

  async listTunnels() {
    return this.getTunnelSummaries();
  }

  /**
   * Re-apply kernel state for every tunnel after global VPN enable/disable (server settings).
   */
  async reconcileVpnStateFromSettings() {
    await this.ensureInitialized().catch(() => {});
    const names = [...this.orderedTunnelNames];
    for (const n of names) {
      (await this.getTunnel(n)).invalidateCache();
    }
    for (const n of names) {
      await (await this.getTunnel(n)).getConfig();
    }
  }

  /**
   * Persist per-tunnel `tunnelEnabled` and bring interface up or down.
   * @param {string} ifName
   * @param {boolean} enabled
   */
  async setTunnelEnabled(ifName, enabled) {
    if (!Util.isValidTunnelInterfaceName(ifName)) {
      throw new ServerError(`Invalid tunnel name: ${ifName}`, 400);
    }
    await this.ensureInitialized();
    if (!this.orderedTunnelNames.includes(ifName)) {
      throw new ServerError(`Tunnel '${ifName}' not found`, 404);
    }
    await (await this.getTunnel(ifName)).setTunnelEnabled(!!enabled);
    return (await this.getTunnel(ifName)).getTunnelSummary();
  }

  async deleteTunnel(ifName) {
    if (!Util.isValidTunnelInterfaceName(ifName)) {
      throw new ServerError(`Invalid tunnel name: ${ifName}`, 400);
    }
    await this.ensureInitialized();
    if (this.orderedTunnelNames.length <= 1) {
      throw new ServerError('Cannot delete the last remaining tunnel', 400);
    }
    if (!this.orderedTunnelNames.includes(ifName)) {
      throw new ServerError(`Tunnel '${ifName}' not found`, 404);
    }
    await (await this.getTunnel(ifName)).Shutdown();
    await fs.unlink(path.join(WG_PATH, `${ifName}.json`)).catch(() => {});
    await fs.unlink(path.join(WG_PATH, `${ifName}.conf`)).catch(() => {});
    this.__initPromise = null;
    this.tunnels.clear();
    await this.refreshOrderedTunnelNames();
    await this.ensureInitialized();
    return { success: true };
  }

  async getClients() {
    return (await this.getTunnel('wg0')).getClients();
  }

  async getClientsForTunnel(tunnelName) {
    return (await this.getTunnel(tunnelName)).getClients();
  }

  async getClient({ clientId, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).getClient({ clientId });
  }

  async getClientConfiguration({ clientId, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).getClientConfiguration({ clientId });
  }

  async getClientQRCodeSVG({ clientId, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).getClientQRCodeSVG({ clientId });
  }

  async createClient({ name, expiredDate, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).createClient({ name, expiredDate });
  }

  async deleteClient({ clientId, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).deleteClient({ clientId });
  }

  async enableClient({ clientId, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).enableClient({ clientId });
  }

  async generateOneTimeLink({ clientId, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).generateOneTimeLink({ clientId });
  }

  async eraseOneTimeLink({ clientId, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).eraseOneTimeLink({ clientId });
  }

  async disableClient({ clientId, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).disableClient({ clientId });
  }

  async updateClientName({ clientId, name, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).updateClientName({ clientId, name });
  }

  async updateClientAddress({ clientId, address, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).updateClientAddress({ clientId, address });
  }

  async updateClientExpireDate({ clientId, expireDate, tunnel = 'wg0' }) {
    return (await this.getTunnel(tunnel)).updateClientExpireDate({ clientId, expireDate });
  }

  async findClientByOneTimeLink(link) {
    await this.ensureInitialized();
    for (const n of this.orderedTunnelNames) {
      const clients = await (await this.getTunnel(n)).getClients();
      const client = clients.find((c) => c.oneTimeLink === link);
      if (client) return { tunnel: n, client, clientId: client.id };
    }
    return null;
  }

  async cronJobEveryMinute() {
    await this.ensureInitialized();
    await Promise.all(this.orderedTunnelNames.map(async (n) => (await this.getTunnel(n)).cronJobEveryMinute()));
  }

  async Shutdown() {
    await this.ensureInitialized().catch(() => {});
    await Promise.all(this.orderedTunnelNames.map(async (n) => (await this.getTunnel(n)).Shutdown()));
  }

  async getMetrics() {
    await this.ensureInitialized();
    let first = true;
    let out = '';
    for (const n of this.orderedTunnelNames) {
      const block = await (await this.getTunnel(n)).getMetrics();
      if (first) {
        out += block;
        first = false;
      } else {
        const lines = block.split('\n').filter((line) => line && !line.startsWith('#'));
        if (lines.length) out += `\n${lines.join('\n')}`;
      }
    }
    return out;
  }

  async getMetricsJSON() {
    await this.ensureInitialized();
    let wireguardPeerCount = 0;
    let wireguardEnabledPeersCount = 0;
    let wireguardConnectedPeersCount = 0;
    const byInterface = [];
    for (const n of this.orderedTunnelNames) {
      const j = await (await this.getTunnel(n)).getMetricsJSON();
      wireguardPeerCount += j.wireguard_configured_peers;
      wireguardEnabledPeersCount += j.wireguard_enabled_peers;
      wireguardConnectedPeersCount += j.wireguard_connected_peers;
      byInterface.push({ interface: n, ...j });
    }
    return {
      wireguard_configured_peers: wireguardPeerCount,
      wireguard_enabled_peers: wireguardEnabledPeersCount,
      wireguard_connected_peers: wireguardConnectedPeersCount,
      byInterface,
    };
  }

  async backupConfiguration(tunnel = 'wg0') {
    await this.ensureInitialized();
    if (tunnel === 'all') {
      const tunnels = {};
      for (const name of this.orderedTunnelNames) {
        tunnels[name] = await (await this.getTunnel(name)).getConfig();
      }
      return JSON.stringify({
        _format: 'amnezia-wg-easy-backup-all-v1',
        tunnels,
      }, null, 2);
    }
    return (await this.getTunnel(tunnel)).backupConfiguration();
  }

  async restoreConfiguration(fileContent, tunnel = 'wg0') {
    let parsed;
    try {
      parsed = JSON.parse(fileContent);
    } catch {
      throw new ServerError('Invalid configuration JSON', 400);
    }
    if (parsed && typeof parsed === 'object' && parsed.tunnels && typeof parsed.tunnels === 'object' && !parsed.server) {
      for (const [name, cfg] of Object.entries(parsed.tunnels)) {
        if (!Util.isValidTunnelInterfaceName(name)) continue;
        const json = typeof cfg === 'string' ? cfg : JSON.stringify(cfg);
        await (await this.getTunnel(name, { provisionMissing: true })).restoreConfiguration(json);
      }
      this.__initPromise = null;
      this.tunnels.clear();
      await this.ensureInitialized();
      return;
    }
    await (await this.getTunnel(tunnel, { provisionMissing: true })).restoreConfiguration(typeof fileContent === 'string' ? fileContent : JSON.stringify(parsed));
    this.__initPromise = null;
    this.tunnels.clear();
    await this.ensureInitialized();
  }

  async getPeersCompat() {
    await this.ensureInitialized();
    let out = [];
    for (const name of this.orderedTunnelNames) {
      out = out.concat(await (await this.getTunnel(name)).getPeersCompat());
    }
    return out;
  }

  async getTunnelSummaries() {
    await this.ensureInitialized();
    return Promise.all(this.orderedTunnelNames.map(async (n) => (await this.getTunnel(n)).getTunnelSummary()));
  }

  async getConnectedPeersCompat() {
    await this.ensureInitialized();
    let out = [];
    for (const name of this.orderedTunnelNames) {
      out = out.concat(await (await this.getTunnel(name)).getConnectedPeersCompat());
    }
    return out;
  }

  async syncServerTunnels(tunnels) {
    if (!Array.isArray(tunnels) || tunnels.length === 0) {
      throw new ServerError('Invalid or missing tunnels data', 400);
    }
    for (const spec of tunnels) {
      if (!spec || !spec.name || !Util.isValidTunnelInterfaceName(spec.name)) {
        throw new ServerError('Invalid tunnel spec: name is required', 400);
      }
      const lp = spec.listen_port ?? spec.listenport;
      const newTunnelHints = {};
      if (lp != null && String(lp).trim() !== '') {
        const p = parseInt(String(lp), 10);
        if (Number.isFinite(p)) newTunnelHints.listenPort = p;
      }
      await (await this.getTunnel(spec.name, { newTunnelHints, provisionMissing: true })).applyCompatTunnelSpec(spec);
    }
    this.__initPromise = null;
    this.tunnels.clear();
    await this.refreshOrderedTunnelNames();
    await this.ensureInitialized();
    return this.getTunnelSummaries();
  }

  async mergeServerTunnelFromAdd(tunnelData, overwrite) {
    if (!tunnelData || !tunnelData.name || !Util.isValidTunnelInterfaceName(tunnelData.name)) {
      throw new ServerError('Invalid or missing tunnel data', 400);
    }
    const { name } = tunnelData;
    let exists = false;
    try {
      await fs.access(path.join(WG_PATH, `${name}.json`));
      exists = true;
    } catch {
      exists = false;
    }
    if (exists && !overwrite) {
      throw new ServerError(`Tunnel ${name} already exists; pass overwrite=true to update, or use sync_tunnels.`, 400);
    }
    const newTunnelHints = {};
    if (tunnelData.listenport != null && String(tunnelData.listenport).trim() !== '') {
      const p = parseInt(String(tunnelData.listenport), 10);
      if (Number.isFinite(p)) newTunnelHints.listenPort = p;
    }
    await (await this.getTunnel(name, { newTunnelHints, provisionMissing: true })).mergeAddTunnelFormat(tunnelData);
    this.__initPromise = null;
    this.tunnels.clear();
    await this.refreshOrderedTunnelNames();
    await this.ensureInitialized();
    return this.getTunnelSummaries();
  }

  async resetTunnelObfuscation(tunnelName) {
    if (!Util.isValidTunnelInterfaceName(tunnelName)) {
      throw new ServerError(`Tunnel '${tunnelName}' not found`, 404);
    }
    await this.ensureInitialized();
    if (!this.orderedTunnelNames.includes(tunnelName)) {
      throw new ServerError(`Tunnel '${tunnelName}' not found`, 404);
    }
    return (await this.getTunnel(tunnelName)).resetObfuscationAndReturnSummary();
  }

  async syncPeersFromPublicKeys(peers, tunnel) {
    const t = tunnel == null || tunnel === '' ? 'all' : tunnel;
    if (t !== 'all' && !Util.isValidTunnelInterfaceName(t)) {
      throw new ServerError('Invalid tunnel name', 400);
    }
    await this.ensureInitialized();
    if (t !== 'all' && !this.orderedTunnelNames.includes(t)) {
      throw new ServerError(`Tunnel '${t}' not found`, 404);
    }
    if (t === 'all') {
      let allPeers = [];
      for (const name of this.orderedTunnelNames) {
        const part = await (await this.getTunnel(name)).syncPeersFromPublicKeys(peers);
        allPeers = allPeers.concat(part);
      }
      return allPeers;
    }
    return (await this.getTunnel(t)).syncPeersFromPublicKeys(peers);
  }

};
