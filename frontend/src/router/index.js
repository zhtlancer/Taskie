import { createRouter, createWebHistory } from 'vue-router';
import ChildSelectView from '../views/ChildSelectView.vue';
import TodayTasksView from '../views/TodayTasksView.vue';
import RewardsView from '../views/RewardsView.vue';
import HistoryView from '../views/HistoryView.vue';
import MistakesView from '../views/MistakesView.vue';
import WordStudyView from '../views/WordStudyView.vue';
import CharactersView from '../views/CharactersView.vue';
import ScheduleView from '../views/ScheduleView.vue';
import HomeworkView from '../views/HomeworkView.vue';
import ParentLoginView from '../views/ParentLoginView.vue';
import ParentBackfillView from '../views/ParentBackfillView.vue';
import ParentDashboardView from '../views/ParentDashboardView.vue';
import ParentChildrenView from '../views/ParentChildrenView.vue';
import ParentTasksView from '../views/ParentTasksView.vue';
import ParentRewardsView from '../views/ParentRewardsView.vue';
import ParentPeriodsView from '../views/ParentPeriodsView.vue';
import ParentScheduleView from '../views/ParentScheduleView.vue';
import ParentTimeStatsView from '../views/ParentTimeStatsView.vue';
import ParentPinSetupView from '../views/ParentPinSetupView.vue';
import ParentSettingsView from '../views/ParentSettingsView.vue';
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
