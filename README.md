# Gero Wallet (Front-end)

## Pre-requisites
1. Make sure you have the updated `.env` file. Contact [@edridudi](https://github.com/edridudi) for the latest variables.
2. Make sure you have the Gero BE docker container running on port 8081.

## How to run Gero BE container
1. Have Using DockerDesktop or Rancher Desktop installed
2. Pull the image from DockerHub:
```
docker pull skyhawkofficial/gero:gerowallet-backend-v1.76
```
3. Run the container
```
docker run -d --name gerowallet-backend --env-file <path to env>  -p 8081:8081 skyhawkofficial/gero:gerowallet-backend-v1.76
```
## Project setup
```
npm install
```

### Compiles and hot-reloads for development
```
npm run serve
```

### Compiles and minifies for production
```
npm run build
```

### Lints and fixes files
```
npm run lint
```

### Customize configuration
See [Configuration Reference](https://cli.vuejs.org/config/).
