# ws 게임 서버 컨테이너 (Fly.io / Koyeb / Render-Docker 등에서 사용)
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "server"]
