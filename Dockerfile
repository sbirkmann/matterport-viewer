# ---- Build the React/Vite viewer ----
FROM node:20-alpine AS build
WORKDIR /app
COPY viewer/package*.json ./viewer/
RUN cd viewer && npm ci
COPY viewer/ ./viewer/
# Der public/model-Symlink ist nur für die lokale Entwicklung; im Container
# werden die Modelldaten separat von nginx ausgeliefert.
RUN rm -f viewer/public/model && cd viewer && npm run build

# ---- Serve build + Modelldaten ----
FROM nginx:alpine
COPY --from=build /app/viewer/dist /usr/share/nginx/html
COPY model/ /usr/share/nginx/html/model/
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
