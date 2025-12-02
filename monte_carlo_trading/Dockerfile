# Multi-stage Dockerfile for Vite React app
# Use Node 20 (>=20.19) because Vite requires Node >=20.19 or 22.12+
# node:20.20-alpine is pinned to a compatible Node.js minor version.
## Use the 20.x Node image (latest 20.x minor). Some specific minor tags may not exist on the registry.
FROM node:20-alpine AS build
WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm install

# Copy rest and build
COPY . .
RUN npm run build

# Serve with nginx
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
