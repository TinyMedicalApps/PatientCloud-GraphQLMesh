FROM node

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json yarn.lock ./

RUN yarn install

# Bundle app source
COPY . .

EXPOSE 4000
CMD [ "yarn", "start" ]
