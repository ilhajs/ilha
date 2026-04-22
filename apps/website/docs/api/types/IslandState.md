# Type Alias: IslandState\<TStateMap\>

> **IslandState**\<`TStateMap`\> = `{ readonly [K in keyof TStateMap]-?: SignalAccessor<TStateMap[K]> }`

## Type Parameters

### TStateMap

`TStateMap` _extends_ `Record`\<`string`, `unknown`\>
