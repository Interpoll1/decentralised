// src/stores/authStore.ts — reactive identity backed by the GenosDB Security Manager.
//
// Replaces the former hand-rolled identity stack (Schnorr KeyService + manual
// sign/verify in CryptoService + device-id sessions in UserService). The SM
// handles WebAuthn/BIP39 identity, signs every database operation automatically,
// and drives RBAC — so this store only mirrors its state into Vue and exposes
// the login/registration actions.
//
// Best practice (per GenosDB SM docs): the security-state callback is the single
// source of truth. We never auto-prompt WebAuthn; silent resume is handled by the
// SM on init, and interactive login is reserved for explicit user actions.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '../services/gdbServices'

/** Shape pushed by `db.sm.setSecurityStateChangeCallback`. */
interface SmSecurityState {
  isActive: boolean
  activeAddress: string | null
  abbrAddr: string
  isWebAuthnProtected: boolean
  hasVolatileIdentity: boolean
  hasWebAuthnHardwareRegistration: boolean
}

export const useAuthStore = defineStore('auth', () => {
  const isActive = ref(false)
  const address = ref<string | null>(null)
  const abbrAddr = ref('N/A')
  const isWebAuthnProtected = ref(false)
  const hasVolatileIdentity = ref(false)
  const hasWebAuthnHardware = ref<boolean>(db.sm.hasExistingWebAuthnRegistration())
  /** Volatile mnemonic shown once after registration/recovery — never persisted. */
  const mnemonic = ref<string | null>(null)

  const isLoggedIn = computed(() => isActive.value)

  // Single source of truth: the SM pushes every state change through this callback.
  db.sm.setSecurityStateChangeCallback((s: SmSecurityState) => {
    isActive.value = s.isActive
    address.value = s.activeAddress
    abbrAddr.value = s.abbrAddr
    isWebAuthnProtected.value = s.isWebAuthnProtected
    hasVolatileIdentity.value = s.hasVolatileIdentity
    hasWebAuthnHardware.value = s.hasWebAuthnHardwareRegistration
    if (!s.isActive) mnemonic.value = null
  })

  /**
   * Generate a brand-new identity (Ethereum address + BIP39 mnemonic).
   * The mnemonic is volatile and MUST be saved by the user before navigating away.
   */
  async function generateNewIdentity() {
    const identity = await db.sm.startNewUserRegistration()
    mnemonic.value = identity?.mnemonic ?? null
    return identity
  }

  /** Log in or recover an identity from a BIP39 mnemonic phrase. */
  async function loginWithMnemonic(phrase: string) {
    return db.sm.loginOrRecoverUserWithMnemonic(phrase.trim().toLowerCase())
  }

  /** Interactive WebAuthn login for a previously registered passkey (may prompt). */
  async function loginWithWebAuthn() {
    return db.sm.loginCurrentUserWithWebAuthn()
  }

  /** Protect the current volatile identity with a WebAuthn passkey and start a session. */
  async function protectWithWebAuthn() {
    const addr = await db.sm.protectCurrentIdentityWithWebAuthn()
    if (addr) mnemonic.value = null
    return addr
  }

  /** Log out: deactivate local signing and clear the WebAuthn resume flag. */
  async function logout() {
    await db.sm.clearSecurity()
  }

  return {
    // state
    isActive,
    address,
    abbrAddr,
    isWebAuthnProtected,
    hasVolatileIdentity,
    hasWebAuthnHardware,
    mnemonic,
    isLoggedIn,
    // actions
    generateNewIdentity,
    loginWithMnemonic,
    loginWithWebAuthn,
    protectWithWebAuthn,
    logout,
  }
})
