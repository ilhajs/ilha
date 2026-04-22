# Variable: from()

> `const` **from**: \<`TInput`, `TStateMap`\>(`selector`, `island`, `props?`) => () => `void` \| `null` = `ilhaFrom`

## Type Parameters

### TInput

`TInput`

### TStateMap

`TStateMap` _extends_ `Record`\<`string`, `unknown`\>

## Parameters

### selector

`string` | `Element`

### island

[`Island`](../interfaces/Island.md)\<`TInput`, `TStateMap`\>

### props?

`Partial`\<`TInput`\>

## Returns

() => `void` \| `null`
