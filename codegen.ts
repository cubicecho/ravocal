import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "./server/src/schema.graphql",
  documents: ["./app/src/**/*.ts", "./app/src/**/*.tsx"],
  ignoreNoDocuments: true,
  generates: {
    "app/src/__generated__/": {
      preset: "client",
      presetConfig: {
        fragmentMasking: false,
      },
      config: {
        avoidOptionals: { field: true },
        useTypeImports: true,
        defaultScalarType: "unknown",
        nonOptionalTypename: true,
        skipTypeNameForRoot: true,
        scalars: {
          DateTime: "string",
        },
      },
    },
  },
};

export default config;
