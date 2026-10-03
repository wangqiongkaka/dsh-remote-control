import type { UserConfig } from 'tsdown'

const clientExternals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
]

export default [
  { entry: { index: 'src/index.ts' }, outDir: 'lib', format: 'esm', platform: 'node', clean: false,
    fixedExtension: false, dts: false },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    clean: false,
    fixedExtension: false,
    dts: false,
    external: clientExternals,
    noExternal: ['qrcode', 'dijkstrajs'],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-remote-control", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      codeSplitting: false,
    },
  },
  {
    entry: {
      index: 'src/index.ts',
      'client/index': 'src/client/index.ts',
      'client/keyboard': 'src/client/keyboard.ts',
      'client/drawer-style': 'src/client/drawer-style.ts',
      'client/SidebarDismiss': 'src/client/SidebarDismiss.tsx',
      'client/agent-board': 'src/client/agent-board.ts',
      'client/AgentBoard': 'src/client/AgentBoard.tsx',
      'client/RemoteControlAction': 'src/client/RemoteControlAction.tsx',
      'phone-document': 'src/phone-document.ts',
    },
    outDir: 'dist', format: 'esm', platform: 'node', clean: false,
    fixedExtension: false, dts: true,
    external: [/^@deepseek-ai\//, /^react(?:-dom)?(?:\/|$)/, /^qrcode(?:\/|$)/],
  },
] satisfies UserConfig[]
