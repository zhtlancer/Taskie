export const parentSections = {
  learning: [
    { to: '/parent/tasks', label: '日常任务' },
    { to: '/parent/recurring-homework', label: '周期作业' },
    { to: '/parent/goals', label: '长期任务' },
    { to: '/parent/word-plans', label: '字词计划' }
  ],
  calendar: [
    { to: '/parent/schedule', label: '学校与课外班' },
    { to: '/parent/calendar', label: '假期与调休' }
  ],
  management: [
    { to: '/parent/children', label: '孩子档案' },
    { to: '/parent/rewards', label: '奖励配置' },
    { to: '/parent/settings', label: '备份与设置' }
  ]
};

export const parentTabs = [
  { to: '/parent/dashboard', label: '总览', paths: ['/parent/dashboard', '/parent/children/'] },
  { to: '/parent/tasks', label: '学习安排', paths: parentSections.learning.map(item => item.to) },
  { to: '/parent/schedule', label: '课程日历', paths: parentSections.calendar.map(item => item.to) },
  { to: '/parent/time-stats', label: '统计', paths: ['/parent/time-stats'] },
  { to: '/parent/children', label: '管理', paths: parentSections.management.map(item => item.to) }
];

export function parentTabActive(tab, path) {
  return tab.paths.some(prefix => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix);
}

// This is a viewing preference, separate from the child's login and from form drafts.
const childKey = 'taskie_parent_child';
export function rememberedParentChild() {
  try { return sessionStorage.getItem(childKey) || ''; } catch { return ''; }
}
export function rememberParentChild(id) {
  try { if (id) sessionStorage.setItem(childKey, id); else sessionStorage.removeItem(childKey); } catch { /* Viewing still works without storage. */ }
}
export function chooseParentChild(children, requested, remembered = rememberedParentChild()) {
  return children.find(child => child.id === requested) || children.find(child => child.id === remembered) || children[0] || null;
}
