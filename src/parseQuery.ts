import type { AvailableFunction } from ".";
import { isAvailableFunction } from ".";
import { VISITOR_KEYS } from "./nodeutils";

const debugLogEnabled = false;

const log = debugLogEnabled ? {
  debug: (...args: unknown[]) => {
    console.debug(...args);
  }
} : undefined;

// Optimize: create supportedIdentifiers directly instead of Object.fromEntries + map
const visitorKeys = Object.keys(VISITOR_KEYS);
const supportedIdentifiers: Record<string, keyof typeof VISITOR_KEYS> = {};
for (let i = 0; i < visitorKeys.length; i++) {
  const k = visitorKeys[i];
  supportedIdentifiers[k] = k as keyof typeof VISITOR_KEYS;
}

export enum TokenType {
  IDENTIFIER,
  WILDCARD,
  DESCENDANT,
  CHILD,
  PARENT,
  AND,
  OR,
  EQUALS,
  LITERAL,
  ATTRIBUTESELECTOR,
  RESOLVESELECTOR,
  BINDINGSELECTOR,
  FILTERBEGIN,
  FILTEREND,
  SEPARATOR,
  PARAMETERSBEGIN,
  PARAMETERSEND,
  FUNCTION 
}

export const NodeType = { 
  PARENT : 0xf1, 
  CHILD : 0xf2, 
  DESCENDANT : 0xf3,
  AND : 0xf4,
  OR : 0xf5,
  EQUALS : 0xf6,
  LITERAL : 0xf7,
  FUNCTION : 0xf8
} as const;



type Token = {
  tokenType: TokenType;
  value?: string;
}
type IdentifierToken = {
  tokenType: TokenType.IDENTIFIER;
  value: string;
}

function isIdentifierToken(token: Token | undefined) : token is IdentifierToken {
  if (token == undefined) return false;
  if (token.tokenType != TokenType.IDENTIFIER && token.tokenType != TokenType.WILDCARD) return false;
  if (!token.value) return false;
  if (!(token.value in supportedIdentifiers) && token.value != "*") {
    throw new Error("Unsupported identifier: " + token.value);
  };
  return true;
}

const whitespace = " \n\r\t";

function isCharacter(charcode: number) : boolean {
  return (charcode >= 65 && charcode <= 90) || (charcode >= 97 && charcode <= 122);
}
function isInteger(charcode: number) : boolean {
  return (charcode >= 48 && charcode <= 57);
}

