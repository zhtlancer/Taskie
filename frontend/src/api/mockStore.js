// Local reactive fallback store when backend is unavailable or during demo/offline preview

const STORAGE_KEY = 'homework_app_state_v2';

const defaultBadges = [
  {
    id: 'badge-first-complete',
    key: 'first_complete',
    name: '初出茅庐',
    description: '第一次完成任务',
    icon_emoji: '🌟',
    condition_type: 'first_complete',
    condition_value: 1
  },
  {
    id: 'badge-streak-3',
    key: 'streak_3',
    name: '三连击',
    description: '连续3天完成任务',
    icon_emoji: '🔥',
    condition_type: 'streak_days',
    condition_value: 3
  },
  {
    id: 'badge-streak-7',
    key: 'streak_7',
    name: '一周勇士',
    description: '连续7天完成任务',
    icon_emoji: '🚀',
    condition_type: 'streak_days',
    condition_value: 7
  },
  {
    id: 'badge-streak-30',
    key: 'streak_30',
    name: '月度冠军',
    description: '连续30天完成任务',
    icon_emoji: '👑',
    condition_type: 'streak_days',
    condition_value: 30
  },
  {
    id: 'badge-points-100',
    key: 'points_100',
    name: '小富翁',
    description: '累计积分≥100',
    icon_emoji: '💰',
    condition_type: 'total_points',
    condition_value: 100
  },
  {
    id: 'badge-points-500',
    key: 'points_500',
    name: '积分达人',
    description: '累计积分≥500',
    icon_emoji: '💎',
    condition_type: 'total_points',
    condition_value: 500
  },
  {
    id: 'badge-all-done-once',
    key: 'all_done_once',
    name: '全勤王',
    description: '第一次完成当天所有任务',
    icon_emoji: '✅',
    condition_type: 'all_done_count',
    condition_value: 1
  },
  {
    id: 'badge-all-done-10',
    key: 'all_done_10',
    name: '优秀学生',
    description: '10次完成当天所有任务',
    icon_emoji: '🏆',
    condition_type: 'all_done_count',
    condition_value: 10
  }
];

function getTodayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekBoundaries(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  // distance to Monday (if Sunday 0, dist is -6)
  const distToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + distToMon);

  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);

  const toStr = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const dayVal = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${dayVal}`;
  };

  return {
    start: toStr(mon),
    end: toStr(sun)
  };
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getInitialState() {
  const today = getTodayString();
  const child1Id = 'child-demo-1';
  const child2Id = 'child-demo-2';

  const templates = [
    {
      id: 'tmpl-1',
      title: '语文朗读 10分钟',
      subject: '语文',
      schedule_type: 'fixed_days',
      days_of_week: [1, 2, 3, 4, 5],
      weekly_target_times: null,
      points: 10,
      created_at: new Date().toISOString()
    },
    {
      id: 'tmpl-2',
      title: '数学练习册 P20',
      subject: '数学',
      schedule_type: 'fixed_days',
      days_of_week: [1, 2, 3, 4, 5],
      weekly_target_times: null,
      points: 10,
      created_at: new Date().toISOString()
    },
    {
      id: 'tmpl-3',
      title: '英语单词 背诵20个',
      subject: '英语',
      schedule_type: 'fixed_days',
      days_of_week: [1, 2, 3, 4, 5],
      weekly_target_times: null,
      points: 15,
      created_at: new Date().toISOString()
    },
    {
      id: 'tmpl-4',
      title: '课外阅读 20页',
      subject: '其他',
      schedule_type: 'weekly_times',
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      weekly_target_times: 4,
      points: 15,
      created_at: new Date().toISOString()
    },
    {
      id: 'tmpl-5',
      title: '跳绳运动 300个',
      subject: '其他',
      schedule_type: 'weekly_times',
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      weekly_target_times: 3,
      points: 10,
      created_at: new Date().toISOString()
    },
    {
      id: 'tmpl-6',
      title: '整理书包与桌面',
      subject: '其他',
      schedule_type: 'fixed_days',
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      weekly_target_times: null,
      points: 10,
      created_at: new Date().toISOString()
    }
  ];

  const dailyTasks = templates.map((t, idx) => ({
    id: `dt-${child1Id}-${idx + 1}`,
    child_id: child1Id,
    template_id: t.id,
    title: t.title,
    subject: t.subject,
    schedule_type: t.schedule_type,
    weekly_target_times: t.weekly_target_times,
    points: t.points,
    date: today,
    is_completed: idx < 2, // first 2 completed for initial demo
    completed_at: idx < 2 ? new Date().toISOString() : null
  }));

  const pointLogs = [
    { id: 'pl-1', child_id: child1Id, daily_task_id: dailyTasks[0].id, points: 10, title: '语文朗读 10分钟', earned_at: new Date(Date.now() - 3600000).toISOString() },
    { id: 'pl-2', child_id: child1Id, daily_task_id: dailyTasks[1].id, points: 10, title: '数学练习册 P20', earned_at: new Date(Date.now() - 1800000).toISOString() },
    { id: 'pl-3', child_id: child1Id, daily_task_id: null, points: 15, title: '昨日英语听力打卡', earned_at: new Date(Date.now() - 86400000).toISOString() },
    { id: 'pl-4', child_id: child1Id, daily_task_id: null, points: 20, title: '连续打卡额外奖励', earned_at: new Date(Date.now() - 172800000).toISOString() }
  ];

  const childBadges = [
    {
      id: 'cb-1',
      child_id: child1Id,
      badge_id: 'badge-first-complete',
      unlocked_at: new Date(Date.now() - 86400000 * 5).toISOString(),
      ...defaultBadges[0]
    },
    {
      id: 'cb-2',
      child_id: child1Id,
      badge_id: 'badge-streak-3',
      unlocked_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      ...defaultBadges[1]
    }
  ];

  const mistakes = [
    {
      id: 'm-1',
      child_id: child1Id,
      subject: '数学',
      description: '计算题：84 ÷ 4 - 3 × 5，混淆了混合运算顺序，漏写括号。',
      photo_path: null,
      is_mastered: false,
      created_at: new Date(Date.now() - 86400000).toISOString(),
      mastered_at: null
    },
    {
      id: 'm-2',
      child_id: child1Id,
      subject: '语文',
      description: '生字听写：“蜿蜒”两个字的偏旁部首写错成三点水。',
      photo_path: null,
      is_mastered: true,
      created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
      mastered_at: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 'm-3',
      child_id: child1Id,
      subject: '英语',
      description: '单词辨析：quiet 和 quite 拼写弄混。',
      photo_path: null,
      is_mastered: false,
      created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
      mastered_at: null
    }
  ];

  const characters = [
    {
      id: 'char-1',
      child_id: child1Id,
      char: '学',
      pinyin: 'xué',
      strokes: 8,
      radical: '子',
      is_mastered: true,
      created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
      mastered_at: new Date(Date.now() - 86400000 * 2).toISOString()
    },
    {
      id: 'char-2',
      child_id: child1Id,
      char: '生',
      pinyin: 'shēng',
      strokes: 5,
      radical: '生',
      is_mastered: true,
      created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
      mastered_at: new Date(Date.now() - 86400000 * 1).toISOString()
    },
    {
      id: 'char-3',
      child_id: child1Id,
      char: '字',
      pinyin: 'zì',
      strokes: 6,
      radical: '宀',
      is_mastered: false,
      created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
      mastered_at: null
    },
    {
      id: 'char-4',
      child_id: child1Id,
      char: '笔',
      pinyin: 'bǐ',
      strokes: 10,
      radical: '竹',
      is_mastered: false,
      created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      mastered_at: null
    },
    {
      id: 'char-5',
      child_id: child1Id,
      char: '画',
      pinyin: 'huà',
      strokes: 8,
      radical: '田',
      is_mastered: false,
      created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
      mastered_at: null
    },
    {
      id: 'char-6',
      child_id: child1Id,
      char: '书',
      pinyin: 'shū',
      strokes: 4,
      radical: '乛',
      is_mastered: true,
      created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
      mastered_at: new Date(Date.now() - 86400000 * 1).toISOString()
    },
    {
      id: 'char-7',
      child_id: child1Id,
      char: '写',
      pinyin: 'xiě',
      strokes: 5,
      radical: '冖',
      is_mastered: false,
      created_at: new Date(Date.now() - 3600000 * 12).toISOString(),
      mastered_at: null
    },
    {
      id: 'char-8',
      child_id: child1Id,
      char: '春',
      pinyin: 'chūn',
      strokes: 9,
      radical: '日',
      is_mastered: false,
      created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
      mastered_at: null
    }
  ];

  return {
    children: [
      { id: child1Id, name: '小明', avatar_emoji: '🐱', pin: '1234', has_pin: true, streak: 5, created_at: new Date().toISOString() },
      { id: child2Id, name: '小红', avatar_emoji: '🐰', pin: null, has_pin: false, streak: 2, created_at: new Date().toISOString() }
    ],
    task_templates: templates,
    daily_tasks: dailyTasks,
    point_logs: pointLogs,
    child_badges: childBadges,
    badge_definitions: defaultBadges,
    mistakes: mistakes,
    characters: characters,
    reward_items: getDefaultRewardItems(),
    reward_redemptions: [],
    parent_pin: '1234'
  };
}

function getDefaultRewardItems() {
  const created_at = new Date().toISOString();
  return [
    { id: 'reward-1', title: '看30分钟动画', icon_emoji: '📺', cost: 50, is_active: true, created_at },
    { id: 'reward-2', title: '周末去公园玩', icon_emoji: '🎡', cost: 150, is_active: true, created_at },
    { id: 'reward-3', title: '挑选一个小玩具', icon_emoji: '🧸', cost: 300, is_active: true, created_at }
  ];
}

class MockStore {
  constructor() {
    this.load();
  }

  load() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        this.state = JSON.parse(data);
        if (!this.state.characters) {
          const init = getInitialState();
          this.state.characters = init.characters;
          this.save();
        }
        if (!this.state.reward_items) {
          this.state.reward_items = getDefaultRewardItems();
          this.state.reward_redemptions = [];
          this.save();
        }
      } else {
        this.state = getInitialState();
        this.save();
      }
    } catch {
      this.state = getInitialState();
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn('Could not save to localStorage:', e);
    }
  }

  // Auth
  childLogin(childId, pin) {
    const child = this.state.children.find(c => c.id === childId);
    if (!child) return { success: false, error: '孩子账号不存在' };
    if (child.pin && child.pin !== pin) {
      return { success: false, error: 'PIN 码错误' };
    }
    return { success: true, child: { id: child.id, name: child.name, avatar_emoji: child.avatar_emoji } };
  }

  parentLogin(pin) {
    if (pin === this.state.parent_pin) {
      return { success: true, role: 'parent' };
    }
    return { success: false, error: '家长 PIN 码错误' };
  }

  // Children
  getChildren() {
    return this.state.children.map(c => ({
      id: c.id,
      name: c.name,
      avatar_emoji: c.avatar_emoji,
      has_pin: Boolean(c.pin),
      created_at: c.created_at
    }));
  }

  createChild({ name, avatar_emoji, pin }) {
    const id = 'child-' + Date.now();
    const newChild = {
      id,
      name: name.trim(),
      avatar_emoji: avatar_emoji || '🐱',
      pin: pin ? String(pin).trim() : null,
      has_pin: Boolean(pin),
      streak: 0,
      created_at: new Date().toISOString()
    };
    this.state.children.push(newChild);
    this.save();
    return newChild;
  }

  updateChild(id, { name, avatar_emoji, pin }) {
    const child = this.state.children.find(c => c.id === id);
    if (!child) throw new Error('Child not found');
    if (name) child.name = name.trim();
    if (avatar_emoji) child.avatar_emoji = avatar_emoji;
    if (pin !== undefined) {
      child.pin = pin ? String(pin).trim() : null;
      child.has_pin = Boolean(child.pin);
    }
    this.save();
    return child;
  }

  deleteChild(id) {
    this.state.children = this.state.children.filter(c => c.id !== id);
    this.state.daily_tasks = this.state.daily_tasks.filter(t => t.child_id !== id);
    this.state.point_logs = this.state.point_logs.filter(p => p.child_id !== id);
    this.state.child_badges = this.state.child_badges.filter(b => b.child_id !== id);
    this.state.mistakes = this.state.mistakes.filter(m => m.child_id !== id);
    for (const t of this.state.task_templates) {
      if (Array.isArray(t.child_ids)) t.child_ids = t.child_ids.filter(childId => childId !== id);
    }
    this.save();
    return { success: true, id };
  }

  // Task templates
  getTemplates() {
    return this.state.task_templates.map(t => ({
      ...t,
      schedule_type: t.schedule_type || 'fixed_days',
      weekly_target_times: t.weekly_target_times || null,
      child_ids: t.child_ids ?? null
    }));
  }

  createTemplate({ title, subject, schedule_type = 'fixed_days', days_of_week, weekly_target_times, points, child_ids = null }) {
    const newTmpl = {
      id: 'tmpl-' + Date.now(),
      title: title.trim(),
      subject: subject.trim(),
      schedule_type: schedule_type || 'fixed_days',
      days_of_week: days_of_week || [0, 1, 2, 3, 4, 5, 6],
      weekly_target_times: schedule_type === 'weekly_times' ? (Number(weekly_target_times) || 3) : null,
      points: Number(points) || 10,
      child_ids,
      created_at: new Date().toISOString()
    };
    this.state.task_templates.push(newTmpl);
    this.save();
    return newTmpl;
  }

  updateTemplate(id, { title, subject, schedule_type, days_of_week, weekly_target_times, points, child_ids }) {
    const tmpl = this.state.task_templates.find(t => t.id === id);
    if (!tmpl) throw new Error('Template not found');
    if (title) tmpl.title = title.trim();
    if (subject) tmpl.subject = subject.trim();
    if (schedule_type) tmpl.schedule_type = schedule_type;
    if (days_of_week) tmpl.days_of_week = days_of_week;
    if (weekly_target_times !== undefined) {
      tmpl.weekly_target_times = tmpl.schedule_type === 'weekly_times' ? (Number(weekly_target_times) || 3) : null;
    }
    if (points !== undefined) tmpl.points = Number(points);
    if (child_ids !== undefined) {
      tmpl.child_ids = child_ids;
      this.removeUnassignedTodayTasks();
    }
    this.save();
    return tmpl;
  }

  deleteTemplate(id) {
    const template = this.state.task_templates.find(t => t.id === id);
    for (const task of this.state.daily_tasks.filter(t => t.template_id === id)) {
      task.source_template_id ||= id;
      task.template_created_at ||= template?.created_at;
      task.template_id = null;
    }
    this.state.task_templates = this.state.task_templates.filter(t => t.id !== id);
    this.save();
    return { success: true, id };
  }

  getWeeklyCompletedCount(childId, templateId, date) {
    if (!templateId) return 0;
    const { start, end } = getWeekBoundaries(date || getTodayString());
    return this.state.daily_tasks.filter(t =>
      t.child_id === childId &&
      (t.source_template_id ?? t.template_id) === templateId &&
      t.schedule_type === 'weekly_times' &&
      t.date >= start &&
      t.date <= end &&
      t.is_completed
    ).length;
  }

  // Daily Tasks
  isUnassignedTodayTask(task) {
    if (task.date !== getTodayString()) return false;
    const template = this.state.task_templates.find(t => t.id === task.template_id);
    return Array.isArray(template?.child_ids) && !template.child_ids.includes(task.child_id);
  }

  removeUnassignedTodayTasks() {
    this.state.daily_tasks = this.state.daily_tasks.filter(t => t.is_completed || !this.isUnassignedTodayTask(t));
  }

  getDailyTasks(childId, date) {
    const targetDate = date || getTodayString();
    if (targetDate === getTodayString()) this.removeUnassignedTodayTasks();
    let tasks = this.state.daily_tasks.filter(t => t.child_id === childId && t.date === targetDate);
    {
      // Auto-generate from templates
      const d = new Date(targetDate);
      const dayOfWeek = d.getDay(); // 0 is Sunday
      const matchingTemplates = this.state.task_templates.filter(t => {
        if (tasks.some(task => task.template_id === t.id)) return false;
        if (Array.isArray(t.child_ids) && !t.child_ids.includes(childId)) return false;
        // Weekly tasks without a day list (older demo data) may be done any day.
        if (t.schedule_type === 'weekly_times' && !Array.isArray(t.days_of_week)) return true;
        return Array.isArray(t.days_of_week) && t.days_of_week.includes(dayOfWeek);
      });

      const generated = matchingTemplates.map(t => ({
        id: `dt-${childId}-${targetDate}-${t.id}-${Date.now()}`,
        child_id: childId,
        template_id: t.id,
        source_template_id: t.id,
        template_created_at: t.created_at,
        title: t.title,
        subject: t.subject,
        schedule_type: t.schedule_type || 'fixed_days',
        weekly_target_times: t.weekly_target_times || null,
        points: t.points,
        date: targetDate,
        is_completed: false,
        completed_at: null
      }));
      this.state.daily_tasks.push(...generated);
      tasks.push(...generated);
      this.save();
    }

    // Attach real-time computed weekly completed count for weekly tasks
    return tasks.map(t => {
      const tmpl = this.state.task_templates.find(tpl => tpl.id === t.template_id);
      const schedType = t.schedule_type || tmpl?.schedule_type || 'fixed_days';
      const targetTimes = t.weekly_target_times || tmpl?.weekly_target_times || null;
      const weeklyCompleted = schedType === 'weekly_times'
        ? this.getWeeklyCompletedCount(childId, t.source_template_id ?? t.template_id, targetDate)
        : null;

      if (schedType !== 'weekly_times') {
        return { ...t, schedule_type: schedType, weekly_target_times: targetTimes, weekly_completed_times: weeklyCompleted, is_optional: false };
      }
      // Same rule as the server: optional while times still needed (from earlier days) < days left incl. today.
      const { start } = getWeekBoundaries(targetDate);
      const doneBefore = this.state.daily_tasks.filter(d => d.child_id === childId &&
        (d.source_template_id ?? d.template_id ?? d.id) === (t.source_template_id ?? t.template_id ?? t.id) &&
        d.schedule_type === 'weekly_times' && d.is_completed && d.date >= start && d.date < targetDate).length;
      // Today plus the remaining days this week the task may still be done.
      const allowedDays = Array.isArray(tmpl?.days_of_week) ? tmpl.days_of_week : [0, 1, 2, 3, 4, 5, 6];
      const weekdayOf = date => new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekEnd = addDays(targetDate, (7 - weekdayOf(targetDate)) % 7);
      let daysLeft = 1;
      for (let date = addDays(targetDate, 1); date <= weekEnd; date = addDays(date, 1)) {
        if (allowedDays.includes(weekdayOf(date))) daysLeft++;
      }
      const target = targetTimes || 1;
      return {
        ...t,
        schedule_type: schedType,
        weekly_target_times: targetTimes,
        weekly_completed_times: weeklyCompleted,
        weekly_remaining_times: Math.max(0, target - weeklyCompleted),
        week_days_left: daysLeft,
        is_optional: target - doneBefore < daysLeft
      };
    });
  }

  completeTask(taskId) {
    const task = this.state.daily_tasks.find(t => t.id === taskId);
    if (!task) throw new Error('Task not found');
    if (task.is_completed) return { success: true, task, points_earned: 0, new_badges: [] };
    if (this.isUnassignedTodayTask(task)) throw new Error('任务已取消分配，请刷新今日任务');

    task.is_completed = true;
    task.completed_at = new Date().toISOString();

    // Add point log
    const log = {
      id: 'pl-' + Date.now(),
      child_id: task.child_id,
      daily_task_id: task.id,
      points: task.points,
      title: task.title,
      earned_at: task.completed_at
    };
    this.state.point_logs.unshift(log);

    // Check badges
    const newBadges = this.checkBadges(task.child_id);
    this.save();

    const tmpl = this.state.task_templates.find(tpl => tpl.id === task.template_id);
    const weeklyCount = this.getWeeklyCompletedCount(task.child_id, task.source_template_id ?? task.template_id, task.date);

    return {
      success: true,
      task: {
        ...task,
        schedule_type: task.schedule_type || tmpl?.schedule_type || 'fixed_days',
        weekly_target_times: task.weekly_target_times || tmpl?.weekly_target_times || null,
        weekly_completed_times: weeklyCount
      },
      points_earned: task.points,
      new_badges: newBadges
    };
  }

  uncompleteTask(taskId) {
    const task = this.state.daily_tasks.find(t => t.id === taskId);
    if (!task) throw new Error('Task not found');
    const earned = this.state.point_logs.filter(p => p.daily_task_id === taskId).reduce((sum, p) => sum + p.points, 0);
    if (this.getAvailablePoints(task.child_id) < earned) throw '这项任务的积分已用于兑换奖励，不能取消打卡';
    task.is_completed = false;
    task.completed_at = null;
    this.state.point_logs = this.state.point_logs.filter(p => p.daily_task_id !== taskId);
    this.removeUnassignedTodayTasks();
    this.save();

    const tmpl = this.state.task_templates.find(tpl => tpl.id === task.template_id);
    const weeklyCount = this.getWeeklyCompletedCount(task.child_id, task.source_template_id ?? task.template_id, task.date);

    return {
      success: true,
      task: {
        ...task,
        schedule_type: task.schedule_type || tmpl?.schedule_type || 'fixed_days',
        weekly_target_times: task.weekly_target_times || tmpl?.weekly_target_times || null,
        weekly_completed_times: weeklyCount
      }
    };
  }

  // Child stats
  getChildStats(childId) {
    const today = getTodayString();
    const tasks = this.getDailyTasks(childId, today);
    const completedTasks = tasks.filter(t => t.is_completed);
    const totalPoints = this.state.point_logs
      .filter(p => p.child_id === childId)
      .reduce((sum, p) => sum + p.points, 0);

    const todayPoints = this.state.point_logs
      .filter(p => p.child_id === childId && p.earned_at.startsWith(today))
      .reduce((sum, p) => sum + p.points, 0);

    const child = this.state.children.find(c => c.id === childId);
    const streak = child ? (child.streak || 5) : 5;

    return {
      total_points: totalPoints,
      available_points: this.getAvailablePoints(childId),
      current_streak: streak,
      today_total_tasks: tasks.length,
      today_completed_tasks: completedTasks.length,
      today_completion_rate: tasks.length > 0 ? Number((completedTasks.length / tasks.length).toFixed(2)) : 0,
      today_points: todayPoints
    };
  }

  getChildBadges(childId) {
    return this.state.child_badges.filter(b => b.child_id === childId);
  }

  getBadgeDefinitions() {
    return this.state.badge_definitions;
  }

  checkBadges(childId) {
    const unlockedIds = new Set(this.state.child_badges.filter(b => b.child_id === childId).map(b => b.badge_id));
    const stats = this.getChildStats(childId);
    const newBadges = [];

    for (const b of this.state.badge_definitions) {
      if (unlockedIds.has(b.id)) continue;
      let eligible = false;
      if (b.key === 'first_complete' && stats.today_completed_tasks >= 1) eligible = true;
      if (b.condition_type === 'total_points' && stats.total_points >= b.condition_value) eligible = true;
      if (b.condition_type === 'streak_days' && stats.current_streak >= b.condition_value) eligible = true;

      if (eligible) {
        const item = {
          id: 'cb-' + Date.now() + '-' + b.key,
          child_id: childId,
          badge_id: b.id,
          unlocked_at: new Date().toISOString(),
          ...b
        };
        this.state.child_badges.push(item);
        newBadges.push(item);
      }
    }
    return newBadges;
  }

  // History
  getHistory(childId, days = 7) {
    const history = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayTasks = this.state.daily_tasks.filter(t => t.child_id === childId && t.date === dateStr);
      const completed = dayTasks.filter(t => t.is_completed).length;
      const total = dayTasks.length || 5;
      const points = completed * 10 || 40;

      history.push({
        date: dateStr,
        day_of_week: d.getDay(),
        total_tasks: total,
        completed_tasks: completed || (i === 0 ? 3 : 4),
        completion_rate: total > 0 ? Number(((completed || (i === 0 ? 3 : 4)) / total).toFixed(2)) : 0.8,
        points_earned: points
      });
    }
    return history;
  }

  // Mistakes
  getMistakes(childId, subject) {
    return this.state.mistakes.filter(m => {
      const matchChild = !childId || m.child_id === childId;
      const matchSub = !subject || subject === '全部' || m.subject === subject;
      return matchChild && matchSub;
    });
  }

  createMistake({ child_id, subject, description, photo_path }) {
    const newMistake = {
      id: 'm-' + Date.now(),
      child_id,
      subject: subject || '数学',
      description: description.trim(),
      photo_path: photo_path || null,
      is_mastered: false,
      created_at: new Date().toISOString(),
      mastered_at: null
    };
    this.state.mistakes.unshift(newMistake);
    this.save();
    return newMistake;
  }

  markMistakeMastered(id, isMastered = true) {
    const mistake = this.state.mistakes.find(m => m.id === id);
    if (!mistake) throw new Error('Mistake not found');
    mistake.is_mastered = isMastered;
    mistake.mastered_at = isMastered ? new Date().toISOString() : null;
    this.save();
    return mistake;
  }

  deleteMistake(id) {
    this.state.mistakes = this.state.mistakes.filter(m => m.id !== id);
    this.save();
    return { success: true, id };
  }

  // Characters (生字本)
  getCharacters(childId, isMastered = null) {
    if (!this.state.characters) this.state.characters = [];
    return this.state.characters
      .filter(c => {
        const matchChild = !childId || c.child_id === childId;
        const matchMastered = isMastered === null || isMastered === undefined ||
          (isMastered === 1 || isMastered === true || isMastered === '1' ? Boolean(c.is_mastered) : !c.is_mastered);
        return matchChild && matchMastered;
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  createCharacter({ child_id, char, pinyin, strokes, radical }) {
    if (!this.state.characters) this.state.characters = [];
    if (!char || !child_id) {
      throw new Error('缺少汉字或孩子ID');
    }
    const cleanChar = char.trim()[0];
    const existing = this.state.characters.find(c => c.child_id === child_id && c.char === cleanChar);
    if (existing) {
      const err = new Error(`生字「${cleanChar}」已在生字本中`);
      err.status = 409;
      throw err;
    }

    const newChar = {
      id: 'char-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      child_id,
      char: cleanChar,
      pinyin: pinyin || '',
      strokes: strokes ? Number(strokes) : 0,
      radical: radical || '',
      is_mastered: false,
      created_at: new Date().toISOString(),
      mastered_at: null
    };
    this.state.characters.unshift(newChar);
    this.save();
    return newChar;
  }

  markCharacterMastered(id, isMastered = null) {
    if (!this.state.characters) this.state.characters = [];
    const item = this.state.characters.find(c => c.id === id);
    if (!item) throw new Error('生字未找到');

    const nextMastered = isMastered !== null && isMastered !== undefined
      ? Boolean(isMastered === 1 || isMastered === true || isMastered === '1')
      : !item.is_mastered;

    item.is_mastered = nextMastered;
    item.mastered_at = nextMastered ? new Date().toISOString() : null;
    this.save();
    return item;
  }

  deleteCharacter(id) {
    if (!this.state.characters) this.state.characters = [];
    this.state.characters = this.state.characters.filter(c => c.id !== id);
    this.save();
    return { success: true, id };
  }

  getPointLogs(childId) {
    return this.state.point_logs.filter(p => !childId || p.child_id === childId);
  }

  // Weekly completion as of today (mirrors the server): fixed-day tasks owe one unit per scheduled
  // day so far; weekly tasks owe what can no longer be made up; unopened days are projected.
  getWeeklyCompletion(childId, weekStart, asOf = getTodayString()) {
    const weekEnd = addDays(weekStart, 6);
    const cutoff = asOf < weekEnd ? asOf : weekEnd;
    if (cutoff < weekStart) return { as_of: cutoff, total_units: 0, completed_units: 0, completion_rate: null, items: [] };
    let daysAfterCutoff = 0;
    for (let date = cutoff; date < weekEnd; date = addDays(date, 1)) daysAfterCutoff++;
    const child = this.state.children.find(c => c.id === childId);
    const sinceDate = iso => {
      if (!iso) return '0000-00-00';
      const date = new Date(iso);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    const childSince = sinceDate(child?.created_at);
    const rows = this.state.daily_tasks.filter(t => t.child_id === childId && t.date >= weekStart && t.date <= cutoff);
    const templates = this.state.task_templates.filter(t => !Array.isArray(t.child_ids) || t.child_ids.includes(childId));
    const templatesById = new Map(this.state.task_templates.map(t => [t.id, t]));
    const items = new Map();
    const sourceId = source => source.source_template_id ?? source.template_id ?? (source.date ? null : source.id);
    const keyFor = source => JSON.stringify([sourceId(source) ?? `row:${source.id}`, source.schedule_type || 'fixed_days']);
    const itemFor = (key, source) => {
      if (!items.has(key)) {
        const id = sourceId(source);
        items.set(key, { key, template_id: id, title: source.title, subject: source.subject,
          schedule_type: source.schedule_type || 'fixed_days', total: 0, completed: 0, target: 0, done: 0,
          since: sinceDate(source.template_created_at || templatesById.get(id)?.created_at), legacyOrphan: id === null });
      }
      return items.get(key);
    };
    const opened = new Set(rows.map(r => r.date));
    for (let date = weekStart; date <= cutoff; date = addDays(date, 1)) {
      if (opened.has(date)) {
        for (const r of rows.filter(r => r.date === date && r.schedule_type !== 'weekly_times')) {
          const item = itemFor(keyFor(r), r);
          item.total++;
          if (r.is_completed) item.completed++;
        }
      } else if (date >= childSince) {
        const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
        for (const t of templates) {
          if (t.schedule_type !== 'weekly_times' && t.days_of_week?.includes(dayOfWeek) && sinceDate(t.created_at) <= date) itemFor(keyFor(t), t).total++;
        }
      }
    }
    for (const r of rows.filter(r => r.schedule_type === 'weekly_times')) {
      const item = itemFor(keyFor(r), r);
      item.target = item.legacyOrphan ? 1 : r.weekly_target_times || 1;
      if (r.is_completed) item.done++;
    }
    if (cutoff >= childSince) {
      for (const t of templates) {
        if (t.schedule_type === 'weekly_times' && sinceDate(t.created_at) <= cutoff && !items.has(keyFor(t))) itemFor(keyFor(t), t).target = t.weekly_target_times || 1;
      }
    }
    const list = [...items.values()].map(({ target, done, since, legacyOrphan, ...item }) => {
      if (item.schedule_type !== 'weekly_times') return item;
      const completed = Math.min(done, target);
      const start = [weekStart, childSince, since].sort().at(-1);
      let availableDays = 0;
      for (let date = start; date <= weekEnd; date = addDays(date, 1)) availableDays++;
      const effectiveTarget = Math.min(target, availableDays);
      return { ...item, total: legacyOrphan ? completed : Math.max(completed, effectiveTarget - daysAfterCutoff, 0), completed, weekly_target: target };
    }).filter(item => item.total > 0);
    const total = list.reduce((sum, i) => sum + i.total, 0);
    const completed = list.reduce((sum, i) => sum + i.completed, 0);
    return { as_of: cutoff, total_units: total, completed_units: completed, completion_rate: total > 0 ? Number((completed / total).toFixed(2)) : null, items: list };
  }

  getWeeklySummary(childId) {
    const today = getTodayString();
    const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay();
    const start = addDays(today, dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    const week = weekStart => ({ start_date: weekStart, end_date: addDays(weekStart, 6), completion: this.getWeeklyCompletion(childId, weekStart) });
    return { current_week: week(start), last_week: week(addDays(start, -7)) };
  }

  // Rewards shop (mirrors the server: pending requests hold points)
  getAvailablePoints(childId) {
    const earned = this.state.point_logs.filter(p => p.child_id === childId).reduce((sum, p) => sum + p.points, 0);
    const spent = (this.state.reward_redemptions || [])
      .filter(r => r.child_id === childId && ['pending', 'approved'].includes(r.status))
      .reduce((sum, r) => sum + r.cost, 0);
    return earned - spent;
  }

  getRewardItems() {
    return [...(this.state.reward_items || [])].sort((a, b) => a.cost - b.cost);
  }

  createRewardItem({ title, icon_emoji = '🎁', cost }) {
    if (!title?.trim() || !Number.isSafeInteger(cost) || cost < 1) throw '请填写奖励名称和有效的所需积分';
    const item = { id: 'reward-' + Date.now(), title: title.trim(), icon_emoji, cost, is_active: true, created_at: new Date().toISOString() };
    (this.state.reward_items ||= []).push(item);
    this.save();
    return item;
  }

  updateRewardItem(id, changes) {
    const item = (this.state.reward_items || []).find(i => i.id === id);
    if (!item) throw '奖励不存在';
    for (const key of ['title', 'icon_emoji', 'cost', 'is_active']) if (changes[key] !== undefined) item[key] = changes[key];
    this.save();
    return item;
  }

  deleteRewardItem(id) {
    this.state.reward_items = (this.state.reward_items || []).filter(i => i.id !== id);
    this.save();
    return { success: true, id };
  }

  getRedemptions({ childId, status, limit = 200, offset = 0 } = {}) {
    return (this.state.reward_redemptions || [])
      .filter(r => (!childId || r.child_id === childId) &&
        (!status || (status === 'history' ? r.status !== 'pending' : r.status === status)))
      .map(r => {
        const child = this.state.children.find(c => c.id === r.child_id);
        return { ...r, child_name: child?.name, child_avatar_emoji: child?.avatar_emoji };
      })
      .sort((a, b) => b.requested_at.localeCompare(a.requested_at) || b.id.localeCompare(a.id))
      .slice(offset, offset + limit);
  }

  requestRedemption(childId, rewardId) {
    const item = (this.state.reward_items || []).find(i => i.id === rewardId && i.is_active);
    if (!item) throw '奖励不存在或已下架';
    const available = this.getAvailablePoints(childId);
    if (available < item.cost) throw `积分不足：还差 ${item.cost - available} 分`;
    const redemption = {
      id: 'redeem-' + Date.now(), child_id: childId, reward_id: item.id, title: item.title, icon_emoji: item.icon_emoji,
      cost: item.cost, status: 'pending', requested_at: new Date().toISOString(), resolved_at: null
    };
    (this.state.reward_redemptions ||= []).push(redemption);
    this.save();
    return redemption;
  }

  resolveRedemption(id, status) {
    const redemption = (this.state.reward_redemptions || []).find(r => r.id === id);
    if (!redemption) throw '兑换记录不存在';
    if (redemption.status !== 'pending') throw '该兑换申请已处理';
    redemption.status = status;
    redemption.resolved_at = new Date().toISOString();
    this.save();
    return redemption;
  }
}

export const mockStore = new MockStore();
