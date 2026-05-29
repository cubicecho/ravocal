import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "./server/src/schema.graphql",
  generates: {
    "server/src/__generated__/resolvers.ts": {
      plugins: ["typescript", "typescript-resolvers"],
      config: {
        inputMaybeValue: "T | undefined",
        contextType: "../context.ts#Context",
        avoidOptionals: { field: true },
        scalars: {
          DateTime: "string",
        },
      },
    },
  },
};

export default config;
