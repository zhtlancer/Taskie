import { computed, unref } from 'vue';
import { isDark } from './theme';

export const useChartInk = () => computed(() => isDark.value
  ? { grid: '#293548', axis: '#475569', muted: '#a8b5c9', secondary: '#cbd5e1', surface: '#111827' }
  : { grid: '#e1e0d9', axis: '#c3c2b7', muted: '#64748b', secondary: '#52514e', surface: '#ffffff' });
export function useChartTheme(options) {
  const ink = useChartInk();
  return computed(() => {
    const value = unref(options);
    return { ...value, color: ink.value.secondary,
      plugins: { ...value.plugins, legend: { ...value.plugins?.legend, labels: { ...value.plugins?.legend?.labels, color: ink.value.secondary } } },
      scales: Object.fromEntries(Object.entries(value.scales || {}).map(([key, scale]) => [key, { ...scale,
        ticks: { ...scale.ticks, color: ink.value.muted }, grid: { ...scale.grid, color: ink.value.grid }, border: { ...scale.border, color: ink.value.axis }
      }]))
    };
  });
}
