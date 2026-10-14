import { afterEach, describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import changeLog from './changeLog';

afterEach(() => changeLog.setEnabled(false));

describe('shared changelog visibility', () => {
  it('reacts to navigation opening and the layout closing the singleton repeatedly', () => {
    const navigation = ref(changeLog);
    const layoutVisibility = computed(() => changeLog.enabled);

    expect(layoutVisibility.value).toBe(false);
    navigation.value.setEnabled(true);
    expect(layoutVisibility.value).toBe(true);
    changeLog.enabled = false;
    expect(layoutVisibility.value).toBe(false);
    navigation.value.setEnabled(true);
    expect(layoutVisibility.value).toBe(true);
  });
});
