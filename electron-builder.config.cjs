const { URL } = require('node:url');
const packageConfig = require('./package.json').build;

const input = process.env.SCKIT_UPDATE_URL;
if (input) {
  let base;
  try { base = new URL(input); }
  catch { throw new Error('SCKIT_UPDATE_URL must be an absolute HTTPS URL'); }
  if (base.protocol !== 'https:' || base.hostname.toLowerCase() !== 'pulsar.42kit.com' || base.pathname !== '/' || base.username || base.password || base.search || base.hash) {
    throw new Error('SCKIT_UPDATE_URL must be the HTTPS origin https://pulsar.42kit.com');
  }
  const platform = process.env.CI_PLATFORM || ({ win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform]);
  const arch = process.env.CI_ARCH || (platform === 'mac' ? 'universal' : process.arch);
  const feeds = new Set(['win/x64', 'mac/universal', 'linux/x64', 'linux/arm64']);
  const feed = `${platform}/${arch}`;
  if (!feeds.has(feed)) throw new Error(`Unsupported automatic-update target: ${feed}`);
  packageConfig.publish = [{ provider: 'generic', url: `${base.origin}/${feed}/`, channel: 'latest', useMultipleRangeRequest: false }];
  packageConfig.detectUpdateChannel = false;
}

module.exports = packageConfig;
