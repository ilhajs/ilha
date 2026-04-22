# Type Alias: IslandDerived\<TDerivedMap\>

> **IslandDerived**\<`TDerivedMap`\> = `{ readonly [K in keyof TDerivedMap]: DerivedValue<TDerivedMap[K]> }`

## Type Parameters

### TDerivedMap

`TDerivedMap` _extends_ `Record`\<`string`, `unknown`\>
