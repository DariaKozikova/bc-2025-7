# Використовуємо легкий образ Node.js
FROM node:18-alpine

# Робоча директорія
WORKDIR /app

# Копіюємо файли залежностей
COPY package*.json ./

# Встановлюємо залежності (включаючи nodemon, бо ми в режимі dev)
RUN npm install

# Копіюємо код
COPY . .

# Порт
EXPOSE 3000

# Запускаємо через npm script "dev", який викликає nodemon
CMD ["npm", "run", "dev"]