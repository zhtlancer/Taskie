import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { chooseParentChild, rememberParentChild } from '../utils/parentNavigation.js';

export function useParentChildSelection(children, selectedChild, selectChild) {
  const route = useRoute(), router = useRouter();
  watch(() => selectedChild.value?.id, id => { if (id) rememberParentChild(id); }, { flush: 'sync' });
  watch(() => route.query.child, id => {
    const child = children.value.find(child => child.id === id);
    if (child && child.id !== selectedChild.value?.id) selectChild(child);
  });
  return {
    initialChild: () => chooseParentChild(children.value, route.query.child),
    changeChild: child => {
      if (child.id === selectedChild.value?.id) return;
      selectChild(child);
      const { class: linkedClass, date: linkedDate, ...query } = route.query;
      router.replace({ query: { ...query, child: child.id } });
    }
  };
}
