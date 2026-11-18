import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  // The served schema, printed by server/src/graphql/write-schema.ts, so better-auth's operations are typed too.
  schema: './server/src/__generated__/schema.graphql',
  documents: ['./app/src/**/*.ts', './app/src/**/*.tsx'],
  ignoreNoDocuments: true,
  generates: {
    'app/src/__generated__/': {
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
      },
      config: {
        avoidOptionals: { field: true },
        useTypeImports: true,
        defaultScalarType: 'unknown',
        nonOptionalTypename: true,
        skipTypeNameForRoot: true,
        scalars: {
          DateTime: 'string',
          UUID: 'string',
        },
      },
    },
  },
};

export default config;
