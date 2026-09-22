# Usamos una imagen ligera de Node.js como base 
FROM node:20-alpine

#Creamos la carpeta donde viviria la app dentro del contenedor
WORKDIR /usr/src/app

#Copiamos primero el package.json para instalar las dependencias
#(Hacerlo asi optimiza la cache de Docker)
COPY package*.json ./ 

#Instalamos las dependencias
RUN npm install 

#Copiamos el resto del codigo (en este caso, index.js)
COPY . . 

#Exponemos el puerto que usa nuestra app 
EXPOSE 3000

#COMANDOS PARA INICIAR EN MODO DESARROLLO (usando nodemon)
CMD [ "npm", "run", "dev" ]