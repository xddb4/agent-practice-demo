function taskPriority(a, b) {
  return (
    (a.ddl || '9999-12-31').localeCompare(b.ddl || '9999-12-31') ||
    (a.q ?? 3) - (b.q ?? 3) ||
    (a.duration ?? Infinity) - (b.duration ?? Infinity)
  );
}

function flexibleGroups(list, key) {
  const all = list
    .filter(
      (task) =>
        !task.start && !task.done && !(typeof taskExpired === 'function' && taskExpired(task)),
    )
    .sort(taskPriority);
  const current = all.filter(
    (task) =>
      (!task.done && !task.ddl) ||
      task.date === key ||
      (task.suggested_sessions || []).some((slot) => slot.start?.slice(0, 10) === key) ||
      (!task.done && task.ddl && task.ddl <= key) ||
      (!task.done && task.date && task.date < key),
  );
  const ids = new Set(current.map((task) => task.id));
  return { all, current, other: all.filter((task) => !ids.has(task.id)) };
}
