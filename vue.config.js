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
      content: './src/content.ts',
      background: './src/background.ts',
      inject: './src/inject.ts'
    },
    output: {
      filename: '[name].js',
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
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        buffer: require.resolve('buffer')
      }
    }
  }
});
