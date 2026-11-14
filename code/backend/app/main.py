"""ASGI application entry point."""
from fastapi.staticfiles import StaticFiles
from .core.application import app
from .core.config import PROJECT_ROOT
from .api.routes import router

app.include_router(router)

frontend = PROJECT_ROOT / 'code' / 'frontend' / 'dist'
if frontend.exists():
    app.mount('/', StaticFiles(directory=frontend, html=True), name='web')

from .api.routes import workflow
