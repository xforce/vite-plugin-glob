import type { ArrayExpression, CallExpression, Literal, Node } from 'estree'
import { parseExpressionAt } from 'acorn'
import type { GeneralGlobOptions, ParsedImportGlob } from '../types'
import { toAbsoluteGlob } from './glob'

const importGlobRE = /\bimport\.meta\.(importGlob|glob|globEager|globEagerDefault)(?:<\w+>)?\s*\(/g

const knownOptions = {
  as: 'string',
  eager: 'boolean',
  export: 'string',
  exhaustive: 'boolean',
} as const

const forceDefaultAs = ['raw', 'url']

export async function parseImportGlob(
  code: string,
  dir: string | null,
  root: string,
  resolveId: (id: string) => string | Promise<string>,
): Promise<ParsedImportGlob[]> {
  const matchs = Array.from(code.matchAll(importGlobRE))

  const tasks = matchs.map(async(match, index) => {
    const type = match[1]
    const start = match.index!

    const err = (msg: string) => {
      const e = new Error(`Invalid glob import syntax: ${msg}`)
      ;(e as any).pos = start
      return e
    }

    let ast: CallExpression

    try {
      ast = parseExpressionAt(
        code,
        start,
        {
          ecmaVersion: 'latest',
          sourceType: 'module',
          ranges: true,
        },
      ) as any
    }
    catch (e) {
      const _e = e as any
      if (_e.message && _e.message.startsWith('Unterminated string constant'))
        return undefined!
      throw _e
    }

    if (ast.type !== 'CallExpression')
      throw err(`Expect CallExpression, got ${ast.type}`)

    if (ast.arguments.length < 1 || ast.arguments.length > 2)
      throw err(`Expected 1-2 arguments, but got ${ast.arguments.length}`)

    const arg1 = ast.arguments[0] as ArrayExpression | Literal
    const arg2 = ast.arguments[1] as Node | undefined

    const globs: string[] = []
    if (arg1.type === 'ArrayExpression') {
      for (const element of arg1.elements) {
        if (!element)
          continue
        if (element.type !== 'Literal')
          throw err('Could only use literals')
        if (typeof element.value !== 'string')
          throw err(`Expected glob to be a string, but got "${typeof element.value}"`)

        globs.push(element.value)
      }
    }
    else if (arg1.type === 'Literal') {
      if (typeof arg1.value !== 'string')
        throw err(`Expected glob to be a string, but got "${typeof arg1.value}"`)
      globs.push(arg1.value)
    }
    else {
      throw err('Could only use literals')
    }

    // if (!globs.every(i => i.match(/^[.\/!]/)))
    //   throw err('pattern must start with "." or "/" (relative to project root) or alias path')

    // arg2
    const options: GeneralGlobOptions = {}
    if (arg2) {
      if (arg2.type !== 'ObjectExpression')
        throw err(`Expected the second argument o to be a object literal, but got "${arg2.type}"`)

      for (const property of arg2.properties) {
        if (property.type === 'SpreadElement' || property.key.type !== 'Identifier')
          throw err('Could only use literals')

        const name = property.key.name as keyof GeneralGlobOptions

        if (name === 'query') {
          if (property.value.type === 'ObjectExpression') {
            const data: Record<string, string> = {}
            for (const prop of property.value.properties) {
              if (prop.type === 'SpreadElement' || prop.key.type !== 'Identifier' || prop.value.type !== 'Literal')
                throw err('Could only use literals')
              data[prop.key.name] = prop.value.value as any
            }
            options.query = data
          }
          else if (property.value.type === 'Literal') {
            if (typeof property.value.value !== 'string')
              throw err(`Expected query to be a string, but got "${typeof property.value.value}"`)
            options.query = property.value.value
          }
          else {
            throw err('Could only use literals')
          }
          continue
        }

        if (!(name in knownOptions))
          throw err(`Unknown options ${name}`)

        if (property.value.type !== 'Literal')
          throw err('Could only use literals')

        const valueType = typeof property.value.value
        if (valueType === 'undefined')
          continue

        if (valueType !== knownOptions[name])
          throw err(`Expected the type of option "${name}" to be "${knownOptions[name]}", but got "${valueType}"`)
        options[name] = property.value.value as any
      }
    }

    if (options.as && forceDefaultAs.includes(options.as)) {
      if (options.export && options.export !== 'default')
        throw err(`Option "export" can only be "default" when "as" is "${options.as}", but got "${options.export}"`)
      options.export = 'default'
    }

    if (options.as && options.query)
      throw err('Options "as" and "query" cannot be used together')

    if (options.as)
      options.query = options.as

    const end = ast.range![1]

    const globsResolved = await Promise.all(globs.map(glob => toAbsoluteGlob(glob, root, dir ?? root, resolveId)))
    const isRelative = globs.every(i => '.!'.includes(i[0]))

    return {
      match,
      index,
      globs,
      globsResolved,
      isRelative,
      options,
      type,
      start,
      end,
    }
  })

  return (await Promise.all(tasks))
    .filter(Boolean)
}
