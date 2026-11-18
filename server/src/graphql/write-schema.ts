import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printSchema } from 'graphql';

// Prints the schema the server serves, better-auth's endpoints included, so codegen for the app and the server reads
// what /graphql answers rather than the hand-written part of it.

/** Stands in when no DATABASE_URL is set: a fresh clone, CI's check job, the image build. Never connected to. */
const PRINT_ONLY_DATABASE_URL = 'postgres://codegen@localhost/codegen';

// Printing runs no query, and postgres-js connects only on the first one.
process.env.DATABASE_URL ||= PRINT_ONLY_DATABASE_URL;
const { db } = await import('@cubicecho/ravocal-db');
const { createSchema } = await import('./build-schema.ts');

const outputDir = join(dirname(fileURLToPath(import.meta.url)), '../__generated__');
await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, 'schema.graphql'), printSchema(createSchema(db).schema), 'utf-8');
