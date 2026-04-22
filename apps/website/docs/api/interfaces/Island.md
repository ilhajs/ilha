# Interface: Island()\<TInput, \_TStateMap\>

## Type Parameters

### TInput

`TInput` = `Record`\<`string`, `unknown`\>

### \_TStateMap

`_TStateMap` _extends_ `Record`\<`string`, `unknown`\> = `Record`\<`string`, `unknown`\>

> **Island**(`props?`): `string` \| `Promise`\<`string`\>

## Parameters

### props?

`Partial`\<`TInput`\>

## Returns

`string` \| `Promise`\<`string`\>

## Methods

### hydratable()

> **hydratable**(`props`, `options`): `Promise`\<`string`\>

#### Parameters

##### props

`Partial`\<`TInput`\>

##### options

[`HydratableOptions`](HydratableOptions.md)

#### Returns

`Promise`\<`string`\>

---

### mount()

> **mount**(`host`, `props?`): () => `void`

#### Parameters

##### host

`Element`

##### props?

`Partial`\<`TInput`\>

#### Returns

> (): `void`

##### Returns

`void`

---

### toString()

> **toString**(`props?`): `string`

#### Parameters

##### props?

`Partial`\<`TInput`\>

#### Returns

`string`
