import * as t from "@babel/types";

const debugLogEnabled = false;

const log = {
  debug: (...args: unknown[]) => {
    if (debugLogEnabled) console.debug(...args);
  }
}

const supportedIdentifiers: Record<string, keyof typeof t> = Object.fromEntries(
  Object.keys(t).filter(key => key.startsWith("is")).map(key => [key.replace("is", ""), key as keyof typeof t])
);

type Token = {
  type: string;
  value?: string;
}
type IdentifierToken = {
  type: "identifier";
  value: string;
}

function isIdentifierToken(token: Token | undefined) : token is IdentifierToken {
  if (token == undefined) return false;
  if (token.type != "identifier" && token.type != "wildcard") return false;
  if (!token.value) return false;
  if (!(token.value in supportedIdentifiers) && token.value != "*") {
    throw new Error("Unsupported identifier: " + token.value);
  };
  return true;
}

const whitespace = " \n\r\t";

function isCharacter(c: string) : boolean {
  const charcode = c.charCodeAt(0);
  return (charcode >= 65 && charcode <= 90) || (charcode >= 97 && charcode <= 122);
}

export function tokenize(input: string) : Token[] {
  let s = 0;
  const result = [];
  while (s < input.length) {
    while (whitespace.includes(input[s])) s++;
    if (s >= input.length) break;
    if (input[s] == "/") {
      if (input[s+1] == "/") {
        result.push({type: "descendant"});
        s += 2;
        continue;
      }
      result.push({type: "child"});
      s++;
      continue;
    }
    if (input[s] == ":") {
      result.push({ type : "attributeSelector" });
      s++;
      continue;
    }
    if (input[s] == "$") {
      result.push({ type : "bindingSelector" });
      s++;
      continue;
    }
    if (input[s] == "[") {
      result.push({ type : "filterBegin" });
      s++;
      continue;
    }
    if (input[s] == "]") {
      result.push({ type : "filterEnd" });
      s++;
      continue;
    }
    if (input[s] == "&" && input[s+1] == "&") {
      result.push({ type : "and" });
      s += 2;
      continue;
    }
    if (input[s] == "|" && input[s+1] == "|") {
      result.push({ type : "or" });
      s += 2;
      continue;
    }
    if (input[s] == "=" && input[s+1] == "=") {
      result.push({ type : "eq" });
      s += 2;
      continue;
    }
    if (input[s] == "'" || input[s] == '"') {
      const begin = input[s];
      const start = s;
      s++;
      while (s < input.length && input[s] != begin) s++;
      result.push({ type: "literal", value: input.slice(start + 1, s)});
      s++;
      continue;
    }
    if (input[s] == "." && input[s+1] == ".") {
      result.push({ type: "parent"});
      s += 2;
      continue;
    }
    if (input[s] == "*") {
      result.push({ type: "wildcard", value: "*"});
      s++;
      continue;
    }
    if (isCharacter(input[s])) {
      const start = s;
      while (s < input.length && isCharacter(input[s])) s++;
      result.push({ type: "identifier", value: input.slice(start, s)});
      continue;
    }
    throw new Error("Unexpected token: " + input[s]);
  }
  return result;
}
type BaseNode = {
  type: string;
  attribute?: boolean;
  binding?: boolean;
  filter?: QNode;
  value?: string;
  child?: QNode;
}

export type Selector = BaseNode & ({
  type: "child" | "descendant";
  attribute: boolean;
  binding: boolean;
  value: string;
} | {
  type: "parent"
});

export type Condition = BaseNode & {
  type: "and" | "or" | "equals";
  left: QNode;
  right: QNode;
}
export type Literal = BaseNode & {
  type: "literal";
  value: string;
}

export type QNode = Selector | Condition | Literal;


function buildFilter(tokens: Token[]) : Condition | QNode {
  log.debug("BUILD FILTER", tokens);
  tokens.shift();
  const p = buildTree(tokens);
  const next = tokens[0];
  if (next.type == "and") {
    return {
      type: "and",
      left: p,
      right: buildFilter(tokens)
    };
  }
  if (next.type == "or") {
    return {
      type: "or",
      left: p,
      right: buildFilter(tokens)
    }
  }
  if (next.type == "eq") {
    const right = buildFilter(tokens);
    if (right.type == "or" || right.type == "and") {
      return {
        type: right.type,
        left: {
          type: "equals",
          left: p,
          right: right.left
        },
        right: right.right
      }
    }
    if (right.type == "equals") throw new Error("Unexpected equals in equals");
    return {
      type: "equals",
      left: p,
      right: right
    }
  }
  if (next.type == "filterEnd") {
    tokens.shift();
    return p;
  }
  throw new Error("Unexpected token in filter: " + next?.type);
}

const subNodes = ["child", "descendant"];

function buildTree(tokens: Token[]) : QNode {
  log.debug("BUILD TREE", tokens);
  if (tokens.length == 0) throw new Error("Unexpected end of input");
  const token = tokens.shift();
  if (token == undefined) throw new Error("Unexpected end of input");
  if (token.type == "parent") {
    return {
      type: "parent",
      child: buildTree(tokens)
    }
  }
  if (subNodes.includes(token.type)) {
    let next = tokens.shift();
    if (next?.type == "parent") {
      return { type: "parent", child: buildTree(tokens) };
    }
    const modifiers: Token[] = [];
    while(next && (next?.type == "attributeSelector" || next?.type == "bindingSelector")) {
      modifiers.push(next);
      next = tokens.shift();
    }
    const isAttribute = modifiers.some(m => m.type == "attributeSelector");
    const isBinding = modifiers.some(m => m.type == "bindingSelector");
    if (!next || !next.value || (!isAttribute && !isIdentifierToken(next))) throw new Error("Unexpected or missing token: " + next?.type);
    const identifer = next.value;
    let filter: QNode | undefined = undefined;
    if (tokens.length > 0 && tokens[0].type == "filterBegin") {
      filter = buildFilter(tokens)
      log.debug("FILTER", filter, tokens);
    }
    let child : QNode | undefined = undefined;
    if (tokens.length > 0 && subNodes.includes(tokens[0].type)) {
      child = buildTree(tokens);
    }
    return {
      type: token.type as "child" | "descendant",
      value: identifer,
      attribute: isAttribute,
      binding: isBinding,
      filter: filter,
      child: child
    }
  }
  if (token.type == "literal") {
    return {
      type: "literal",
      value: token.value!
    }
  }
  throw new Error("Unexpected token: " + token.type);
}

export function parse(input: string): QNode {
  const tokens = tokenize(input);
  const result = buildTree(tokens);
  log.debug("RESULT", result);
  if (!result) throw new Error("No root element found");
  return result;
}