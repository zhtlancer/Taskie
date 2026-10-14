const shiftDate = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

// Plot at most 90 days of actual progress, including goals that run for multiple years.
export function goalChartDates(goal, today) {
  const last = goal.completed_on || (goal.end_date && goal.end_date < today ? goal.end_date : today);
  const start = [goal.start_date, shiftDate(last, -89)].sort().at(-1);
  const dates = [];
  for (let date = start; date <= last; date = shiftDate(date, 1)) dates.push(date);
  return dates;
}
