# Type Alias: HandlerContextFor\<TInput, TStateMap, TEventName, TDerivedMap\>

> **HandlerContextFor**\<`TInput`, `TStateMap`, `TEventName`, `TDerivedMap`\> = `object`

## Type Parameters

### TInput

`TInput`

### TStateMap

`TStateMap` _extends_ `Record`\<`string`, `unknown`\>

### TEventName

`TEventName` _extends_ `string`

### TDerivedMap

`TDerivedMap` _extends_ `Record`\<`string`, `unknown`\> = `Record`\<`string`, `never`\>

## Properties

### derived

> **derived**: [`IslandDerived`](IslandDerived.md)\<`TDerivedMap`\>

---

### event

> **event**: `TEventName` _extends_ keyof `HTMLElementEventMap` ? `HTMLElementEventMap`\[`TEventName`\] : `Event`

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

> **target**: `TEventName` _extends_ keyof `HTMLElementEventMap` ? `HTMLElementEventMap`\[`TEventName`\]\[`"target"`\] _extends_ `Element` \| `null` ? `NonNullable`\<`HTMLElementEventMap`\[`TEventName`\]\[`"target"`\]\> : `Element` : `Element`
