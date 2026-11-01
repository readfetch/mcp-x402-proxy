# Glama listing health checks — stdio MCP (probe/list works without EVM_PRIVATE_KEY).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json index.mjs url-policy.mjs ./
RUN npm ci --omit=dev --ignore-scripts
ENTRYPOINT ["node", "index.mjs"]
