// Install workspace navigation and lifecycle events, then render the initial screen.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLandingDistortion();
  else if (!activeAccount && !landingMotionPaused) startLandingDistortion();
});

StudyPilotRouter.bindNavigation();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

render();
