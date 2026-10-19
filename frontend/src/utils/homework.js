// The name of a homework record's or summary row's course. An outside class that was deleted keeps
// only its title, so it is marked to read apart from a class of the same name made later.
export function courseLabel({ kind, course_kind, subject, class_id }) {
  return (kind ?? course_kind) === 'class' && !class_id ? `${subject}（已删除）` : subject;
}
