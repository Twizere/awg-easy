'use strict';

const fs = require('node:fs/promises');
const path = require('path');
const net = require('node:net');
const debug = require('debug')('WireGuard');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const CRC32 = require('crc-32');

const Util = require('./Util');
const ServerError = require('./ServerError');

const {
  WG_PATH,
  WG_HOST,
  WG_PORT,
  WG_MTU,
  WG_DEFAULT_DNS,
  WG_DEFAULT_ADDRESS,
  WG_PERSISTENT_KEEPALIVE,
  WG_ALLOWED_IPS,
  WG_PRE_UP,
  WG_POST_UP,
  WG_PRE_DOWN,
  WG_POST_DOWN,
  WG_ENABLE_EXPIRES_TIME,
  WG_ENABLE_ONE_TIME_LINKS,
  JC,
  JMIN,
  JMAX,
  S1,
  S2,
  H1,
  H2,
  H3,
  H4,
  WG_TUNNEL_DEFAULT_LISTEN_PORT,
} = require('../config');

module.exports = class WireGuardTunnel {

  constructor(tunnelName, options = {}) {
    if (!Util.isValidTunnelInterfaceName(tunnelName)) {
      throw new Error(`Invalid tunnel/interface name: ${tunnelName}`);
    }
    this.ifName = tunnelName;
    /** @type {{ address?: string, listenPort?: number } | null} */
    this.__newTunnelDefaults = options.newTunnelDefaults || null;
  }

  __addressPoolPattern(config) {
    const a = config.server.address;
    if (!a || !Util.isValidIPv4(a)) return WG_DEFAULT_ADDRESS;
    const oct = a.split('.');
    return `${oct[0]}.${oct[1]}.${oct[2]}.x`;
  }

  async __buildConfig() {
    this.__configPromise = Promise.resolve().then(async () => {
      if (!WG_HOST) {
        throw new Error('WG_HOST Environment Variable Not Set!');
      }

      debug('Loading configuration...');
      let config;
      try {
        config = await fs.readFile(path.join(WG_PATH, `${this.ifName}.json`), 'utf8');
        config = JSON.parse(config);
        debug('Configuration loaded.');
      } catch (err) {
        const privateKey = await Util.exec('wg genkey');
        const publicKey = await Util.exec(`echo ${privateKey} | wg pubkey`, {
          log: 'echo ***hidden*** | wg pubkey',
        });
        const address = (this.__newTunnelDefaults && this.__newTunnelDefaults.address)
          ? this.__newTunnelDefaults.address
          : WG_DEFAULT_ADDRESS.replace('x', '1');
        const server = {
          privateKey,
          publicKey,
          address,
          jc: JC,
          jmin: JMIN,
          jmax: JMAX,
          s1: S1,
          s2: S2,
          h1: H1,
          h2: H2,
          h3: H3,
          h4: H4,
        };
        if (this.__newTunnelDefaults && this.__newTunnelDefaults.listenPort != null) {
          server.listenPort = Number(this.__newTunnelDefaults.listenPort);
        }
        config = {
          server,
          clients: {},
        };
        debug('Configuration generated.');
      }

      return config;
    });

    return this.__configPromise;
  }

  async getConfig() {
    if (!this.__configPromise) {
      const config = await this.__buildConfig();

      await this.__saveConfig(config);
      await Util.exec(`wg-quick down ${this.ifName}`).catch(() => {});
      await Util.exec(`wg-quick up ${this.ifName}`).catch((err) => {
        if (err && err.message && err.message.includes(`Cannot find device "${this.ifName}"`)) {
          throw new Error(`WireGuard exited with the error: Cannot find device "${this.ifName}"\nThis usually means that your host's kernel does not support WireGuard!`);
        }

        throw err;
      });
      // await Util.exec(`iptables -t nat -A POSTROUTING -s ${WG_DEFAULT_ADDRESS.replace('x', '0')}/24 -o ' + WG_DEVICE + ' -j MASQUERADE`);
      // await Util.exec('iptables -A INPUT -p udp -m udp --dport 51820 -j ACCEPT');
      // await Util.exec('iptables -A FORWARD -i wg0 -j ACCEPT');
      // await Util.exec('iptables -A FORWARD -o wg0 -j ACCEPT');
      await this.__syncConfig();
    }

    return this.__configPromise;
  }

  async saveConfig() {
    const config = await this.getConfig();
    await this.__saveConfig(config);
    await this.__syncConfig();
  }

  __effectiveListenPort(config) {
    if (config.server.listenPort != null && String(config.server.listenPort).trim() !== '') {
      return String(config.server.listenPort);
    }
    const mapped = WG_TUNNEL_DEFAULT_LISTEN_PORT[this.ifName];
    if (mapped != null && String(mapped).trim() !== '') return String(mapped);
    return String(WG_PORT);
  }

  __serverSubnetSlash24(config) {
    const a = String(config.server.address || '');
    const oct = a.split('.');
    if (oct.length !== 4 || !Util.isValidIPv4(a)) {
      return `${WG_DEFAULT_ADDRESS.replace('x', '0')}/24`;
    }
    return `${oct[0]}.${oct[1]}.${oct[2]}.0/24`;
  }

  __expandWireguardScriptTemplates(str, listenPort, serverSubnetCidr) {
    return String(str || '')
      .replace(/\{INTERFACE\}/g, this.ifName)
      .replace(/\{LISTEN_PORT\}/g, listenPort)
      .replace(/\{SERVER_SUBNET\}/g, serverSubnetCidr);
  }

  __peerAllowedIPsLine(client) {
    if (client.allowedIPs && String(client.allowedIPs).trim()) {
      return String(client.allowedIPs).trim();
    }
    return `${client.address}/32`;
  }

  async __saveConfig(config) {
    Util.assertSaneWireGuardServerLanIPv4(config.server.address);
    const listenPort = this.__effectiveListenPort(config);
    const serverSubnet = this.__serverSubnetSlash24(config);
    const tpl = (s) => this.__expandWireguardScriptTemplates(s, listenPort, serverSubnet);
    let result = `
# Note: Do not edit this file directly.
# Your changes will be overwritten!

# Server
[Interface]
PrivateKey = ${config.server.privateKey}
Address = ${config.server.address}/24
ListenPort = ${listenPort}
PreUp = ${tpl(WG_PRE_UP)}
PostUp = ${tpl(WG_POST_UP)}
PreDown = ${tpl(WG_PRE_DOWN)}
PostDown = ${tpl(WG_POST_DOWN)}
Jc = ${config.server.jc}
Jmin = ${config.server.jmin}
Jmax = ${config.server.jmax}
S1 = ${config.server.s1}
S2 = ${config.server.s2}
H1 = ${config.server.h1}
H2 = ${config.server.h2}
H3 = ${config.server.h3}
H4 = ${config.server.h4}
`;

    for (const [clientId, client] of Object.entries(config.clients)) {
      if (!client.enabled) continue;

      result += `

# Client: ${client.name} (${clientId})
[Peer]
PublicKey = ${client.publicKey}
${client.preSharedKey ? `PresharedKey = ${client.preSharedKey}\n` : ''
}AllowedIPs = ${this.__peerAllowedIPsLine(client)}`;
    }

    debug('Config saving...');
    await fs.writeFile(path.join(WG_PATH, `${this.ifName}.json`), JSON.stringify(config, false, 2), {
      mode: 0o660,
    });
    await fs.writeFile(path.join(WG_PATH, `${this.ifName}.conf`), result, {
      mode: 0o600,
    });
    debug('Config saved.');
  }

  async __syncConfig() {
    debug('Config syncing...');
    await Util.exec(`wg syncconf ${this.ifName} <(wg-quick strip ${this.ifName})`);
    debug('Config synced.');
  }

  async getClients() {
    const config = await this.getConfig();
    const clients = Object.entries(config.clients).map(([clientId, client]) => ({
      id: clientId,
      name: client.name,
      enabled: client.enabled,
      address: client.address,
      publicKey: client.publicKey,
      createdAt: new Date(client.createdAt),
      updatedAt: new Date(client.updatedAt),
      expiredAt: client.expiredAt !== null
        ? new Date(client.expiredAt)
        : null,
      allowedIPs: client.allowedIPs,
      oneTimeLink: client.oneTimeLink ?? null,
      oneTimeLinkExpiresAt: client.oneTimeLinkExpiresAt ?? null,
      downloadableConfig: !!(client.privateKey),
      persistentKeepalive: null,
      latestHandshakeAt: null,
      transferRx: null,
      transferTx: null,
      endpoint: null,
    }));

    // Loop WireGuard status
    const dump = await Util.exec(`wg show ${this.ifName} dump`, {
      log: false,
    });
    dump
      .trim()
      .split('\n')
      .slice(1)
      .forEach((line) => {
        const [
          publicKey,
          preSharedKey, // eslint-disable-line no-unused-vars
          endpoint, // eslint-disable-line no-unused-vars
          allowedIps, // eslint-disable-line no-unused-vars
          latestHandshakeAt,
          transferRx,
          transferTx,
          persistentKeepalive,
        ] = line.split('\t');

        const client = clients.find((client) => client.publicKey === publicKey);
        if (!client) return;

        client.latestHandshakeAt = latestHandshakeAt === '0'
          ? null
          : new Date(Number(`${latestHandshakeAt}000`));
        client.endpoint = endpoint === '(none)' ? null : endpoint;
        client.transferRx = Number(transferRx);
        client.transferTx = Number(transferTx);
        client.persistentKeepalive = persistentKeepalive;
      });

    return clients;
  }

  async getClient({ clientId }) {
    const config = await this.getConfig();
    const client = config.clients[clientId];
    if (!client) {
      throw new ServerError(`Client Not Found: ${clientId}`, 404);
    }

    return client;
  }

  async getClientConfiguration({ clientId }) {
    const config = await this.getConfig();
    const client = await this.getClient({ clientId });

    return `
[Interface]
PrivateKey = ${client.privateKey ? `${client.privateKey}` : 'REPLACE_ME'}
Address = ${client.address}/24
${WG_DEFAULT_DNS ? `DNS = ${WG_DEFAULT_DNS}\n` : ''}\
${WG_MTU ? `MTU = ${WG_MTU}\n` : ''}\
Jc = ${config.server.jc}
Jmin = ${config.server.jmin}
Jmax = ${config.server.jmax}
S1 = ${config.server.s1}
S2 = ${config.server.s2}
H1 = ${config.server.h1}
H2 = ${config.server.h2}
H3 = ${config.server.h3}
H4 = ${config.server.h4}

[Peer]
PublicKey = ${config.server.publicKey}
${client.preSharedKey ? `PresharedKey = ${client.preSharedKey}\n` : ''
}AllowedIPs = ${WG_ALLOWED_IPS}
PersistentKeepalive = ${WG_PERSISTENT_KEEPALIVE}
Endpoint = ${WG_HOST}:${this.__effectiveListenPort(config)}`;
  }

  async getClientQRCodeSVG({ clientId }) {
    const config = await this.getClientConfiguration({ clientId });
    return QRCode.toString(config, {
      type: 'svg',
      width: 512,
    });
  }

  async createClient({ name, expiredDate }) {
    if (!name) {
      throw new Error('Missing: Name');
    }

    const config = await this.getConfig();

    const privateKey = await Util.exec('wg genkey');
    const publicKey = await Util.exec(`echo ${privateKey} | wg pubkey`, {
      log: 'echo ***hidden*** | wg pubkey',
    });
    const preSharedKey = await Util.exec('wg genpsk');

    // Calculate next IP
    let address;
    const pool = this.__addressPoolPattern(config);
    for (let i = 2; i < 255; i++) {
      const client = Object.values(config.clients).find((client) => {
        return client.address === pool.replace('x', i);
      });

      if (!client) {
        address = pool.replace('x', i);
        break;
      }
    }

    if (!address) {
      throw new Error('Maximum number of clients reached.');
    }
    // Create Client
    const id = crypto.randomUUID();
    const client = {
      id,
      name,
      address,
      privateKey,
      publicKey,
      preSharedKey,

      createdAt: new Date(),
      updatedAt: new Date(),
      expiredAt: null,
      enabled: true,
    };
    if (expiredDate) {
      client.expiredAt = new Date(expiredDate);
      client.expiredAt.setHours(23);
      client.expiredAt.setMinutes(59);
      client.expiredAt.setSeconds(59);
    }
    config.clients[id] = client;

    await this.saveConfig();

    return client;
  }

  async deleteClient({ clientId }) {
    const config = await this.getConfig();

    if (config.clients[clientId]) {
      delete config.clients[clientId];
      await this.saveConfig();
    }
  }

  async enableClient({ clientId }) {
    const client = await this.getClient({ clientId });

    client.enabled = true;
    client.updatedAt = new Date();

    await this.saveConfig();
  }

  async generateOneTimeLink({ clientId }) {
    const client = await this.getClient({ clientId });
    const key = `${clientId}-${Math.floor(Math.random() * 1000)}`;
    client.oneTimeLink = Math.abs(CRC32.str(key)).toString(16);
    client.oneTimeLinkExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    client.updatedAt = new Date();
    await this.saveConfig();
  }

  async eraseOneTimeLink({ clientId }) {
    const client = await this.getClient({ clientId });
    // client.oneTimeLink = null;
    client.oneTimeLinkExpiresAt = new Date(Date.now() + 10 * 1000);
    client.updatedAt = new Date();
    await this.saveConfig();
  }

  async disableClient({ clientId }) {
    const client = await this.getClient({ clientId });

    client.enabled = false;
    client.updatedAt = new Date();

    await this.saveConfig();
  }

  async updateClientName({ clientId, name }) {
    const client = await this.getClient({ clientId });

    client.name = name;
    client.updatedAt = new Date();

    await this.saveConfig();
  }

  async updateClientAddress({ clientId, address }) {
    const client = await this.getClient({ clientId });

    if (!Util.isValidIPv4(address)) {
      throw new ServerError(`Invalid Address: ${address}`, 400);
    }

    client.address = address;
    client.updatedAt = new Date();

    await this.saveConfig();
  }

  async updateClientExpireDate({ clientId, expireDate }) {
    const client = await this.getClient({ clientId });

    if (expireDate) {
      client.expiredAt = new Date(expireDate);
      client.expiredAt.setHours(23);
      client.expiredAt.setMinutes(59);
      client.expiredAt.setSeconds(59);
    } else {
      client.expiredAt = null;
    }
    client.updatedAt = new Date();

    await this.saveConfig();
  }

  async __reloadConfig() {
    await this.__buildConfig();
    await this.__syncConfig();
  }

  async restoreConfiguration(config) {
    debug('Starting configuration restore process.');
    const _config = JSON.parse(config);
    if (_config.server && _config.server.listenPort != null && String(_config.server.listenPort).trim() !== '') {
      Util.assertListenPortInPublishedUdpRange(_config.server.listenPort);
    }
    await this.__saveConfig(_config);
    await this.__reloadConfig();
    debug('Configuration restore process completed.');
  }

  async backupConfiguration() {
    debug('Starting configuration backup.');
    const config = await this.getConfig();
    const backup = JSON.stringify(config, null, 2);
    debug('Configuration backup completed.');
    return backup;
  }

  // Shutdown wireguard
  async Shutdown() {
    await Util.exec(`wg-quick down ${this.ifName}`).catch(() => {});
  }

  async cronJobEveryMinute() {
    const config = await this.getConfig();
    let needSaveConfig = false;
    // Expires Feature
    if (WG_ENABLE_EXPIRES_TIME === 'true') {
      for (const client of Object.values(config.clients)) {
        if (client.enabled !== true) continue;
        if (client.expiredAt !== null && new Date() > new Date(client.expiredAt)) {
          debug(`Client ${client.id} expired.`);
          needSaveConfig = true;
          client.enabled = false;
          client.updatedAt = new Date();
        }
      }
    }
    // One Time Link Feature
    if (WG_ENABLE_ONE_TIME_LINKS === 'true') {
      for (const client of Object.values(config.clients)) {
        if (client.oneTimeLink !== null && new Date() > new Date(client.oneTimeLinkExpiresAt)) {
          debug(`Client ${client.id} One Time Link expired.`);
          needSaveConfig = true;
          client.oneTimeLink = null;
          client.oneTimeLinkExpiresAt = null;
          client.updatedAt = new Date();
        }
      }
    }
    if (needSaveConfig) {
      await this.saveConfig();
    }
  }

  async getMetrics() {
    const clients = await this.getClients();
    let wireguardPeerCount = 0;
    let wireguardEnabledPeersCount = 0;
    let wireguardConnectedPeersCount = 0;
    let wireguardSentBytes = '';
    let wireguardReceivedBytes = '';
    let wireguardLatestHandshakeSeconds = '';
    for (const client of Object.values(clients)) {
      wireguardPeerCount++;
      if (client.enabled === true) {
        wireguardEnabledPeersCount++;
      }
      if (client.endpoint !== null) {
        wireguardConnectedPeersCount++;
      }
      wireguardSentBytes += `wireguard_sent_bytes{interface="${this.ifName}",enabled="${client.enabled}",address="${client.address}",name="${client.name}"} ${Number(client.transferTx)}\n`;
      wireguardReceivedBytes += `wireguard_received_bytes{interface="${this.ifName}",enabled="${client.enabled}",address="${client.address}",name="${client.name}"} ${Number(client.transferRx)}\n`;
      wireguardLatestHandshakeSeconds += `wireguard_latest_handshake_seconds{interface="${this.ifName}",enabled="${client.enabled}",address="${client.address}",name="${client.name}"} ${client.latestHandshakeAt ? (new Date().getTime() - new Date(client.latestHandshakeAt).getTime()) / 1000 : 0}\n`;
    }

    let returnText = '# HELP wg-easy and wireguard metrics\n';

    returnText += '\n# HELP wireguard_configured_peers\n';
    returnText += '# TYPE wireguard_configured_peers gauge\n';
    returnText += `wireguard_configured_peers{interface="${this.ifName}"} ${Number(wireguardPeerCount)}\n`;

    returnText += '\n# HELP wireguard_enabled_peers\n';
    returnText += '# TYPE wireguard_enabled_peers gauge\n';
    returnText += `wireguard_enabled_peers{interface="${this.ifName}"} ${Number(wireguardEnabledPeersCount)}\n`;

    returnText += '\n# HELP wireguard_connected_peers\n';
    returnText += '# TYPE wireguard_connected_peers gauge\n';
    returnText += `wireguard_connected_peers{interface="${this.ifName}"} ${Number(wireguardConnectedPeersCount)}\n`;

    returnText += '\n# HELP wireguard_sent_bytes Bytes sent to the peer\n';
    returnText += '# TYPE wireguard_sent_bytes counter\n';
    returnText += `${wireguardSentBytes}`;

    returnText += '\n# HELP wireguard_received_bytes Bytes received from the peer\n';
    returnText += '# TYPE wireguard_received_bytes counter\n';
    returnText += `${wireguardReceivedBytes}`;

    returnText += '\n# HELP wireguard_latest_handshake_seconds UNIX timestamp seconds of the last handshake\n';
    returnText += '# TYPE wireguard_latest_handshake_seconds gauge\n';
    returnText += `${wireguardLatestHandshakeSeconds}`;

    return returnText;
  }

  async getMetricsJSON() {
    const clients = await this.getClients();
    let wireguardPeerCount = 0;
    let wireguardEnabledPeersCount = 0;
    let wireguardConnectedPeersCount = 0;
    for (const client of Object.values(clients)) {
      wireguardPeerCount++;
      if (client.enabled === true) {
        wireguardEnabledPeersCount++;
      }
      if (client.endpoint !== null) {
        wireguardConnectedPeersCount++;
      }
    }
    return {
      interface: this.ifName,
      wireguard_configured_peers: Number(wireguardPeerCount),
      wireguard_enabled_peers: Number(wireguardEnabledPeersCount),
      wireguard_connected_peers: Number(wireguardConnectedPeersCount),
    };
  }

  validateCidr(cidr) {
    if (typeof cidr !== 'string' || !cidr.includes('/')) return false;
    const slash = cidr.indexOf('/');
    const addr = cidr.slice(0, slash).trim();
    const mask = parseInt(cidr.slice(slash + 1).trim(), 10);
    if (!Number.isFinite(mask) || mask < 0) return false;
    if (net.isIPv4(addr)) return mask <= 32;
    if (net.isIPv6(addr)) return mask <= 128;
    return false;
  }

  validateWireGuardPublicKey(publicKey) {
    if (typeof publicKey !== 'string') return false;
    const k = publicKey.trim();
    return /^[A-Za-z0-9+/]{43}=$/.test(k);
  }

  __randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  __nextClientIPv4(config) {
    const pool = this.__addressPoolPattern(config);
    for (let i = 2; i < 255; i++) {
      const candidate = pool.replace('x', i);
      const taken = Object.values(config.clients).some((c) => c.address === candidate);
      if (!taken) return candidate;
    }
    return null;
  }

  __latestHandshakeHuman(latestHandshakeAt) {
    if (!latestHandshakeAt) return 'never';
    const ts = latestHandshakeAt instanceof Date ? latestHandshakeAt.getTime() : new Date(latestHandshakeAt).getTime();
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  }

  async getPeersCompat() {
    const config = await this.getConfig();
    const list = Object.entries(config.clients).map(([clientId, client]) => {
      const allowedIps = client.allowedIPs && String(client.allowedIPs).trim()
        ? String(client.allowedIPs).split(',').map((s) => s.trim()).filter(Boolean)
        : [`${client.address}/32`];
      return {
        id: clientId,
        description: client.name || '',
        public_key: client.publicKey,
        private_key: client.privateKey ? client.privateKey : '',
        tunnel: this.ifName,
        allowed_ips: allowedIps,
        endpoint: '',
        enabled: !!client.enabled,
      };
    });
    return list;
  }

  async getTunnelSummary() {
    const config = await this.getConfig();
    const s = config.server;
    const peerCount = Object.keys(config.clients).length;
    const dnsServers = typeof WG_DEFAULT_DNS === 'string' && WG_DEFAULT_DNS.trim()
      ? WG_DEFAULT_DNS.split(',').map((x) => x.trim()).filter(Boolean)
      : [];
    return {
      name: this.ifName,
      description: this.ifName,
      public_key: s.publicKey,
      address: [`${s.address}/24`],
      public_ip: WG_HOST,
      listen_port: this.__effectiveListenPort(config),
      dns: dnsServers,
      config: {
        jc: Number(s.jc),
        jmin: Number(s.jmin),
        jmax: Number(s.jmax),
        s1: Number(s.s1),
        s2: Number(s.s2),
        h1: Number(s.h1),
        h2: Number(s.h2),
        h3: Number(s.h3),
        h4: Number(s.h4),
      },
      peer_count: peerCount,
      enabled: true,
    };
  }

  async getConnectedPeersCompat() {
    const config = await this.getConfig();
    const dump = await Util.exec(`wg show ${this.ifName} dump`, {
      log: false,
    });
    const lines = dump.trim().split('\n').slice(1);
    const byPub = Object.fromEntries(
      Object.values(config.clients).map((c) => [c.publicKey, c]),
    );
    const peers = lines.map((line) => {
      const cols = line.split('\t');
      const publicKey = cols[0];
      const latestHandshakeAt = cols[4];
      const client = byPub[publicKey];
      const ts = latestHandshakeAt === '0'
        ? 0
        : Math.floor(Number(`${latestHandshakeAt}000`) / 1000);
      const date = latestHandshakeAt === '0'
        ? null
        : new Date(Number(`${latestHandshakeAt}000`));
      return {
        public_key: publicKey,
        description: client ? client.name : '',
        latest_handshake: ts,
        latest_handshake_human: this.__latestHandshakeHuman(date),
      };
    });
    return [{
      tunnel: this.ifName,
      peers,
      total_peers: peers.length,
    }];
  }

  __parseTunnelServerAddress(tunnel) {
    if (tunnel.address && Array.isArray(tunnel.address) && tunnel.address[0]) {
      const first = String(tunnel.address[0]).trim();
      const normalized = Util.normalizeNetworkCidrToWireGuardServerIPv4(first);
      if (normalized) return normalized;
    }
    if (tunnel.addresses && Array.isArray(tunnel.addresses) && tunnel.addresses[0]) {
      const row = tunnel.addresses[0];
      if (row && row.address) {
        if (row.mask != null && String(row.mask).trim() !== '') {
          const cidr = `${row.address}/${row.mask}`;
          const normalized = Util.normalizeNetworkCidrToWireGuardServerIPv4(cidr);
          if (normalized) return normalized;
        }
        if (Util.isValidIPv4(row.address)) return row.address;
      }
    }
    return null;
  }

  async applyCompatTunnelSpec(spec) {
    if (!spec || spec.name !== this.ifName) {
      throw new ServerError(`Tunnel spec name must match interface (${this.ifName})`, 400);
    }
    const config = await this.getConfig();
    const host = this.__parseTunnelServerAddress(spec);
    if (host) {
      Util.assertSaneWireGuardServerLanIPv4(host);
      config.server.address = host;
    }
    const cfg = spec.config || {};
    const num = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    if (Object.keys(cfg).length > 0 || spec.jc != null) {
      config.server.jc = num(cfg.jc ?? spec.jc, config.server.jc);
      config.server.jmin = num(cfg.jmin ?? spec.jmin, config.server.jmin);
      config.server.jmax = num(cfg.jmax ?? spec.jmax, config.server.jmax);
      config.server.s1 = num(cfg.s1 ?? spec.s1, config.server.s1);
      config.server.s2 = num(cfg.s2 ?? spec.s2, config.server.s2);
      config.server.h1 = num(cfg.h1 ?? spec.h1, config.server.h1);
      config.server.h2 = num(cfg.h2 ?? spec.h2, config.server.h2);
      config.server.h3 = num(cfg.h3 ?? spec.h3, config.server.h3);
      config.server.h4 = num(cfg.h4 ?? spec.h4, config.server.h4);
    }
    const lp = spec.listen_port ?? spec.listenport;
    if (lp != null && String(lp).trim() !== '') {
      const p = parseInt(String(lp), 10);
      if (p < 1 || p > 65535) {
        throw new ServerError('Invalid listen port', 400);
      }
      Util.assertListenPortInPublishedUdpRange(p);
      config.server.listenPort = p;
    }
    await this.saveConfig();
  }

  async mergeAddTunnelFormat(tunnelData) {
    if (!tunnelData || tunnelData.name !== this.ifName) {
      throw new ServerError(`Tunnel name must be ${this.ifName}`, 400);
    }
    const config = await this.getConfig();
    const host = this.__parseTunnelServerAddress({
      address: Array.isArray(tunnelData.addresses)
        ? tunnelData.addresses.map((row) => `${row.address}/${row.mask}`)
        : null,
      addresses: tunnelData.addresses,
    });
    if (host) {
      Util.assertSaneWireGuardServerLanIPv4(host);
      config.server.address = host;
    }
    if (tunnelData.listenport != null && String(tunnelData.listenport).trim() !== '') {
      const p = parseInt(String(tunnelData.listenport), 10);
      if (p < 1 || p > 65535) {
        throw new ServerError('Invalid listen port', 400);
      }
      Util.assertListenPortInPublishedUdpRange(p);
      config.server.listenPort = p;
    }
    if (tunnelData.enabled === false) {
      throw new ServerError(`Disabling tunnel ${this.ifName} is not supported`, 400);
    }
    await this.saveConfig();
  }

  async resetObfuscationAndReturnSummary() {
    const config = await this.getConfig();
    const jmin = this.__randInt(10, 300);
    config.server.jc = this.__randInt(3, 10);
    config.server.jmin = jmin;
    config.server.jmax = this.__randInt(jmin + 1, jmin + 570);
    config.server.s1 = this.__randInt(3, 127);
    config.server.s2 = this.__randInt(3, 127);
    const min = 0x10000011;
    const max = 0x7FFFFF00;
    config.server.h1 = this.__randInt(min, max);
    config.server.h2 = this.__randInt(min, max);
    config.server.h3 = this.__randInt(min, max);
    config.server.h4 = this.__randInt(min, max);
    await this.saveConfig();
    return this.getTunnelSummary();
  }

  async syncPeersFromPublicKeys(peers) {
    if (!Array.isArray(peers)) {
      throw new ServerError('Peers must be an array', 400);
    }
    const config = await this.getConfig();

    if (peers.length === 0) {
      config.clients = {};
      await this.saveConfig();
      return this.getPeersCompat();
    }

    for (const peer of peers) {
      if (!peer || typeof peer !== 'object') {
        throw new ServerError('Each peer must be an object', 400);
      }
      const pub = (peer.public_key || peer.publickey || '').trim();
      const description = peer.description || peer.descr || '';
      if (!pub || !description) {
        throw new ServerError('Invalid peer data: public_key and description are required', 400);
      }
      if (!this.validateWireGuardPublicKey(pub)) {
        throw new ServerError('Invalid public key format', 400);
      }
      const allowedList = peer.allowed_ips || peer.allowedips;
      if (allowedList != null) {
        if (!Array.isArray(allowedList)) {
          throw new ServerError('allowed_ips must be an array', 400);
        }
        for (const cidr of allowedList) {
          if (!this.validateCidr(cidr)) {
            throw new ServerError(`Invalid allowed IP format: ${cidr}`, 400);
          }
        }
      }
    }

    const incomingKeys = new Set(peers.map((p) => (p.public_key || p.publickey || '').trim()));
    for (const [id, client] of Object.entries(config.clients)) {
      if (!incomingKeys.has(client.publicKey)) {
        delete config.clients[id];
      }
    }

    for (const peer of peers) {
      const pub = (peer.public_key || peer.publickey || '').trim();
      const description = peer.description || peer.descr || '';
      const allowedList = peer.allowed_ips || peer.allowedips;
      const allowedIPs = Array.isArray(allowedList) && allowedList.length
        ? allowedList.join(', ')
        : '';
      const enabled = peer.enabled !== false;

      let existing = null;
      for (const c of Object.values(config.clients)) {
        if (c.publicKey === pub) {
          existing = c;
          break;
        }
      }

      if (existing) {
        existing.name = description;
        existing.enabled = enabled;
        existing.updatedAt = new Date();
        if (allowedIPs) existing.allowedIPs = allowedIPs;
        else delete existing.allowedIPs;
      } else {
        const address = this.__nextClientIPv4(config);
        if (!address) {
          throw new ServerError('Maximum number of clients reached.', 400);
        }
        const id = crypto.randomUUID();
        const row = {
          id,
          name: description,
          address,
          publicKey: pub,
          enabled,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiredAt: null,
        };
        if (allowedIPs) row.allowedIPs = allowedIPs;
        config.clients[id] = row;
      }
    }

    await this.saveConfig();
    return this.getPeersCompat();
  }

};
