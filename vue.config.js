const CopyPlugin = require('copy-webpack-plugin');
const { defineConfig } = require('@vue/cli-service');
const webpack = require('webpack');
const path = require('path');

module.exports = defineConfig({
  chainWebpack: config => {
    config.plugin('html')
      .tap(args => {
        args[0].title = "Gero Dashboard Beta | A Multi-chain Light Wallet Merging Web2 and Web3";
        return args;
      });
  },
  transpileDependencies: [
    'vuetify'
  ],
  filenameHashing: true,
  productionSourceMap: false,
  configureWebpack: {
    experiments: {
      asyncWebAssembly: true,
      syncWebAssembly: true,
    },
    plugins: [
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
