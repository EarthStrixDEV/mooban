# Dev image for the Node stack. Dependencies live in /app/node_modules (npm ci, prebuilt sharp);
# the sources are bind-mounted at /app/node, so Node finds the modules by walking up from there.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
WORKDIR /app/node
