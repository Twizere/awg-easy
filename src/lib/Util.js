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
