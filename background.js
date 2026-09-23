// Remove only the dynamic rules earlier builds created (the chat-block 1001-1003
// set). The extension ships no dynamic rules today, and a future build may add its
// own, so this must never wipe the whole dynamic rule set. No-op on fresh installs.
const LEGACY_RULE_IDS = [1001, 1002, 1003];

chrome.runtime.onInstalled.addListener(async () => {
  let existing;
  try {
    existing = await chrome.declarativeNetRequest.getDynamicRules();
  } catch (_) {
    return;
  }
  const present = new Set(existing.map((r) => r.id));
  const removeRuleIds = LEGACY_RULE_IDS.filter((id) => present.has(id));
  if (removeRuleIds.length === 0) return;
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
});
