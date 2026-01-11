import esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production') || process.env.BUILD === 'production';

const sharedConfig = {
  entryPoints: ['main.ts'],
  bundle: true,
  outfile: 'main.js',
  platform: 'browser',
  format: 'cjs',
  target: 'es2018',
  external: ['obsidian'],
  treeShaking: true,
  sourcemap: isProduction ? false : 'inline',
  minify: isProduction,
  logLevel: 'info'
};

const build = async () => {
  if (isWatch) {
    const ctx = await esbuild.context(sharedConfig);
    await ctx.watch();
    console.log('⚡️ Watching for changes...');
  } else {
    await esbuild.build(sharedConfig);
    console.log('✅ Build complete');
  }
};

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
