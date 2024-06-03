import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'src/background.js',
  output: {
    file: 'dist/background.js',
    format: 'es'
  },
  plugins: [
    nodeResolve()
  ]
};
