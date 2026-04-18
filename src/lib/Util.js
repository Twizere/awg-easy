'use strict';

const childProcess = require('child_process');
const ServerError = require('./ServerError');
const {
  WG_PUBLISHED_UDP_PORT_MIN,
  WG_PUBLISHED_UDP_PORT_MAX,
} = require('../config');

module.exports = class Util {

  /** Linux interface name: max 15 chars, alphanumeric, underscore, hyphen. */
  static isValidTunnelInterfaceName(name) {
    return typeof name === 'string' && /^[a-zA-Z0-9_-]{1,15}$/.test(name);
  }

  /** Ensures listen port matches `WG_UDP_PORT_RANGE` / `WG_PORT` (must match Docker-published UDP ports). */
  static assertListenPortInPublishedUdpRange(port) {
    const p = typeof port === 'number' ? port : parseInt(String(port).trim(), 10);
    if (!Number.isFinite(p) || p < 1 || p > 65535) {
      throw new ServerError('Invalid listen port', 400);
    }
    if (p < WG_PUBLISHED_UDP_PORT_MIN || p > WG_PUBLISHED_UDP_PORT_MAX) {
      throw new ServerError(
        `Listen port ${p} is outside the published UDP range ${WG_PUBLISHED_UDP_PORT_MIN}-${WG_PUBLISHED_UDP_PORT_MAX} (set WG_UDP_PORT_RANGE in .env to match docker-compose and restart).`,
        400,
      );
    }
  }

  static isValidIPv4(str) {
    const blocks = str.split('.');
    if (blocks.length !== 4) return false;

    for (let value of blocks) {
      value = parseInt(value, 10);
      if (Number.isNaN(value)) return false;
      if (value < 0 || value > 255) return false;
    }

    return true;
  }

  /**
   * WireGuard server LAN address for /24 pools must not be .0 (network) or .255 (broadcast).
   * Using 172.16–172.31 inside Docker often clashes with `eth0`; prefer 10.x not used elsewhere.
   */
  static assertSaneWireGuardServerLanIPv4(address) {
    const a = String(address || '').trim();
    if (!Util.isValidIPv4(a)) {
      throw new ServerError(`Invalid server IPv4 address: ${address}`, 400);
    }
    const last = parseInt(a.split('.')[3], 10);
    if (last === 0 || last === 255) {
      throw new ServerError(
        `Invalid WireGuard server address ${a}: last octet cannot be .0 or .255. Use e.g. 10.66.0.1 for a /24 tunnel.`,
        400,
      );
    }
  }

  /**
   * API may send a network CIDR (e.g. `10.18.0.0/16`); WireGuard server LAN is stored as first host (`10.18.0.1`).
   * Plain IPv4 without `/` is returned as-is. `/32` returns that host.
   */
  static normalizeNetworkCidrToWireGuardServerIPv4(s) {
    const str = String(s || '').trim();
    if (!str) return null;
    if (!str.includes('/')) {
      return Util.isValidIPv4(str) ? str : null;
    }
    const slash = str.lastIndexOf('/');
    const ipStr = str.slice(0, slash).trim();
    const mask = parseInt(str.slice(slash + 1).trim(), 10);
    if (!Number.isFinite(mask) || mask < 0 || mask > 32) return null;
    const parts = ipStr.split('.');
    if (parts.length !== 4) return null;
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    const c = parseInt(parts[2], 10);
    const d = parseInt(parts[3], 10);
    if ([a, b, c, d].some((x) => !Number.isFinite(x) || x < 0 || x > 255)) return null;
    const ip = (a << 24) | (b << 16) | (c << 8) | d;
    if (mask === 32) {
      return `${a}.${b}.${c}.${d}`;
    }
    const hostBits = 32 - mask;
    const network = (ip >>> hostBits) << hostBits;
    const firstHost = (network + 1) >>> 0;
    if (firstHost > 0xffffffff) return null;
    return `${(firstHost >>> 24) & 255}.${(firstHost >>> 16) & 255}.${(firstHost >>> 8) & 255}.${firstHost & 255}`;
  }

  static promisify(fn) {
    // eslint-disable-next-line func-names
    return function(req, res) {
      Promise.resolve().then(async () => fn(req, res))
        .then((result) => {
          if (res.headersSent) return;

          if (typeof result === 'undefined') {
            return res
              .status(204)
              .end();
          }

          return res
            .status(200)
            .json(result);
        })
        .catch((error) => {
          if (typeof error === 'string') {
            error = new Error(error);
          }

          // eslint-disable-next-line no-console
          console.error(error);

          return res
            .status(error.statusCode || 500)
            .json({
              error: error.message || error.toString(),
              stack: error.stack,
            });
        });
    };
  }

  static async exec(cmd, {
    log = true,
  } = {}) {
    if (typeof log === 'string') {
      // eslint-disable-next-line no-console
      console.log(`$ ${log}`);
    } else if (log === true) {
      // eslint-disable-next-line no-console
      console.log(`$ ${cmd}`);
    }

    if (process.platform !== 'linux') {
      return '';
    }

    return new Promise((resolve, reject) => {
      childProcess.exec(cmd, {
        shell: 'bash',
      }, (err, stdout) => {
        if (err) return reject(err);
        return resolve(String(stdout).trim());
      });
    });
  }

};
