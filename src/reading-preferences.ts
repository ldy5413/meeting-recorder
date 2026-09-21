// Only presentation preferences belong here. Meeting data stays behind typed IPC.
const key = "meeting-recorder:reading-v1";
export interface ReadingPreferences {
  comfortable: boolean;
  defaultEvidence: boolean;
}
export function readPreferences(): ReadingPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    return {
      comfortable: value?.comfortable === true,
      defaultEvidence: value?.defaultEvidence !== false,
    };
  } catch {
    return { comfortable: false, defaultEvidence: true };
  }
}
export function savePreferences(value: ReadingPreferences) {
  localStorage.setItem(
    key,
    JSON.stringify({
      comfortable: value.comfortable,
      defaultEvidence: value.defaultEvidence,
    }),
  );
}
