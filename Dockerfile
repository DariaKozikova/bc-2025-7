# Use a stable Node.js version (Alpine - lightweight version)
FROM node:18-alpine

# Set the environment to development (important for certain libraries)
ENV NODE_ENV development

# Set the working directory inside the container
WORKDIR /app

# Copy dependency definitions first to cache module installation
COPY package*.json ./

# Install dependencies (standard npm install is more reliable for learning purposes)
RUN npm install

# Copy the rest of the project code
COPY . .

# Expose port 3000 (for the server) and 9229 (for the debugger)
EXPOSE 3000
EXPOSE 9229

# Start the dev command (which runs nodemon with --inspect)
CMD ["npm", "run", "dev"]