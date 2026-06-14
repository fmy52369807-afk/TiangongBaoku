const dns = require('dns').promises;
const net = require('net');

const PRIVATE_NETWORK_ERROR = 'Private network URLs are not allowed';

function isBlockedNetworkHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    const ipType = net.isIP(host);
    if (ipType === 4) {
        const [a, b] = host.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
    }
    if (ipType === 6) {
        return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
    }
    return false;
}

async function assertPublicNetworkHost(hostname, { allowPrivateNetworkFetch = false } = {}) {
    if (allowPrivateNetworkFetch) return;
    if (isBlockedNetworkHost(hostname)) throw new Error(PRIVATE_NETWORK_ERROR);
    const addresses = await dns.lookup(hostname, { all: true, verbatim: false });
    if (addresses.some(item => isBlockedNetworkHost(item.address))) {
        throw new Error(PRIVATE_NETWORK_ERROR);
    }
}

module.exports = {
    PRIVATE_NETWORK_ERROR,
    isBlockedNetworkHost,
    assertPublicNetworkHost,
};
