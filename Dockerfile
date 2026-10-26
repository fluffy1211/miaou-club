FROM node:26.12.0-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY . .
FROM dependencies AS development
EXPOSE 4321
CMD ["npm", "run", "dev:docker"]
FROM dependencies AS build
RUN npm run build
FROM build AS production-dependencies
# npm retains Drizzle Kit as Better Auth's optional peer. It is a schema-generation
# tool, not a runtime dependency; migrations use the compiled ORM migrator.
RUN npm prune --omit=dev --omit=peer && rm -rf node_modules/drizzle-kit node_modules/@esbuild-kit
FROM node:26.12.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/start.mjs /app/server/client-ip.mjs /app/server/proxy-probe.mjs ./server/
COPY --from=build --chown=node:node /app/packages/contracts ./packages/contracts
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn*
USER node
EXPOSE 4321
CMD ["node", "server/start.mjs"]
