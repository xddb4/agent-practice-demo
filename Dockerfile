FROM node:22-alpine AS frontend
WORKDIR /build
COPY code/frontend/package.json code/frontend/package-lock.json ./
RUN npm ci
COPY code/frontend ./
RUN npm run build
FROM python:3.12-slim
WORKDIR /app
COPY code/backend/requirements.txt ./
RUN pip install --no-cache-dir --timeout 120 --retries 10 -r requirements.txt
COPY code/backend ./code/backend
COPY code/core_engine ./code/core_engine
RUN mkdir -p /app/logs
COPY --from=frontend /build/dist ./code/frontend/dist
CMD ["uvicorn", "backend.app.main:app", "--app-dir", "code", "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning", "--no-access-log", "--log-config", "code/backend/logging.json"]
