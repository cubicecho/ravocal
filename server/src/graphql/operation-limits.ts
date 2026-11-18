import { maxAliasesRule } from '@escape.tech/graphql-armor-max-aliases';
import { maxDepthRule } from '@escape.tech/graphql-armor-max-depth';
import { MaxTokensParserWLexer } from '@escape.tech/graphql-armor-max-tokens';
import type { DocumentNode, ExecutionArgs, GraphQLError, ParseOptions, Source, ValidationContext } from 'graphql';
import { fieldExtensionsEstimator, getComplexity, simpleEstimator } from 'graphql-query-complexity';
import type { Plugin } from 'graphql-yoga';
import { OPERATION_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { tooComplex } from '../core/errors.ts';

const { maxTokens, maxDepth, maxAliases, maxCost, defaultFieldCost } = OPERATION_LIMIT_DEFAULTS;

/**
 * Re-reports an armor refusal with our code. Armor's own error has none and reads "Syntax Error: ...".
 *
 * @param context - Validation context. It is null from the token limit, which runs while the document is parsed.
 * @param error - Armor's error.
 * @throws The coded refusal when there is no context, which ends the parse.
 */
function reportCoded(context: ValidationContext | null, error: GraphQLError): void {
  const refusal = tooComplex(error.message.replace(/^Syntax Error: /, ''));
  if (context === null) {
    throw refusal;
  }
  context.reportError(refusal);
}

/** Armor rules report through reportCoded instead of throwing. */
const armor = { propagateOnRejection: false, onReject: [reportCoded] };

/**
 * Prices an operation with its own variables.
 *
 * @param args - Execution args.
 * @returns The cost.
 */
function costOf(args: ExecutionArgs): number {
  return getComplexity({
    schema: args.schema,
    query: args.document,
    operationName: args.operationName ?? undefined,
    variables: args.variableValues ?? {},
    // Field hints first, though the hand-written schema has none yet. Any other field costs `defaultFieldCost`.
    estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: defaultFieldCost })],
    // The library stops at 10,000 nodes with an uncoded error, before maxCost could. maxCost is the bound,
    // and the body cap already bounds how many nodes a document can hold.
    maxQueryNodes: Number.POSITIVE_INFINITY,
  });
}

/** The part of Yoga's execute and subscribe payloads that the cost check uses. */
interface OperationStart {
  args: ExecutionArgs;
  /** Ends the operation with a result of our choosing. */
  setResultAndStopExecution: (result: { errors: GraphQLError[] }) => void;
}

/**
 * Stops an operation that costs more than `maxCost`.
 *
 * @param start - The operation about to run.
 */
function refuseCostly({ args, setResultAndStopExecution }: OperationStart): void {
  const cost = costOf(args);
  if (cost <= maxCost) {
    return;
  }
  const advice = 'Ask for fewer fields or fewer nested lists.';
  setResultAndStopExecution({ errors: [tooComplex(`Query cost ${cost} exceeds ${maxCost}. ${advice}`)] });
}

/**
 * Parses a document, stopping as soon as it passes `maxTokens`.
 *
 * @param source - The document.
 * @param options - graphql-js's parse options, as Yoga passes them.
 * @returns The parsed document.
 */
function parseWithTokenLimit(source: string | Source, options?: ParseOptions): DocumentNode {
  return new MaxTokensParserWLexer(source, { ...options, n: maxTokens, ...armor }).parseDocument();
}

/**
 * Refuses operations that are too long, too deep, too aliased or too costly, before any resolver runs.
 *
 * @returns A Yoga plugin.
 */
export function useOperationLimits(): Plugin {
  return {
    // Before validation, whose repeated-field check is quadratic in the document's length.
    onParse: ({ setParseFn }) => {
      setParseFn(parseWithTokenLimit);
    },
    onValidate: ({ addValidationRule }) => {
      addValidationRule(maxDepthRule({ n: maxDepth, ...armor }));
      addValidationRule(maxAliasesRule({ n: maxAliases, ...armor }));
    },
    // Cost needs the variables, which validation doesn't see, so it's checked when execution starts.
    onExecute: refuseCostly,
    onSubscribe: refuseCostly,
  };
}
