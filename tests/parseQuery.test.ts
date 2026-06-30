import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, parse, Condition, FunctionCall, NodeType, TokenType } from '../src/parseQuery';

describe('tokenization', () => {
  
  test('single descendant', () => {
    const tokens = tokenize("//abc");
    assert.deepStrictEqual(tokens.length, 2);
    assert.deepStrictEqual(tokens[0], { tokenType: TokenType.DESCENDANT });
    assert.deepStrictEqual(tokens[1], { tokenType:  TokenType.IDENTIFIER, value: "abc" });
  });
  test('single child', () => {
    const tokens = tokenize("/abc");
    assert.deepStrictEqual(tokens.length, 2);
    assert.deepStrictEqual(tokens[0], { tokenType: TokenType.CHILD });
    assert.deepStrictEqual(tokens[1], { tokenType: TokenType.IDENTIFIER, value: "abc" });
  });
  test('two children', () => {
    const tokens = tokenize("/abc/def");
    assert.deepStrictEqual(tokens.length, 4);
    assert.deepStrictEqual(tokens[0], { tokenType: TokenType.CHILD });
    assert.deepStrictEqual(tokens[1], { tokenType: TokenType.IDENTIFIER, value: "abc" });
    assert.deepStrictEqual(tokens[2], { tokenType: TokenType.CHILD });
    assert.deepStrictEqual(tokens[3], { tokenType: TokenType.IDENTIFIER, value: "def" });
  });
  test('attribute', () => {
    const tokens = tokenize("/:abc");
    assert.deepStrictEqual(tokens.length, 3);
    assert.deepStrictEqual(tokens[0], { tokenType: TokenType.CHILD });
    assert.deepStrictEqual(tokens[1], { tokenType: TokenType.ATTRIBUTESELECTOR });
    assert.deepStrictEqual(tokens[2], { tokenType: TokenType.IDENTIFIER, value: "abc" });
  });
  test('single filter', () => {
    const tokens = tokenize("/abc[/def]");
    assert.deepStrictEqual(tokens.length, 6);
    assert.deepStrictEqual(tokens[0], { tokenType: TokenType.CHILD });
    assert.deepStrictEqual(tokens[1], { tokenType: TokenType.IDENTIFIER, value: "abc" });
    assert.deepStrictEqual(tokens[2], { tokenType: TokenType.FILTERBEGIN});
    assert.deepStrictEqual(tokens[3], { tokenType: TokenType.CHILD});
    assert.deepStrictEqual(tokens[4], { tokenType: TokenType.IDENTIFIER, value: "def" });
    assert.deepStrictEqual(tokens[5], { tokenType: TokenType.FILTEREND});
  });
  test('and filter', () => {
    const tokens = tokenize("/abc[/def && /ghi]");
    assert.deepStrictEqual(tokens.length, 9);
    assert.deepStrictEqual(tokens[0], { tokenType: TokenType.CHILD });
    assert.deepStrictEqual(tokens[1], { tokenType: TokenType.IDENTIFIER, value: "abc" });
    assert.deepStrictEqual(tokens[2], { tokenType: TokenType.FILTERBEGIN});
    assert.deepStrictEqual(tokens[3], { tokenType: TokenType.CHILD});
    assert.deepStrictEqual(tokens[4], { tokenType: TokenType.IDENTIFIER, value: "def" });
    assert.deepStrictEqual(tokens[5], { tokenType: TokenType.AND});
    assert.deepStrictEqual(tokens[6], { tokenType: TokenType.CHILD});
    assert.deepStrictEqual(tokens[7], { tokenType: TokenType.IDENTIFIER, value: "ghi" });
    assert.deepStrictEqual(tokens[8], { tokenType: TokenType.FILTEREND});
  });
  test('or filter', () => {
    const tokens = tokenize("/abc[/def || /ghi]");
    assert.deepStrictEqual(tokens.length, 9);
    assert.deepStrictEqual(tokens[0], { tokenType: TokenType.CHILD });
    assert.deepStrictEqual(tokens[1], { tokenType: TokenType.IDENTIFIER, value: "abc" });
    assert.deepStrictEqual(tokens[2], { tokenType: TokenType.FILTERBEGIN});
    assert.deepStrictEqual(tokens[3], { tokenType: TokenType.CHILD});
    assert.deepStrictEqual(tokens[4], { tokenType: TokenType.IDENTIFIER, value: "def" });
    assert.deepStrictEqual(tokens[5], { tokenType: TokenType.OR});
    assert.deepStrictEqual(tokens[6], { tokenType: TokenType.CHILD});
    assert.deepStrictEqual(tokens[7], { tokenType: TokenType.IDENTIFIER, value: "ghi" });
    assert.deepStrictEqual(tokens[8], { tokenType: TokenType.FILTEREND});
  });
  test('== filter', () => {
    const tokens = tokenize("/abc[/def == '12 3']");
    assert.deepStrictEqual(tokens.length, 8);
    assert.deepStrictEqual(tokens[0], { tokenType: TokenType.CHILD });
    assert.deepStrictEqual(tokens[1], { tokenType: TokenType.IDENTIFIER, value: "abc" });
    assert.deepStrictEqual(tokens[2], { tokenType: TokenType.FILTERBEGIN});
    assert.deepStrictEqual(tokens[3], { tokenType: TokenType.CHILD});
    assert.deepStrictEqual(tokens[4], { tokenType: TokenType.IDENTIFIER, value: "def" });
    assert.deepStrictEqual(tokens[5], { tokenType: TokenType.EQUALS});
    assert.deepStrictEqual(tokens[6], { tokenType: TokenType.LITERAL, value: "12 3" });
    assert.deepStrictEqual(tokens[7], { tokenType: TokenType.FILTEREND});
  });
  test('child filter child', () => {
    const tokens = tokenize("/abc[/def]/ghi");
    assert.deepStrictEqual(tokens.length, 8);
    assert.deepStrictEqual(tokens[0], { tokenType: TokenType.CHILD });
    assert.deepStrictEqual(tokens[1], { tokenType: TokenType.IDENTIFIER, value: "abc" });
    assert.deepStrictEqual(tokens[2], { tokenType: TokenType.FILTERBEGIN});
    assert.deepStrictEqual(tokens[3], { tokenType: TokenType.CHILD});
    assert.deepStrictEqual(tokens[4], { tokenType: TokenType.IDENTIFIER, value: "def" });
    assert.deepStrictEqual(tokens[5], { tokenType: TokenType.FILTEREND});
    assert.deepStrictEqual(tokens[6], { tokenType: TokenType.CHILD});
    assert.deepStrictEqual(tokens[7], { tokenType: TokenType.IDENTIFIER, value: "ghi" });
  });
  test('nested filter child', () => {
    const tokens = tokenize("/abc[/def[/ghi]]");
    assert.deepStrictEqual(tokens.length, 10);
    assert.deepStrictEqual(tokens[0], { tokenType: TokenType.CHILD });
    assert.deepStrictEqual(tokens[1], { tokenType: TokenType.IDENTIFIER, value: "abc" });
    assert.deepStrictEqual(tokens[2], { tokenType: TokenType.FILTERBEGIN});
    assert.deepStrictEqual(tokens[3], { tokenType: TokenType.CHILD});
    assert.deepStrictEqual(tokens[4], { tokenType: TokenType.IDENTIFIER, value: "def" });
    assert.deepStrictEqual(tokens[5], { tokenType: TokenType.FILTERBEGIN});
    assert.deepStrictEqual(tokens[6], { tokenType: TokenType.CHILD});
    assert.deepStrictEqual(tokens[7], { tokenType: TokenType.IDENTIFIER, value: "ghi" });
    assert.deepStrictEqual(tokens[8], { tokenType: TokenType.FILTEREND});
    assert.deepStrictEqual(tokens[9], { tokenType: TokenType.FILTEREND});
  });
});


