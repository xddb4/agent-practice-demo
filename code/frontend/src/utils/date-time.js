// Keep the original local-date and noon-based arithmetic to avoid shifting calendar days.
function localDateKey(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function addDays(key, n) {
  let d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDateKey(d);
}
function taskExpiryDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function taskExpired(task, day = taskExpiryDay()) {
  const deadline = String(task.ddl || '').slice(0, 10);
  return !!(!task.start && !task.done && /^\d{4}-\d{2}-\d{2}$/.test(deadline) && deadline < day);
}
