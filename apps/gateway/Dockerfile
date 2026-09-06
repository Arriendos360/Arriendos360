FROM node:18-alpine

# Carpeta de trabajo dentro del contenedor
WORKDIR /app

# Copiamos archivos de dependencias
COPY package*.json ./

# Instalamos dependencias
RUN npm install

# Copiamos el resto del código
COPY . .

# Exponemos el puerto definido en tu app.js
EXPOSE 3001

# Comando para arrancar en modo desarrollo
CMD ["npx", "nodemon", "src/app.js"]