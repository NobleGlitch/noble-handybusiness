FROM node:20-alpine

# native deps for better-sqlite3 + bcrypt
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/handy.db

EXPOSE 3000

CMD ["node", "server.js"]
