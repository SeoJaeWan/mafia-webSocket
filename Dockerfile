FROM node:20.16-alpine3.19 as build

# 작업 디렉토리 변경
WORKDIR /build

# 패키지 파일 build 디렉토리에 복사
COPY package.json yarn.lock ./

# 패키지 설치 및 캐시 초기화 
# npm이라면 RUN npm ci --omit=dev && npm cache clean --force
RUN yarn install && yarn cache clean

COPY . .

RUN yarn build

# 빌드 파일을 복사
FROM node:20.16-alpine3.19 as production

WORKDIR /app

# 패키지 파일 복사
COPY package.json yarn.lock ./

# 패키지 설치 및 캐시 초기화
RUN yarn install --production && yarn cache clean

# 빌드 파일 복사
COPY --from=build /build/dist ./dist

# 빌드 포트 설정
EXPOSE 4000

# 실행 명령어
CMD ["node", "dist/app.js"]