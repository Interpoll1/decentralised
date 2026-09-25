import { ref } from 'vue';
import {
  HumanGateError,
  HumanGateService,
  inputSnapshot,
  startInputTracking,
  type GateAction,
} from '../services/humanGateService';

/**
 * Form-side half of the human gate. Bind `honeypot` to a <HoneypotField>,
 * call `reset()` when the form opens (defaults to creation time) and
 * `check()` right before submitting.
 *
 *   const gate = useHumanGate('post');
 *   async function submit() {
 *     const verdict = gate.check();
 *     if (verdict === 'silent') return fakeSuccess();
 *     if (verdict) return showError(verdict);
 *     ...
 *   }
 *
 * Returns null when the submit may proceed, 'silent' for a honeypot hit (the
 * caller should pretend it worked), or a user-facing message.
 */
export function useHumanGate(action: GateAction) {
  startInputTracking();
  const honeypot = ref('');
  let openedAt = Date.now();
  let inputsAtOpen = inputSnapshot();

  function reset() {
    honeypot.value = '';
    openedAt = Date.now();
    inputsAtOpen = inputSnapshot();
  }

  function check(): null | 'silent' | string {
    try {
      HumanGateService.assertHumanSubmit(action, { honeypot: honeypot.value, openedAt, inputsAtOpen });
      return null;
    } catch (err) {
      if (err instanceof HumanGateError) return err.silent ? 'silent' : err.message;
      throw err;
    }
  }

  return { honeypot, reset, check };
}
