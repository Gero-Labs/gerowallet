import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/background.js',
  output: {
    file: 'dist/background.js',
    format: 'es'
  },
  plugins: [
    nodeResolve(),
    typescript()
  ]
};
