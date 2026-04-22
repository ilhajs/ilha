# Variable: default

> `const` **default**: `IlhaBuilder`\<`Record`\<`string`, `unknown`\>, `Record`\<`string`, `never`\>, `Record`\<`string`, `never`\>, `Record`\<`string`, `never`\>\> & `object`

## Type Declaration

### context()

> **context**: \<`T`\>(`key`, `initial`) => `ContextSignal`\<`T`\> = `ilhaContext`

#### Type Parameters

##### T

`T`

#### Parameters

##### key

`string`

##### initial

`T`

#### Returns

`ContextSignal`\<`T`\>

### from()

> **from**: \<`TInput`, `TStateMap`\>(`selector`, `island`, `props?`) => () => `void` \| `null` = `ilhaFrom`

#### Type Parameters

##### TInput

`TInput`

##### TStateMap

`TStateMap` _extends_ `Record`\<`string`, `unknown`\>

#### Parameters

##### selector

`string` | `Element`

##### island

[`Island`](../interfaces/Island.md)\<`TInput`, `TStateMap`\>

##### props?

`Partial`\<`TInput`\>

#### Returns

() => `void` \| `null`

### html()

> **html**: (`strings`, ...`values`) => [`RawHtml`](../interfaces/RawHtml.md) = `ilhaHtml`

#### Parameters

##### strings

`TemplateStringsArray`

##### values

...`unknown`[]

#### Returns

[`RawHtml`](../interfaces/RawHtml.md)

### mount()

> **mount**: (`registry`, `options`) => [`MountResult`](../interfaces/MountResult.md) = `mountAll`

#### Parameters

##### registry

`IslandRegistry`

##### options

[`MountOptions`](../interfaces/MountOptions.md) = `{}`

#### Returns

[`MountResult`](../interfaces/MountResult.md)

### raw()

> **raw**: (`value`) => [`RawHtml`](../interfaces/RawHtml.md) = `ilhaRaw`

#### Parameters

##### value

`string`

#### Returns

[`RawHtml`](../interfaces/RawHtml.md)
