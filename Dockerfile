FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-builder /app/dist ./frontend/dist
COPY deploy/huggingface/start.sh ./start.sh
RUN chmod +x start.sh

RUN mkdir -p /data && chmod 777 /data
ENV DATA_DIR=/data

EXPOSE 7860

CMD ["./start.sh"]
