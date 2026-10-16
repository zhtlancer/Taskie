// A moved lesson keeps the date it was originally scheduled for, even when several lessons of
// the same class land on one day. Older task rows fall back to their board date.
const classLessonKey = lesson => JSON.stringify([lesson.class_id, lesson.class_lesson_date ?? lesson.date]);

module.exports = { classLessonKey };
