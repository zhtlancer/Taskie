import { createRouter, createWebHistory } from 'vue-router';
import ChildSelectView from '../views/ChildSelectView.vue';
import TodayTasksView from '../views/TodayTasksView.vue';
import RewardsView from '../views/RewardsView.vue';
import HistoryView from '../views/HistoryView.vue';
import MistakesView from '../views/MistakesView.vue';
import CharactersView from '../views/CharactersView.vue';
import ParentLoginView from '../views/ParentLoginView.vue';
import ParentDashboardView from '../views/ParentDashboardView.vue';
import ParentChildrenView from '../views/ParentChildrenView.vue';
import ParentTasksView from '../views/ParentTasksView.vue';
import ParentSettingsView from '../views/ParentSettingsView.vue';
import { hasSession } from '../utils/session.js';

const routes = [
  // Child Routes
  {
    path: '/',
    name: 'ChildSelect',
    component: ChildSelectView
  },
  {
    path: '/child/:id/today',
    name: 'TodayTasks',
    component: TodayTasksView
  },
  {
    path: '/child/:id/rewards',
    name: 'Rewards',
    component: RewardsView
  },
  {
    path: '/child/:id/history',
    name: 'History',
    component: HistoryView
  },
  {
    path: '/child/:id/mistakes',
    name: 'Mistakes',
    component: MistakesView
  },
  {
    path: '/child/:id/characters',
    name: 'Characters',
    component: CharactersView
  },

  // Parent Routes
  {
    path: '/parent/login',
    name: 'ParentLogin',
    component: ParentLoginView
  },
  {
    path: '/parent/dashboard',
    name: 'ParentDashboard',
    component: ParentDashboardView
  },
  {
    path: '/parent/children',
    name: 'ParentChildren',
    component: ParentChildrenView
  },
  {
    path: '/parent/tasks',
    name: 'ParentTasks',
    component: ParentTasksView
  },

  // Catch-all redirect
  { path: '/parent/settings', component: ParentSettingsView },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});
router.beforeEach(to => {
  if (to.path.startsWith('/parent/') && to.path !== '/parent/login' && !hasSession('parent')) return '/parent/login';
  if (to.path.startsWith('/child/') && !hasSession('parent') && !hasSession('child', to.params.id)) return '/';
});

export default router;
