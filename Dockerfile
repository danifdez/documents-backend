FROM node:22

WORKDIR /app

RUN yarn global add @nestjs/cli

COPY package.json ./
COPY . .

RUN chown -R node:node /app

# Switch to non-root user
USER node

EXPOSE 3000

CMD ["sh", "scripts/run.sh"]