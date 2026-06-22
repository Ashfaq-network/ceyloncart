FROM oven/bun:latest

WORKDIR /app

# Install system dependencies for Playwright/Chromium
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
    libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests and install packages
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY client/package.json client/bun.lock* ./client/
RUN cd client && bun install --frozen-lockfile

# Copy source code
COPY . .

# Install Playwright Chromium browser binary
RUN bunx playwright install chromium

# Build the client for production
RUN cd client && bun run build

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "server.js"]
