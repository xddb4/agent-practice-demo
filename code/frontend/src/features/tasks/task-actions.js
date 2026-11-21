// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
function changeQ(id, q) {
  tasks.find((t) => t.id === id).q = +q;
  save();
  render();
  toast('已同步更新每日计划与四象限');
}

function toggle(id) {
  let t = tasks.find((t) => t.id === id);
  t.done = !t.done;
  save();
  render();
}

function dayTasks() {
  return tasks.filter(
    (t) =>
      !taskExpired(t) &&
      (t.date === date ||
        ((t.repeat === '每周' || t.repeat === '每周六') &&
          t.date < date &&
          new Date(t.date).getDay() === new Date(date).getDay())),
  );
}
