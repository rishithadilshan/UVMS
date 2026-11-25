FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
USER node
EXPOSE 5001
CMD ["node","server.js"]
