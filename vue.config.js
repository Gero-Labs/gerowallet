const CopyPlugin = require('copy-webpack-plugin')
const { defineConfig } = require('@vue/cli-service')
const webpack = require('webpack');

module.exports = defineConfig({
  chainWebpack: config => {
    config.plugin('html')
        .tap(args => {
          args[0].title = "GeroWallet | Your Master Key to DeFi";
          return args;
        })
  },
  transpileDependencies: [
    'vuetify'
  ],
  configureWebpack: {
    experiments: {
      asyncWebAssembly: true
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: 'src/assets', to: 'assets' },
          { from: 'src/manifest.json', to: 'manifest.json' },
          { from: 'chrome/src/background.js', to: 'background.js' }
        ]
      }),
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
