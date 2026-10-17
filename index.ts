import { z } from 'zod'
import Dexie from 'dexie'
import type { DatabaseSchema, TableInterface, Query } from 'asasvirtuais/interface'

const operators = ['$ne', '$in', '$nin', '$lt', '$lte', '$gt', '$gte'] as const

/**
 * Whether a record matches a query: field matches, `$ne $lt $lte $gt $gte $in $nin`, and nested `$or` / `$and`.
 */
export function matches(item: Record<string, any>, query: Query<any> = {}): boolean {
    return Object.entries(query).every(([key, value]) => {
        if (key === '$or') return (value as Query<any>[]).some(sub => matches(item, sub))
        if (key === '$and') return (value as Query<any>[]).every(sub => matches(item, sub))
        if (key.startsWith('$')) return true // $limit, $skip, $sort and $select are not filters
        const itemValue = item[key]
        if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some(op => (operators as readonly string[]).includes(op))) {
            return Object.entries(value).every(([op, opValue]) => {
                switch (op) {
                    case '$ne': return itemValue !== opValue
                    case '$in': return Array.isArray(opValue) && opValue.includes(itemValue)
                    case '$nin': return Array.isArray(opValue) && !opValue.includes(itemValue)
                    case '$lt': return itemValue < (opValue as any)
                    case '$lte': return itemValue <= (opValue as any)
                    case '$gt': return itemValue > (opValue as any)
                    case '$gte': return itemValue >= (opValue as any)
                    default: return true
                }
            })
        }
        return itemValue === value
    })
}

/**
 * Creates a TableInterface adapter for IndexedDB using Dexie.js.
 * This allows the framework to be used in a client-side only context.
 *
 * @param dbName The name of the IndexedDB database.
 * @param schema The Zod schema definition for the database tables.
 * @param version The Dexie schema version. Bump it when the tables or their fields change.
 * @returns A TableInterface implementation for Dexie.
 */
export function indexedInterface<Schema extends DatabaseSchema>(
    dbName: string,
    schema: Schema,
    version = 1,
): TableInterface<z.infer<Schema[keyof Schema]['readable']>, z.infer<Schema[keyof Schema]['writable']>> {

    const db = new Dexie(dbName)

    // Dynamically define the database schema for Dexie from the Zod schema.
    // It marks 'id' as the primary key and indexes all other top-level readable fields.
    // Values that aren't valid IndexedDB keys (objects, booleans) are simply left out of their index.
    const dexieSchema = Object.fromEntries(
        Object.keys(schema).map(tableName => {
            const fields = Object.keys(schema[tableName].readable.shape)
            const indexedFields = fields.filter(f => f !== 'id').join(', ')
            return [tableName, indexedFields ? `id, ${indexedFields}` : 'id']
        })
    )

    db.version(version).stores(dexieSchema)

    type GenericReadable = z.infer<Schema[keyof Schema]['readable']>
    type GenericWritable = z.infer<Schema[keyof Schema]['writable']>

    const methods = {
        async find({ table, id }) {
            if (!table) throw new Error('Table name must be provided.')
            const result = await db.table(table).get(id)
            if (!result) throw new Error(`Record with id ${id} not found in ${table}`)
            return result
        },

        async list({ table, query }) {
            if (!table) throw new Error('Table name must be provided.')
            const { $limit, $skip, $sort, $select } = query ?? {}

            let rows: Record<string, any>[] = await db.table(table).filter(item => matches(item, query)).toArray()

            if ($sort) {
                const keys = Object.entries($sort) as [string, 1 | -1][]
                rows.sort((a, b) => {
                    for (const [key, direction] of keys) {
                        if (a[key] < b[key]) return -direction
                        if (a[key] > b[key]) return direction
                    }
                    return 0
                })
            }
            if ($skip) rows = rows.slice($skip)
            if ($limit) rows = rows.slice(0, $limit)
            if ($select) rows = rows.map(row => Object.fromEntries(['id', ...$select as string[]].map(key => [key, row[key]])))

            return rows as GenericReadable[]
        },

        async create({ table, data }) {
            if (!table) throw new Error('Table name must be provided.')
            // Use existing id or generate a new UUID
            const id = (data as any).id || crypto.randomUUID()
            const record = { ...data, id }
            await db.table(table).add(record)
            return record as GenericReadable
        },

        async update({ table, id, data }) {
            if (!table) throw new Error('Table name must be provided.')
            const updatedCount = await db.table(table).update(id, data as any)
            if (updatedCount === 0) {
                // Dexie reports 0 both for a missing record and for an update that changes nothing.
                await methods.find({ table, id })
            }
            const result = await methods.find({ table, id })
            return result as GenericReadable
        },

        async remove({ table, id }) {
            if (!table) throw new Error('Table name must be provided.')
            const record = await methods.find({ table, id })
            await db.table(table).delete(id)
            return record as GenericReadable
        },
    } as TableInterface<GenericReadable, GenericWritable>

    return methods
}

export default indexedInterface
