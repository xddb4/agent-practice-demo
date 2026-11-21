(async () => {
  try {
    activeAccount = await api('me');
    const s = await api('state');
    tasks = s.tasks;
    evidence = s.evidence;
    taskTrashRecords = s.task_trash || [];
    expiredTaskRecords = s.expired_tasks || [];
    confirmed = [0, 0, 0, 0, 0, 0];
    demoPreview = false;
    render();
  } catch {
    activeAccount = null;
  }
})();

let expirySyncedDay = taskExpiryDay();
let expirySyncing = false;
async function syncExpiredDay() {
  if (!activeAccount || document.hidden || expirySyncing || expirySyncedDay === taskExpiryDay())
    return;
  const owner = activeAccount.id;
  expirySyncing = true;
  try {
    await saveQueue;
    if (owner !== activeAccount?.id) return;
    const before = JSON.stringify({ tasks, evidence, taskTrashRecords });
    const state = await api('state');
    if (
      owner !== activeAccount?.id ||
      before !== JSON.stringify({ tasks, evidence, taskTrashRecords })
    )
      return;
    tasks = state.tasks;
    evidence = state.evidence;
    taskTrashRecords = state.task_trash || [];
    expiredTaskRecords = state.expired_tasks || [];
    expirySyncedDay = taskExpiryDay();
    render();
  } catch {
    // A later visibility change or timer tick retries without discarding local work.
  } finally {
    expirySyncing = false;
  }
}
setInterval(syncExpiredDay, 60000);
document.addEventListener('visibilitychange', syncExpiredDay);
