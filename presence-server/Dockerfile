FROM node:22.12.0-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.js ./
EXPOSE 8787
CMD ["node", "server.js"]
