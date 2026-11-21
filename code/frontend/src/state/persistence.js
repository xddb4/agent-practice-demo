// Compatibility contract: save() queues a snapshot and returns a boolean immediately.
// Callers that require a confirmed write must also await saveQueue, as before.
let saveQueue = Promise.resolve();

save = function () {
  if (!activeAccount) return false;
  const snapshot = structuredClone({ tasks, evidence });
  const owner = activeAccount.id;
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => api('state', snapshot, 'PUT'))
    .then((result) => {
      if (activeAccount?.id !== owner) return;
      if (Array.isArray(result?.tasks) && JSON.stringify(tasks) === JSON.stringify(snapshot.tasks))
        tasks = result.tasks;
      if (
        Array.isArray(result?.evidence) &&
        JSON.stringify(evidence) === JSON.stringify(snapshot.evidence)
      )
        evidence = result.evidence;
    })
    .catch((e) => {
      toast('保存失败：' + e.message + '；当前内容仍保留，请重试');
      throw e;
    });
  return true;
};
