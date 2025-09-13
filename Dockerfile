# Gebruik Playwright-ready image
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

# Werkdirectory in container
WORKDIR /app

# Installeer dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Kopieer alle projectbestanden
COPY . .

# ✅ Zorg dat public/index.html expliciet wordt meegenomen
COPY public/ public/

# Omgevingsvariabelen
ENV NODE_ENV=production
ENV PORT=8080

# Open poort
EXPOSE 8080

# Start de server
CMD ["node", "server.js"]
