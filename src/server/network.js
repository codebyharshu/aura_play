const os = require('os');

/**
 * Discovers the local machine's IPv4 network interfaces.
 * Prioritizes active Wi-Fi and Ethernet interfaces.
 * @returns {{ primaryIP: string, allInterfaces: Array<{ name: string, ip: string, family: string, internal: boolean }> }}
 */
function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const allInterfaces = [];
  let primaryIP = '127.0.0.1';

  // Preference order for interface names
  const preferredRegex = /(wi-fi|wlan|ethernet|eth|en0|en1)/i;
  const virtualRegex = /(virtual|vmware|vbox|docker|loopback|tailscale|zerotier|wsl)/i;

  let bestScore = -1;

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;

    for (const addr of addrs) {
      if (addr.family === 'IPv4' || addr.family === 4) {
        allInterfaces.push({
          name,
          ip: addr.address,
          family: 'IPv4',
          internal: addr.internal
        });

        if (!addr.internal) {
          let score = 10;
          if (preferredRegex.test(name)) score += 50;
          if (virtualRegex.test(name)) score -= 40;
          if (addr.address.startsWith('192.168.')) score += 20;
          else if (addr.address.startsWith('10.')) score += 15;
          else if (addr.address.startsWith('172.')) score += 10;

          if (score > bestScore) {
            bestScore = score;
            primaryIP = addr.address;
          }
        }
      }
    }
  }

  return { primaryIP, allInterfaces };
}

module.exports = {
  getLocalNetworkInfo
};
