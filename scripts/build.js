const esbuild = require('esbuild');
const fs = require('fs');
fs.mkdirSync('dist', { recursive: true });
esbuild.buildSync({ entryPoints: ['src/channel.js'], bundle: true, platform: 'node', target: 'node18', outfile: 'dist/channel.cjs', logLevel: 'info', legalComments: 'none' });
