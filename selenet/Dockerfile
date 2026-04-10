FROM python:3.12-slim AS backend-base

WORKDIR /app/backend

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/worker ./worker


FROM backend-base AS backend

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]


FROM backend-base AS worker

CMD ["python", "worker/worker.py"]


FROM node:20-alpine AS frontend

WORKDIR /app/frontend

COPY frontend/package.json ./package.json
RUN npm install

COPY frontend/. .

EXPOSE 5173

CMD ["npm", "run", "dev"]