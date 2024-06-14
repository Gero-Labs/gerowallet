const CopyPlugin = require('copy-webpack-plugin');
const { defineConfig } = require('@vue/cli-service');
const webpack = require('webpack');
const path = require('path');

module.exports = defineConfig({
  chainWebpack: config => {
    config.plugin('html')
      .tap(args => {
        args[0].title = "GeroWallet | Your Master Key to DeFi";
        return args;
      });
  },
  transpileDependencies: [
    'vuetify'
  ],
  configureWebpack: {
    entry: {
      background: './src/chrome/background.js',
      config: './src/chrome/config.js',
      content: './src/chrome/content.js',
      eventRegistration: './src/chrome/eventRegistration.js',
      extension: './src/chrome/extension.js',
      inject: './src/chrome/inject.js',
      messaging: './src/chrome/messaging.js',
      webpage: './src/chrome/webpage.js',
    },
    output: {
      filename: 'js/[name].js',
      path: path.resolve(__dirname, 'dist')
    },
    experiments: {
      asyncWebAssembly: true,
      syncWebAssembly: true,
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: 'src/assets', to: 'assets' },
          { from: 'src/manifest.json', to: 'manifest.json' },
          { from: 'src/chrome/background.js', to: 'js/background.js' },
          { from: 'src/chrome/config.js', to: 'js/config.js' },
          { from: 'src/chrome/content.js', to: 'js/content.js' },
          { from: 'src/chrome/extension.js', to: 'js/extension.js' },
          { from: 'src/chrome/inject.js', to: 'js/inject.js' },
          { from: 'src/chrome/messaging.js', to: 'js/messaging.js' },
          { from: 'src/chrome/webpage.js', to: 'js/webpage.js' },
        ]
      }),
      new webpack.ProvidePlugin({
        process: 'process/browser',
        Buffer: ['buffer', 'Buffer'],
      })
    ],
    resolve: {
      extensions: ['.ts', '.js', '.wasm'],
      fallback: {
        vm: require.resolve("vm-browserify"),
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        buffer: require.resolve('buffer')
      }
    }
  }
});
