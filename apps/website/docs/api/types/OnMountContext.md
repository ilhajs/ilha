# Type Alias: OnMountContext\<TInput, TStateMap, TDerivedMap\>

> **OnMountContext**\<`TInput`, `TStateMap`, `TDerivedMap`\> = `object`

## Type Parameters

### TInput

`TInput`

### TStateMap

`TStateMap` _extends_ `Record`\<`string`, `unknown`\>

### TDerivedMap

`TDerivedMap` _extends_ `Record`\<`string`, `unknown`\> = `Record`\<`string`, `never`\>

## Properties

### derived

> **derived**: [`IslandDerived`](IslandDerived.md)\<`TDerivedMap`\>

---

### host

> **host**: `Element`

---

### hydrated

> **hydrated**: `boolean`

---

### input

> **input**: `TInput`

---

### state

> **state**: [`IslandState`](IslandState.md)\<`TStateMap`\>
