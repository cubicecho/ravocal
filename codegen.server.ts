import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: './server/src/schema.graphql',
  generates: {
    'server/src/__generated__/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        inputMaybeValue: 'T | undefined',
        contextType: '../context.ts#Context',
        avoidOptionals: { field: true },
        // verbatimModuleSyntax and erasableSyntaxOnly: type imports, and unions instead of enums.
        useTypeImports: true,
        enumsAsTypes: true,
        scalars: {
          DateTime: 'string',
        },
      },
    },
  },
};

export default config;
