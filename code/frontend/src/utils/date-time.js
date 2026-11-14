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
