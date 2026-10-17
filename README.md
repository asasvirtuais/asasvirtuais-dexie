# asasvirtuais-dexie

An IndexedDB `TableInterface` for [asasvirtuais](https://www.npmjs.com/package/asasvirtuais), built on Dexie. Prototype a whole
app in the browser, then swap this interface for your server actions — the UI stays the same.

```tsx
import indexedInterface from 'asasvirtuais-dexie'
import { InterfaceProvider } from 'asasvirtuais/context'
import { schema } from './schema'

const db = indexedInterface('my-app', schema)

<InterfaceProvider {...db}>{children}</InterfaceProvider>
```

`indexedInterface(dbName, schema, version = 1)` — bump `version` when tables or fields change.

`list` supports the framework's whole query: field matches, `$ne $lt $lte $gt $gte $in $nin`, nested `$or` / `$and`, and
`$sort` (several keys), `$skip`, `$limit`, `$select`. `matches(record, query)` is exported for reuse.
