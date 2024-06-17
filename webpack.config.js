const webpack = require('webpack')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const CopyPlugin = require('copy-webpack-plugin')
const { VueLoaderPlugin } = require('vue-loader')
const { version } = require('./package.json')
const { VuetifyLoaderPlugin } = require('vuetify-loader')
const ESLintPlugin = require('eslint-webpack-plugin')

module.exports = {
  context: __dirname + '/src',
  entry: {
    background: './chrome/background.ts',
    config: './chrome/config.ts',
    content: './chrome/content.ts',
    extension: './chrome/extension.ts',
    inject: './chrome/inject.ts',
    messaging: './chrome/messaging.ts',
    webpage: './chrome/webpage.ts',
  },
  output: {
    path: __dirname + '/dist',
    filename: 'js/[name].js'
  },
  stats: {
    children: false
  },
  experiments: {
    asyncWebAssembly: true,
    syncWebAssembly: true,
  },
  resolve: {
    alias: {
      '@': __dirname + '/src',
      '#': __dirname + '/src/components'
    },
    extensions: ['.ts', '.js', '.wasm'],
    fallback: {
      vm: require.resolve('vm-browserify'),
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts?$/,
        loader: require.resolve('ts-loader'),
        exclude: /node_modules/,
        options: {
          transpileOnly: true,
        },
      },
      {
        test: /\.vue$/,
        loader: 'vue-loader'
      },
      {
        test: /\.js$/,
        loader: 'babel-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              sourceMap: false
            }
          },
          {
            loader: 'postcss-loader',
            options: {
              sourceMap: false
            }
          }
        ]
      },
      {
        test: /\.scss$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          {
            loader: 'sass-loader',
            options: {
              sourceMap: false,
              additionalData: "@import '@/assets/variables.scss';"
            }
          }
        ]
      },
      {
        test: /\.sass$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          {
            loader: 'sass-loader',
            options: {
              implementation: require('sass'),
              sourceMap: false,
              additionalData: "@import '@/assets/variables.scss'",
              sassOptions: {
                indentedSyntax: true // optional
              }
            }
          }
        ]
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg|ico)$/,
        type: 'asset',
        generator: {
          filename: 'images/[name].[ext]'
        }
      },
      {
        test: /\.(woff(2)?|ttf|eot|svg)(\?v=\d+\.\d+\.\d+)?$/,
        type: 'asset',
        generator: {
          filename: 'fonts/[name].[ext]'
        }
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      global: 'window',
      NODE_ENV: 'process.env.NODE_ENV'
    }),
    new VueLoaderPlugin(),
    new VuetifyLoaderPlugin(),
    new MiniCssExtractPlugin({
      filename: '[name].css'
    }),
    new ESLintPlugin({
      extensions: ['.js', '.vue'],
      emitWarning: true,
      emitError: true,
      formatter: undefined
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer'],
    }),
    new CopyPlugin({
      patterns: [
        {
          from: 'assets/img/bkp',
          to: 'assets',
        },
        {
          from: 'manifest.json',
          to: 'manifest.json',
          transform: (content) => {
            const jsonContent = JSON.parse(content)
            jsonContent.version = version

            if (process.env.NODE_ENV === 'development') {
              jsonContent['content_security_policy'] =
                "script-src 'self' 'unsafe-eval'; object-src 'self'"
            }

            return JSON.stringify(jsonContent, null, 2)
          }
        }
      ]
    })
  ]
}
