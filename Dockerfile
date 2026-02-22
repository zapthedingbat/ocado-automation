FROM mcr.microsoft.com/playwright:v1.57.0-jammy

# Set workdir
WORKDIR /opt/ocado-automation/

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application code
COPY ./src ./src/

ENV NODE_ENV=production
ENV HEADLESS=true
ENV API_KEY=change-me-in-production

EXPOSE 3000

CMD ["node", "src/server.js"]
