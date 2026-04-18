/* eslint-disable no-console */
/* eslint-disable no-alert */
/* eslint-disable no-undef */
/* eslint-disable no-new */

'use strict';

function bytes(bytes, decimals, kib, maxunit) {
  kib = kib || false;
  if (bytes === 0) return '0 B';
  if (Number.isNaN(parseFloat(bytes)) && !Number.isFinite(bytes)) return 'NaN';
  const k = kib ? 1024 : 1000;
  const dm = decimals != null && !Number.isNaN(decimals) && decimals >= 0 ? decimals : 2;
  const sizes = kib
    ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB', 'BiB']
    : ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB', 'BB'];
  let i = Math.floor(Math.log(bytes) / Math.log(k));
  if (maxunit !== undefined) {
    const index = sizes.indexOf(maxunit);
    if (index !== -1) i = index;
  }
  // eslint-disable-next-line no-restricted-properties
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Sorts an array of objects by a specified property in ascending or descending order.
 *
 * @param {Array} array - The array of objects to be sorted.
 * @param {string} property - The property to sort the array by.
 * @param {boolean} [sort=true] - Whether to sort the array in ascending (default) or descending order.
 * @return {Array} - The sorted array of objects.
 */
function sortByProperty(array, property, sort = true) {
  if (sort) {
    return array.sort((a, b) => (typeof a[property] === 'string' ? a[property].localeCompare(b[property]) : a[property] - b[property]));
  }

  return array.sort((a, b) => (typeof a[property] === 'string' ? b[property].localeCompare(a[property]) : b[property] - a[property]));
}

const i18n = new VueI18n({
  locale: localStorage.getItem('lang') || 'en',
  fallbackLocale: 'en',
  messages,
});

const UI_CHART_TYPES = [
  { type: false, strokeWidth: 0 },
  { type: 'line', strokeWidth: 3 },
  { type: 'area', strokeWidth: 0 },
  { type: 'bar', strokeWidth: 0 },
];

const CHART_COLORS = {
  rx: { light: 'rgba(128,128,128,0.3)', dark: 'rgba(255,255,255,0.3)' },
  tx: { light: 'rgba(128,128,128,0.4)', dark: 'rgba(255,255,255,0.3)' },
  gradient: { light: ['rgba(0,0,0,1.0)', 'rgba(0,0,0,1.0)'], dark: ['rgba(128,128,128,0)', 'rgba(128,128,128,0)'] },
};

new Vue({
  el: '#app',
  components: {
    apexchart: VueApexCharts,
  },
  i18n,
  data: {
    authenticated: null,
    authenticating: false,
    password: null,
    requiresPassword: null,
    remember: false,
    rememberMeEnabled: false,

    clients: null,
    clientsPersist: {},
    clientDelete: null,
    clientCreate: null,
    clientCreateName: '',
    clientExpiredDate: '',
    clientEditName: null,
    clientEditNameId: null,
    clientEditAddress: null,
    clientEditAddressId: null,
    clientEditExpireDate: null,
    clientEditExpireDateId: null,
    qrcode: null,

    currentRelease: null,
    latestRelease: null,

    uiTrafficStats: false,

    uiChartType: 0,
    avatarSettings: {
      dicebear: null,
      gravatar: false,
    },
    enableOneTimeLinks: false,
    enableSortClient: false,
    sortClient: true, // Sort clients by name, true = asc, false = desc
    enableExpireTime: false,

    compatApi: null,

    serverSettings: null,
    settingsCompatMode: 'env',
    settingsWgHost: '',
    settingsWgDns: '',
    settingsSaving: false,

    /** @type {object[]} */
    tunnelsList: [],
    selectedTunnel: localStorage.getItem('wgEasyTunnel') || 'wg0',

    activeTab: (() => {
      try {
        return localStorage.getItem('wgEasyTab') || 'peers';
      } catch {
        return 'peers';
      }
    })(),
    tunnelModalOpen: false,
    tunnelModalMode: 'add',
    tunnelFormName: '',
    tunnelFormListenPort: '',
    tunnelFormAddressCidr: '',
    tunnelDelete: null,

    uiShowCharts: localStorage.getItem('uiShowCharts') === '1',
    uiTheme: localStorage.theme || 'auto',
    prefersDarkScheme: window.matchMedia('(prefers-color-scheme: dark)'),

    chartOptions: {
      chart: {
        background: 'transparent',
        stacked: false,
        toolbar: {
          show: false,
        },
        animations: {
          enabled: false,
        },
        parentHeightOffset: 0,
        sparkline: {
          enabled: true,
        },
      },
      colors: [],
      stroke: {
        curve: 'smooth',
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0,
          gradientToColors: CHART_COLORS.gradient[this.theme],
          inverseColors: false,
          opacityTo: 0,
          stops: [0, 100],
        },
      },
      dataLabels: {
        enabled: false,
      },
      plotOptions: {
        bar: {
          horizontal: false,
        },
      },
      xaxis: {
        labels: {
          show: false,
        },
        axisTicks: {
          show: false,
        },
        axisBorder: {
          show: false,
        },
      },
      yaxis: {
        labels: {
          show: false,
        },
        min: 0,
      },
      tooltip: {
        enabled: false,
      },
      legend: {
        show: false,
      },
      grid: {
        show: false,
        padding: {
          left: -10,
          right: 0,
          bottom: -15,
          top: -15,
        },
        column: {
          opacity: 0,
        },
        xaxis: {
          lines: {
            show: false,
          },
        },
      },
    },

  },
  methods: {
    dateTime: (value) => {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      }).format(value);
    },
    async refresh({
      updateCharts = false,
    } = {}) {
      if (!this.authenticated) return;

      try {
        const list = await this.api.listTunnels();
        this.applyTunnelListFromApi(list);
      } catch (err) {
        console.error(err);
        this.tunnelsList = [{ name: 'wg0' }];
        this.selectedTunnel = 'wg0';
        try {
          localStorage.setItem('wgEasyTunnel', 'wg0');
        } catch (_) {}
      }

      this.api.tunnel = this.selectedTunnel;
      const clients = await this.api.getClients();
      this.clients = clients.map((client) => {
        if (client.name.includes('@') && client.name.includes('.') && this.avatarSettings.gravatar) {
          client.avatar = `https://gravatar.com/avatar/${sha256(client.name.toLowerCase().trim())}.jpg`;
        } else if (this.avatarSettings.dicebear) {
          client.avatar = `https://api.dicebear.com/9.x/${this.avatarSettings.dicebear}/svg?seed=${sha256(client.name.toLowerCase().trim())}`;
        }

        if (!this.clientsPersist[client.id]) {
          this.clientsPersist[client.id] = {};
          this.clientsPersist[client.id].transferRxHistory = Array(50).fill(0);
          this.clientsPersist[client.id].transferRxPrevious = client.transferRx;
          this.clientsPersist[client.id].transferTxHistory = Array(50).fill(0);
          this.clientsPersist[client.id].transferTxPrevious = client.transferTx;
        }

        // Debug
        // client.transferRx = this.clientsPersist[client.id].transferRxPrevious + Math.random() * 1000;
        // client.transferTx = this.clientsPersist[client.id].transferTxPrevious + Math.random() * 1000;
        // client.latestHandshakeAt = new Date();
        // this.requiresPassword = true;

        this.clientsPersist[client.id].transferRxCurrent = client.transferRx - this.clientsPersist[client.id].transferRxPrevious;
        this.clientsPersist[client.id].transferRxPrevious = client.transferRx;
        this.clientsPersist[client.id].transferTxCurrent = client.transferTx - this.clientsPersist[client.id].transferTxPrevious;
        this.clientsPersist[client.id].transferTxPrevious = client.transferTx;

        if (updateCharts) {
          this.clientsPersist[client.id].transferRxHistory.push(this.clientsPersist[client.id].transferRxCurrent);
          this.clientsPersist[client.id].transferRxHistory.shift();

          this.clientsPersist[client.id].transferTxHistory.push(this.clientsPersist[client.id].transferTxCurrent);
          this.clientsPersist[client.id].transferTxHistory.shift();

          this.clientsPersist[client.id].transferTxSeries = [{
            name: 'Tx',
            data: this.clientsPersist[client.id].transferTxHistory,
          }];

          this.clientsPersist[client.id].transferRxSeries = [{
            name: 'Rx',
            data: this.clientsPersist[client.id].transferRxHistory,
          }];

          client.transferTxHistory = this.clientsPersist[client.id].transferTxHistory;
          client.transferRxHistory = this.clientsPersist[client.id].transferRxHistory;
          client.transferMax = Math.max(...client.transferTxHistory, ...client.transferRxHistory);

          client.transferTxSeries = this.clientsPersist[client.id].transferTxSeries;
          client.transferRxSeries = this.clientsPersist[client.id].transferRxSeries;
        }

        client.transferTxCurrent = this.clientsPersist[client.id].transferTxCurrent;
        client.transferRxCurrent = this.clientsPersist[client.id].transferRxCurrent;

        client.hoverTx = this.clientsPersist[client.id].hoverTx;
        client.hoverRx = this.clientsPersist[client.id].hoverRx;

        return client;
      });

      if (this.enableSortClient) {
        this.clients = sortByProperty(this.clients, 'name', this.sortClient);
      }
    },
    login(e) {
      e.preventDefault();

      if (!this.password) return;
      if (this.authenticating) return;

      this.authenticating = true;
      this.api.createSession({
        password: this.password,
        remember: this.remember,
      })
        .then(async () => {
          const session = await this.api.getSession();
          this.authenticated = session.authenticated;
          this.requiresPassword = session.requiresPassword;
          return this.refresh();
        })
        .then(() => {
          this.loadServerSettings().catch(console.error);
        })
        .catch((err) => {
          alert(err.message || err.toString());
        })
        .finally(() => {
          this.authenticating = false;
          this.password = null;
        });
    },
    logout(e) {
      e.preventDefault();

      this.api.deleteSession()
        .then(() => {
          this.authenticated = false;
          this.clients = null;
        })
        .catch((err) => {
          alert(err.message || err.toString());
        });
    },
    createClient() {
      const name = this.clientCreateName;
      const expiredDate = this.clientExpiredDate;
      if (!name) return;

      this.api.createClient({ name, expiredDate })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    deleteClient(client) {
      this.api.deleteClient({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    showOneTimeLink(client) {
      this.api.showOneTimeLink({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    enableClient(client) {
      this.api.enableClient({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    disableClient(client) {
      this.api.disableClient({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    updateClientName(client, name) {
      this.api.updateClientName({ clientId: client.id, name })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    updateClientAddress(client, address) {
      this.api.updateClientAddress({ clientId: client.id, address })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    updateClientExpireDate(client, expireDate) {
      this.api.updateClientExpireDate({ clientId: client.id, expireDate })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    restoreConfig(e) {
      e.preventDefault();
      const file = e.currentTarget.files.item(0);
      if (file) {
        file.text()
          .then((content) => {
            this.api.restoreConfiguration(content, this.selectedTunnel)
              .then((_result) => alert('The configuration was updated.'))
              .catch((err) => alert(err.message || err.toString()))
              .finally(() => this.refresh().catch(console.error));
          })
          .catch((err) => alert(err.message || err.toString()));
      } else {
        alert('Failed to load your file!');
      }
    },
    onTunnelChange() {
      try {
        localStorage.setItem('wgEasyTunnel', this.selectedTunnel);
      } catch (_) {}
      this.api.tunnel = this.selectedTunnel;
      this.clientsPersist = {};
      this.refresh().catch(console.error);
    },
    applyTunnelListFromApi(list) {
      this.tunnelsList = Array.isArray(list) ? list : [];
      const names = this.tunnelsList.map((x) => x.name).filter(Boolean);
      if (!names.includes(this.selectedTunnel) && names.length) {
        this.selectedTunnel = names[0];
        try {
          localStorage.setItem('wgEasyTunnel', this.selectedTunnel);
        } catch (_) {}
      }
      if (this.api) this.api.tunnel = this.selectedTunnel;
    },
    setActiveTab(tab) {
      this.activeTab = tab;
      try {
        localStorage.setItem('wgEasyTab', tab);
      } catch (_) {}
      if (tab === 'settings' && this.authenticated) {
        this.loadServerSettings().catch(console.error);
      }
    },
    async loadServerSettings() {
      if (!this.api || !this.authenticated) return;
      try {
        const data = await this.api.getServerSettings();
        this.serverSettings = data;
        const o = data.overrides;
        if (o.compatApiEnabled === null || o.compatApiEnabled === undefined) {
          this.settingsCompatMode = 'env';
        } else {
          this.settingsCompatMode = o.compatApiEnabled ? 'on' : 'off';
        }
        this.settingsWgHost = o.wgHost != null ? o.wgHost : '';
        this.settingsWgDns = o.wgDefaultDns != null ? o.wgDefaultDns : '';
      } catch (e) {
        console.error(e);
      }
    },
    async saveServerSettings() {
      if (!this.api || this.settingsSaving) return;
      this.settingsSaving = true;
      try {
        let compatApiEnabled;
        if (this.settingsCompatMode === 'env') compatApiEnabled = null;
        else if (this.settingsCompatMode === 'on') compatApiEnabled = true;
        else compatApiEnabled = false;
        const body = {
          compatApiEnabled,
          wgHost: this.settingsWgHost.trim() === '' ? null : this.settingsWgHost.trim(),
          wgDefaultDns: this.settingsWgDns.trim() === '' ? null : this.settingsWgDns.trim(),
        };
        const res = await this.api.putServerSettings(body);
        if (res && res.effective) {
          this.serverSettings = {
            env: res.env,
            overrides: res.overrides,
            effective: res.effective,
          };
        }
        this.compatApi = await this.api.getCompatApiStatus();
      } catch (e) {
        alert(e.message || e.toString());
      } finally {
        this.settingsSaving = false;
      }
    },
    tabBtnClass(tab) {
      const base = 'px-3 py-2 text-sm font-medium border-b-2 transition -mb-px';
      const active = this.activeTab === tab
        ? 'border-red-800 dark:border-red-400 text-red-800 dark:text-red-300'
        : 'border-transparent text-gray-500 dark:text-neutral-400 hover:text-gray-800 dark:hover:text-neutral-200';
      return `${base} ${active}`;
    },
    tunnelRowAddress(t) {
      if (!t || t.address == null) return '—';
      const a = t.address;
      if (Array.isArray(a) && a[0]) return String(a[0]);
      if (typeof a === 'string' && a) return a;
      return '—';
    },
    parseLanCidrToAddresses(str) {
      const s = String(str || '').trim();
      if (!s) return undefined;
      const i = s.indexOf('/');
      if (i === -1) {
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return [{ address: s, mask: 24 }];
        return undefined;
      }
      const address = s.slice(0, i).trim();
      const mask = parseInt(s.slice(i + 1), 10);
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address) || !Number.isFinite(mask) || mask < 0 || mask > 32) return undefined;
      return [{ address, mask }];
    },
    isValidTunnelNameClient(name) {
      return typeof name === 'string' && /^[a-zA-Z0-9_-]{1,15}$/.test(name.trim());
    },
    openTunnelModal(mode, row) {
      this.tunnelModalMode = mode;
      if (mode === 'add') {
        this.tunnelFormName = '';
        this.tunnelFormListenPort = '';
        this.tunnelFormAddressCidr = '';
      } else if (row) {
        this.tunnelFormName = row.name || '';
        const lp = row.listen_port;
        this.tunnelFormListenPort = lp != null && lp !== '' ? String(lp) : '';
        const addr = this.tunnelRowAddress(row);
        this.tunnelFormAddressCidr = addr !== '—' ? addr : '';
      }
      this.tunnelModalOpen = true;
    },
    closeTunnelModal() {
      this.tunnelModalOpen = false;
    },
    async submitTunnelModal() {
      const name = String(this.tunnelFormName || '').trim();
      if (!this.isValidTunnelNameClient(name)) {
        alert('Invalid interface name (1–15 characters: letters, digits, _, -).');
        return;
      }
      const lp = String(this.tunnelFormListenPort || '').trim();
      const cidr = String(this.tunnelFormAddressCidr || '').trim();
      try {
        if (this.tunnelModalMode === 'add') {
          const body = { name, enabled: true };
          if (lp) body.listenport = lp;
          const addrs = this.parseLanCidrToAddresses(cidr);
          if (addrs) body.addresses = addrs;
          const list = await this.api.addTunnel(body, false);
          this.applyTunnelListFromApi(list);
        } else {
          const spec = { name };
          if (lp) spec.listen_port = lp;
          if (cidr) spec.address = [cidr];
          const list = await this.api.syncTunnels([spec]);
          this.applyTunnelListFromApi(list);
        }
        this.closeTunnelModal();
        await this.refresh({ updateCharts: this.updateCharts });
      } catch (err) {
        alert(err.message || err.toString());
      }
    },
    useTunnelForPeers(ifName) {
      if (!ifName) return;
      this.selectedTunnel = ifName;
      try {
        localStorage.setItem('wgEasyTunnel', ifName);
      } catch (_) {}
      this.api.tunnel = ifName;
      this.clientsPersist = {};
      this.setActiveTab('peers');
      this.refresh().catch(console.error);
    },
    async confirmResetTunnel(t) {
      if (!t || !t.name) return;
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Reset obfuscation for ${t.name}?`)) return;
      try {
        await this.api.resetTunnelObfuscation(t.name);
        const list = await this.api.listTunnels();
        this.applyTunnelListFromApi(list);
        await this.refresh({ updateCharts: this.updateCharts });
      } catch (err) {
        alert(err.message || err.toString());
      }
    },
    requestDeleteTunnel(t) {
      this.tunnelDelete = t;
    },
    async doDeleteTunnel() {
      const t = this.tunnelDelete;
      if (!t || !t.name) return;
      try {
        await this.api.deleteTunnel(t.name);
        this.tunnelDelete = null;
        const list = await this.api.listTunnels();
        this.applyTunnelListFromApi(list);
        await this.refresh({ updateCharts: this.updateCharts });
      } catch (err) {
        alert(err.message || err.toString());
      }
    },
    toggleTheme() {
      const themes = ['light', 'dark', 'auto'];
      const currentIndex = themes.indexOf(this.uiTheme);
      const newIndex = (currentIndex + 1) % themes.length;
      this.uiTheme = themes[newIndex];
      localStorage.theme = this.uiTheme;
      this.setTheme(this.uiTheme);
    },
    setTheme(theme) {
      const { classList } = document.documentElement;
      const shouldAddDarkClass = theme === 'dark' || (theme === 'auto' && this.prefersDarkScheme.matches);
      classList.toggle('dark', shouldAddDarkClass);
    },
    handlePrefersChange(e) {
      if (localStorage.theme === 'auto') {
        this.setTheme(e.matches ? 'dark' : 'light');
      }
    },
    toggleCharts() {
      localStorage.setItem('uiShowCharts', this.uiShowCharts ? 1 : 0);
    },
  },
  filters: {
    bytes,
    timeago: (value) => {
      return timeago.format(value, i18n.locale);
    },
    expiredDateFormat: (value) => {
      if (value === null) return i18n.t('Permanent');
      const dateTime = new Date(value);
      const options = { year: 'numeric', month: 'long', day: 'numeric' };
      return dateTime.toLocaleDateString(i18n.locale, options);
    },
    expiredDateEditFormat: (value) => {
      if (value === null) return 'yyyy-MM-dd';
    },
  },
  mounted() {
    this.prefersDarkScheme.addListener(this.handlePrefersChange);
    this.setTheme(this.uiTheme);

    this.api = new API();
    this.api.tunnel = this.selectedTunnel;
    this.api.getSession()
      .then((session) => {
        this.authenticated = session.authenticated;
        this.requiresPassword = session.requiresPassword;
        return this.api.listTunnels()
          .then((list) => {
            this.applyTunnelListFromApi(list);
            try {
              const saved = localStorage.getItem('wgEasyTunnel');
              if (saved && this.tunnelsList.some((x) => x.name === saved)) {
                this.selectedTunnel = saved;
              }
            } catch (_) {}
            this.api.tunnel = this.selectedTunnel;
          })
          .catch(() => {
            this.tunnelsList = [{ name: 'wg0' }];
          })
          .then(() => this.refresh({
            updateCharts: this.updateCharts,
          }))
          .catch((err) => {
            alert(err.message || err.toString());
          })
          .finally(() => {
            if (this.authenticated) this.loadServerSettings().catch(console.error);
          });
      })
      .catch((err) => {
        alert(err.message || err.toString());
      });

    this.api.getRememberMeEnabled()
      .then((rememberMeEnabled) => {
        this.rememberMeEnabled = rememberMeEnabled;
      });

    setInterval(() => {
      this.refresh({
        updateCharts: this.updateCharts,
      }).catch(console.error);
    }, 1000);

    this.api.getuiTrafficStats()
      .then((res) => {
        this.uiTrafficStats = res;
      })
      .catch(() => {
        this.uiTrafficStats = false;
      });

    this.api.getChartType()
      .then((res) => {
        this.uiChartType = parseInt(res, 10);
      })
      .catch(() => {
        this.uiChartType = 0;
      });

    this.api.getWGEnableOneTimeLinks()
      .then((res) => {
        this.enableOneTimeLinks = res;
      })
      .catch(() => {
        this.enableOneTimeLinks = false;
      });

    this.api.getUiSortClients()
      .then((res) => {
        this.enableSortClient = res;
      })
      .catch(() => {
        this.enableSortClient = false;
      });

    this.api.getWGEnableExpireTime()
      .then((res) => {
        this.enableExpireTime = res;
      })
      .catch(() => {
        this.enableExpireTime = false;
      });

    this.api.getAvatarSettings()
      .then((res) => {
        this.avatarSettings = res;
      })
      .catch(() => {
        this.avatarSettings = {
          dicebear: null,
          gravatar: false,
        };
      });

    this.api.getCompatApiStatus()
      .then((res) => {
        this.compatApi = res;
      })
      .catch(() => {
        this.compatApi = null;
      });

    Promise.resolve().then(async () => {
      const lang = await this.api.getLang();
      if (lang !== localStorage.getItem('lang') && i18n.availableLocales.includes(lang)) {
        localStorage.setItem('lang', lang);
        i18n.locale = lang;
      }

      const currentRelease = await this.api.getRelease();
      const latestRelease = await fetch('https://wg-easy.github.io/wg-easy/changelog.json')
        .then((res) => res.json())
        .then((releases) => {
          const releasesArray = Object.entries(releases).map(([version, changelog]) => ({
            version: parseInt(version, 10),
            changelog,
          }));
          releasesArray.sort((a, b) => {
            return b.version - a.version;
          });

          return releasesArray[0];
        });

      if (currentRelease >= latestRelease.version) return;

      this.currentRelease = currentRelease;
      this.latestRelease = latestRelease;
    }).catch((err) => console.error(err));
  },
  computed: {
    chartOptionsTX() {
      const opts = {
        ...this.chartOptions,
        colors: [CHART_COLORS.tx[this.theme]],
      };
      opts.chart.type = UI_CHART_TYPES[this.uiChartType].type || false;
      opts.stroke.width = UI_CHART_TYPES[this.uiChartType].strokeWidth;
      return opts;
    },
    chartOptionsRX() {
      const opts = {
        ...this.chartOptions,
        colors: [CHART_COLORS.rx[this.theme]],
      };
      opts.chart.type = UI_CHART_TYPES[this.uiChartType].type || false;
      opts.stroke.width = UI_CHART_TYPES[this.uiChartType].strokeWidth;
      return opts;
    },
    updateCharts() {
      return this.uiChartType > 0 && this.uiShowCharts;
    },
    theme() {
      if (this.uiTheme === 'auto') {
        return this.prefersDarkScheme.matches ? 'dark' : 'light';
      }
      return this.uiTheme;
    },
  },
});
