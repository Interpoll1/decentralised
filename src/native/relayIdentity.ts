/**
 * Shared identity plumbing for the relay's notification endpoints.
 *
 * The relay has no accounts to authenticate against, and `userId` IS the
 * x-only Schnorr public key — so signing with the matching private key both
 * proves who we are and proves we own the id we are claiming. Without it,
 * anyone could bind their own device token or email address to someone else's
 * id and learn who is messaging them, or unbind one to silence them.
 *
 * Used by `pushNotifications.ts` (FCM) and `emailNotifications.ts` (Resend).
 */

/** The user the relay should target — empty if the profile isn't ready yet. */
export async function currentUserId(): Promise<string> {
  try {
    const { UserService } = await import('../services/userService');
    const user = await UserService.getCurrentUser();
    return user?.id || '';
  } catch {
    return '';
  }
}

/** Sign a canonical relay message with the identity key. */
export async function signForRelay(message: string): Promise<string> {
  const [{ KeyService }, { CryptoService }] = await Promise.all([
    import('../services/keyService'),
    import('../services/cryptoService'),
  ]);
  const privateKey = await KeyService.getPrivateKeyHex();
  return CryptoService.sign(message, privateKey);
}