describe('testing index file', () => {
  test('dummy', () => {})

  test('single descendant', () => {
    const node = parse("//FunctionDeclaration");
    assert.partialDeepStrictEqual(node, { type: NodeType.DESCENDANT, value: "FunctionDeclaration" });
  });
  test('single child', () => {
    const node = parse("/FunctionDeclaration");
    assert.partialDeepStrictEqual(node, { type: NodeType.CHILD, value: "FunctionDeclaration" });
  });
  
  test('single child', () => {
    const node = parse("/FunctionDeclaration/:bb");
    assert.deepStrictEqual(node.type, NodeType.CHILD);
    assert.partialDeepStrictEqual(node.child, { type: NodeType.CHILD, value: "bb", attribute: true });
  });
  
  
  test('descendant / child', () => {
    const node = parse("//FunctionDeclaration/AssignmentExpression");
    assert.deepStrictEqual(node?.type, NodeType.DESCENDANT);
    assert.partialDeepStrictEqual(node?.child, { type: NodeType.CHILD, value: "AssignmentExpression" });

  });
  
  test('child / descendant', () => {
    const node = parse("/FunctionDeclaration//AssignmentExpression");
    assert.deepStrictEqual(node?.type, NodeType.CHILD);
    assert.partialDeepStrictEqual(node?.child, { type: NodeType.DESCENDANT, value: "AssignmentExpression" });

  });
  
  test('child / descendant / child', () => {
    const node = parse("/FunctionDeclaration//ExpressionStatement/AssignmentExpression");
    assert.deepStrictEqual(node?.type, NodeType.CHILD);
    assert.deepStrictEqual(node?.child?.type, NodeType.DESCENDANT);
    assert.deepStrictEqual(node?.child?.child?.type, NodeType.CHILD);
  });
  
  test('single filter condition', () => {
    const node = parse("/FunctionDeclaration[/ExpressionStatement]");
    assert.deepStrictEqual(node?.type, NodeType.CHILD);
    assert.partialDeepStrictEqual(node?.filter, {type: NodeType.CHILD, value: "ExpressionStatement"});
  });
  

  test('double filter condition', () => {
    const node = parse("/FunctionDeclaration[/ExpressionStatement && /AssignmentExpression]");
    assert.deepStrictEqual(node?.type, NodeType.CHILD);
    assert.deepStrictEqual(node?.filter?.type, NodeType.AND);
    const and = node?.filter as Condition;
    assert.partialDeepStrictEqual(and.left, {type: NodeType.CHILD, value: "ExpressionStatement"});
    assert.partialDeepStrictEqual(and.right, {type: NodeType.CHILD, value: "AssignmentExpression"});
  });
  
  

  test('nested filter condition', () => {
    const node = parse("/FunctionDeclaration[/ExpressionStatement[/AssignmentExpression]]");
    assert.deepStrictEqual(node?.type, NodeType.CHILD);
    assert.deepStrictEqual(node?.filter?.type, NodeType.CHILD);
    assert.partialDeepStrictEqual(node?.filter?.filter, {type: NodeType.CHILD, value: "AssignmentExpression"});
  });
    

  test('single equals condition', () => {
    const node = parse('/FunctionDeclaration[/:x == "2"]');
    assert.deepStrictEqual(node?.filter?.type, NodeType.EQUALS);
    const filter = node.filter as Condition;
    assert.partialDeepStrictEqual(filter.left, {type: NodeType.CHILD, value: "x"});
    assert.partialDeepStrictEqual(filter.right, {type: NodeType.LITERAL, value: "2"});
  });

  test('double equals condition', () => {
    const node = parse('/FunctionDeclaration[/:x == "2" && /:y == "3"]');
    assert.deepStrictEqual(node?.filter?.type, NodeType.AND);
    const condition = node.filter as Condition;
    assert.deepStrictEqual(condition.left.type, NodeType.EQUALS);
    const leftCondition = condition.left as Condition;
    assert.partialDeepStrictEqual(leftCondition.left, {type: NodeType.CHILD, value: "x"});
    assert.partialDeepStrictEqual(leftCondition.right, {type: NodeType.LITERAL, value: "2"});
    assert.deepStrictEqual(condition.right.type, NodeType.EQUALS);
    const rightCondition = condition.right as Condition;
    assert.partialDeepStrictEqual(rightCondition.left, {type: NodeType.CHILD, value: "y"});
    assert.partialDeepStrictEqual(rightCondition.right, {type: NodeType.LITERAL, value: "3"});
  });

  test('continue after filter', () => {
    const node = parse('/FunctionDeclaration[/:x]/:y');
    assert.partialDeepStrictEqual(node?.filter, { type: NodeType.CHILD, value: "x" });
    assert.partialDeepStrictEqual(node?.child, { type: NodeType.CHILD, value: "y" });
  });
  
  test('descendant variable', () => {
    const node = parse('/FunctionDeclaration[//:x == "2"]');
    assert.partialDeepStrictEqual(node?.filter, { type: NodeType.EQUALS });
    const condition = node?.filter as Condition;
    assert.partialDeepStrictEqual(condition.left, { type: NodeType.DESCENDANT, value: "x", attribute: true });
    assert.partialDeepStrictEqual(condition.right, { type: NodeType.LITERAL });
  });
  
  test('assignment to parameter', () => {
    const node = parse("//FunctionDeclaration[/:params/:name == //AssignmentExpression/:left/:name]");
    assert.partialDeepStrictEqual(node?.filter, { type: NodeType.EQUALS });
  });
  
  test('access parent in filter', () => {
    const node = parse(`//FunctionDeclaration//AssignmentExpression[
      ../../:params/:name == /:left/:object/:name
    ]`);
    assert.partialDeepStrictEqual(node, { type: NodeType.DESCENDANT, value: "FunctionDeclaration" });
    assert.partialDeepStrictEqual(node?.child, { type: NodeType.DESCENDANT, value: "AssignmentExpression" });
    assert.partialDeepStrictEqual(node?.child?.filter, { type: NodeType.EQUALS });
    const condition = node?.child?.filter as Condition;
    assert.partialDeepStrictEqual(condition.left, { type: NodeType.PARENT });
    assert.partialDeepStrictEqual(condition.left.child, { type: NodeType.PARENT });
  })

  test('assignment to parameter', () => {
    const node = parse(`//FunctionDeclaration/*
    /AssignmentExpression`);
    assert.partialDeepStrictEqual(node, { type: NodeType.DESCENDANT, value: "FunctionDeclaration" });
    assert.partialDeepStrictEqual(node?.child, { type: NodeType.CHILD, value: "*" });
    assert.partialDeepStrictEqual(node?.child?.child, { type: NodeType.CHILD, value: "AssignmentExpression" });
  });

  test('variable is bound to parameter', () => {
    const node = parse(`//FunctionDeclaration/*
    /*
    /AssignmentExpression[
      /$:left == ../../:params
    ]`);
    //assert.partialDeepStrictEqual(node?.child?.child?.child?.filter, { type: "binding" });
    const condition = node?.child?.child?.child?.filter as Condition;
    assert.deepStrictEqual(condition.left.binding, true);
  });
  test('auto resolve value', () => {
    const node = parse(`//AssignmentExpression/$$:right/:value`);
    assert.partialDeepStrictEqual(node, { type: NodeType.DESCENDANT, value: "AssignmentExpression" });
    assert.partialDeepStrictEqual(node?.child, { type: NodeType.CHILD, resolve: true });
  });
  
  test('invoke joining of values function', () => {
    const node = parse('//ObjectExpression/:properties/fn:join(/:value, ".")');
    assert.partialDeepStrictEqual(node, { type: NodeType.DESCENDANT, value: "ObjectExpression" });
    assert.partialDeepStrictEqual(node?.child, { type: NodeType.CHILD, attribute: true, value: "properties" });
    assert.partialDeepStrictEqual(node?.child?.child, { type: NodeType.FUNCTION, function: "join" });
    const fn = node?.child?.child as FunctionCall;
    assert.partialDeepStrictEqual(fn.parameters[0], { type: NodeType.CHILD, value: "value" });
    assert.partialDeepStrictEqual(fn.parameters[1], { type: NodeType.LITERAL, value: "." });
  });

  test('function in function', () => {
    const node = parse("//ObjectExpression/fn:concat(/fn:first(/:properties/:value/:value), 'ms')");
    assert.partialDeepStrictEqual(node, { type: NodeType.DESCENDANT, value: "ObjectExpression" });
    assert.partialDeepStrictEqual(node?.child, { type: NodeType.FUNCTION, function: "concat" });
    const fn = node?.child as FunctionCall;
    assert.partialDeepStrictEqual(fn.parameters[0], { type: NodeType.FUNCTION, function: "first" });
    assert.partialDeepStrictEqual(fn.parameters[1], { type: NodeType.LITERAL, value: "ms" });
    const fn2 = fn.parameters[0] as FunctionCall;
    assert.partialDeepStrictEqual(fn2.parameters[0], { type: NodeType.CHILD, value: "properties" });
  });
  test('should parse', () => {
    const node = parse(`//ObjectExpression/fn:join(/:value/:value, ".")`);
    assert.partialDeepStrictEqual(node, { type: NodeType.DESCENDANT, value: "ObjectExpression" });
  })
});
