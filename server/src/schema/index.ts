import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { DateTimeResolver } from "graphql-scalars";
import { applyAuthResolvers } from "./resolvers/auth.ts";
import { applyGroupResolvers } from "./resolvers/groups.ts";
import { applyTimeBlockResolvers } from "./resolvers/time-blocks.ts";
import { applyVoteResolvers } from "./resolvers/votes.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const typeDefs = readFileSync(join(__dirname, "../schema.graphql"), "utf-8");

export function buildSchema() {
  const queryFields: Record<string, unknown> = {};
  const mutationFields: Record<string, unknown> = {};

  applyAuthResolvers(queryFields, mutationFields);
  applyGroupResolvers(queryFields, mutationFields);
  applyTimeBlockResolvers(queryFields, mutationFields);
  applyVoteResolvers(queryFields, mutationFields);

  return makeExecutableSchema({
    typeDefs,
    resolvers: {
      DateTime: DateTimeResolver,
      Query: queryFields,
      Mutation: mutationFields,
    },
  });
}
