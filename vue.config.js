const { defineConfig } = require('@vue/cli-service')
const webpack = require('webpack');

module.exports = defineConfig({
  transpileDependencies: [
    'vuetify'
  ],
  configureWebpack: {
    plugins: [
      // Work around for Buffer is undefined:
      // https://github.com/webpack/changelog-v5/issues/10
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      })
    ],
    resolve: {
      extensions: ['.ts', '.js'],
      fallback: {
        "stream": require.resolve("stream-browserify"),
        "buffer": require.resolve("buffer")
      }
    },
  }
})
