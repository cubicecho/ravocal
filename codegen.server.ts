import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  // The served schema, printed by server/src/schema/write-schema.ts (`npm run codegen:server` runs it first).
  schema: './server/src/__generated__/schema.graphql',
  generates: {
    'server/src/__generated__/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        inputMaybeValue: 'T | undefined',
        contextType: '../core/context.ts#Context',
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
