export const ErrorCodes = {
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  HASH_MISMATCH: 'HASH_MISMATCH',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  POW_INSUFFICIENT: 'POW_INSUFFICIENT',
  REPLAY_DETECTED: 'REPLAY_DETECTED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
};

export function makeError(code, details = []) {
  return {
    type: 'error',
    code,
    details: Array.isArray(details) ? details : [details],
    timestamp: Date.now(),
  };
}

export function makeHttpError(code, statusCode, details = []) {
  return {
    statusCode,
    body: makeError(code, details),
  };
}
