FROM node:22

WORKDIR /app

RUN yarn global add @nestjs/cli

COPY package.json yarn.lock ./
RUN yarn install

COPY . .

USER node

EXPOSE 3000

CMD ["sh", "scripts/run.sh"]