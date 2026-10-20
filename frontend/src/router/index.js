import { createRouter, createWebHistory } from 'vue-router';
import ChildSelectView from '../views/ChildSelectView.vue';
const TodayTasksView = () => import('../views/TodayTasksView.vue');
const RewardsView = () => import('../views/RewardsView.vue');
const HistoryView = () => import('../views/HistoryView.vue');
const MistakesView = () => import('../views/MistakesView.vue');
const WordStudyView = () => import('../views/WordStudyView.vue');
const CharactersView = () => import('../views/CharactersView.vue');
const ScheduleView = () => import('../views/ScheduleView.vue');
const HomeworkView = () => import('../views/HomeworkView.vue');
const ParentLoginView = () => import('../views/ParentLoginView.vue');
const ParentBackfillView = () => import('../views/ParentBackfillView.vue');
const ParentDashboardView = () => import('../views/ParentDashboardView.vue');
const ParentChildrenView = () => import('../views/ParentChildrenView.vue');
const ParentTasksView = () => import('../views/ParentTasksView.vue');
const ParentRewardsView = () => import('../views/ParentRewardsView.vue');
const ParentPeriodsView = () => import('../views/ParentPeriodsView.vue');
const ParentScheduleView = () => import('../views/ParentScheduleView.vue');
const ParentTimeStatsView = () => import('../views/ParentTimeStatsView.vue');
const ParentPinSetupView = () => import('../views/ParentPinSetupView.vue');
const ParentSettingsView = () => import('../views/ParentSettingsView.vue');
import { hasSession, mustChangePin } from '../utils/session.js';

const routes = [
  // Child Routes
  { path: "/child/:id/word-study", component: WordStudyView },
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
  {
    path: '/child/:id/schedule',
    name: 'Schedule',
    component: ScheduleView
  },
  {
    path: '/child/:id/homework',
    name: 'Homework',
    component: HomeworkView
  },

  // Parent Routes
  { path: "/parent/children/:id/backfill", component: ParentBackfillView },
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
  {
    path: '/parent/setup-pin',
    name: 'ParentPinSetup',
    component: ParentPinSetupView
  },
  {
    path: '/parent/periods',
    name: 'ParentPeriods',
    component: ParentPeriodsView
  },
  {
    path: '/parent/time-stats',
    name: 'ParentTimeStats',
    component: ParentTimeStatsView
  },
  {
    path: '/parent/schedule',
    name: 'ParentSchedule',
    component: ParentScheduleView
  },
  {
    path: '/parent/rewards',
    name: 'ParentRewards',
    component: ParentRewardsView
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
  if (to.path.startsWith('/parent/') && !['/parent/login', '/parent/setup-pin'].includes(to.path) && mustChangePin()) return '/parent/setup-pin';
  if (to.path.startsWith('/child/') && !hasSession('parent') && !hasSession('child', to.params.id)) return '/';
});

export default router;