export function tokenize(input: string) : Token[] {
  let s = 0;
  const result = [] as Token[];
  while (s < input.length) {
    while (whitespace.includes(input[s])) s++;
    if (s >= input.length) break;
    if (input[s] == "/") {
      if (input[s+1] == "/") {
        result.push({tokenType: TokenType.DESCENDANT});
        s += 2;
        continue;
      }
      result.push({tokenType: TokenType.CHILD});
      s++;
      continue;
    }
    if (input[s] == ":") {
      result.push({ tokenType : TokenType.ATTRIBUTESELECTOR });
      s++;
      continue;
    }
    if (input[s] == "$" && input[s+1] == "$") {
      result.push({ tokenType : TokenType.RESOLVESELECTOR });
      s+=2;
      continue;
    }
    if (input[s] == "$") {
      result.push({ tokenType : TokenType.BINDINGSELECTOR });
      s++;
      continue;
    }
    if (input[s] == "[") {
      result.push({ tokenType : TokenType.FILTERBEGIN });
      s++;
      continue;
    }
    if (input[s] == "]") {
      result.push({ tokenType : TokenType.FILTEREND });
      s++;
      continue;
    }
    if (input[s] == ",") {
      result.push({ tokenType : TokenType.SEPARATOR });
      s++;
      continue;
    }
    if (input[s] == "(") {
      result.push({ tokenType : TokenType.PARAMETERSBEGIN });
      s++;
      continue;
    }
    if (input[s] == "f" && input[s+1] == "n" && input[s+2] == ":") {
      result.push({ tokenType : TokenType.FUNCTION });
      s += 3;
      continue;
    }
    if (input[s] == ")") {
      result.push({ tokenType : TokenType.PARAMETERSEND });
      s++;
      continue;
    }
    if (input[s] == "&" && input[s+1] == "&") {
      result.push({ tokenType : TokenType.AND });
      s += 2;
      continue;
    }
    if (input[s] == "|" && input[s+1] == "|") {
      result.push({ tokenType : TokenType.OR });
      s += 2;
      continue;
    }
    if (input[s] == "=" && input[s+1] == "=") {
      result.push({ tokenType : TokenType.EQUALS });
      s += 2;
      continue;
    }
    if (input[s] == "'" || input[s] == '"') {
      const begin = input[s];
      const start = s;
      s++;
      while (s < input.length && input[s] != begin) s++;
      result.push({ tokenType: TokenType.LITERAL, value: input.slice(start + 1, s)});
      s++;
      continue;
    }
    if (input[s] == "." && input[s+1] == ".") {
      result.push({ tokenType: TokenType.PARENT});
      s += 2;
      continue;
    }
    if (input[s] == "*") {
      result.push({ tokenType: TokenType.WILDCARD, value: "*"});
      s++;
      continue;
    }
    const charCode = input.charCodeAt(s);
    if (isCharacter(charCode)) {
      const start = s;
      while (s < input.length && isCharacter(input.charCodeAt(s))) s++;
      result.push({ tokenType: TokenType.IDENTIFIER, value: input.slice(start, s)});
      continue;
    }
    if (isInteger(charCode)) {
      const start = s;
      while (s < input.length && isInteger(input.charCodeAt(s))) s++;
      result.push({ tokenType: TokenType.LITERAL, value: input.slice(start, s)});
      continue;
    }
    throw new Error("Unexpected token: " + input[s]);
  }
  return result;
}
type BaseNode = {
  attribute?: boolean;
  binding?: boolean;
  resolve?: boolean;
  filter?: QNode;
  value?: string;
  child?: QNode;
}




export type Selector = BaseNode & ({
  type: typeof NodeType.CHILD | typeof NodeType.DESCENDANT;
  attribute: boolean;
  binding: boolean;
  value: string;
  resolve: boolean;
} | {
  type: typeof NodeType.PARENT
});

export type Condition = BaseNode & {
  type: typeof NodeType.AND | typeof NodeType.OR | typeof NodeType.EQUALS;
  left: QNode;
  right: QNode;
}
export type Literal = BaseNode & {
  type: typeof NodeType.LITERAL;
  value: string;
}

export type FunctionCall = BaseNode & {
  type: typeof NodeType.FUNCTION;
  function: AvailableFunction;
  parameters: QNode[];
}

export type QNode = Selector | Condition | Literal | FunctionCall ;


function buildFilter(tokens: Token[]) : Condition | QNode {
  log?.debug("BUILD FILTER", tokens);
  tokens.shift();
  const p = buildTree(tokens);
  const next = tokens[0];
  if (next.tokenType == TokenType.AND) {
    return {
      type: NodeType.AND,
      left: p,
      right: buildFilter(tokens)
    };
  }
  if (next.tokenType == TokenType.OR) {
    return {
      type: NodeType.OR,
      left: p,
      right: buildFilter(tokens)
    }
  }
  if (next.tokenType == TokenType.EQUALS) {
    const right = buildFilter(tokens);
    if (right.type == NodeType.OR || right.type == NodeType.AND) {
      return {
        type: right.type,
        left: {
          type: NodeType.EQUALS,
          left: p,
          right: right.left
        },
        right: right.right
      }
    }
    if (right.type == NodeType.EQUALS) throw new Error("Unexpected equals in equals");
    return {
      type: NodeType.EQUALS,
      left: p,
      right: right
    }
  }
  if (next.tokenType == TokenType.FILTEREND) {
    tokens.shift();
    return p;
  }
  throw new Error("Unexpected token in filter: " + next?.tokenType);
}



const subNodes = [TokenType.CHILD, TokenType.DESCENDANT];

