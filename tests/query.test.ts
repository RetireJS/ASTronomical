import { multiQuery, query } from '../src/index';
import { ESTree as t } from "meriyah";


describe('testing index file', () => {
  const code = `function a(x) { 
    let b = 2;
    let c = 3;
    b = c;
    x.y = 25;
    return b + c;
  }`;

  test('dummy', () => {})

  test('Find FunctionExpression', () => {
    const nodes = query(code, "/FunctionDeclaration", true);
    const ast = nodes.__AST as t.Program;
    const expectedNode = ast.body[0] as t.FunctionDeclaration;
    expect(nodes.length).toEqual(1);
    expect(nodes[0]).toBeDefined();
    expect(nodes[0]).toEqual(expectedNode);
  });
  test('Find FunctionExpressions identifier', () => {
    const nodes = query(code, "/FunctionDeclaration/Identifier", true);
    const ast = nodes.__AST as t.Program;
    const functionD = ast.body[0] as t.FunctionDeclaration;
    const expectedNode1 = functionD.id as t.Identifier;
    const expectedNode2 = functionD.params[0] as t.Identifier;
    expect(nodes.length).toEqual(2);
    expect(nodes[0]).toBeDefined();
    expect(nodes[0]).toEqual(expectedNode1);
    expect(nodes[1]).toBeDefined();
    expect(nodes[1]).toEqual(expectedNode2);
  });

  test('Find identifiers below FunctionExpression', () => {
    const nodes = query(code, "/FunctionDeclaration//Identifier");
    expect(nodes.length).toEqual(10);
  });
  
  test('Find identifiers below FunctionExpression', () => {
    const nodes = query(code, "/FunctionDeclaration/:id");
    expect(nodes.length).toEqual(1);
    const identifier = nodes[0] as t.Identifier;
    expect(identifier.name).toEqual("a");
  });


  test('Find identifiers below FunctionExpression', () => {
    const nodes = query(code, "/FunctionDeclaration/:params/:name");
    expect(nodes.length).toEqual(1);
    expect(nodes[0]).toEqual("x");
  });
    

  
  test('Find named FunctionExpression', () => {
    const nodes = query(code, '/FunctionDeclaration[/:id/:name == "a"]', true);
    const ast = nodes.__AST as t.Program;
    const expectedNode = ast!.body[0] as t.FunctionDeclaration;
    expect(nodes[0]).toBeDefined();
    expect(nodes[0]).toEqual(expectedNode);
  });
  
  test('Dont find wrongly named FunctionExpression', () => {
    const nodes = query(code, '/FunctionDeclaration[/:id/:name == "b"]');
    expect(nodes[0]).toEqual(undefined);
  });
  
  test('Find named FunctionExpression double declaration', () => {
    const nodes = query(code, '/FunctionDeclaration[/:id/:name == "b" || /:id/:name == "a"]', true);
    const ast = nodes.__AST as t.Program;
    const expectedNode = ast!.body[0] as t.FunctionDeclaration;
    expect(nodes[0]).toBeDefined();
    expect(nodes[0]).toEqual(expectedNode);
  });

  test('Find named FunctionExpression triple declaration', () => {
    const nodes = query(code, '/FunctionDeclaration[/:id/:name == "b" || /:id/:name == "a" || /:id/:name == "c"]', true);
    const ast = nodes.__AST as t.Program;
    const expectedNode = ast!.body[0] as t.FunctionDeclaration;
    expect(nodes[0]).toBeDefined();
    expect(nodes[0]).toEqual(expectedNode);
  });
  test('Find named FunctionExpression nested', () => {
    const nodes = query(code, '/FunctionDeclaration[/:id[/:name == "a"]]', true);
    const ast = nodes.__AST as t.Program;
    const expectedNode = ast!.body[0] as t.FunctionDeclaration;
    expect(nodes[0]).toBeDefined();
    expect(nodes[0]).toEqual(expectedNode);
  });
  
  test('Dont find named FunctionExpression nested when wrong name', () => {
    const nodes = query(code, '/FunctionDeclaration[/:id[/:name == "b"]]');
    expect(nodes.length).toEqual(0);
  });
  
  test('Find named FunctionExpression as descendant', () => {
    const nodes = query(code, "/FunctionDeclaration//AssignmentExpression");
    expect(nodes.length).toEqual(2);
    const assignmentExpression = nodes[0] as t.AssignmentExpression;
    expect(assignmentExpression).toBeDefined();
    expect(assignmentExpression.left.type).toEqual("Identifier");
    expect(assignmentExpression.right.type).toEqual("Identifier");
  }); 

  test('Find named FunctionExpression as descendant', () => {
    const nodes = query(code, "//AssignmentExpression[/:left/:name == 'b']/:right/:name");
    expect(nodes.length).toEqual(1);
    expect(nodes[0]).toEqual("c");
  });
  
  
  test('Find named decalartion as descendant', () => {
    const nodes = query(code, "//VariableDeclarator[/:id/:name == 'c']/:init/:value");
    expect(nodes[0]).toEqual(3);
  });
  test('Find named decalartion as descendant', () => {
    const nodes = query(code, "//VariableDeclarator[/:id/:name == 'k']/:init/:value");
    expect(nodes.length).toEqual(0);
  });
  
  


  test("find assigment to parameter", () => {
    const nodes = query(code, "//FunctionDeclaration[/:params/:name == //AssignmentExpression/:left/:object/:name]");
    //const nodes = query(ast!, "//FunctionDeclaration//AssignmentExpression/:left/:object/:name");
    expect(nodes.length).toEqual(1);
  });
  test("find double function expression", () => {
    const code = `function a() { function b() { let b = 2; } }`;
    const nodes = query(code, "//FunctionDeclaration[//VariableDeclarator//Identifier/:name == 'b']");
    expect(nodes.length).toEqual(2);
    expect(nodes[0] == nodes[1]).toEqual(false);
    //@ts-expect-error should be right type 
    expect(nodes[0].type).toEqual("FunctionDeclaration");
    //@ts-expect-error should be right type 
    expect(nodes[1].type).toEqual("FunctionDeclaration");
  });
  test("find assigment to named parameter", () => {
    const nodes = query(code, `//FunctionDeclaration[
      /:params/:name == //AssignmentExpression/:left/:object/:name && 
      //AssignmentExpression/:left/:property/:name == 'y'
    ]`);
    //const nodes = query(ast!, "//FunctionDeclaration//AssignmentExpression/:left/:object/:name");
    expect(nodes.length).toEqual(1);
  });

  test("find assigment to named parameter", () => {
    const nodes = query(code, 
    `//FunctionDeclaration//AssignmentExpression[
      ../../../:params/:name == /:left/:object/:name && 
      /:left/:property/:name == 'y'
    ]`);
    //const nodes = query(ast!, "//FunctionDeclaration//AssignmentExpression/:left/:object/:name");
    expect(nodes.length).toEqual(1);
  });

  test("find assigment to named parameter and get the value", () => {
    const nodes = query(code, `//FunctionDeclaration//AssignmentExpression[
      ../../../:params/:name == /:left/:object/:name && 
      /:left/:property/:name == 'y'
    ]/:right/:value`);
    expect(nodes).toEqual([25]);
  });
  
  test("Should work with wildcards", () => {
    const nodes = query(code, `//FunctionDeclaration//AssignmentExpression/*
    /Identifier/:name`);
    expect(nodes).toEqual(['x', 'y']);
  });
  
  test("should find assigment property of object bound to function parameter", () => {
    const nodes = query(code, `//FunctionDeclaration//AssignmentExpression[
      /:left/$:object == ../../../:params 
    ]/:right/:value`);
    expect(nodes).toEqual([25]);
  });

  
  test("should return binding", () => {
    const nodes = query(code, `//FunctionDeclaration//AssignmentExpression/:left/$:object`);
    expect(nodes[0]).toMatchObject({name: "x"});
  });

  test("should return binding value", () => {
    const nodes = query(code, `//FunctionDeclaration//AssignmentExpression/$:right/:init/:value`);
    expect(nodes).toEqual([3]);
  });
  
  test("should return named binding value", () => {
    const nodes = query(code, `//FunctionDeclaration//AssignmentExpression[/:left/:name == 'b']/$:right/:init/:value`);
    expect(nodes).toEqual([3]);
  });

  
  
  test("should NOT find assigment property of object bound to function parameter", () => {
    const nodes = query(code, `//FunctionDeclaration//AssignmentExpression[
      /:left/$:property == ../../../:params 
    ]/:right/:value`);
    expect(nodes).toEqual([]);
  });

  test("should only add double filtered nodes once", () => {
    const code = (`function a() { function b() { let c = 2; } }`);
    const nodes = query(code, `//FunctionDeclaration[/:id/:name == 'a']//FunctionDeclaration[/:id/:name == 'b']//VariableDeclaration//Identifier/:name`);
    expect(nodes).toEqual(['c']);
  })

  test("should resolve value", () => {
    const code = "let x = 1; let y = 2; x = y; y = 3";
    const nodes = query(code, "//AssignmentExpression/$$:right/:value");
    expect(nodes).toEqual([2, 3]);
  });
  test("should join values", () => {
    const code = "var a = { b: 1, c: 2 }";
    const nodes = query(code, "//ObjectExpression/fn:join(/:properties/:value/:value, '.')");
    expect(nodes).toEqual(["1.2"]);
  });
  test("should find first", () => {
    const code = "var a = { b: 1, c: 2 }";
    const nodes = query(code, "//ObjectExpression/fn:first(/:properties/:value/:value)");
    expect(nodes).toEqual([1]);
  });
  test("should concat values", () => {
    const code = "var a = { b: 1, c: 2 }";
    const nodes = query(code, "//ObjectExpression/fn:concat(/:properties/:value/:value, 'ms')");
    expect(nodes).toEqual(["12ms"]);
  });
  
  test("should call function in function values", () => {
    const code = "var a = { b: 1, c: 2 }";
    const nodes = query(code, "//ObjectExpression/fn:concat(/fn:first(/:properties/:value/:value), 'ms')");
    expect(nodes).toEqual(["1ms"]);
  });
  test("should be able to filter", () => {
    const code = "var a = { b: 1, c: 2 }; var d = { x: 27}";
    const nodes = query(code, `//ObjectExpression[//:name == 'x']/fn:concat(/:properties/:value/:value, 'ms')`);
    console.log(nodes);
    expect(nodes.length).toEqual(1);
  });
  test("should pick nth child", () => {
    const code = "var a = { b: 1, c: 2 }";
    const nodes = query(code, `//ObjectExpression/fn:nthchild(/:properties/:value/:value, 1)`);
    console.log(nodes);
    expect(nodes.length).toEqual(1);
    expect(nodes[0]).toEqual(2);
  });
  test("should pick nth child by key", () => {
    const code = "var a = { b: 1, c: 2 }";
    const nodes = query(code, `//ObjectExpression/:1/:value/:value`);
    console.log(nodes);
    expect(nodes.length).toEqual(1);
    expect(nodes[0]).toEqual(2);
  });
  
  test("object expression selection", () => {
    const code = "let k = 32; var a = { b: 1, c: 2 }; var d = { b: k, e: 3}";
    const nodes = query(code, `//ObjectExpression[
        /Property/:key/:name == 'e'
      ]/Property[/:key/:name == 'b']/$:value/:init/:value`);
    console.log(nodes);
    expect(nodes).toEqual([32]);
  })
  
  test("find binding to function name", () => {
    const code = `
    function a(x) {
      function b() {}
      let k = 1;
      b.c = k;
    }`
    const queries = {
      A : "//MemberExpression/$:object",
      B : "//FunctionDeclaration//FunctionDeclaration/:id"
    }
    const result = multiQuery(code, queries);
    const nodes1 = result.A;
    const nodes2 = result.B;
    expect(nodes1).toEqual(nodes2);
  });
  test("find correct binding when exported", () => {
    const code = `
    let a = 1;
    let b = 2;
    b = a;
    export {
      a
    }`
    const nodes = query(code, "//AssignmentExpression/$:right/:init/:value");
    console.log(nodes);
    expect(nodes).toEqual([1]);
  });

  test("should hoist variables to function scope", () => {
    const code = `
      function a() {
        for(var x=0,u=22; x<10; x++) {
        }
        return u;
      }
    `
    const nodes = query(code, "//ReturnStatement/$:argument/:init/:value");
    expect(nodes).toEqual([22]);
  })
  
});


