FROM node:18-alpine

WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Create curves directory if it doesn't exist
RUN mkdir -p curves

# Expose the port used by the app
EXPOSE 3000

# Start the application
CMD ["node", "node.js"]