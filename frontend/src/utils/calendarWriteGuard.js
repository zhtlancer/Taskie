import { ref } from 'vue';

// Shared with the calendar store, separate from the API to avoid a store/client import cycle.
export const familyDateConfirmed = ref(false);
export const FAMILY_DATE_REQUIRED = '无法确认家庭日期，请重新读取家庭时区后再操作';
export function requireFamilyDate() {
  if (!familyDateConfirmed.value) throw FAMILY_DATE_REQUIRED;
}
