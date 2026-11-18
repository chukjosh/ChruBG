// Gentle hints about slow devices. They only suggest, never switch anything, and can be dismissed for good.

const HINT_DISMISSED_PREFIX = "chrubg-hint-dismissed-";

/**
 * A rough guess, not a measurement. A device counts as slow when it is a phone or tablet
 * (touch screen) that also has little memory, few processor cores, or no graphics acceleration.
 * Desktops and laptops are never flagged.
 */
function deviceLooksSlow(facts) {
  if (!facts.isTouchDevice) return false;
  const hasLittleMemory = facts.deviceMemory !== undefined && facts.deviceMemory <= 4;
  const hasFewCores = facts.hardwareConcurrency !== undefined && facts.hardwareConcurrency <= 4;
  return hasLittleMemory || hasFewCores || !facts.hasWebGpu;
}

function readDeviceFacts() {
  return {
    isTouchDevice: window.matchMedia("(pointer: coarse)").matches,
    deviceMemory: navigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    hasWebGpu: Boolean(navigator.gpu),
  };
}

function isHintDismissed(hintName) {
  try {
    return localStorage.getItem(HINT_DISMISSED_PREFIX + hintName) === "yes";
  } catch (ignoredStorageError) {
    return false;
  }
}

function dismissHintForGood(hintName) {
  try {
    localStorage.setItem(HINT_DISMISSED_PREFIX + hintName, "yes");
  } catch (ignoredStorageError) {}
}