function buildTree(tokens: Token[]) : QNode {
  log?.debug("BUILD TREE", tokens);
  if (tokens.length == 0) throw new Error("Unexpected end of input");
  const token = tokens.shift();
  if (token == undefined) throw new Error("Unexpected end of input");
  if (token.tokenType == TokenType.PARENT) {
    return {
      type: NodeType.PARENT,
      child: buildTree(tokens)
    }
  }
  if (subNodes.includes(token.tokenType)) {
    let next = tokens.shift();
    if (next?.tokenType == TokenType.FUNCTION) {
      const name = tokens.shift();
      if (name == undefined || name.tokenType != TokenType.IDENTIFIER || name.value == undefined || typeof(name.value) != "string") throw new Error("Unexpected token: " + name?.tokenType + ". Expecting function name");
      const value = name.value;
      if (!isAvailableFunction(value)) {
        throw new Error("Unsupported function: " + name.value);
      }
      return buildFunctionCall(value, tokens);
    }

    if (next?.tokenType == TokenType.PARENT) {
      return { type: NodeType.PARENT, child: buildTree(tokens) };
    }
    const modifiers: Token[] = [];
    while(next && (next?.tokenType == TokenType.ATTRIBUTESELECTOR || next?.tokenType == TokenType.BINDINGSELECTOR || next?.tokenType == TokenType.RESOLVESELECTOR)) {
      modifiers.push(next);
      next = tokens.shift();
    }
    const isAttribute = modifiers.some(m => m.tokenType == TokenType.ATTRIBUTESELECTOR);
    const isBinding = modifiers.some(m => m.tokenType == TokenType.BINDINGSELECTOR);
    const isResolve = modifiers.some(m => m.tokenType == TokenType.RESOLVESELECTOR);
    if (isResolve && isBinding) throw new Error("Cannot have both resolve and binding");
    if (!next || !next.value || (!isAttribute && !isIdentifierToken(next))) throw new Error("Unexpected or missing token: " + next?.tokenType);
    const identifer = next.value;
    let filter: QNode | undefined = undefined;
    if (tokens.length > 0 && tokens[0].tokenType == TokenType.FILTERBEGIN) {
      filter = buildFilter(tokens)
      log?.debug("FILTER", filter, tokens);
    }
    let child : QNode | undefined = undefined;
    if (tokens.length > 0 && subNodes.includes(tokens[0].tokenType)) {
      child = buildTree(tokens);
    }
    if (typeof(identifer) != "string") throw new Error("Identifier must be a string");
    let nodeType: typeof NodeType.CHILD | typeof NodeType.DESCENDANT = NodeType.CHILD;
    if (token.tokenType == TokenType.DESCENDANT) {
      nodeType = NodeType.DESCENDANT;
    } else if (token.tokenType != TokenType.CHILD) {
      throw new Error("Unexpected token:" + token.tokenType)
    }
    return {
      type: nodeType,
      value: identifer,
      attribute: isAttribute,
      binding: isBinding,
      resolve: isResolve,
      filter: filter,
      child: child
    }
  }
  if (token.tokenType == TokenType.LITERAL) {
    return {
      type: NodeType.LITERAL,
      value: token.value!
    }
  }
  throw new Error("Unexpected token: " + token.tokenType);
}

function buildFunctionCall(name: AvailableFunction, tokens: Token[]) : QNode {
  log?.debug("BUILD FUNCTION", name, tokens);
  const parameters: QNode[] = [];
  const next = tokens.shift();
  if (next?.tokenType != TokenType.PARAMETERSBEGIN) throw new Error("Unexpected token: " + next?.tokenType);
  while (tokens.length > 0 && tokens[0].tokenType != TokenType.PARAMETERSEND) {
    parameters.push(buildTree(tokens));
    if (tokens[0].tokenType == TokenType.SEPARATOR) tokens.shift();
  }
  if (tokens.length == 0) throw new Error("Unexpected end of input");
  tokens.shift();
  return {
    type: NodeType.FUNCTION,
    function: name,
    parameters: parameters
  }
}

export function parse(input: string): QNode {
  const tokens = tokenize(input);
  const result = buildTree(tokens);
  log?.debug("RESULT", result);
  if (!result) throw new Error("No root element found");
  return result;
}
