(async () => {
  try {
    activeAccount = await api('me');
    const s = await api('state');
    tasks = s.tasks;
    evidence = s.evidence;
    confirmed = [0, 0, 0, 0, 0, 0];
    demoPreview = false;
    render();
  } catch {
    activeAccount = null;
  }
})();
