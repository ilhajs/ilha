# Type Alias: HandlerContext\<TInput, TStateMap, TDerivedMap\>

> **HandlerContext**\<`TInput`, `TStateMap`, `TDerivedMap`\> = `object`

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

### event

> **event**: `Event`

---

### host

> **host**: `Element`

---

### input

> **input**: `TInput`

---

### state

> **state**: [`IslandState`](IslandState.md)\<`TStateMap`\>

---

### target

> **target**: `Element`
