/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

'use strict';

class API {

  constructor() {
    this.tunnel = 'wg0';
  }

  wgBase() {
    return `/wireguard/${this.tunnel}`;
  }

  async call({ method, path, body }) {
    const res = await fetch(`./api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body
        ? JSON.stringify(body)
        : undefined,
    });

    if (res.status === 204) {
      return undefined;
    }

    const json = await res.json();

    if (!res.ok) {
      throw new Error(json.error || res.statusText);
    }

    return json;
  }

  async getRelease() {
    return this.call({
      method: 'get',
      path: '/release',
    });
  }

  async getLang() {
    return this.call({
      method: 'get',
      path: '/lang',
    });
  }

  async getRememberMeEnabled() {
    return this.call({
      method: 'get',
      path: '/remember-me',
    });
  }

  async getuiTrafficStats() {
    return this.call({
      method: 'get',
      path: '/ui-traffic-stats',
    });
  }

  async getChartType() {
    return this.call({
      method: 'get',
      path: '/ui-chart-type',
    });
  }

  async getWGEnableOneTimeLinks() {
    return this.call({
      method: 'get',
      path: '/wg-enable-one-time-links',
    });
  }

  async getWGEnableExpireTime() {
    return this.call({
      method: 'get',
      path: '/wg-enable-expire-time',
    });
  }

  async getAvatarSettings() {
    return this.call({
      method: 'get',
      path: '/ui-avatar-settings',
    });
  }

  async getSession() {
    return this.call({
      method: 'get',
      path: '/session',
    });
  }

  async createSession({ password, remember }) {
    return this.call({
      method: 'post',
      path: '/session',
      body: { password, remember },
    });
  }

  async deleteSession() {
    return this.call({
      method: 'delete',
      path: '/session',
    });
  }

  async getServerSettings() {
    return this.call({
      method: 'get',
      path: '/server-settings',
    });
  }

  async putServerSettings(body) {
    return this.call({
      method: 'put',
      path: '/server-settings',
      body,
    });
  }

  async listTunnels() {
    return this.call({
      method: 'get',
      path: '/wireguard/tunnel',
    });
  }

  async syncTunnels(tunnels) {
    return this.call({
      method: 'post',
      path: '/wireguard/tunnels/sync',
      body: { tunnels },
    });
  }

  async addTunnel(tunnel, overwrite = false) {
    return this.call({
      method: 'post',
      path: '/wireguard/tunnels/add',
      body: { tunnel, overwrite },
    });
  }

  async resetTunnelObfuscation(tunnelName) {
    return this.call({
      method: 'post',
      path: '/wireguard/tunnels/reset',
      body: { tunnel: tunnelName },
    });
  }

  async deleteTunnel(tunnelName) {
    return this.call({
      method: 'delete',
      path: `/wireguard/tunnels/${encodeURIComponent(tunnelName)}`,
    });
  }

  async putTunnelEnabled(tunnelName, enabled) {
    return this.call({
      method: 'put',
      path: `/wireguard/tunnels/${encodeURIComponent(tunnelName)}/enabled`,
      body: { enabled: !!enabled },
    });
  }

  async getClients() {
    return this.call({
      method: 'get',
      path: `${this.wgBase()}/client`,
    }).then((clients) => clients.map((client) => ({
      ...client,
      createdAt: new Date(client.createdAt),
      updatedAt: new Date(client.updatedAt),
      expiredAt: client.expiredAt !== null
        ? new Date(client.expiredAt)
        : null,
      latestHandshakeAt: client.latestHandshakeAt !== null
        ? new Date(client.latestHandshakeAt)
        : null,
    })));
  }

  async createClient({ name, expiredDate }) {
    return this.call({
      method: 'post',
      path: `${this.wgBase()}/client`,
      body: { name, expiredDate },
    });
  }

  async deleteClient({ clientId }) {
    return this.call({
      method: 'delete',
      path: `${this.wgBase()}/client/${clientId}`,
    });
  }

  async showOneTimeLink({ clientId }) {
    return this.call({
      method: 'post',
      path: `${this.wgBase()}/client/${clientId}/generateOneTimeLink`,
    });
  }

  async enableClient({ clientId }) {
    return this.call({
      method: 'post',
      path: `${this.wgBase()}/client/${clientId}/enable`,
    });
  }

  async disableClient({ clientId }) {
    return this.call({
      method: 'post',
      path: `${this.wgBase()}/client/${clientId}/disable`,
    });
  }

  async updateClientName({ clientId, name }) {
    return this.call({
      method: 'put',
      path: `${this.wgBase()}/client/${clientId}/name/`,
      body: { name },
    });
  }

  async updateClientAddress({ clientId, address }) {
    return this.call({
      method: 'put',
      path: `${this.wgBase()}/client/${clientId}/address/`,
      body: { address },
    });
  }

  async updateClientExpireDate({ clientId, expireDate }) {
    return this.call({
      method: 'put',
      path: `${this.wgBase()}/client/${clientId}/expireDate/`,
      body: { expireDate },
    });
  }

  async restoreConfiguration(file, tunnel) {
    return this.call({
      method: 'put',
      path: '/wireguard/restore',
      body: { file, tunnel: tunnel || this.tunnel },
    });
  }

  async getUiSortClients() {
    return this.call({
      method: 'get',
      path: '/ui-sort-clients',
    });
  }

  async getCompatApiStatus() {
    return this.call({
      method: 'get',
      path: '/compat/status',
    });
  }

}
