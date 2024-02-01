# babel-q

`babel-q` offers a way to query an babel AST to find specific patterns using a syntax somewhat similar to XPath. 
`babel-q` was inspired by [astq](https://github.com/rse/astq), but offers some features that did not seem possible in `astq` and also has some limits compared to `astq`.

Goals:

* Should try to traverse the AST only once when resolving the Query
* Should allow filtering of nodes
* Allow running multiple queries at the same time _without traversing the AST multiple times_

## Example


The following pattern:
```
//AssignmentExpression[
      /MemberExpression[
        /:property/:name == "migrateVersion" && 
        /$:object == ../../../../:params
      ]
    ]/:right/:value
```
tries to find the following code snippet and returns the string value assigned to the `migrateVersion` property:
```
...
  function( jQuery, window ) {
    ...
    jQuery.migrateVersion = "3.4.1";
    ...
  }
...
```
Find an AssignmentExpression at arbitrary depth, which directly contains a MemberExpression where the property name is "migrateVersion" and
the object is bound to a parameter of the surrounding function, an return the assigned value.

## Grammar

* `/<node type>` - find a child node of the given type
* `//<node type>` - find a descendant of the given type
* `/:<name>` - find an attribute of the current node with the given name
* `//:<name>` - find an attribute of the current node with the given name regardless of whether it's on the current node or on a descendant
* `/$:<name>` - find the binding of an Identifier
* `[]` - apply a filter to the node
* `&&`, `||` - logical conditions of a filter
* `==` - comparison in filter
* `../` - go to parent in filter (use with care, as this causes extra traversal)
* `/*` - wildcard type child
* `//*` - wildcard type descendant
* `'<some value>'`,`"<some value>"` - a string literal 

## API

* `query(code: ParseResult<Babel.File> | string, query: string) : Result[]` - Runs the given query on the given code in the form of an already parsed AST or a string (which is parsed as `sourceType: "script"`), and returns the result.
* `multiQuery<T extends Record<string, string>>(code: ParseResult<Babel.File> | string, namedQueries: T) : Record<keyof T, Result[]>` - Runs the given set of named queries on the given code in the form of an already parsed AST or a string (which is parsed as `sourceType: "script"`), and returns a map of named results (one result array per named query).

where `Result` is `Babel.Node | string | number | boolean;`


## Example code

```
import { query } from "babel-q";
import * as fs from "fs";

const contents = fs.readFileSync("some-file.js");

const result = query(
  contents,
  `//FunctionDeclaration/:id/:name`
);

console.log("Function names", result);
```

