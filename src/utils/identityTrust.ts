const TRUST_ISSUER_DOMAINS = new Set([
  'endles.sbs',
  'endless.sbs',
]);

export type IdentityTrustLevel = 'trusted-issuer' | 'unverified';

export interface IdentityTrustInfo {
  identityUsername: string;
  issuer: string;
  hasIssuer: boolean;
  isTrustedIssuer: boolean;
  trustLevel: IdentityTrustLevel;
}

export function parseIdentityTrust(rawUsername: string | null | undefined): IdentityTrustInfo {
  const identityUsername = typeof rawUsername === 'string' ? rawUsername.trim() : '';
  const at = identityUsername.lastIndexOf('@');
  const issuer = at > 0 && at < identityUsername.length - 1
    ? identityUsername.slice(at + 1).toLowerCase()
    : '';
  const hasIssuer = issuer.length > 0;
  const isTrustedIssuer = hasIssuer && TRUST_ISSUER_DOMAINS.has(issuer);
  return {
    identityUsername,
    issuer,
    hasIssuer,
    isTrustedIssuer,
    trustLevel: isTrustedIssuer ? 'trusted-issuer' : 'unverified',
  };
}

export function formatTrustedIdentityLabel(input: {
  username?: string | null;
  issuer?: string | null;
}): string {
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const issuer = typeof input.issuer === 'string' ? input.issuer.trim() : '';
  if (!username && !issuer) return 'Unverified identity';
  if (!issuer) return username || 'Unverified identity';
  if (!username) return `@${issuer}`;
  const parsedUsername = parseIdentityTrust(username);
  if (parsedUsername.hasIssuer && parsedUsername.issuer === issuer.toLowerCase()) {
    return parsedUsername.identityUsername;
  }
  return `${username}@${issuer}`;
}
