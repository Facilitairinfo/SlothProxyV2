FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080
CMD ["node", "server.js"]
