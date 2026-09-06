FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Puerto por defecto de React
EXPOSE 3000

CMD ["npm", "start"]