// db/dns-override.js — Override Node.js dns.lookup to bypass broken local IPv6 DNS servers
const dns = require('dns');

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  
  const originalLookup = dns.lookup;
  
  dns.lookup = function(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    const isAll = options && options.all === true;
    
    // Resolve host using dns.resolve4
    dns.resolve4(hostname, (err, addresses) => {
      if (err) {
        // Fallback to local DNS lookup if resolver fails (e.g., for local hosts or other services)
        return originalLookup(hostname, options, callback);
      }
      if (!addresses || addresses.length === 0) {
        return callback(new Error(`ENOTFOUND ${hostname}`));
      }
      
      if (isAll) {
        const addrList = addresses.map(addr => ({ address: addr, family: 4 }));
        callback(null, addrList);
      } else {
        callback(null, addresses[0], 4);
      }
    });
  };
  console.log('🌐 B2B ERP: Global DNS override injected successfully.');
} catch (e) {
  console.warn('⚠️ B2B ERP: Could not configure DNS override:', e.message);
}
