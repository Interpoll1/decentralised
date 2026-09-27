// Caller owns the injected mysql2/promise Connection and its SELECT-only account.
// This module opens no connection, imports no application pool and loads no body.
const WINDOW_MS = 600_000;
const MAX_ROWS = 1_000;
const MAX_TARGETS = 20;
const MAX_NODE_BYTES = 65_536;
const QUERY_TIMEOUT_MS = 2_000;
const ID = /^[a-z0-9_.:-]{1,128}$/;
const HASH = /^[0-9a-f]{64}$/;
const CAPTURE_CODES = new Set([
  'MYSQL_RESULT_SHAPE', 'MYSQL_CLOCK_INVALID', 'MYSQL_ROW_LIMIT', 'MYSQL_ROW_CONTEXT',
  'MYSQL_ROW_TIME', 'MYSQL_PAYLOAD_LIMIT', 'MYSQL_METADATA_SHAPE', 'MYSQL_METADATA_LIMIT',
  'MYSQL_METADATA_DUPLICATE', 'MYSQL_METADATA_MISSING',
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function policyContext(policy) {
  if (!policy || policy.version !== 1 || policy.scope !== 'operator-reviewed-public-posts'
    || typeof policy.namespace !== 'string' || !/^v[1-9][0-9]{0,3}$/.test(policy.namespace)
    || !Array.isArray(policy.targets) || !policy.targets.length || policy.targets.length > MAX_TARGETS) {
    throw fail('MYSQL_POLICY_CONTEXT');
  }
  const ids = new Set();
  const souls = new Set();
  for (const target of policy.targets) {
    if (!target || typeof target.id !== 'string' || !ID.test(target.id)
      || typeof target.communityId !== 'string' || !ID.test(target.communityId)
      || typeof target.postReviewHash !== 'string' || !HASH.test(target.postReviewHash)
      || typeof target.communityReviewHash !== 'string' || !HASH.test(target.communityReviewHash)
      || ids.has(target.id)) throw fail('MYSQL_POLICY_CONTEXT');
    ids.add(target.id);
    souls.add(`${policy.namespace}/posts/${target.id}`);
    souls.add(`${policy.namespace}/communities/${target.communityId}`);
  }
  return { ids: [...ids].sort(), souls: [...souls].sort() };
}

function safeInteger(value) {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function flag(value) {
  if (value === null || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw fail('MYSQL_METADATA_SHAPE');
}

function metadataRow(row, expectedSouls) {
  if (!row || typeof row.soul !== 'string' || !expectedSouls.has(row.soul)
    || row.documentType !== 'OBJECT' || typeof row.dataHash !== 'string' || !HASH.test(row.dataHash)
    || row.idType !== 'STRING' || typeof row.id !== 'string' || !ID.test(row.id)) {
    throw fail('MYSQL_METADATA_SHAPE');
  }
  let communityId = null;
  if (row.communityIdType !== null && row.communityIdType !== 'NULL') {
    if (row.communityIdType !== 'STRING' || typeof row.communityId !== 'string' || !ID.test(row.communityId)) {
      throw fail('MYSQL_METADATA_SHAPE');
    }
    communityId = row.communityId;
  }
  if (![0, 1, '0', '1', false, true].includes(row.encrypted)) throw fail('MYSQL_METADATA_SHAPE');
  return {
    soul: row.soul, dataHash: row.dataHash, id: row.id, communityId,
    isPrivate: flag(row.isPrivate), isEncrypted: flag(row.isEncrypted),
    deleted: flag(row.deleted), isDeleted: flag(row.isDeleted), encrypted: row.encrypted === true || Number(row.encrypted) === 1,
  };
}

function metadataSql(count) {
  // The size check guards JSON parsing and hashing. CASE/JSON_VALID keeps malformed
  // records out of JSON_EXTRACT; no full data/content value crosses the wire.
  const data = `(CASE WHEN OCTET_LENGTH(data) <= ${MAX_NODE_BYTES} THEN CASE WHEN JSON_VALID(data) THEN data ELSE NULL END ELSE NULL END)`;
  const extract = name => `JSON_EXTRACT(${data}, '$.${name}')`;
  const scalar = name => `CASE WHEN JSON_TYPE(${extract(name)}) = 'STRING' AND OCTET_LENGTH(JSON_UNQUOTE(${extract(name)})) <= 128 THEN JSON_UNQUOTE(${extract(name)}) ELSE NULL END AS ${name}`;
  const boolean = name => `CASE WHEN JSON_TYPE(${extract(name)}) = 'BOOLEAN' THEN JSON_UNQUOTE(${extract(name)}) WHEN JSON_TYPE(${extract(name)}) IS NULL OR JSON_TYPE(${extract(name)}) = 'NULL' THEN NULL ELSE 'INVALID' END AS ${name}`;
  return `SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIMEOUT_MS}) */ soul,
    SHA2(${data}, 256) AS dataHash, JSON_TYPE(${data}) AS documentType,
    ${scalar('id')}, JSON_TYPE(${extract('id')}) AS idType,
    ${scalar('communityId')}, JSON_TYPE(${extract('communityId')}) AS communityIdType,
    ${['isPrivate', 'isEncrypted', 'deleted', 'isDeleted'].map(boolean).join(',\n    ')},
    JSON_CONTAINS_PATH(${data}, 'one', '$.encryptedMeta', '$.encryptedContent', '$.encryptedData') AS encrypted
    FROM gun_nodes WHERE soul IN (${Array(count).fill('?').join(',')}) ORDER BY soul LIMIT 41`;
}

/**
 * Read one retained committed sample through a caller-owned mysql2 Connection.
 * Returns {readAt, rows, metadata}; policy authorization, hashes, explicit privacy
 * flags and signed-envelope verification are the exporter's responsibility.
 * A record over 64 KiB fails closed. Rows preserve the database column names.
 * Always attempts ROLLBACK after starting transaction setup; never commits,
 * performs DML, changes schema, or ends/destroys the supplied connection.
 */
export async function readCapture(connection, policy) {
  const context = policyContext(policy);
  if (!connection || typeof connection.query !== 'function') throw fail('MYSQL_CONNECTION_REQUIRED');
  const query = async (sql, values = []) => {
    const result = await connection.query({ sql, timeout: QUERY_TIMEOUT_MS }, values);
    if (!Array.isArray(result) || result.length !== 2) throw fail('MYSQL_RESULT_SHAPE');
    return result[0];
  };
  let output;
  let error;
  try {
    await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const clock = await query(`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIMEOUT_MS}) */ CAST(FLOOR(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000) AS UNSIGNED) AS readAt`);
    const readAt = Array.isArray(clock) && clock.length === 1 ? safeInteger(clock[0]?.readAt) : null;
    if (readAt === null || readAt < WINDOW_MS) throw fail('MYSQL_CLOCK_INVALID');
    const rows = await query(`SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIMEOUT_MS}) */ id, actor, kind, target_type, target_id, received_at,
      CASE WHEN OCTET_LENGTH(payload) <= 2048 THEN payload ELSE NULL END AS payload
      FROM engagement_actions_v1 WHERE kind = 'reaction' AND target_type = 'post'
        AND received_at >= ? AND received_at <= ? AND target_id IN (${context.ids.map(() => '?').join(',')})
      ORDER BY received_at, id LIMIT 1001`, [readAt - WINDOW_MS, readAt, ...context.ids]);
    if (!Array.isArray(rows)) throw fail('MYSQL_RESULT_SHAPE');
    if (rows.length > MAX_ROWS) throw fail('MYSQL_ROW_LIMIT');
    const seenRows = new Set();
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !HASH.test(row.id) || seenRows.has(row.id)
        || typeof row.actor !== 'string' || !HASH.test(row.actor)
        || row.kind !== 'reaction' || row.target_type !== 'post' || !context.ids.includes(row.target_id)) {
        throw fail('MYSQL_ROW_CONTEXT');
      }
      seenRows.add(row.id);
      const receivedAt = safeInteger(row.received_at);
      if (receivedAt === null || receivedAt < readAt - WINDOW_MS || receivedAt > readAt) throw fail('MYSQL_ROW_TIME');
      if (typeof row.payload !== 'string' || Buffer.byteLength(row.payload, 'utf8') > 2048) throw fail('MYSQL_PAYLOAD_LIMIT');
    }
    const rawMetadata = await query(metadataSql(context.souls.length), context.souls);
    if (!Array.isArray(rawMetadata)) throw fail('MYSQL_RESULT_SHAPE');
    if (rawMetadata.length > 40) throw fail('MYSQL_METADATA_LIMIT');
    const seenSouls = new Set();
    const expectedSouls = new Set(context.souls);
    const metadata = rawMetadata.map(row => {
      const result = metadataRow(row, expectedSouls);
      if (seenSouls.has(result.soul)) throw fail('MYSQL_METADATA_DUPLICATE');
      seenSouls.add(result.soul);
      return result;
    });
    if (seenSouls.size !== expectedSouls.size) throw fail('MYSQL_METADATA_MISSING');
    output = { readAt, rows, metadata };
  } catch (caught) {
    error = CAPTURE_CODES.has(caught?.code) ? fail(caught.code) : fail('MYSQL_CAPTURE_FAILED');
  } finally {
    try { await query('ROLLBACK'); }
    catch { error = fail('MYSQL_ROLLBACK_FAILED'); }
  }
  if (error) throw error;
  return output;
}
