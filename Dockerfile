FROM node:20.16-alpine3.19 AS base

# 작업 디렉토리 변경
WORKDIR /build

# 패키지 파일 build 디렉토리에 복사
COPY package.json yarn.lock ./

# 패키지 설치 및 캐시 초기화 
# npm이라면 RUN npm ci --omit=dev && npm cache clean --force
RUN yarn install --immutable --immutable-cache --check-cache

COPY . .

# 빌드 포트 설정
EXPOSE 4000

# 실행 명령어
CMD ["yarn", "start"]