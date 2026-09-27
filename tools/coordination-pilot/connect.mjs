export function validateConnectionConfig(config) {
  const allowed = ['host','port','socketPath','user','password','database'];
  if (!config || Array.isArray(config) || Object.keys(config).some(k => !allowed.includes(k))
    || !['user','password','database'].every(k => typeof config[k] === 'string' && config[k].length > 0 && config[k].length <= 256)
    || !/^[a-zA-Z0-9_]{1,64}$/.test(config.database)) throw new Error('DB_CONFIG');
  if (config.socketPath !== undefined) {
    if (config.host !== undefined || config.port !== undefined || typeof config.socketPath !== 'string'
      || !/^\/[a-zA-Z0-9_./-]{1,200}$/.test(config.socketPath)) throw new Error('DB_LOCAL_ONLY');
  } else if (!['127.0.0.1','::1'].includes(config.host)
    || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('DB_LOCAL_ONLY');
  return config;
}

export async function createConnection(config) {
  validateConnectionConfig(config);
  let mysql;
  try { mysql = await import('mysql2/promise'); } catch { throw new Error('MYSQL_DRIVER_UNAVAILABLE'); }
  try {
    return await mysql.createConnection({...config, connectTimeout:3000, multipleStatements:false,
      supportBigNumbers:true, bigNumberStrings:true, decimalNumbers:false, charset:'utf8mb4'});
  } catch { throw new Error('DB_CONNECT'); }
}
