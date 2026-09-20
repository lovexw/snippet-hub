FROM node:20-alpine

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

ENV NODE_ENV=production
EXPOSE 8321

VOLUME ["/app/data"]
CMD ["node", "server.js"]
