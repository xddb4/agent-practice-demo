// Compatibility contract: save() queues a snapshot and returns a boolean immediately.
// Callers that require a confirmed write must also await saveQueue, as before.
let saveQueue = Promise.resolve();

save = function () {
  if (!activeAccount) return false;
  const snapshot = structuredClone({ tasks, evidence });
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => api('state', snapshot, 'PUT'))
    .catch((e) => {
      toast('保存失败：' + e.message + '；当前内容仍保留，请重试');
      throw e;
    });
  return true;
};
