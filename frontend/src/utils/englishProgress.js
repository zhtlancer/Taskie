export const ENGLISH_STUDY_SKILLS = [
  { key: 'recognize', label: '认读' }, { key: 'write', label: '默写' }
];

export function englishProgress(entry, skill) {
  const progress = entry?.study_progress?.[skill];
  if (!progress || !['unlearned', 'learning', 'due'].includes(progress.status)) {
    return { status: 'unknown', label: '进度未读取', last_review_date: null, next_due_date: null };
  }
  return { ...progress, label: { unlearned: '未学习', learning: '复习中', due: '今日待复习' }[progress.status] };
}

export function matchesEnglishProgress(entry, skill = 'any', status = 'all') {
  if (status === 'all') return true;
  const skills = skill === 'any' ? ENGLISH_STUDY_SKILLS.map(item => item.key) : [skill];
  return skills.some(key => englishProgress(entry, key).status === status);
}

export function englishStudyLink(childId, skill) {
  return { path: `/child/${childId}/word-study`, query: { language: 'en', skill } };
}
